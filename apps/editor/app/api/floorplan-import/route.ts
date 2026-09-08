import {
  FLOORPLAN_MAX_REQUEST_BYTES,
  type FloorplanProgress,
  floorplanRequestSchema,
} from '@pascal-app/editor/floorplan-import'
import {
  acquireFloorplanImportSlot,
  FloorplanImportServerError,
  generateFloorplanOnServer,
  getFloorplanImportConfiguration,
} from '@/lib/floorplan-import-server'
import {
  guardSceneApiRequest,
  sceneApiJson,
  sceneApiPreflight,
  withSceneApiHeaders,
} from '@/lib/scene-api-security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 400

const JOB_TIMEOUT_MS = 390_000

type FloorplanStreamEvent =
  | { type: 'stage'; stage: FloorplanProgress }
  | { type: 'result'; response: unknown }
  | { type: 'error'; error: string; message: string; status: number }

export function OPTIONS(request: Request) {
  return sceneApiPreflight(request)
}

export function GET(request: Request) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  return sceneApiJson(request, getFloorplanImportConfiguration())
}

export async function POST(request: Request) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard
  if (process.env.NODE_ENV === 'production' && !process.env.PASCAL_SCENE_API_TOKEN?.trim()) {
    return sceneApiJson(
      request,
      {
        error: 'scene_api_token_required',
        message:
          'Production floorplan generation is disabled until PASCAL_SCENE_API_TOKEN is configured on the editor server.',
      },
      { status: 503 },
    )
  }

  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    return sceneApiJson(
      request,
      {
        error: 'unsupported_content_type',
        message: 'Use application/json for floorplan requests.',
      },
      { status: 415 },
    )
  }

  let body: unknown
  try {
    body = JSON.parse(await readRequestBodyBounded(request, FLOORPLAN_MAX_REQUEST_BYTES))
  } catch (error) {
    if (error instanceof FloorplanImportServerError) {
      return sceneApiJson(
        request,
        { error: error.code, message: error.message },
        { status: error.status },
      )
    }
    return sceneApiJson(
      request,
      { error: 'invalid_json', message: 'The floorplan request body is not valid JSON.' },
      { status: 400 },
    )
  }

  const parsed = floorplanRequestSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      {
        error: 'invalid_floorplan_request',
        message: parsed.error.issues
          .slice(0, 4)
          .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
          .join('; ')
          .slice(0, 2_000),
      },
      { status: 400 },
    )
  }

  if (parsed.data.action !== 'extract' && !isPaidRequestHostAllowed(request)) {
    return sceneApiJson(
      request,
      {
        error: 'paid_endpoint_same_origin_required',
        message:
          'Remote floorplan processing is restricted to the editor’s same origin or a loopback editor host.',
      },
      { status: 403 },
    )
  }

  const configuration = getFloorplanImportConfiguration()
  if (parsed.data.action === 'segment' && !configuration.segmentationConfigured) {
    return sceneApiJson(
      request,
      {
        error: 'fal_not_configured',
        message:
          'Floorplan segmentation is not configured. Set FAL_KEY on the editor server and restart it.',
      },
      { status: 503 },
    )
  }
  if (
    (parsed.data.action === 'interpret' || parsed.data.action === 'review') &&
    !configuration.configured
  ) {
    return sceneApiJson(
      request,
      {
        error: 'openrouter_not_configured',
        message:
          'Floorplan interpretation is not configured. Set OPENROUTER_API_KEY on the editor server and restart it.',
      },
      { status: 503 },
    )
  }

  const releaseSlot = acquireFloorplanImportSlot()
  if (!releaseSlot) {
    const response = sceneApiJson(
      request,
      {
        error: 'floorplan_capacity_reached',
        message:
          'The editor is already processing the maximum number of floorplans. Try again shortly.',
      },
      { status: 429 },
    )
    response.headers.set('Retry-After', '10')
    return response
  }

  const encoder = new TextEncoder()
  const jobController = new AbortController()
  let closed = false
  let timedOut = false
  const abortFromRequest = () => jobController.abort(request.signal.reason)
  if (request.signal.aborted) jobController.abort(request.signal.reason)
  else request.signal.addEventListener('abort', abortFromRequest, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    jobController.abort(new DOMException('Floorplan generation timed out.', 'TimeoutError'))
  }, JOB_TIMEOUT_MS)

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: FloorplanStreamEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          closed = true
          jobController.abort()
        }
      }

      void generateFloorplanOnServer(parsed.data, {
        signal: jobController.signal,
        onProgress: (stage) => send({ type: 'stage', stage }),
      })
        .then((response) => send({ type: 'result', response }))
        .catch((error: unknown) => {
          if (closed || (request.signal.aborted && !timedOut)) return
          if (timedOut) {
            send({
              type: 'error',
              error: 'floorplan_timeout',
              message: 'Floorplan generation exceeded the bounded processing time.',
              status: 504,
            })
            return
          }
          if (error instanceof FloorplanImportServerError) {
            send({
              type: 'error',
              error: error.code,
              message: error.message,
              status: error.status,
            })
            return
          }
          if (error instanceof DOMException && error.name === 'AbortError') {
            send({
              type: 'error',
              error: 'floorplan_cancelled',
              message: 'Floorplan generation was cancelled.',
              status: 499,
            })
            return
          }
          send({
            type: 'error',
            error: 'floorplan_generation_failed',
            message: 'Floorplan generation failed without changing the scene.',
            status: 500,
          })
        })
        .finally(() => {
          clearTimeout(timeout)
          request.signal.removeEventListener('abort', abortFromRequest)
          releaseSlot()
          if (!closed) {
            closed = true
            controller.close()
          }
        })
    },
    cancel() {
      closed = true
      jobController.abort(new DOMException('Client closed the stream.', 'AbortError'))
    },
  })

  return withSceneApiHeaders(
    request,
    new Response(stream, {
      headers: {
        'Cache-Control': 'no-cache, no-store, no-transform',
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'X-Accel-Buffering': 'no',
      },
    }),
  )
}

async function readRequestBodyBounded(request: Request, limit: number): Promise<string> {
  const declared = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > limit) {
    throw new FloorplanImportServerError(
      'floorplan_request_too_large',
      `The request exceeds the ${limit}-byte floorplan limit.`,
      413,
    )
  }
  if (!request.body) {
    throw new FloorplanImportServerError(
      'empty_floorplan_request',
      'The floorplan request body is empty.',
      400,
    )
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    if (request.signal.aborted) {
      await reader.cancel().catch(() => undefined)
      throw new FloorplanImportServerError(
        'floorplan_request_cancelled',
        'The floorplan request was cancelled while uploading.',
        499,
      )
    }
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      throw new FloorplanImportServerError(
        'floorplan_request_too_large',
        `The request exceeds the ${limit}-byte floorplan limit.`,
        413,
      )
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

function isPaidRequestHostAllowed(request: Request): boolean {
  const requestUrl = new URL(request.url)
  const hostname = requestUrl.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  ) {
    return true
  }
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    const parsedOrigin = new URL(origin)
    return parsedOrigin.protocol === requestUrl.protocol && parsedOrigin.host === requestUrl.host
  } catch {
    return false
  }
}
