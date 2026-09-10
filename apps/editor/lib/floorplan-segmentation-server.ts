import {
  FLOORPLAN_MAX_IMAGE_SIDE,
  FLOORPLAN_MAX_MASK_DATA_URL_CHARS,
  FLOORPLAN_MAX_MASKS,
  FLOORPLAN_MODELS,
  type FloorplanMask,
  type ImportIssue,
} from '@pascal-app/editor/floorplan-import'
import sharp from 'sharp'
import { z } from 'zod'

const FAL_ENDPOINT = `https://fal.run/${FLOORPLAN_MODELS.segmentation}`
const FAL_TIMEOUT_MS = 90_000
const MAX_FAL_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_INLINE_MASK_DATA_URLS_PER_RESPONSE = 4
const MAX_FAL_IMAGE_DATA_URL_CHARS =
  Math.ceil(MAX_FAL_IMAGE_BYTES / 3) * 4 + 'data:image/png;base64,'.length
const MAX_FAL_RESPONSE_BYTES =
  MAX_INLINE_MASK_DATA_URLS_PER_RESPONSE * MAX_FAL_IMAGE_DATA_URL_CHARS + 64 * 1024
const scoreSchema = z.number().finite().min(0).max(1).nullable()

const falImageSchema = z.object({
  url: z.string().min(1).max(MAX_FAL_IMAGE_DATA_URL_CHARS),
  content_type: z.string().max(100).optional(),
  width: z.number().int().positive().max(FLOORPLAN_MAX_IMAGE_SIDE).optional(),
  height: z.number().int().positive().max(FLOORPLAN_MAX_IMAGE_SIDE).optional(),
})
const falResponseSchema = z.object({
  masks: z.array(falImageSchema).max(FLOORPLAN_MAX_MASKS),
  metadata: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        score: scoreSchema.optional(),
      }),
    )
    .max(FLOORPLAN_MAX_MASKS)
    .nullish(),
  scores: z.array(scoreSchema).max(FLOORPLAN_MAX_MASKS).nullish(),
})

const GROUPS = [
  { id: 'walls', label: 'Walls', prompt: 'walls' },
  {
    id: 'openings',
    label: 'Doors and windows',
    prompt: 'doors and windows',
  },
  {
    id: 'fixtures',
    label: 'Furniture',
    prompt: 'furniture',
  },
] as const

export interface FloorplanSegmentationResult {
  masks: FloorplanMask[]
  issues: ImportIssue[]
  cost: number | null
}

export class FloorplanSegmentationServerError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 502) {
    super(message)
    this.name = 'FloorplanSegmentationServerError'
    this.code = code
    this.status = status
  }
}

export async function segmentFloorplanWithFal(input: {
  apiKey: string
  imageDataUrl: string
  width: number
  height: number
  signal: AbortSignal
}): Promise<FloorplanSegmentationResult> {
  const controller = new AbortController()
  const abort = () => controller.abort(input.signal.reason)
  if (input.signal.aborted) controller.abort(input.signal.reason)
  else input.signal.addEventListener('abort', abort, { once: true })

  try {
    const grouped = await Promise.all(
      GROUPS.map((group) =>
        requestSegmentationGroup({ ...input, group, signal: controller.signal }),
      ),
    ).catch((error) => {
      controller.abort(error)
      throw error
    })
    const selectionCounts = allocateMaskCounts(
      grouped.map((result) => result.candidates.length),
      FLOORPLAN_MAX_MASKS,
    )
    const masks: FloorplanMask[] = []
    const issues: ImportIssue[] = []
    for (const [groupIndex, result] of grouped.entries()) {
      const offset = masks.length
      const materialized = await materializeGroupMasks({
        width: input.width,
        height: input.height,
        group: result.group,
        candidates: result.candidates.slice(0, selectionCounts[groupIndex]),
        candidateCount: result.candidates.length,
        signal: controller.signal,
      })
      masks.push(...materialized.masks)
      issues.push(
        ...materialized.issues.map((issue) => ({
          ...issue,
          path: issue.path?.map((part, index) =>
            index === 1 && issue.path?.[0] === 'masks' && typeof part === 'number'
              ? part + offset
              : part,
          ),
        })),
      )
    }
    return { masks, issues, cost: null }
  } finally {
    input.signal.removeEventListener('abort', abort)
  }
}

