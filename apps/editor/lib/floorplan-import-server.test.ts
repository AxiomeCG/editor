import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  FLOORPLAN_MODELS,
  type FloorplanFeatures,
  type FloorplanRequest,
  floorplanRequestSchema,
} from '@pascal-app/editor/floorplan-import'
import sharp from 'sharp'
import { generateFloorplanOnServer } from './floorplan-import-server'

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_OPENROUTER_KEY = process.env.OPENROUTER_API_KEY

const features: FloorplanFeatures = {
  width: 20,
  height: 20,
  points: [
    { id: 'p1', point: [2, 2] },
    { id: 'p2', point: [18, 2] },
    { id: 'p3', point: [18, 18] },
    { id: 'p4', point: [2, 18] },
  ],
  lines: [{ id: 'L1', startId: 'p1', endId: 'p2', width: 2 }],
  regions: [
    {
      id: 'R1',
      pointIds: ['p1', 'p2', 'p3', 'p4'],
      center: [10, 10],
      width: 16,
      depth: 16,
      angle: 0,
    },
  ],
}

function groundedCandidate(modelId: string) {
  return {
    modelId,
    floor: {
      boundaryPointIds: ['p1', 'p2', 'p3', 'p4'],
      holePointIds: [],
      evidenceRegionIds: ['R1'],
    },
    walls: [
      {
        id: 'wall1',
        startPointId: 'p1',
        endPointId: 'p2',
        thicknessFeatureId: 'L1',
        evidenceLineIds: ['L1'],
      },
    ],
    openings: [],
    zones: [],
    props: [],
    dimensions: [],
    issues: [],
    unsupported: [],
  }
}

async function request(
  action: 'interpret' | 'review',
  candidateJson: string | null = null,
): Promise<FloorplanRequest> {
  const image = await sharp({
    create: { width: 20, height: 20, channels: 4, background: '#ffffff' },
  })
    .png()
    .toBuffer()
  return {
    action,
    imageDataUrl: `data:image/png;base64,${image.toString('base64')}`,
    name: 'test-plan.png',
    page: null,
    calibration: null,
    levelHeight: 3,
    catalog: [],
    consent: true,
    candidateJson,
    features,
    masks: [],
  }
}

function providerEnvelope(
  content: string | null,
  finishReason: string | null,
  nativeFinishReason: string | null,
  cost: number,
) {
  return {
    choices: [
      {
        message: { content },
        finish_reason: finishReason,
        native_finish_reason: nativeFinishReason,
      },
    ],
    usage: { cost },
  }
}

type MockProviderRequest = {
  max_tokens?: number
  max_completion_tokens?: number
  response_format?: {
    json_schema: { schema: unknown }
  }
  provider?: {
    require_parameters?: boolean
    allow_fallbacks?: boolean
    data_collection?: string
    zdr?: boolean
  }
}

function hasArrayBounds(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false
  if ('minItems' in schema || 'maxItems' in schema) return true
  return Object.values(schema).some(hasArrayBounds)
}

