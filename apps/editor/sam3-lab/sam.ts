import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import sharp from 'sharp'
import { z } from 'zod'

export const ENDPOINT = 'https://fal.run/fal-ai/sam-3/image'
export const REQUEST_HEADERS = {
  'Content-Type': 'application/json',
  'X-Fal-Store-IO': '0',
  'X-Fal-No-Retry': '1',
  'x-app-fal-disable-fallback': 'true',
}
const MAX_BYTES = 32 * 1024 * 1024
const integer = z.number().int().nonnegative()
const objectId = z.number().int().nonnegative()
export const promptSchema = z
  .object({
    prompt: z.string().max(500),
    point_prompts: z
      .array(
        z
          .object({
            x: integer,
            y: integer,
            label: z.union([z.literal(0), z.literal(1)]),
            object_id: objectId,
          })
          .strict(),
      )
      .max(100),
    box_prompts: z
      .array(
        z
          .object({
            x_min: integer,
            y_min: integer,
            x_max: integer,
            y_max: integer,
            object_id: objectId,
          })
          .strict(),
      )
      .max(10),
    max_masks: z.number().int().min(1).max(32),
  })
  .strict()
export type Prompts = z.infer<typeof promptSchema>
export type Source = { name: string; width: number; height: number; sha256: string; png: Buffer }
export type Mask = {
  index: number
  width: number
  height: number
  coverage: number
  bbox: [number, number, number, number] | null
  score: number | null
  rawUrl: string
  maskUrl: string
  overlayUrl: string
  positiveHits: number
  positiveCount: number
  negativeHits: number
  negativeCount: number
  warnings: string[]
}
export type SamRun = {
  id: string
  status: 'completed' | 'failed'
  createdAt: string
  durationMs: number
  input: Prompts
  image: Omit<Source, 'png'>
  provider: {
    endpoint: string
    requestId: string | null
    httpStatus: number | null
    reportedCostUsd: number | null
  }
  masks: Mask[]
  warnings: string[]
  error?: string
}

export async function loadSource(options: {
  image?: string
  inspection?: string
}): Promise<Source> {
  if (Boolean(options.image) === Boolean(options.inspection))
    throw new Error('Specify exactly one of --image or --inspection.')
  let bytes: Buffer
  let name: string
  if (options.inspection) {
    const inspection = JSON.parse(await readFile(options.inspection, 'utf8'))
    const dataUrl = inspection.source?.imageDataUrl
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,'))
      throw new Error('Inspection export must include source.imageDataUrl as PNG.')
    bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
    name = inspection.source.name ?? basename(options.inspection)
  } else {
    bytes = await readFile(options.image!)
    name = basename(options.image!)
  }
  if (bytes.length > MAX_BYTES)
    throw new Error('Source exceeds 32 MiB. Prepare an explicit smaller source first.')
  const { data, info } = await sharp(bytes, { limitInputPixels: 4096 * 4096, animated: false })
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true })
  if (info.width > 4096 || info.height > 4096)
    throw new Error('Source exceeds 4096 pixels on one side. No implicit resizing is performed.')
  return {
    name,
    width: info.width,
    height: info.height,
    sha256: createHash('sha256').update(data).digest('hex'),
    png: data,
  }
}

export function validatePrompts(value: unknown, source: Source): Prompts {
  const prompts = promptSchema.parse(value)
  if (
    !prompts.prompt.trim() &&
    !prompts.point_prompts.some((p) => p.label === 1) &&
    prompts.box_prompts.length === 0
  )
    throw new Error(
      'Use text, a positive point, or a box; negative points alone do not identify a target.',
    )
  for (const point of prompts.point_prompts) {
    if (point.x >= source.width || point.y >= source.height)
      throw new Error('A point lies outside the source image.')
  }
  for (const box of prompts.box_prompts) {
    if (
      box.x_min >= box.x_max ||
      box.y_min >= box.y_max ||
      box.x_max > source.width ||
      box.y_max > source.height
    )
      throw new Error('A box must have positive area and lie inside the source image.')
  }
  return prompts
}

export function requestBody(source: Source, prompts: Prompts) {
  return {
    image_url: `data:image/png;base64,${source.png.toString('base64')}`,
    ...prompts,
    apply_mask: false,
    sync_mode: true,
    output_format: 'png',
    return_multiple_masks: true,
    include_scores: true,
    include_boxes: true,
  }
}