async function requestSegmentationGroup(input: {
  apiKey: string
  imageDataUrl: string
  width: number
  height: number
  group: (typeof GROUPS)[number]
  signal: AbortSignal
}): Promise<{
  group: (typeof GROUPS)[number]
  candidates: Array<{
    image: z.infer<typeof falImageSchema>
    index: number
    score: number | null
  }>
}> {
  const timeout = createTimeoutSignal(input.signal, FAL_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(FAL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Key ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: input.imageDataUrl,
        prompt: input.group.prompt,
        apply_mask: false,
        sync_mode: true,
        output_format: 'png',
        return_multiple_masks: true,
        max_masks: FLOORPLAN_MAX_MASKS,
        include_scores: true,
        include_boxes: false,
      }),
      signal: timeout.signal,
    })
  } catch {
    timeout.cleanup()
    if (input.signal.aborted) throw abortError()
    if (timeout.didTimeout()) {
      throw new FloorplanSegmentationServerError(
        'segmentation_timeout',
        `SAM segmentation for ${input.group.label.toLowerCase()} timed out. No automatic retry was made.`,
        504,
      )
    }
    throw new FloorplanSegmentationServerError(
      'segmentation_unreachable',
      `SAM segmentation for ${input.group.label.toLowerCase()} could not be reached. No automatic retry was made.`,
    )
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    timeout.cleanup()
    throw new FloorplanSegmentationServerError(
      'segmentation_rejected',
      `fal rejected SAM segmentation for ${input.group.label.toLowerCase()} with status ${response.status}. No automatic retry was made.`,
    )
  }

  let raw: string
  try {
    raw = await readResponseBounded(response, MAX_FAL_RESPONSE_BYTES, timeout.signal)
  } catch (error) {
    if (input.signal.aborted) throw abortError()
    if (timeout.didTimeout()) {
      throw new FloorplanSegmentationServerError(
        'segmentation_timeout',
        `SAM segmentation for ${input.group.label.toLowerCase()} timed out. No automatic retry was made.`,
        504,
      )
    }
    if (error instanceof FloorplanSegmentationServerError) throw error
    throw new FloorplanSegmentationServerError(
      'segmentation_response_failed',
      `The SAM response for ${input.group.label.toLowerCase()} could not be read. No automatic retry was made.`,
    )
  } finally {
    timeout.cleanup()
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw new FloorplanSegmentationServerError(
      'invalid_segmentation_response',
      `The SAM response for ${input.group.label.toLowerCase()} was not valid JSON.`,
    )
  }
  const parsed = falResponseSchema.safeParse(decoded)
  if (!parsed.success) {
    throw new FloorplanSegmentationServerError(
      'invalid_segmentation_response',
      `The SAM response for ${input.group.label.toLowerCase()} did not match fal's documented PNG mask contract.`,
    )
  }

  const metadataScores = new Map(
    (parsed.data.metadata ?? []).map(
      (metadata) => [metadata.index, metadata.score ?? null] as const,
    ),
  )
  return {
    group: input.group,
    candidates: parsed.data.masks.map((image, index) => ({
      image,
      index,
      score: metadataScores.get(index) ?? parsed.data.scores?.[index] ?? null,
    })),
  }
}

