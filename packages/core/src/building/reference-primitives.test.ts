import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  type DoorNode,
  GuideNode,
  LevelNode,
  WallNode,
} from '../schema'
import { reconcileReferenceLinks } from './reference-links'
import { outlineBatchPrimitiveNodes } from './reference-primitives'

const building = BuildingNode.parse({})
const level = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
// 1000 px at scale 10 → 0.1 m/px, with the image centre on the level origin.
const guide = GuideNode.parse({
  parentId: level.id,
  url: '/plan.svg',
  scale: 10,
  metadata: { planReference: { width: 1000, height: 800, role: 'floorplan' } },
})
const base = {
  guide,
  level,
  name: 'Plan element',
  contextNodes: { [building.id]: building, [level.id]: level },
}

/** Level metres → plan image pixels. */
const px = ([x, z]: [number, number]): [number, number] => [x / 0.1 + 500, z / 0.1 + 400]
const box = (x0: number, z0: number, x1: number, z1: number) =>
  (
    [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ] as [number, number][]
  ).map(px)

describe('outlineBatchPrimitiveNodes openings', () => {
  const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [6, 0], thickness: 0.18 })

  test('merges a window symbol drawn as frame + glass into one hosted window', () => {
    const nodes = outlineBatchPrimitiveNodes({
      ...base,
      kind: 'window',
      existingWalls: [wall],
      shapes: [
        { id: 'frame', points: box(2.6, -0.08, 3.4, 0.08), holes: [] },
        { id: 'glass', points: box(2.65, -0.02, 3.35, 0.02), holes: [] },
      ],
    })

    expect(nodes).toHaveLength(1)
    const [window] = nodes
    expect(window?.type).toBe('window')
    expect(window?.parentId).toBe(wall.id)
    expect((window as { wallId?: string }).wallId).toBe(wall.id)
    const position = (window as { position: number[] }).position
    expect(position[0]).toBeCloseTo(3, 5)
    expect(position[1]).toBeCloseTo(1.65, 5)
    expect((window as { width: number }).width).toBeCloseTo(0.8, 5)
  })

  test('bridges a door symbol drawn as leaf + arc with the missing wall segment', () => {
    const left = WallNode.parse({ parentId: level.id, start: [0, 0], end: [2, 0] })
    const right = WallNode.parse({ parentId: level.id, start: [3, 0], end: [6, 0] })
    const arc = Array.from({ length: 12 }, (_, i) => {
      const angle = (i / 11) * (Math.PI / 2)
      return px([2 + Math.cos(angle), 0.09 + Math.sin(angle)])
    })
    const nodes = outlineBatchPrimitiveNodes({
      ...base,
      kind: 'door',
      existingWalls: [left, right],
      shapes: [
        { id: 'leaf', points: box(2, 0.09, 2.04, 1.09), holes: [] },
        { id: 'swing', points: arc, holes: [], stroke: true },
      ],
    })

    expect(nodes.map((n) => n.type)).toEqual(['wall', 'door'])
    const [bridge, door] = nodes as [
      WallNode,
      { parentId: string; wallId: string; position: number[] },
    ]
    expect(bridge.start).toEqual([2, 0])
    expect(bridge.end).toEqual([3, 0])
    expect(door.parentId).toBe(bridge.id)
    expect(door.wallId).toBe(bridge.id)
    expect(door.position[0]).toBeCloseTo(0.5, 5)
    expect(door.position[1]).toBeCloseTo(1.05, 5)
  })

  test('a plan door follows its bridge wall when the guide rescales, without detaching', () => {
    const left = WallNode.parse({ parentId: level.id, start: [0, 0], end: [2, 0] })
    const right = WallNode.parse({ parentId: level.id, start: [3, 0], end: [6, 0] })
    const [bridge, door] = outlineBatchPrimitiveNodes({
      ...base,
      kind: 'door',
      existingWalls: [left, right],
      shapes: [{ id: 'symbol', points: box(2, 0.09, 3, 1.09), holes: [] }],
    }) as [WallNode, DoorNode]
    const before: Record<string, AnyNode> = Object.fromEntries(
      [
        building,
        { ...level, children: [guide.id, left.id, right.id, bridge.id] },
        guide,
        left,
        right,
        { ...bridge, children: [door.id] },
        door,
      ].map((n) => [n.id, n as AnyNode]),
    )
    const next = { ...before, [guide.id]: { ...guide, scale: 20 } }

    const updates = new Map(
      reconcileReferenceLinks(before, next, [guide.id]).map((n) => [n.id, n] as const),
    )

    const moved = updates.get(bridge.id) as WallNode
    expect(moved.start).toEqual([4, 0])
    expect(moved.end).toEqual([6, 0])
    const followed = updates.get(door.id) as DoorNode
    expect(followed.position[0]).toBeCloseTo(door.position[0] * 2, 8)
    expect(
      (followed.metadata.referenceOutline as { detachedReason?: string }).detachedReason,
    ).toBeUndefined()
  })
})

