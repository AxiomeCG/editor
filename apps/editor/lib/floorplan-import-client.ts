'use client'

import {
  FLOORPLAN_MAX_REQUEST_BYTES,
  type FloorplanGenerator,
  type FloorplanProgress,
  type FloorplanResponse,
  floorplanRequestSchema,
  floorplanResponseSchema,
} from '@pascal-app/editor/floorplan-import'
import { z } from 'zod'

const MAX_RESPONSE_BYTES = FLOORPLAN_MAX_REQUEST_BYTES + 4 * 1024 * 1024
const MAX_EVENT_LINE_BYTES = MAX_RESPONSE_BYTES
// These route errors are returned before the provider-backed stream starts.
const PREFLIGHT_ERRORS = new Set([
  'invalid_floorplan_request',
  'floorplan_request_too_large',
  'invalid_json',
  'unsupported_content_type',
  'scene_api_token_required',
  'paid_endpoint_same_origin_required',
  'fal_not_configured',
  'openrouter_not_configured',
  'floorplan_capacity_reached',
])

const streamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stage'),
    stage: z.enum(['extracting', 'segmenting', 'interpreting', 'reviewing', 'checking']),
  }),
  z.object({ type: z.literal('result'), response: z.unknown() }),
  z.object({
    type: z.literal('error'),
    error: z.string().min(1).max(100),
    message: z.string().min(1).max(2_000),
    status: z.number().int().min(400).max(599),
  }),
])

const errorResponseSchema = z.object({
  error: z.string().min(1).max(100),
  message: z.string().min(1).max(2_000).optional(),
})

interface FloorplanGenerationOptions {
  signal: AbortSignal
  onProgress: (stage: FloorplanProgress) => void
}

export class FloorplanImportClientError extends Error {
  readonly code: string
  readonly status: number
  readonly modelCost: number | null

  constructor(code: string, message: string, status: number, modelCost: number | null = null) {
    super(message)
    this.name = 'FloorplanImportClientError'
    this.code = code
    this.status = status
    this.modelCost = modelCost
  }
}

export const generateFloorplan: FloorplanGenerator = async (request, options) => {
  const validatedRequest = floorplanRequestSchema.safeParse(request)
  if (!validatedRequest.success) {
    throw new FloorplanImportClientError(
      'invalid_floorplan_request',
      validatedRequest.error.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
        .join('; ')
        .slice(0, 2_000),
      400,
      0,
    )
  }

  const encoded = JSON.stringify(validatedRequest.data)
  if (new Blob([encoded]).size > FLOORPLAN_MAX_REQUEST_BYTES) {
    throw new FloorplanImportClientError(
      'floorplan_request_too_large',
      `The prepared floorplan request exceeds the ${FLOORPLAN_MAX_REQUEST_BYTES}-byte limit.`,
      413,
      0,
    )
  }

  let response: Response
  try {
    response = await fetch('/api/floorplan-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: encoded,
      credentials: 'same-origin',
      signal: options.signal,
    })
  } catch (error) {
    if (options.signal.aborted) throw error
    throw new FloorplanImportClientError(
      'floorplan_transport_failed',
      'The editor could not reach its floorplan generation endpoint.',
      0,
    )
  }

  if (!response.ok) {
    const raw = await readResponseTextBounded(response, 64 * 1024, options.signal)
    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      throw new FloorplanImportClientError(
        'floorplan_request_failed',
        `Floorplan generation was rejected with status ${response.status}.`,
        response.status,
      )
    }
    const parsed = errorResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new FloorplanImportClientError(
        'floorplan_request_failed',
        `Floorplan generation was rejected with status ${response.status}.`,
        response.status,
      )
    }
    throw new FloorplanImportClientError(
      parsed.data.error,
      parsed.data.message ?? `Floorplan generation was rejected with status ${response.status}.`,
      response.status,
      PREFLIGHT_ERRORS.has(parsed.data.error) ? 0 : null,
    )
  }

  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/x-ndjson' || !response.body) {
    await response.body?.cancel().catch(() => undefined)
    throw new FloorplanImportClientError(
      'invalid_floorplan_stream',
      'The floorplan endpoint did not return the expected progress stream.',
      502,
    )
  }

  return consumeFloorplanStream(response.body, options)
}