async function materializeGroupMasks(input: {
  width: number
  height: number
  group: (typeof GROUPS)[number]
  candidates: Array<{
    image: z.infer<typeof falImageSchema>
    index: number
    score: number | null
  }>
  candidateCount: number
  signal: AbortSignal
}): Promise<{ masks: FloorplanMask[]; issues: ImportIssue[] }> {
  const masks: FloorplanMask[] = []
  const issues: ImportIssue[] = []
  for (const candidate of input.candidates) {
    const downloadTimeout = createTimeoutSignal(input.signal, FAL_TIMEOUT_MS)
    let bytes: Buffer
    try {
      bytes = await readFalPng(candidate.image.url, downloadTimeout.signal)
    } catch (error) {
      if (downloadTimeout.didTimeout()) {
        throw new FloorplanSegmentationServerError(
          'segmentation_timeout',
          `SAM mask download for ${input.group.label.toLowerCase()} timed out. No automatic retry was made.`,
          504,
        )
      }
      throw error
    } finally {
      downloadTimeout.cleanup()
    }
    const normalized = await normalizeMaskPng(bytes, input.width, input.height)
    const maskIndex = masks.length
    const label =
      input.candidateCount === 1
        ? input.group.label
        : `${input.group.label} candidate ${candidate.index + 1}`
    const id = `sam-${input.group.id}-${candidate.index + 1}`
    masks.push({
      id,
      label,
      imageDataUrl: normalized.imageDataUrl,
      width: input.width,
      height: input.height,
      score: candidate.score,
      coverage: normalized.coverage,
    })
    if (normalized.coverage === 0 || normalized.coverage === 1) {
      issues.push({
        id: `${id}-${normalized.coverage === 0 ? 'empty' : 'full'}`,
        severity: 'warning',
        message:
          normalized.coverage === 0
            ? `${label} is empty and supplies no semantic evidence.`
            : `${label} covers the full source frame and is not discriminating evidence.`,
        relatedIds: [id],
        path: ['masks', maskIndex],
      })
    }
  }
  if (input.candidateCount === FLOORPLAN_MAX_MASKS) {
    issues.push({
      id: `sam-${input.group.id}-saturated`,
      severity: 'warning',
      message: `SAM reached the ${FLOORPLAN_MAX_MASKS}-mask provider request limit for prompt "${input.group.prompt}". Coverage may be incomplete and must not be treated as exhaustive detection.`,
      relatedIds: masks.map((mask) => mask.id),
      path: ['masks'],
    })
  }
  if (input.candidates.length < input.candidateCount) {
    issues.push({
      id: `sam-${input.group.id}-shared-budget`,
      severity: 'warning',
      message: `${input.candidateCount - input.candidates.length} SAM mask candidates for prompt "${input.group.prompt}" were excluded by the shared ${FLOORPLAN_MAX_MASKS}-mask import budget.`,
      relatedIds: masks.map((mask) => mask.id),
      path: ['masks'],
    })
  } else if (input.candidateCount === 0) {
    issues.push({
      id: `sam-${input.group.id}-missing`,
      severity: 'warning',
      message: `SAM detected no masks for prompt "${input.group.prompt}". This is a failed detection, not evidence that the requested concept is absent from the image. Classical evidence remains available.`,
      relatedIds: [],
      path: ['masks'],
    })
  }
  return { masks, issues }
}

function allocateMaskCounts(groupSizes: number[], limit: number): number[] {
  const counts = groupSizes.map(() => 0)
  let remaining = Math.min(
    limit,
    groupSizes.reduce((sum, size) => sum + size, 0),
  )
  while (remaining > 0) {
    for (const [index, size] of groupSizes.entries()) {
      if (remaining === 0) break
      if (counts[index]! < size) {
        counts[index] = counts[index]! + 1
        remaining--
      }
    }
  }
  return counts
}

async function readFalPng(value: string, signal: AbortSignal): Promise<Buffer> {
  const match = value.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
  if (match?.[1]) {
    const encoded = match[1]
    const bytes = Buffer.from(encoded, 'base64')
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > MAX_FAL_IMAGE_BYTES ||
      bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')
    ) {
      throw new FloorplanSegmentationServerError(
        'invalid_segmentation_mask',
        'A SAM PNG mask was empty or exceeded the bounded download size.',
      )
    }
    return bytes
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new FloorplanSegmentationServerError(
      'invalid_segmentation_mask_url',
      'A SAM mask did not contain a valid PNG data URI or fal media URL.',
    )
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    (url.hostname !== 'fal.media' && !url.hostname.endsWith('.fal.media'))
  ) {
    throw new FloorplanSegmentationServerError(
      'invalid_segmentation_mask_url',
      'A SAM mask URL was outside the permitted fal media origin.',
    )
  }

  let response: Response
  try {
    response = await fetch(url, { signal, redirect: 'error' })
  } catch {
    if (signal.aborted) throw abortError()
    throw new FloorplanSegmentationServerError(
      'segmentation_mask_download_failed',
      'A SAM PNG mask could not be downloaded from the permitted fal media origin.',
    )
  }
  if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0] !== 'image/png') {
    await response.body?.cancel().catch(() => undefined)
    throw new FloorplanSegmentationServerError(
      'invalid_segmentation_mask',
      'A SAM mask download was not a PNG response.',
    )
  }
  return Buffer.from(await readBytesBounded(response, MAX_FAL_IMAGE_BYTES, signal))
}

