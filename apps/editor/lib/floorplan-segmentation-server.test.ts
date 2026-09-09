import { afterEach, expect, test } from 'bun:test'
import sharp from 'sharp'
import { segmentFloorplanWithFal } from './floorplan-segmentation-server'

const SOURCE_WIDTH = 24
const SOURCE_HEIGHT = 16
const ORIGINAL_FETCH = globalThis.fetch
const PROMPTS = ['walls', 'doors and windows', 'furniture'] as const

interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

interface FalRequestBody {
  prompt: string
  return_multiple_masks: boolean
  max_masks: number
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
})

test('retains twelve distinct source-aligned masks across SAM concepts without extra requests', async () => {
  const rectanglesByPrompt: Record<(typeof PROMPTS)[number], Rectangle[]> = {
    walls: [
      { x: 1, y: 1, width: 2, height: 14 },
      { x: 8, y: 1, width: 14, height: 2 },
      { x: 20, y: 3, width: 2, height: 12 },
      { x: 3, y: 13, width: 17, height: 2 },
    ],
    'doors and windows': [
      { x: 1, y: 5, width: 2, height: 3 },
      { x: 8, y: 1, width: 4, height: 2 },
      { x: 20, y: 7, width: 2, height: 3 },
      { x: 13, y: 13, width: 4, height: 2 },
    ],
    furniture: [
      { x: 4, y: 4, width: 5, height: 4 },
      { x: 12, y: 4, width: 4, height: 4 },
      { x: 5, y: 10, width: 7, height: 2 },
      { x: 15, y: 9, width: 3, height: 3 },
    ],
  }
  const scoresByPrompt: Record<(typeof PROMPTS)[number], number[]> = {
    walls: [0.97, 0.94, 0.91, 0.88],
    'doors and windows': [0.89, 0.84, 0.8, 0.76],
    furniture: [0.93, 0.87, 0.82, 0.79],
  }
  const responses = Object.fromEntries(
    await Promise.all(
      PROMPTS.map(async (prompt) => {
        const urls = await Promise.all(
          rectanglesByPrompt[prompt].map((rectangle) => createMaskDataUrl(rectangle)),
        )
        return [
          prompt,
          {
            masks: urls.map((url) => ({
              url,
              content_type: 'image/png',
              width: SOURCE_WIDTH,
              height: SOURCE_HEIGHT,
            })),
            metadata: scoresByPrompt[prompt].map((score, index) => ({ index, score })),
            scores: scoresByPrompt[prompt],
          },
        ] as const
      }),
    ),
  ) as Record<(typeof PROMPTS)[number], { masks: object[]; metadata: object[]; scores: number[] }>
  const requests: FalRequestBody[] = []
  globalThis.fetch = (async (_request: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as FalRequestBody
    requests.push(body)
    const response = responses[body.prompt as (typeof PROMPTS)[number]]
    if (!response) return new Response('unexpected prompt', { status: 400 })
    const count = body.return_multiple_masks ? body.max_masks : 1
    return Response.json({
      masks: response.masks.slice(0, count),
      metadata: response.metadata.slice(0, count),
      scores: response.scores.slice(0, count),
    })
  }) as typeof fetch

  const result = await segmentFloorplanWithFal({
    apiKey: 'test-key',
    imageDataUrl: 'data:image/png;base64,source',
    width: SOURCE_WIDTH,
    height: SOURCE_HEIGHT,
    signal: new AbortController().signal,
  })

  expect(requests).toHaveLength(3)
  expect(requests.every((request) => request.max_masks === 12)).toBe(true)
  expect(result.masks).toHaveLength(12)
  const expectedRectangles = PROMPTS.flatMap((prompt) => rectanglesByPrompt[prompt])
  for (const [index, mask] of result.masks.entries()) {
    const rectangle = expectedRectangles[index]!
    const { data, info } = await sharp(dataUrlBytes(mask.imageDataUrl))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([SOURCE_WIDTH, SOURCE_HEIGHT])
    for (let y = 0; y < SOURCE_HEIGHT; y++) {
      for (let x = 0; x < SOURCE_WIDTH; x++) {
        const inside =
          x >= rectangle.x &&
          x < rectangle.x + rectangle.width &&
          y >= rectangle.y &&
          y < rectangle.y + rectangle.height
        expect(data[(y * SOURCE_WIDTH + x) * 4 + 3]).toBe(inside ? 255 : 0)
      }
    }
    expect(mask.coverage).toBeCloseTo(
      (rectangle.width * rectangle.height) / (SOURCE_WIDTH * SOURCE_HEIGHT),
      5,
    )
  }
  expect(result.issues).toEqual([])
  expect(result.cost).toBeNull()
})