describe('floorplan provider candidate recovery', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
  })

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
    if (ORIGINAL_OPENROUTER_KEY === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = ORIGINAL_OPENROUTER_KEY
  })

  test('request schema accepts malformed non-empty interpreter text for explicit review', async () => {
    const malformed = '{"modelId":"google/gemini-3.8-flash","floor":{"boundaryPointIds":["p1"'
    const parsed = floorplanRequestSchema.safeParse(await request('review', malformed))

    expect(parsed.success).toBe(true)
  })

  test('retains malformed interpreter text for an explicit reviewer call', async () => {
    const malformed = '{"modelId":"google/gemini-3.8-flash","floor":{"boundaryPointIds":["p1"'
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return new Response(JSON.stringify(providerEnvelope(malformed, 'stop', 'STOP', 0.0837)), {
        status: 200,
      })
    }

    const response = await generateFloorplanOnServer(await request('interpret'), {
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })

    expect(calls).toBe(1)
    expect(response.candidateJson).toBe(malformed)
    expect(response.draft).toBeNull()
    expect(response.usage.cost).toBe(0.0837)
    expect(response.issues.some((issue) => issue.severity === 'blocking')).toBe(true)
  })

  test.each([
    ['review', 'length', 'MAX_TOKENS'],
    ['interpret', 'content_filter', 'SAFETY'],
    ['interpret', 'error', 'ERROR'],
    ['interpret', 'stop', 'MAX_TOKENS'],
  ] as const)('blocks JSON-valid %s output with finish %s and native finish %s while retaining cost', async (action, finishReason, nativeFinishReason) => {
    let calls = 0
    const role = action === 'interpret' ? 'interpreter' : 'reviewer'
    const candidate = JSON.stringify(groundedCandidate(FLOORPLAN_MODELS[role]))
    globalThis.fetch = async () => {
      calls++
      return new Response(
        JSON.stringify(providerEnvelope(candidate, finishReason, nativeFinishReason, 0.0837)),
        { status: 200 },
      )
    }

    const response = await generateFloorplanOnServer(
      await request(action, action === 'review' ? candidate : null),
      {
        signal: new AbortController().signal,
        onProgress: () => undefined,
      },
    )

    expect(calls).toBe(1)
    expect(response.candidateJson).toBe(candidate)
    expect(response.draft).toBeNull()
    expect(response.usage.cost).toBe(0.0837)
    expect(response.issues).toEqual([
      expect.objectContaining({
        severity: 'blocking',
        message: expect.stringContaining(nativeFinishReason),
      }),
    ])
  })

  test('retains a parsed charge when the provider returns no usable candidate text', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify(providerEnvelope(null, 'stop', 'STOP', 0.0412)), { status: 200 })

    const response = await generateFloorplanOnServer(await request('interpret'), {
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })

    expect(response.candidateJson).toBeNull()
    expect(response.draft).toBeNull()
    expect(response.usage.cost).toBe(0.0412)
    expect(response.issues[0]).toEqual(
      expect.objectContaining({
        id: 'floorplan-interpreter-candidate-empty',
        severity: 'blocking',
      }),
    )
  })

  test.each([
    'interpret',
    'review',
  ] as const)('%s uses its endpoint-compatible completion field with strict privacy', async (action) => {
    const malformed = '{"modelId":"google/gemini-3.8-flash","walls":[{"id":"partial"'
    let calls = 0
    const role = action === 'interpret' ? 'interpreter' : 'reviewer'
    const reviewed = JSON.stringify(groundedCandidate(FLOORPLAN_MODELS[role]))
    globalThis.fetch = (async (_request: RequestInfo | URL, init?: RequestInit) => {
      calls++
      const body = JSON.parse(String(init?.body)) as MockProviderRequest
      const completionLimit = body.max_tokens
      const boundedCompletion =
        Number.isInteger(completionLimit) && completionLimit! > 0 && completionLimit! <= 65_536
      const strictPrivacy =
        body.provider?.require_parameters === true &&
        body.provider.allow_fallbacks === false &&
        body.provider.data_collection === 'deny' &&
        body.provider.zdr === true
      if ('max_completion_tokens' in body || !boundedCompletion || !strictPrivacy) {
        return Response.json(
          { error: { message: 'Unsupported or privacy-incompatible model request.' } },
          { status: 400 },
        )
      }
      // Live schema-only probes rejected this nested Gemini grammar with array bounds.
      if (hasArrayBounds(body.response_format?.json_schema.schema)) {
        return Response.json(
          {
            error: {
              message: 'Provider returned error',
              metadata: {
                provider_name: 'Google',
                raw: JSON.stringify({
                  error: {
                    message: 'Request contains an invalid argument.',
                    status: 'INVALID_ARGUMENT',
                  },
                }),
              },
            },
          },
          { status: 400 },
        )
      }
      return new Response(JSON.stringify(providerEnvelope(reviewed, 'stop', 'STOP', 0.019)), {
        status: 200,
      })
    }) as typeof fetch

    const response = await generateFloorplanOnServer(await request(action, malformed), {
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })

    expect(calls).toBe(1)
    expect(response.usage.cost).toBe(0.019)
    expect(response.candidateJson).toBe(reviewed)
    expect(response.issues).toEqual([])
    expect(response.draft).toEqual(
      expect.objectContaining({
        floor: {
          polygon: [
            [2, 2],
            [18, 2],
            [18, 18],
            [2, 18],
          ],
          holes: [],
        },
        walls: [expect.objectContaining({ start: [2, 2], end: [18, 2], thickness: 2 })],
      }),
    )
  })

  test('enforces wall, polygon and tuple cardinality locally for Gemini output', async () => {
    const candidate = groundedCandidate(FLOORPLAN_MODELS.interpreter)
    const invalid = JSON.stringify({
      ...candidate,
      floor: { ...candidate.floor, boundaryPointIds: ['p1', 'p2'] },
      walls: [],
      dimensions: [
        {
          id: 'dimension1',
          start: { wallId: 'wall1', pointId: 'p1' },
          end: { wallId: 'wall1', pointId: 'p2' },
          baselinePointIds: ['p1'],
          sourceText: '8 m',
          valueMeters: 8,
          unitStatus: 'explicit',
          evidenceRegionIds: ['R1'],
        },
      ],
      unsupported: Array.from({ length: 301 }, (_, index) => ({
        id: `unsupported${index}`,
        label: 'Unresolved symbol',
        reason: 'Insufficient evidence',
        featureIds: ['R1'],
      })),
    })
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return Response.json(providerEnvelope(invalid, 'stop', 'STOP', 0.019))
    }

    const response = await generateFloorplanOnServer(await request('interpret'), {
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })

    expect(calls).toBe(1)
    expect(response.candidateJson).toBe(invalid)
    expect(response.usage.cost).toBe(0.019)
    expect(response.draft).toBeNull()
    expect(
      response.issues.filter((issue) => issue.severity === 'blocking').map((issue) => issue.path),
    ).toEqual(
      expect.arrayContaining([
        ['floor', 'boundaryPointIds'],
        ['walls'],
        ['dimensions', 0, 'baselinePointIds'],
        ['unsupported'],
      ]),
    )
  })

  test('resolves a reviewer candidate delivered as ordered text content parts', async () => {
    const reviewed = JSON.stringify(groundedCandidate(FLOORPLAN_MODELS.reviewer))
    const split = reviewed.indexOf('"walls"')
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          {
            message: {
              content: [
                { type: 'text', text: reviewed.slice(0, split) },
                { type: 'text', text: reviewed.slice(split) },
              ],
            },
            finish_reason: 'stop',
          },
        ],
        usage: { cost: 0.019 },
      })

    const response = await generateFloorplanOnServer(await request('review', '{}'), {
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })

    expect(response.candidateJson).toBe(reviewed)
    expect(response.draft?.walls).toEqual([
      expect.objectContaining({ start: [2, 2], end: [18, 2], thickness: 2 }),
    ])
    expect(response.usage.cost).toBe(0.019)
    expect(response.issues).toEqual([])
  })

  test('surfaces provider errors inside HTTP 200 without exposing credentials or accepting a candidate', async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return Response.json({
        ...providerEnvelope(
          JSON.stringify(groundedCandidate(FLOORPLAN_MODELS.reviewer)),
          'stop',
          'STOP',
          0.019,
        ),
        error: {
          code: 503,
          message: 'Upstream unavailable for test-openrouter-key',
          metadata: { provider_name: 'Azure' },
        },
      })
    }

    const result = generateFloorplanOnServer(await request('review', '{}'), {
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })

    const error = await result.catch((value: unknown) => value)
    expect(error).toEqual(expect.objectContaining({ code: 'provider_rejected', status: 502 }))
    expect((error as Error).message).toContain('Azure')
    expect((error as Error).message).toContain('Upstream unavailable')
    expect((error as Error).message).not.toContain('test-openrouter-key')
    expect(calls).toBe(1)
  })

  test('projects measured jamb points on a thick wall face into a hosted opening', async () => {
    const input = await request('review', '{}')
    input.features = {
      ...features,
      lines: [{ id: 'L1', startId: 'p1', endId: 'p2', width: 12 }],
      points: [...features.points, { id: 'jamb1', point: [6, 8] }, { id: 'jamb2', point: [14, 8] }],
    }
    const reviewed = JSON.stringify({
      ...groundedCandidate(FLOORPLAN_MODELS.reviewer),
      openings: [
        {
          id: 'door1',
          wallId: 'wall1',
          kind: 'door',
          startPointId: 'jamb1',
          endPointId: 'jamb2',
          evidenceRegionIds: ['R1'],
          doorType: 'hinged',
          hingesSide: 'left',
          swingDirection: 'inward',
          side: 'front',
        },
      ],
    })
    globalThis.fetch = async () => Response.json(providerEnvelope(reviewed, 'stop', 'STOP', 0.019))

    const response = await generateFloorplanOnServer(input, {
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })

    expect(response.draft?.openings).toEqual([
      expect.objectContaining({ wallId: 'floorplan-wall-wall1', offset: 8, width: 8 }),
    ])
    expect(response.issues).toEqual([])

    input.features.points = input.features.points.map((point) =>
      point.id.startsWith('jamb') ? { ...point, point: [point.point[0], 15] } : point,
    )
    const outside = await generateFloorplanOnServer(input, {
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })
    expect(outside.draft).toBeNull()
    expect(outside.candidateJson).toBe(reviewed)
    expect(outside.issues).toEqual([
      expect.objectContaining({ severity: 'blocking', path: ['openings', 0] }),
    ])
  })
})
