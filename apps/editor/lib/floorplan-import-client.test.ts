import { afterEach, expect, test } from 'bun:test'
import type { FloorplanRequest } from '@pascal-app/editor/floorplan-import'
import { generateFloorplan } from './floorplan-import-client'

const originalFetch = globalThis.fetch
const request: FloorplanRequest = {
  action: 'review',
  imageDataUrl: 'data:image/png;base64,AA==',
  name: 'plan.png',
  page: null,
  calibration: null,
  levelHeight: 2.8,
  catalog: [],
  consent: true,
  candidateJson: '{"walls":[',
  features: { width: 32, height: 32, points: [], lines: [], regions: [] },
  masks: [],
}
const options = () => ({ signal: new AbortController().signal, onProgress: () => {} })

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('local preflight rejection incurs zero model cost and never sends a request', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    throw new Error('unexpected network call')
  }) as typeof fetch
  const error = await generateFloorplan({ ...request, candidateJson: null }, options()).catch(
    (error) => error,
  )
  expect(error).toMatchObject({ code: 'invalid_floorplan_request', modelCost: 0 })
  expect(calls).toBe(0)
})

test('malformed candidate reaches server preflight, whose explicit rejection costs zero', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return Response.json(
      { error: 'openrouter_not_configured', message: 'No provider key' },
      { status: 503 },
    )
  }) as typeof fetch
  const error = await generateFloorplan(request, options()).catch((error) => error)
  expect(error).toMatchObject({ code: 'openrouter_not_configured', modelCost: 0 })
  expect(calls).toBe(1)
})

test('an error after the provider stream starts does not claim a zero charge', async () => {
  globalThis.fetch = (async () =>
    new Response(
      `${JSON.stringify({ type: 'stage', stage: 'reviewing' })}\n${JSON.stringify({ type: 'error', error: 'provider_timeout', message: 'Provider timed out', status: 504 })}\n`,
      { headers: { 'Content-Type': 'application/x-ndjson' } },
    )) as typeof fetch
  const error = await generateFloorplan(request, options()).catch((error) => error)
  expect(error).toMatchObject({ code: 'provider_timeout', modelCost: null })
})
