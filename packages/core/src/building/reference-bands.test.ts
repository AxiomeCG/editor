import { describe, expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, GuideNode, LevelNode } from '../schema'
import { bandWallCenterline } from './reference-bands'
import { outlinePrimitiveNodes } from './reference-primitives'

const ring = {
  outer: [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ] as [number, number][],
  hole: [
    [1, 1],
    [9, 1],
    [9, 7],
    [1, 7],
  ] as [number, number][],
}

describe('bandWallCenterline', () => {
  test('derives a closed centreline and uniform thickness from a rectangular ring band', () => {
    const band = bandWallCenterline(ring.outer, [ring.hole])

    expect(band).not.toBeNull()
    expect(band!.closed).toBe(true)
    expect(band!.thickness).toBeCloseTo(1, 2)
    // Simplified to the four midline corners of the 10×8 / 9×7 ring.
    expect(band!.points).toHaveLength(4)
    for (const [x, z] of [
      [0.5, 0.5],
      [9.5, 0.5],
      [9.5, 7.5],
      [0.5, 7.5],
    ]) {
      expect(
        band!.points.some((p) => Math.hypot(p[0] - x, p[1] - z) < 0.05),
      ).toBe(true)
    }
  })

  test('derives a straight centreline from a solid rectangular band', () => {
    const band = bandWallCenterline(
      [
        [0, 0],
        [6, 0],
        [6, 0.4],
        [0, 0.4],
      ],
      [],
    )

    expect(band).not.toBeNull()
    expect(band!.closed).toBe(false)
    expect(band!.thickness).toBeCloseTo(0.4, 2)
    expect(band!.points).toHaveLength(2)
    expect(band!.points[0]![1]).toBeCloseTo(0.2, 2)
    expect(band!.points[1]![1]).toBeCloseTo(0.2, 2)
  })

  test('derives the centreline from a densely sampled band (raster-traced contours)', () => {
    const sampled = (rect: [number, number][]) =>
      rect.flatMap(([x, z], i) => {
        const [nx, nz] = rect[(i + 1) % rect.length]!
        return Array.from({ length: 40 }, (_, s) => [
          x + ((nx - x) * s) / 40,
          z + ((nz - z) * s) / 40,
        ]) as [number, number][]
      })

    const band = bandWallCenterline(sampled(ring.outer), [sampled(ring.hole)])

    expect(band).not.toBeNull()
    expect(band!.thickness).toBeCloseTo(1, 1)
    expect(band!.points.length).toBeLessThanOrEqual(6)
  })

  test('rejects a non-uniform band whose hole is far from the centre', () => {
    const band = bandWallCenterline(ring.outer, [
      [
        [8, 6],
        [9, 6],
        [9, 7],
        [8, 7],
      ],
    ])

    expect(band).toBeNull()
  })

  test('rejects a squarish solid fill (a room, not a band)', () => {
    const band = bandWallCenterline(
      [
        [0, 0],
        [3, 0],
        [3, 3],
        [0, 3],
      ],
      [],
    )

    expect(band).toBeNull()
  })

  test('rejects several holes outright', () => {
    const band = bandWallCenterline(ring.outer, [ring.hole, ring.hole])

    expect(band).toBeNull()
  })
})

describe('outlinePrimitiveNodes fillAsWall', () => {
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const guide = GuideNode.parse({
    parentId: level.id,
    url: '/plan.svg',
    scale: 100,
    metadata: {
      planReference: { width: 1000, height: 800, role: 'floorplan' },
    },
  })
  const nodes = { [building.id]: building, [level.id]: level, [guide.id]: guide } as Record<
    string,
    AnyNode
  >
  const contextNodes = nodes
  const toLevel = ([x, z]: [number, number]) => [x, z] as [number, number]

  test('creates one thick wall along the band instead of outlining both boundaries', () => {
    const created = outlinePrimitiveNodes({
      guide,
      level,
      points: ring.outer.map(toLevel),
      holes: [ring.hole.map(toLevel)],
      outlineId: 'band_1',
      kind: 'walls',
      name: 'Band',
      fillAsWall: true,
      contextNodes,
    })

    const walls = created.filter((node) => node.type === 'wall')
    expect(walls).toHaveLength(4)
    expect(walls.every((wall) => wall.type === 'wall' && wall.thickness === 1)).toBe(true)
  })

  test('falls back to outlining the area when the fill is not a band', () => {
    const created = outlinePrimitiveNodes({
      guide,
      level,
      points: [
        [0, 0],
        [3, 0],
        [3, 3],
        [0, 3],
      ].map(toLevel),
      holes: [ring.hole.map(toLevel), ring.hole.map(toLevel)],
      outlineId: 'room_1',
      kind: 'walls',
      name: 'Room',
      fillAsWall: true,
      contextNodes,
    })

    // Outer loop (4) + two hole loops (4 + 4) — the outline behaviour.
    expect(created.filter((node) => node.type === 'wall')).toHaveLength(12)
  })
})
