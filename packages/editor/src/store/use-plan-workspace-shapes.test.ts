import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  detectSpacesForLevel,
  type DoorNode,
  GuideNode,
  type ItemNode,
  LevelNode,
  useScene,
  WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { PlanShape } from '../lib/plan-reference/selection-geometry'

// Rasterizing needs a browser; the fill itself is covered by whitespace.test.ts.
let nextFill: PlanShape | null = null
mock.module('../lib/plan-reference/whitespace', () => ({
  pickWhitespaceRegion: async () => nextFill,
}))

const { followGuide, workspaceShapeCandidates } = await import('../lib/plan-reference/workspace')
const { usePlanWorkspace } = await import('./use-plan-workspace')

// 1000 px at scale 10 → 0.1 m/px, image centre on the level origin.
const px = ([x, z]: [number, number]) => [x / 0.1 + 500, z / 0.1 + 400] as [number, number]
const box = (x0: number, z0: number, x1: number, z1: number) =>
  (
    [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ] as [number, number][]
  ).map(px)
const outline = (id: string, points: [number, number][]) => ({
  id,
  type: 'Polygon' as const,
  points: points.map((p) => p.join(',')).join(' '),
})

function fixture() {
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const guide = GuideNode.parse({
    parentId: level.id,
    url: '/plan.svg',
    scale: 10,
    metadata: { planReference: { width: 1000, height: 800, role: 'floorplan' } },
  })
  const left = WallNode.parse({ parentId: level.id, start: [0, 0], end: [2, 0] })
  const right = WallNode.parse({ parentId: level.id, start: [3, 0], end: [6, 0] })
  level.children = [guide.id, left.id, right.id]
  building.children = [level.id]
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, level, guide, left, right].map((n) => [n.id, n]),
  )
  return { nodes, building, level, guide, left, right }
}

let scene = fixture()
const originalRaf = globalThis.requestAnimationFrame
beforeEach(() => {
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  usePlanWorkspace.getState().close()
  scene = fixture()
  useScene.setState({ nodes: scene.nodes, rootNodeIds: [scene.building.id], readOnly: false })
  useScene.temporal.getState().clear()
  useViewer.getState().setSelection({ levelId: scene.level.id, selectedIds: [] })
  nextFill = null
})
afterEach(() => {
  usePlanWorkspace.getState().close()
  globalThis.requestAnimationFrame = originalRaf
})

function shapesDraft() {
  const draft = usePlanWorkspace.getState().draft
  if (draft?.mode !== 'shapes') throw Error(usePlanWorkspace.getState().error || 'No shapes draft')
  return draft
}

test('a whitespace fill becomes a selectable area and commits as a zone', async () => {
  usePlanWorkspace.getState().openShapes(scene.level, scene.guide, [], 'areas')
  nextFill = { id: 'fill-room', points: box(1, 1, 4, 3), holes: [] }

  await usePlanWorkspace.getState().pickWhitespace(px([2, 2]))

  const draft = shapesDraft()
  expect(draft.selected).toEqual(['fill-room'])
  const candidates = workspaceShapeCandidates(draft)
  expect(candidates.map((s) => s.id)).toContain('fill-room')
  // Memoised previews depend on the candidate array keeping its identity.
  expect(workspaceShapeCandidates(draft)).toBe(candidates)

  usePlanWorkspace.getState().change((d) => (d.mode === 'shapes' ? { ...d, kind: 'zone' } : d))
  usePlanWorkspace.getState().commit()
  expect(usePlanWorkspace.getState().error).toBe('')
  const zones = Object.values(useScene.getState().nodes).filter(
    (n): n is ZoneNode => n.type === 'zone',
  )
  expect(zones).toHaveLength(1)
  expect(zones[0]!.polygon.map(([x, z]) => [+x.toFixed(6), +z.toFixed(6)])).toEqual([
    [1, 1],
    [4, 1],
    [4, 3],
    [1, 3],
  ])
})