async function boundedBytes(response: Response): Promise<Buffer> {
  if (!response.body) throw new Error('Provider returned no body.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > MAX_BYTES)
        throw new Error(
          'Provider payload exceeded 32 MiB; inspect the failed run before changing mask count.',
        )
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

async function readMask(url: string, signal: AbortSignal): Promise<Buffer> {
  if (url.startsWith('data:image/png;base64,')) {
    if (url.length > Math.ceil((MAX_BYTES * 4) / 3) + 100)
      throw new Error('Mask data URI exceeds byte limit.')
    return Buffer.from(url.slice('data:image/png;base64,'.length), 'base64')
  }
  const parsed = new URL(url)
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !(parsed.hostname === 'fal.media' || parsed.hostname.endsWith('.fal.media'))
  )
    throw new Error('Mask URL is not an HTTPS fal.media asset.')
  const response = await fetch(url, { signal, redirect: 'error' })
  if (!response.ok) throw new Error(`Mask download returned HTTP ${response.status}.`)
  return boundedBytes(response)
}

async function inspectMask(
  bytes: Buffer,
  source: Source,
  prompts: Prompts,
  index: number,
  score: number | null,
  out: string,
): Promise<Mask> {
  await writeFile(join(out, `mask-${index}.raw.png`), bytes, { mode: 0o600 })
  const image = sharp(bytes, { limitInputPixels: 4096 * 4096, animated: false })
  const metadata = await image.metadata()
  if (
    metadata.format !== 'png' ||
    metadata.width !== source.width ||
    metadata.height !== source.height ||
    (metadata.pages ?? 1) !== 1
  )
    throw new Error(`Mask ${index} is not a source-sized single PNG; refusing to rescale it.`)
  const { data } = await image
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let alphaVaries = false
  for (let i = 3; i < data.length; i += 4)
    if (data[i] !== 255) {
      alphaVaries = true
      break
    }
  const binary = Buffer.alloc(source.width * source.height)
  const tint = Buffer.alloc(binary.length * 4)
  let foreground = 0
  let softPixels = 0
  let minX = source.width
  let minY = source.height
  let maxX = -1
  let maxY = -1
  for (let i = 0; i < binary.length; i++) {
    const offset = i * 4
    const value = alphaVaries
      ? data[offset + 3]!
      : Math.round(0.2126 * data[offset]! + 0.7152 * data[offset + 1]! + 0.0722 * data[offset + 2]!)
    if (value > 0 && value < 255) softPixels++
    if (value < 128) continue
    binary[i] = 255
    foreground++
    const x = i % source.width
    const y = Math.floor(i / source.width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    tint[offset] = 0
    tint[offset + 1] = 170
    tint[offset + 2] = 230
    tint[offset + 3] = 150
  }
  const mask = await sharp(binary, {
    raw: { width: source.width, height: source.height, channels: 1 },
  })
    .png()
    .toBuffer()
  const overlay = await sharp(source.png)
    .composite([{ input: tint, raw: { width: source.width, height: source.height, channels: 4 } }])
    .png()
    .toBuffer()
  await Promise.all([
    writeFile(join(out, `mask-${index}.png`), mask, { mode: 0o600 }),
    writeFile(join(out, `overlay-${index}.png`), overlay, { mode: 0o600 }),
  ])
  const positives = prompts.point_prompts.filter((p) => p.label === 1)
  const negatives = prompts.point_prompts.filter((p) => p.label === 0)
  const hitCount = (points: typeof positives) =>
    points.filter((p) => binary[p.y * source.width + p.x] === 255).length
  const positiveHits = hitCount(positives)
  const negativeHits = hitCount(negatives)
  const coverage = foreground / binary.length
  const warnings: string[] = []
  if (coverage === 0) warnings.push('Empty mask.')
  if (coverage > 0.95)
    warnings.push(
      'Mask covers over 95% of the source; inspect foreground/background polarity and target specificity.',
    )
  if (softPixels)
    warnings.push(
      `${softPixels} nonbinary pixels; inspection mask uses threshold 128. Raw PNG preserved.`,
    )
  if (positiveHits < positives.length)
    warnings.push('Some positive points are outside this candidate.')
  if (negativeHits) warnings.push('Some negative points are inside this candidate.')
  const base = `/runs/${encodeURIComponent(basename(out))}`
  return {
    index,
    width: source.width,
    height: source.height,
    coverage,
    bbox: foreground ? [minX, minY, maxX + 1, maxY + 1] : null,
    score,
    rawUrl: `${base}/mask-${index}.raw.png`,
    maskUrl: `${base}/mask-${index}.png`,
    overlayUrl: `${base}/overlay-${index}.png`,
    positiveHits,
    positiveCount: positives.length,
    negativeHits,
    negativeCount: negatives.length,
    warnings,
  }
}

export async function segment(
  source: Source,
  input: unknown,
  out: string,
  apiKey: string,
): Promise<SamRun> {
  const prompts = validatePrompts(input, source)
  if (!apiKey.trim()) throw new Error('FAL_KEY is missing; no request was made.')
  await mkdir(dirname(out), { recursive: true, mode: 0o700 })
  await mkdir(out, { mode: 0o700 }) // An existing run is never overwritten or silently resubmitted.
  const { png: _png, ...image } = source
  const run: SamRun = {
    id: basename(out),
    status: 'failed',
    createdAt: new Date().toISOString(),
    durationMs: 0,
    input: prompts,
    image,
    provider: { endpoint: ENDPOINT, requestId: null, httpStatus: null, reportedCostUsd: null },
    masks: [],
    warnings: [],
  }
  const body = requestBody(source, prompts)
  await Promise.all([
    writeFile(join(out, 'request.json'), JSON.stringify(body, null, 2), { mode: 0o600 }),
    writeFile(join(out, 'request-headers.json'), JSON.stringify(REQUEST_HEADERS, null, 2), {
      mode: 0o600,
    }),
    writeFile(join(out, 'source.png'), source.png, { mode: 0o600 }),
    writeFile(
      join(out, 'run.json'),
      JSON.stringify(
        { ...run, error: 'Request not settled; do not resubmit automatically.' },
        null,
        2,
      ),
      { mode: 0o600 },
    ),
  ])
  const started = performance.now()
  const signal = AbortSignal.timeout(180_000)
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { ...REQUEST_HEADERS, Authorization: `Key ${apiKey}` },
      body: JSON.stringify(body),
      signal,
      redirect: 'error',
    })
    run.provider.httpStatus = response.status
    run.provider.requestId =
      response.headers.get('x-fal-request-id') ?? response.headers.get('x-request-id')
    const raw = await boundedBytes(response)
    await writeFile(join(out, 'response.json'), raw, { mode: 0o600 })
    if (!response.ok)
      throw new Error(
        `fal returned HTTP ${response.status}. Inspect response.json; no retry was made.`,
      )
    const decoded = JSON.parse(raw.toString('utf8'))
    if (!Array.isArray(decoded.masks)) throw new Error('Response has no masks array.')
    if (decoded.masks.length > prompts.max_masks)
      run.warnings.push(
        'Provider returned more masks than requested; all returned candidates are retained within the 32-mask safety bound.',
      )
    if (decoded.masks.length > 32)
      throw new Error('Provider exceeded the documented 32-mask bound.')
    if (decoded.masks.length === 0)
      run.warnings.push('No masks detected. This is not evidence that the target is absent.')
    if (decoded.masks.length === prompts.max_masks)
      run.warnings.push('Returned mask count reached max_masks; completeness is unknown.')
    for (const [index, mask] of decoded.masks.entries()) {
      if (typeof mask.url !== 'string') throw new Error(`Mask ${index} has no URL.`)
      const metadata = decoded.metadata?.find((entry: { index?: number }) => entry.index === index)
      const candidateScore = metadata?.score ?? decoded.scores?.[index]
      const score =
        typeof candidateScore === 'number' && Number.isFinite(candidateScore)
          ? candidateScore
          : null
      run.masks.push(
        await inspectMask(await readMask(mask.url, signal), source, prompts, index, score, out),
      )
    }
    run.status = 'completed'
  } catch (error) {
    run.error = (error instanceof Error ? error.message : String(error))
      .split(apiKey)
      .join('<REDACTED>')
      .slice(0, 1000)
    run.warnings.push(
      'Failed or interrupted attempts may still be billed; no automatic retry was made.',
    )
  }
  run.durationMs = Math.round(performance.now() - started)
  await writeFile(join(out, 'run.json'), JSON.stringify(run, null, 2), { mode: 0o600 })
  return run
}
