import { expect, test } from 'bun:test'
import type { ComparisonCandidate, ComparisonVariant, NativeMaskPreview } from './comparison-types'
import { buildNativeMaskPreview } from './mask-to-native'

function fixture() {
  const rectangle = (
    id: string,
    kind: ComparisonCandidate['class'],
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): ComparisonCandidate => ({
    id,
    class: kind,
    outer: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
    holes: [],
  })
  const rgba = new Uint8Array(100 * 100 * 4).fill(255)
  for (let y = 10; y < 90; y++) {
    for (const start of [15, 75]) {
      for (let x = start; x < start + 10; x++) {
        const index = (y * 100 + x) * 4
        rgba[index] = rgba[index + 1] = rgba[index + 2] = 0
      }
    }
  }
  const variant: ComparisonVariant = {
    id: 'fixture',
    label: 'Aperture evidence',
    extractor: 'replicate',
    reviewer: null,
    candidates: [
      rectangle('left', 'wall', 15, 10, 25, 90),
      rectangle('right', 'wall', 75, 10, 85, 90),
      {
        ...rectangle('aperture', 'door', 25, 45, 75, 55),
        centerline: [
          [10, 10],
          [10, 90],
        ],
      },
    ],
    missingFeatures: [],
    issues: [],
    overlayUrl: '',
    usage: {
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      durationMs: null,
      basis: 'Synthetic regression evidence',
    },
  }
  return {
    variant,
    rectangle,
    source: { width: 100, height: 100, rgba },
    options: { metersPerPixel: 0.02, wallHeight: 2.8 },
  }
}

test('closed raster contours and perpendicular jambs host the mask aperture, not an unrelated supplied line', async () => {
  const { variant, source, options } = fixture()
  const preview = await buildNativeMaskPreview(variant, source, options)
  const doors = Object.values(preview.nodes).filter((node) => node.type === 'door')
  expect(doors).toHaveLength(1)
  const door = doors[0]!
  const wall = preview.nodes[door.parentId!]
  expect(wall?.type).toBe('wall')
  if (!wall || wall.type !== 'wall') throw new Error('Missing aperture host')
  expect(door.wallId).toBe(wall.id)
  expect(wall.children).toContain(door.id)
  expect(door.width).toBeCloseTo(1, 2)
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  expect(wall.start[0] + (dx / length) * door.position[0]).toBeCloseTo(1, 2)
  expect(wall.start[1] + (dz / length) * door.position[0]).toBeCloseTo(1, 2)
})

test('repair flags preserve supported walls and apertures as approximations, without inventing missing features', async () => {
  const { variant, source, options } = fixture()
  for (const candidate of variant.candidates) candidate.decision = {
    id: candidate.id,
    action: 'needs_repair',
    correctedClass: candidate.class,
    confidence: 'high',
    evidence: 'Valid structure with an imperfect contour.',
  }
  variant.missingFeatures = [
    {
      kind: 'door',
      sourceRegion: [25, 45, 75, 55],
      evidence: 'Review region, not a replacement mask.',
    },
  ]
  const preview = await buildNativeMaskPreview(variant, source, options)
  expect(preview.counts.doors).toBe(1)
  expect(preview.mappings.find((mapping) => mapping.sourceId === 'left')?.nodeIds.length).toBeGreaterThan(0)
  expect(preview.mappings.find((mapping) => mapping.sourceId === 'aperture')?.status).toBe(
    'approximated',
  )
  expect(preview.mappings.find((mapping) => mapping.sourceId.startsWith('missing:'))?.status).toBe(
    'unresolved',
  )
})

test('an observed opening establishes a bounded host even when no wall mask exists', async () => {
  const { variant, source, options } = fixture()
  variant.candidates = variant.candidates.filter((candidate) => candidate.class === 'door')
  const preview = await buildNativeMaskPreview(variant, source, options)
  expect(preview.counts.doors).toBe(1)
  expect(preview.counts.walls).toBe(1)
  expect(preview.mappings.find((mapping) => mapping.sourceId === 'aperture')?.status).toBe(
    'approximated',
  )
})

function covers(preview: NativeMaskPreview, point: [number, number]) {
  return Object.values(preview.nodes).some(wall => {
    if (wall.type !== 'wall') return false
    const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1], length = Math.hypot(dx, dy)
    const along = ((point[0] - wall.start[0]) * dx + (point[1] - wall.start[1]) * dy) / length
    const across = Math.abs((point[0] - wall.start[0]) * dy - (point[1] - wall.start[1]) * dx) / length
    return along >= -1e-6 && along <= length + 1e-6 && across <= (wall.thickness ?? .1) / 2 + 1e-6
  })
}

test('short orthogonal wall returns survive without filling the adjacent room', async () => {
  const { variant, source, options } = fixture()
  variant.candidates = [{ id: 'return', class: 'wall', holes: [], outer: [
    [10, 10], [80, 10], [80, 18], [24, 18], [24, 28], [16, 28], [16, 18], [10, 18],
  ] }]
  const preview = await buildNativeMaskPreview(variant, source, options)
  expect(covers(preview, [.4, .48])).toBe(true)
  expect(covers(preview, [1.2, .48])).toBe(false)
})

test('near-collinear long runs share an axis across a window but do not move a separate parallel wall', async () => {
  const { variant, source, options, rectangle } = fixture()
  variant.candidates = [
    { id: 'upper', class: 'wall', holes: [], outer: [[10, 10], [14, 10], [14.5, 45], [10.5, 45]] },
    rectangle('lower', 'wall', 11, 58, 15, 90),
    rectangle('opening', 'window', 10, 45, 15, 58),
    rectangle('separate', 'wall', 70, 10, 74, 90),
  ]
  const preview = await buildNativeMaskPreview(variant, source, options)
  const window = Object.values(preview.nodes).find(n => n.type === 'window')
  expect(window).toBeDefined()
  const host = window && preview.nodes[window.parentId!]
  if (!host || host.type !== 'wall') throw new Error('Missing aligned host')
  expect(Math.abs(host.end[1] - host.start[1])).toBeGreaterThan(1.5)
  expect(Math.abs(host.end[0] - host.start[0])).toBeLessThan(.02)
  expect(covers(preview, [1.44, 1])).toBe(true)
  expect(covers(preview, [.8, 1])).toBe(false)
})