test('uses the shared mask budget for seven furniture instances when other groups are empty', async () => {
  const furnitureRectangles = Array.from({ length: 7 }, (_, index) => ({
    x: index * 3,
    y: 5,
    width: 2,
    height: 3,
  }))
  const furnitureMasks = await Promise.all(furnitureRectangles.map(createMaskDataUrl))
  const requests: FalRequestBody[] = []
  globalThis.fetch = (async (_request: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as FalRequestBody
    requests.push(body)
    if (body.prompt !== 'furniture') {
      return Response.json({ masks: [], metadata: [], scores: [] })
    }
    return Response.json({
      masks: furnitureMasks.map((url) => ({
        url,
        content_type: 'image/png',
        width: SOURCE_WIDTH,
        height: SOURCE_HEIGHT,
      })),
      metadata: furnitureMasks.map((_, index) => ({ index, score: 0.9 - index * 0.05 })),
      scores: furnitureMasks.map((_, index) => 0.9 - index * 0.05),
    })
  }) as typeof fetch

  const result = await segmentFloorplanWithFal({
    apiKey: 'test-key',
    imageDataUrl: 'data:image/png;base64,source',
    width: SOURCE_WIDTH,
    height: SOURCE_HEIGHT,
    signal: new AbortController().signal,
  })

  expect(requests).toHaveLength(3)
  expect(requests.every((request) => request.max_masks === 12)).toBe(true)
  expect(result.masks.map((mask) => mask.id)).toEqual(
    furnitureMasks.map((_, index) => `sam-fixtures-${index + 1}`),
  )
  expect(result.masks.map((mask) => mask.score)).toEqual(
    furnitureMasks.map((_, index) => 0.9 - index * 0.05),
  )
  for (const [index, mask] of result.masks.entries()) {
    await expectMaskMatchesRectangle(mask.imageDataUrl, furnitureRectangles[index]!)
  }
  expect(result.issues.map((issue) => issue.id)).toEqual([
    'sam-walls-missing',
    'sam-openings-missing',
  ])
})

test('fairly shares twelve masks and never downloads candidates excluded by the shared budget', async () => {
  const responseByPrompt: Record<
    (typeof PROMPTS)[number],
    {
      masks: Array<{
        url: string
        content_type: string
        width: number
        height: number
      }>
      scores: number[]
    }
  > = {
    walls: { masks: [], scores: [] },
    'doors and windows': { masks: [], scores: [] },
    furniture: { masks: [], scores: [] },
  }
  const pngByUrl: Record<string, Buffer> = {}
  for (const [groupIndex, prompt] of PROMPTS.entries()) {
    for (let index = 0; index < 12; index++) {
      const url = `https://fal.media/${groupIndex}/${index}.png`
      pngByUrl[url] = await createMaskPng({
        x: index,
        y: groupIndex * 3,
        width: 1,
        height: 2,
      })
      responseByPrompt[prompt].masks.push({
        url,
        content_type: 'image/png',
        width: SOURCE_WIDTH,
        height: SOURCE_HEIGHT,
      })
      responseByPrompt[prompt].scores.push(0.99 - groupIndex * 0.1 - index * 0.01)
    }
  }
  const requests: FalRequestBody[] = []
  const downloads: string[] = []
  globalThis.fetch = (async (request: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as FalRequestBody
      requests.push(body)
      const response = responseByPrompt[body.prompt as (typeof PROMPTS)[number]]
      return Response.json({
        masks: response.masks,
        metadata: response.scores.map((score, index) => ({ index, score })),
        scores: response.scores,
      })
    }
    const url = String(request)
    downloads.push(url)
    const png = pngByUrl[url]
    if (!png) return new Response('unexpected mask', { status: 404 })
    return new Response(png, { headers: { 'content-type': 'image/png' } })
  }) as typeof fetch

  const result = await segmentFloorplanWithFal({
    apiKey: 'test-key',
    imageDataUrl: 'data:image/png;base64,source',
    width: SOURCE_WIDTH,
    height: SOURCE_HEIGHT,
    signal: new AbortController().signal,
  })

  expect(requests).toHaveLength(3)
  expect(requests.every((request) => request.max_masks === 12)).toBe(true)
  expect(result.masks).toHaveLength(12)
  expect(result.masks.map((mask) => mask.id)).toEqual(
    ['walls', 'openings', 'fixtures'].flatMap((group) =>
      Array.from({ length: 4 }, (_, index) => `sam-${group}-${index + 1}`),
    ),
  )
  expect(result.masks.map((mask) => mask.score)).toEqual(
    PROMPTS.flatMap((prompt) => responseByPrompt[prompt].scores.slice(0, 4)),
  )
  expect(downloads).toEqual(
    PROMPTS.flatMap((prompt) => responseByPrompt[prompt].masks.slice(0, 4).map((mask) => mask.url)),
  )
  expect(result.issues.map((issue) => issue.id)).toEqual(
    ['walls', 'openings', 'fixtures'].flatMap((group) => [
      `sam-${group}-saturated`,
      `sam-${group}-shared-budget`,
    ]),
  )
  expect(result.issues.every((issue) => issue.path?.[0] === 'masks')).toBe(true)
})