test('Areas mode offers stroked wall paths next to faces and builds walls from them', () => {
  const room = outline('room', box(1, 1, 4, 3))
  const wallLine = {
    id: 'wall-line',
    type: 'Stroke' as const,
    strokeWidth: 2,
    points: [px([0, -1]), px([5, -1])].map((p) => p.join(',')).join(' '),
  }
  usePlanWorkspace.getState().openShapes(scene.level, scene.guide, [room, wallLine], 'areas')

  const ids = workspaceShapeCandidates(shapesDraft()).map((s) => s.id)
  expect(ids).toContain('wall-line')
  expect(ids.some((id) => id.startsWith('area:'))).toBe(true)

  usePlanWorkspace
    .getState()
    .change((d) => (d.mode === 'shapes' ? { ...d, kind: 'walls', selected: ['wall-line'] } : d))
  usePlanWorkspace.getState().commit()

  expect(usePlanWorkspace.getState().error).toBe('')
  const created = Object.values(useScene.getState().nodes).filter(
    (n): n is WallNode => n.type === 'wall' && n.name?.startsWith('Plan outline') === true,
  )
  expect(created).toHaveLength(1)
  expect(created[0]!.start.map((v) => +v.toFixed(6))).toEqual([0, -1])
  expect(created[0]!.end.map((v) => +v.toFixed(6))).toEqual([5, -1])
})

test('plan wall strokes that overshoot corners and stop at faces commit as closed rooms', () => {
  const stroke = (id: string, a: [number, number], b: [number, number]) => ({
    id,
    type: 'Stroke' as const,
    strokeWidth: 2,
    points: [px(a), px(b)].map((p) => p.join(',')).join(' '),
  })
  usePlanWorkspace.getState().openShapes(scene.level, scene.guide, [
    stroke('north', [-0.09, 2], [6.09, 2]),
    stroke('east', [6, 1.91], [6, 6.09]),
    stroke('south', [6.09, 6], [-0.09, 6]),
    stroke('west', [0, 6.09], [0, 1.91]),
    // A partition drawn face to face, 9 cm short of both centrelines.
    stroke('partition', [3, 2.09], [3, 5.91]),
  ])
  usePlanWorkspace.getState().change((d) =>
    d.mode === 'shapes'
      ? {
          ...d,
          kind: 'walls',
          thickness: 0.18,
          selected: ['north', 'east', 'south', 'west', 'partition'],
        }
      : d,
  )

  usePlanWorkspace.getState().commit()

  expect(usePlanWorkspace.getState().error).toBe('')
  const walls = Object.values(useScene.getState().nodes).filter(
    (n): n is WallNode => n.type === 'wall' && n.parentId === scene.level.id,
  )
  expect(detectSpacesForLevel(scene.level.id, walls).rooms).toHaveLength(2)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
})

test('a fill that lands after the session changed is dropped', async () => {
  usePlanWorkspace.getState().openShapes(scene.level, scene.guide, [], 'areas')
  nextFill = { id: 'fill-late', points: box(1, 1, 4, 3), holes: [] }
  const pending = usePlanWorkspace.getState().pickWhitespace(px([2, 2]))
  usePlanWorkspace.getState().setSelectionMode('source')
  await pending

  expect(shapesDraft().fills ?? []).toHaveLength(0)
  expect(shapesDraft().selected).toEqual([])
})