async function normalizeMaskPng(
  bytes: Buffer,
  width: number,
  height: number,
): Promise<{ imageDataUrl: string; coverage: number }> {
  try {
    const source = sharp(bytes, {
      animated: false,
      failOn: 'error',
      limitInputPixels: FLOORPLAN_MAX_IMAGE_SIDE * FLOORPLAN_MAX_IMAGE_SIDE,
    })
    const metadata = await source.metadata()
    if (
      metadata.format !== 'png' ||
      (metadata.pages ?? 1) !== 1 ||
      metadata.width !== width ||
      metadata.height !== height
    ) {
      throw new Error('invalid metadata')
    }
    const decoded = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (decoded.info.channels !== 4) throw new Error('invalid channels')
    let meaningfulAlpha = false
    for (let offset = 3; offset < decoded.data.length; offset += 4) {
      if (decoded.data[offset] !== 255) {
        meaningfulAlpha = true
        break
      }
    }
    let foreground = 0
    for (let offset = 0; offset < decoded.data.length; offset += 4) {
      const alpha = meaningfulAlpha
        ? decoded.data[offset + 3]!
        : Math.round(
            0.2126 * decoded.data[offset]! +
              0.7152 * decoded.data[offset + 1]! +
              0.0722 * decoded.data[offset + 2]!,
          )
      decoded.data[offset] = 255
      decoded.data[offset + 1] = 255
      decoded.data[offset + 2] = 255
      decoded.data[offset + 3] = alpha
      if (alpha > 0) foreground++
    }
    const normalized = await sharp(decoded.data, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer()
    const imageDataUrl = `data:image/png;base64,${normalized.toString('base64')}`
    if (imageDataUrl.length > FLOORPLAN_MAX_MASK_DATA_URL_CHARS) {
      throw new FloorplanSegmentationServerError(
        'segmentation_mask_too_large',
        'A normalized SAM PNG mask exceeded the shared response bound.',
      )
    }
    return { imageDataUrl, coverage: foreground / (width * height) }
  } catch (error) {
    if (error instanceof FloorplanSegmentationServerError) throw error
    throw new FloorplanSegmentationServerError(
      'invalid_segmentation_mask',
      'A SAM result was not a source-sized PNG mask with usable alpha or luminance.',
    )
  }
}

async function readResponseBounded(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<string> {
  return new TextDecoder().decode(await readBytesBounded(response, limit, signal))
}

async function readBytesBounded(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined)
    throw new FloorplanSegmentationServerError(
      'segmentation_response_too_large',
      'The SAM response exceeded the configured safety bound.',
    )
  }
  if (!response.body) {
    throw new FloorplanSegmentationServerError(
      'invalid_segmentation_response',
      'The SAM response did not contain a body.',
    )
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      if (signal.aborted) throw abortError()
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel().catch(() => undefined)
        throw new FloorplanSegmentationServerError(
          'segmentation_response_too_large',
          'The SAM response exceeded the configured safety bound.',
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

function createTimeoutSignal(parent: AbortSignal, milliseconds: number) {
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort(parent.reason)
  if (parent.aborted) controller.abort(parent.reason)
  else parent.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('Timed out', 'TimeoutError'))
  }, milliseconds)
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      parent.removeEventListener('abort', abort)
    },
    didTimeout: () => timedOut,
  }
}

function abortError(): Error {
  return new DOMException('Floorplan segmentation was cancelled.', 'AbortError')
}