async function consumeFloorplanStream(
  stream: ReadableStream<Uint8Array>,
  options: FloorplanGenerationOptions,
): Promise<FloorplanResponse> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  let receivedBytes = 0
  let result: FloorplanResponse | null = null

  try {
    while (true) {
      if (options.signal.aborted) {
        await reader.cancel().catch(() => undefined)
        throw (
          options.signal.reason ??
          new DOMException('Floorplan generation was cancelled.', 'AbortError')
        )
      }
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new FloorplanImportClientError(
          'floorplan_response_too_large',
          'The floorplan response exceeded the client safety bound.',
          502,
        )
      }
      buffered += decoder.decode(value, { stream: true })
      if (new Blob([buffered]).size > MAX_EVENT_LINE_BYTES && !buffered.includes('\n')) {
        await reader.cancel().catch(() => undefined)
        throw new FloorplanImportClientError(
          'floorplan_event_too_large',
          'A floorplan stream event exceeded the client safety bound.',
          502,
        )
      }

      let newline = buffered.indexOf('\n')
      while (newline !== -1) {
        const rawLine = buffered.slice(0, newline)
        if (new Blob([rawLine]).size > MAX_EVENT_LINE_BYTES) {
          throw new FloorplanImportClientError(
            'floorplan_event_too_large',
            'A floorplan stream event exceeded the client safety bound.',
            502,
          )
        }
        buffered = buffered.slice(newline + 1)
        const line = rawLine.trim()
        if (line) result = handleStreamLine(line, result, options)
        newline = buffered.indexOf('\n')
      }
    }
    buffered += decoder.decode()
    if (new Blob([buffered]).size > MAX_EVENT_LINE_BYTES) {
      throw new FloorplanImportClientError(
        'floorplan_event_too_large',
        'A floorplan stream event exceeded the client safety bound.',
        502,
      )
    }
    const finalLine = buffered.trim()
    if (finalLine) result = handleStreamLine(finalLine, result, options)
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }

  if (!result) {
    throw new FloorplanImportClientError(
      'floorplan_result_missing',
      'Floorplan generation ended without a validated result.',
      502,
    )
  }
  return result
}

function handleStreamLine(
  line: string,
  currentResult: FloorplanResponse | null,
  options: FloorplanGenerationOptions,
): FloorplanResponse | null {
  let decoded: unknown
  try {
    decoded = JSON.parse(line)
  } catch {
    throw new FloorplanImportClientError(
      'invalid_floorplan_stream',
      'The floorplan endpoint returned malformed progress data.',
      502,
    )
  }
  const event = streamEventSchema.safeParse(decoded)
  if (!event.success) {
    throw new FloorplanImportClientError(
      'invalid_floorplan_stream',
      'The floorplan endpoint returned an unknown progress event.',
      502,
    )
  }
  if (event.data.type === 'stage') {
    options.onProgress(event.data.stage)
    return currentResult
  }
  if (event.data.type === 'error') {
    throw new FloorplanImportClientError(event.data.error, event.data.message, event.data.status)
  }
  if (currentResult) {
    throw new FloorplanImportClientError(
      'duplicate_floorplan_result',
      'The floorplan endpoint returned more than one result.',
      502,
    )
  }
  const parsed = floorplanResponseSchema.safeParse(event.data.response)
  if (!parsed.success) {
    throw new FloorplanImportClientError(
      'invalid_floorplan_result',
      'The generated floorplan failed the shared response schema.',
      502,
    )
  }
  return parsed.data
}

async function readResponseTextBounded(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<string> {
  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined)
    return ''
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      if (signal.aborted) {
        await reader.cancel().catch(() => undefined)
        throw signal.reason ?? new DOMException('Floorplan request was cancelled.', 'AbortError')
      }
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel().catch(() => undefined)
        return ''
      }
      chunks.push(value)
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder().decode(merged)
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
}