test('a grouped door symbol commits the bridge wall and its door in one undo step', () => {
  const arc = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 11) * (Math.PI / 2)
    return px([2 + Math.cos(angle), 0.09 + Math.sin(angle)])
  })
  usePlanWorkspace
    .getState()
    .openShapes(scene.level, scene.guide, [
      outline('leaf', box(2, 0.09, 2.04, 1.09)),
      { id: 'swing', type: 'Stroke', points: arc.map((p) => p.join(',')).join(' ') },
    ])
  usePlanWorkspace
    .getState()
    .change((d) => (d.mode === 'shapes' ? { ...d, kind: 'door', selected: ['leaf', 'swing'] } : d))

  usePlanWorkspace.getState().commit()

  expect(usePlanWorkspace.getState().error).toBe('')
  const nodes = useScene.getState().nodes
  const door = Object.values(nodes).find((n): n is DoorNode => n.type === 'door')!
  const host = nodes[door.parentId as AnyNodeId] as WallNode
  expect(host.type).toBe('wall')
  expect(host.start).toEqual([2, 0])
  expect(host.end).toEqual([3, 0])
  expect(door.wallId).toBe(host.id)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
})

test('a sofa symbol commits a real-size catalog sofa in one undo step', () => {
  usePlanWorkspace
    .getState()
    .openShapes(scene.level, scene.guide, [outline('sofa-symbol', box(1, 4, 3.2, 4.95))])
  usePlanWorkspace
    .getState()
    .change((d) => (d.mode === 'shapes' ? { ...d, kind: 'prop', selected: ['sofa-symbol'] } : d))

  usePlanWorkspace.getState().commit()
  expect(usePlanWorkspace.getState().error).toContain('catalog item')

  usePlanWorkspace
    .getState()
    .change((d) => (d.mode === 'shapes' ? { ...d, propItemId: 'sofa' } : d))
  usePlanWorkspace.getState().commit()

  expect(usePlanWorkspace.getState().error).toBe('')
  const items = Object.values(useScene.getState().nodes).filter(
    (n): n is ItemNode => n.type === 'item',
  )
  expect(items).toHaveLength(1)
  const [sofa] = items
  expect(sofa!.asset.id).toBe('sofa')
  expect(sofa!.scale).toEqual([1, 1, 1])
  expect(sofa!.parentId).toBe(scene.level.id)
  expect(sofa!.position[0]).toBeCloseTo(2.1, 6)
  expect(sofa!.position[2]).toBeCloseTo(4.475, 6)
  // The sofa's long side (local X) lies along the symbol's long side (level X).
  expect(Math.abs(Math.sin(sofa!.rotation[1]))).toBeCloseTo(0, 6)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  expect(usePlanWorkspace.getState().message).toContain('1 prop created')
})

test('after the guide is rescaled, following it lets Create commit at the new frame', () => {
  usePlanWorkspace
    .getState()
    .openShapes(scene.level, scene.guide, [outline('slab', box(1, 1, 4, 3))])
  usePlanWorkspace
    .getState()
    .change((d) => (d.mode === 'shapes' ? { ...d, kind: 'zone', selected: ['slab'] } : d))
  useScene.getState().updateNode(scene.guide.id, { scale: 20 })
  const live = useScene.getState().nodes[scene.guide.id] as GuideNode

  // Without following, the commit guard refuses the moved reference.
  usePlanWorkspace.getState().commit()
  expect(usePlanWorkspace.getState().error).toContain('reference changed')

  const next = followGuide(shapesDraft(), live)!
  usePlanWorkspace.getState().change(() => next)
  usePlanWorkspace.getState().commit()

  expect(usePlanWorkspace.getState().error).toBe('')
  const zone = Object.values(useScene.getState().nodes).find(
    (n): n is ZoneNode => n.type === 'zone',
  )!
  // Twice the scale doubles every coordinate around the guide centre.
  expect(zone.polygon[0]![0]).toBeCloseTo(2, 6)
  expect(zone.polygon[0]![1]).toBeCloseTo(2, 6)
})

test('a guide whose image dimensions changed closes the session instead of following', () => {
  usePlanWorkspace.getState().openShapes(scene.level, scene.guide, [])
  const replaced = GuideNode.parse({
    ...scene.guide,
    metadata: { planReference: { width: 2000, height: 800, role: 'floorplan' } },
  })

  expect(followGuide(shapesDraft(), replaced)).toBeNull()
})