describe('outlineBatchPrimitiveNodes opening grouping', () => {
  const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [8, 0], thickness: 0.18 })
  /** A 0.9 m window drawn as a frame with two glass panes nested inside it. */
  const windowSymbol = (x: number, id: string) => [
    { id: `${id}-frame`, points: box(x, -0.08, x + 0.9, 0.08), holes: [] },
    { id: `${id}-pane-1`, points: box(x + 0.05, -0.02, x + 0.45, 0.02), holes: [] },
    { id: `${id}-pane-2`, points: box(x + 0.45, -0.02, x + 0.85, 0.02), holes: [] },
  ]
  const twoWindows = [...windowSymbol(1, 'a'), ...windowSymbol(5, 'b')]

  test('touching parts become one window per symbol: 2 windows, not 1 nor 6', () => {
    const nodes = outlineBatchPrimitiveNodes({
      ...base,
      kind: 'window',
      existingWalls: [wall],
      openingGrouping: 'touching',
      shapes: twoWindows,
    })

    expect(nodes.map((n) => n.type)).toEqual(['window', 'window'])
    const openings = nodes as { position: number[]; width: number; name: string }[]
    expect(openings.map((n) => n.position[0])).toEqual([
      expect.closeTo(1.45, 5),
      expect.closeTo(5.45, 5),
    ])
    expect(openings.map((n) => n.width)).toEqual([expect.closeTo(0.9, 5), expect.closeTo(0.9, 5)])
    expect(openings.map((n) => n.name)).toEqual(['Plan element 1', 'Plan element 2'])
  })

  test('separate mode makes one window per selected shape', () => {
    const nodes = outlineBatchPrimitiveNodes({
      ...base,
      kind: 'window',
      existingWalls: [wall],
      openingGrouping: 'separate',
      shapes: twoWindows,
    })

    expect(nodes.filter((n) => n.type === 'window')).toHaveLength(6)
  })

  test('openings sharing one wall gap share one bridge wall', () => {
    const left = WallNode.parse({ parentId: level.id, start: [0, 0], end: [2, 0] })
    const right = WallNode.parse({ parentId: level.id, start: [3, 0], end: [6, 0] })
    const nodes = outlineBatchPrimitiveNodes({
      ...base,
      kind: 'window',
      existingWalls: [left, right],
      openingGrouping: 'separate',
      shapes: [
        { id: 'frame', points: box(2.05, -0.08, 2.95, 0.08), holes: [] },
        { id: 'glass', points: box(2.1, -0.02, 2.9, 0.02), holes: [] },
      ],
    })

    expect(nodes.map((n) => n.type)).toEqual(['wall', 'window', 'window'])
    const bridge = nodes[0] as WallNode
    expect(nodes.slice(1).map((n) => n.parentId)).toEqual([bridge.id, bridge.id])
  })
})

describe('outlineBatchPrimitiveNodes dense outlines', () => {
  test('fits a densely traced curve to the corner cap instead of refusing it', () => {
    const circle = Array.from({ length: 2400 }, (_, i) => {
      const angle = (i / 2400) * Math.PI * 2
      return px([Math.cos(angle) * 4, Math.sin(angle) * 4])
    })
    const [slab] = outlineBatchPrimitiveNodes({
      ...base,
      kind: 'slab',
      shapes: [{ id: 'curve', points: circle, holes: [] }],
    })

    expect(slab?.type).toBe('slab')
    const polygon = (slab as { polygon: [number, number][] }).polygon
    expect(polygon.length).toBeGreaterThan(8)
    expect(polygon.length).toBeLessThanOrEqual(1024)
  })
})