test('nearby openings receive a support pier, while a larger unrelated gap stays empty', async () => {
  const { variant, source, options, rectangle } = fixture()
  source.rgba.fill(255)
  variant.candidates = [rectangle('door', 'door', 10, 45, 30, 51),
    rectangle('window', 'window', 37, 45, 65, 51), rectangle('far', 'window', 82, 45, 98, 51)]
  const preview = await buildNativeMaskPreview(variant, source, options)
  expect(preview.counts.doors).toBe(1)
  expect(preview.counts.windows).toBe(2)
  expect(covers(preview, [.67, .96])).toBe(true)
  expect(covers(preview, [1.47, .96])).toBe(false)
})

test('a window mask wrapping a corner is trimmed to the jamb instead of dropping its aperture', async () => {
  const { variant, source, options } = fixture()
  variant.candidates = [
    { id: 'walls', class: 'wall', holes: [], outer: [[10,10],[90,10],[90,90],[82,90],[82,18],[18,18],[18,90],[10,90]] },
    { id: 'frame', class: 'window', holes: [], outer: [[8,10],[50,10],[50,18],[14,18],[14,30],[8,30]] },
  ]
  const preview = await buildNativeMaskPreview(variant, source, options)
  const window = Object.values(preview.nodes).find(n => n.type === 'window')
  expect(window).toBeDefined()
  expect(window?.width).toBeGreaterThan(.65)
  expect(window?.width).toBeLessThan(.9)
})

test('source text separates named open-plan zones without inserting a partition wall', async () => {
  const { variant, source, options, rectangle } = fixture()
  variant.candidates = [rectangle('top', 'wall', 10,10,90,16), rectangle('bottom', 'wall', 10,84,90,90),
    rectangle('left', 'wall', 10,10,16,90), rectangle('right', 'wall', 84,10,90,90)]
  const preview = await buildNativeMaskPreview(variant, { ...source, labels: [
    { text:'Kitchen', confidence:1, box:[25,45,35,55] }, { text:'Dining', confidence:1, box:[65,45,75,55] },
  ] }, options)
  expect(preview.counts.walls).toBe(4)
  const zones = Object.values(preview.nodes).filter(n => n.type === 'zone')
  expect(zones).toHaveLength(2)
  const kitchen = zones.find(zone => zone.name === 'Kitchen')!, dining = zones.find(zone => zone.name === 'Dining')!
  expect(Math.max(...kitchen.polygon.map(p => p[0]))).toBeLessThanOrEqual(Math.min(...dining.polygon.map(p => p[0])) + .03)
  expect(kitchen.enclosureStatus).toBe('open')
  expect(dining.enclosureStatus).toBe('open')
})

test('a review region recovers a window only when the source contains separated frame rails', async () => {
  const { variant, source, options, rectangle } = fixture()
  variant.candidates = [rectangle('wall', 'wall', 45,10,55,90)]
  variant.missingFeatures = [{ kind:'window', sourceRegion:[43,35,57,65], evidence:'Inspect this aperture.' }]
  source.rgba.fill(255)
  expect((await buildNativeMaskPreview(variant, source, options)).counts.windows).toBe(0)
  for (let y = 35; y <= 65; y++) for (const x of [45,46,54,55]) {
    const index = (y * source.width + x) * 4
    source.rgba[index] = source.rgba[index + 1] = source.rgba[index + 2] = 0
  }
  const recovered = await buildNativeMaskPreview(variant, source, options)
  expect(recovered.counts.windows).toBe(1)
  const window = Object.values(recovered.nodes).find(n => n.type === 'window')
  expect(window?.width).toBeGreaterThan(.5)
  for (let y = 35; y <= 65; y++) for (let x = 45; x <= 55; x++) {
    const index = (y * source.width + x) * 4
    source.rgba[index] = source.rgba[index + 1] = source.rgba[index + 2] = 0
  }
  expect((await buildNativeMaskPreview(variant, source, options)).counts.windows).toBe(0)
})

test('a corner-glazing mask can produce two hosted windows when both source frame runs are present', async () => {
  const { variant, source, options, rectangle } = fixture()
  source.rgba.fill(255)
  variant.candidates = [
    rectangle('top-post', 'wall', 10,10,18,25),
    rectangle('right-post', 'wall', 70,70,90,78),
    { id:'corner-frame', class:'window', holes:[], outer:[[10,25],[18,25],[18,70],[70,70],[70,78],[10,78]] },
  ]
  for (let y = 25; y <= 78; y++) for (const x of [10,11,17,18]) {
    const index = (y * source.width + x) * 4
    source.rgba[index] = source.rgba[index + 1] = source.rgba[index + 2] = 0
  }
  for (let x = 10; x <= 70; x++) for (const y of [70,71,77,78]) {
    const index = (y * source.width + x) * 4
    source.rgba[index] = source.rgba[index + 1] = source.rgba[index + 2] = 0
  }
  const preview = await buildNativeMaskPreview(variant, source, options)
  expect(preview.counts.windows).toBe(2)
  const mapping = preview.mappings.find(m => m.sourceId === 'corner-frame')!
  expect(mapping.nodeIds.filter(id => preview.nodes[id]?.type === 'window')).toHaveLength(2)
})