test('reports empty SAM responses as failed detections without retries', async () => {
  const requests: FalRequestBody[] = []
  globalThis.fetch = (async (_request: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as FalRequestBody)
    return Response.json({ masks: [], metadata: [], scores: [] })
  }) as typeof fetch

  const result = await segmentFloorplanWithFal({
    apiKey: 'test-key',
    imageDataUrl: 'data:image/png;base64,source',
    width: SOURCE_WIDTH,
    height: SOURCE_HEIGHT,
    signal: new AbortController().signal,
  })

  expect(requests).toHaveLength(3)
  expect(result.masks).toEqual([])
  expect(result.issues).toHaveLength(3)
  expect(
    result.issues.every((issue) => issue.severity === 'warning' && issue.relatedIds.length === 0),
  ).toBe(true)
  expect(result.cost).toBeNull()
})

async function createMaskDataUrl(rectangle: Rectangle): Promise<string> {
  const png = await createMaskPng(rectangle)
  return `data:image/png;base64,${png.toString('base64')}`
}

async function createMaskPng(rectangle: Rectangle): Promise<Buffer> {
  const pixels = Buffer.alloc(SOURCE_WIDTH * SOURCE_HEIGHT * 4)
  for (let y = rectangle.y; y < rectangle.y + rectangle.height; y++) {
    for (let x = rectangle.x; x < rectangle.x + rectangle.width; x++) {
      const offset = (y * SOURCE_WIDTH + x) * 4
      pixels[offset] = 255
      pixels[offset + 1] = 255
      pixels[offset + 2] = 255
      pixels[offset + 3] = 255
    }
  }
  return sharp(pixels, {
    raw: { width: SOURCE_WIDTH, height: SOURCE_HEIGHT, channels: 4 },
  })
    .png()
    .toBuffer()
}

async function expectMaskMatchesRectangle(
  imageDataUrl: string,
  rectangle: Rectangle,
): Promise<void> {
  const { data, info } = await sharp(dataUrlBytes(imageDataUrl))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  expect([info.width, info.height]).toEqual([SOURCE_WIDTH, SOURCE_HEIGHT])
  for (let y = 0; y < SOURCE_HEIGHT; y++) {
    for (let x = 0; x < SOURCE_WIDTH; x++) {
      const inside =
        x >= rectangle.x &&
        x < rectangle.x + rectangle.width &&
        y >= rectangle.y &&
        y < rectangle.y + rectangle.height
      expect(data[(y * SOURCE_WIDTH + x) * 4 + 3]).toBe(inside ? 255 : 0)
    }
  }
}

function dataUrlBytes(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
}
