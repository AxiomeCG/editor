import { beforeEach, afterEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  WallNode,
  DoorNode,
  WindowNode,
  SlabNode,
  FenceNode,
  ZoneNode,
  UnitNode,
  GuideNode,
  useScene,
} from '@pascal-app/core'
import {
  createBalconyParts,
  DEFAULT_BALCONY,
  mirrorPoint,
  mirrorSelection,
  planMirror,
} from '@pascal-app/core/building'
import { commitMirror } from './mirror'
import { buildLevelDuplicateCreateOps } from './level-duplication'
import { planBalconyStyle } from './balcony-style'

function fixture() {
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ parentId: building.id, level: 3, name: 'Étage 4', height: 3.2 })
  const upper = LevelNode.parse({ parentId: building.id, level: 4, name: 'Étage 5', height: 3.2 })
  const guide = GuideNode.parse({ parentId: level.id, url: '/plan.svg' })
  const metadata = { referenceOutline: { guideId: guide.id, linked: true } }
  const wall = WallNode.parse({
    parentId: level.id,
    start: [0, 0],
    end: [4, 0],
    curveOffset: 0.2,
    metadata,
  })
  const door = DoorNode.parse({
    parentId: wall.id,
    wallId: wall.id,
    position: [1, 1.05, 0],
    hingesSide: 'left',
    handleSide: 'right',
  })
  const window = WindowNode.parse({
    parentId: wall.id,
    wallId: wall.id,
    position: [3, 2, 0],
    columnRatios: [0.3, 0.7],
    openingCornerRadii: [1, 2, 3, 4],
  })
  const zone = ZoneNode.parse({
    parentId: level.id,
    name: '401',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    boundaryWallIds: [wall.id],
    metadata,
  })
  const slab = SlabNode.parse({
    parentId: level.id,
    polygon: zone.polygon,
    holes: [
      [
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 2],
      ],
    ],
    elevation: 0.2,
    metadata,
  })
  const fence = FenceNode.parse({
    parentId: level.id,
    start: [0, 4],
    end: [4, 4],
    supportSlabId: slab.id,
    path: [
      [0, 4],
      [2, 3],
      [4, 4],
    ],
    tangents: [[1, 0], null, [1, 1]],
  })
  const unit = UnitNode.parse({ parentId: building.id, name: '401', members: [zone.id], metadata })
  const upperZone = ZoneNode.parse({ parentId: upper.id, name: '501', polygon: zone.polygon })
  const upperUnit = UnitNode.parse({ parentId: building.id, name: '501', members: [upperZone.id] })
  wall.children = [door.id, window.id]
  level.children = [guide.id, wall.id, zone.id, slab.id, fence.id]
  upper.children = [upperZone.id]
  building.children = [level.id, upper.id, unit.id, upperUnit.id]
  const nodes = Object.fromEntries(
    [
      building,
      level,
      upper,
      guide,
      wall,
      door,
      window,
      zone,
      slab,
      fence,
      unit,
      upperZone,
      upperUnit,
    ].map((n) => [n.id, n]),
  ) as Record<AnyNodeId, AnyNode>
  return {
    nodes,
    building,
    level,
    upper,
    guide,
    wall,
    door,
    window,
    zone,
    slab,
    fence,
    unit,
    upperUnit,
  }
}
let scene = fixture()
const raf = globalThis.requestAnimationFrame
beforeEach(() => {
  globalThis.requestAnimationFrame = (fn) => {
    fn(0)
    return 0
  }
  scene = fixture()
  useScene.setState({ nodes: scene.nodes, rootNodeIds: [scene.building.id], readOnly: false })
  useScene.temporal.getState().clear()
})
afterEach(() => {
  globalThis.requestAnimationFrame = raf
})

for (const axis of ['x', 'z'] as const)
  test(`mirror twice around ${axis} restores geometry, and one undo restores dependencies`, () => {
    const before = structuredClone(scene.nodes)
    commitMirror([scene.level.id], { axis, coordinate: 7, copy: false })
    const reflected = useScene.getState().nodes
    expect((reflected[scene.door.id] as DoorNode).position[0]).toBe(3)
    expect((reflected[scene.door.id] as DoorNode).hingesSide).toBe('right')
    expect((reflected[scene.window.id] as WindowNode).columnRatios).toEqual([0.7, 0.3])
    expect((reflected[scene.window.id] as WindowNode).openingCornerRadii).toEqual([2, 1, 4, 3])
    expect((reflected[scene.wall.id]!.metadata.referenceOutline as any).linked).toBe(false)
    expect(reflected[scene.guide.id]).toEqual(before[scene.guide.id])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    commitMirror([scene.level.id], { axis, coordinate: 7, copy: false })
    for (const id of [
      scene.wall.id,
      scene.door.id,
      scene.window.id,
      scene.slab.id,
      scene.fence.id,
      scene.zone.id,
    ]) {
      const { metadata: _a, ...a } = before[id]!
      const { metadata: _b, ...b } = useScene.getState().nodes[id]!
      expect(b).toEqual(a)
    }
    useScene.temporal.getState().undo()
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
  })

test('unit expansion includes walls, hosted openings and its floor geometry exactly once', () => {
  const selected = mirrorSelection(scene.nodes, [scene.unit.id, scene.wall.id])
  expect(selected.map((n) => n.id).sort()).toEqual(
    [scene.unit, scene.zone, scene.wall, scene.door, scene.window, scene.slab, scene.fence]
      .map((n) => n.id)
      .sort(),
  )
  const before = structuredClone(scene.nodes)
  const [id] = commitMirror([scene.unit.id], { axis: 'x', coordinate: 4, copy: true })
  const nodes = useScene.getState().nodes
  const copy = nodes[id!] as UnitNode
  expect(copy.members).not.toEqual(scene.unit.members)
  expect(nodes[copy.members[0]!]!.parentId).toBe(scene.level.id)
  const copiedZone = nodes[copy.members[0]!] as ZoneNode
  expect(copiedZone.boundaryWallIds[0]).not.toBe(scene.wall.id)
  expect((nodes[copiedZone.boundaryWallIds[0]!] as WallNode).start).toEqual([4, 0])
  expect(nodes[scene.wall.id]).toEqual(scene.wall)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
})

for (const mirror of [false, true])
  test(`${mirror ? 'mirror' : 'duplicate'} floor makes 501, shifts 501 to 601, and undo restores everything`, () => {
    const before = structuredClone(scene.nodes)
    let result: AnyNodeId
    if (mirror)
      [result] = commitMirror([scene.level.id], { axis: 'x', coordinate: 2, copy: true }) as [
        AnyNodeId,
      ]
    else {
      const plan = buildLevelDuplicateCreateOps({
        nodes: scene.nodes,
        level: scene.level,
        levels: [scene.level, scene.upper],
        preset: 'everything',
      })
      useScene.getState().applyNodeChanges({
        create: plan.createOps,
        update: plan.shiftedLevels.map((l) => ({ id: l.id, data: { level: l.level } })),
      })
      result = plan.newLevelId
    }
    const nodes = useScene.getState().nodes
    expect(nodes[result]!.name).toBe('Étage 5')
    expect(nodes[scene.upper.id]!.name).toBe('Étage 6')
    expect(nodes[scene.upperUnit.id]!.name).toBe('601')
    const unit = Object.values(nodes).find(
      (n) => n.type === 'unit' && n.members.every((id) => nodes[id]!.parentId === result),
    ) as UnitNode
    expect(unit.name).toBe('501')
    const zone = nodes[unit.members[0]!] as ZoneNode
    expect(zone.name).toBe('501')
    expect(zone.boundaryWallIds[0]).not.toBe(scene.wall.id)
    expect(nodes[zone.boundaryWallIds[0]!]!.parentId).toBe(result)
    expect((nodes[zone.boundaryWallIds[0]!]!.metadata.referenceOutline as any).linked).toBe(false)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
  })

test('preview is pure; invalid selection and read-only edits change nothing', () => {
  const before = structuredClone(scene.nodes)
  planMirror(scene.nodes, [scene.unit.id], { axis: 'x', coordinate: 4, copy: true })
  expect(useScene.getState().nodes).toEqual(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(() => commitMirror([scene.door.id], { axis: 'x', coordinate: 4, copy: true })).toThrow(
    'host wall',
  )
  useScene.setState({ readOnly: true })
  expect(() => commitMirror([scene.level.id], { axis: 'x', coordinate: 4, copy: true })).toThrow(
    'read-only',
  )
  expect(useScene.getState().nodes).toEqual(before)
})

test('shared unit walls require a copy, while mirroring the whole floor is allowed', () => {
  const neighbor = ZoneNode.parse({
    parentId: scene.level.id,
    name: '402',
    polygon: [
      [0, 0],
      [4, 0],
      [4, -3],
      [0, -3],
    ],
    boundaryWallIds: [scene.wall.id],
  })
  useScene.getState().createNode(neighbor, scene.level.id)
  const before = structuredClone(useScene.getState().nodes)
  expect(() => commitMirror([scene.unit.id], { axis: 'x', coordinate: 4, copy: false })).toThrow(
    'shares walls',
  )
  expect(useScene.getState().nodes).toEqual(before)
  expect(() =>
    commitMirror([scene.unit.id], { axis: 'x', coordinate: 4, copy: true }),
  ).not.toThrow()
})

test('an empty floor cannot silently create an empty mirror', () => {
  const empty = LevelNode.parse({ parentId: scene.building.id, level: 8 })
  useScene.getState().createNode(empty, scene.building.id)
  expect(() => commitMirror([empty.id], { axis: 'x', coordinate: 0, copy: true })).toThrow(
    'no building geometry',
  )
})

test('mirroring a balcony deck or guard copies the complete balcony with remapped support', () => {
  const parts = createBalconyParts({
    level: scene.level,
    polygon: [
      [10, 10],
      [14, 10],
      [14, 12],
      [10, 12],
    ],
    options: { ...DEFAULT_BALCONY, openEdge: 0 },
  })
  useScene.getState().createNodes(parts.map((node) => ({ node, parentId: scene.level.id })))
  const before = structuredClone(useScene.getState().nodes)
  for (const selected of [parts[0]!, parts[1]!]) {
    const plan = planMirror(before, [selected.id], { axis: 'x', coordinate: 20, copy: true })
    expect(plan.sourceIds.sort()).toEqual(parts.map((n) => n.id).sort())
    const deck = plan.creates.find((n) => n.type === 'slab') as SlabNode
    const guards = plan.creates.filter((n): n is FenceNode => n.type === 'fence')
    expect(guards).toHaveLength(3)
    for (const guard of guards) {
      expect(guard.supportSlabId).toBe(deck.id)
      expect((guard.metadata.balcony as any).id).toBe(deck.id)
    }
  }
  commitMirror([parts[0]!.id], { axis: 'x', coordinate: 20, copy: true })
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
})

test('railings added after mirroring preserve the balcony opening and courtyard edges', () => {
  const parts = createBalconyParts({
    level: scene.level,
    polygon: [
      [10, 10],
      [16, 10],
      [16, 16],
      [10, 16],
    ],
    holes: [
      [
        [12, 12],
        [12, 14],
        [14, 14],
        [14, 12],
      ],
    ],
    options: { ...DEFAULT_BALCONY, railing: 'none', openEdge: 0 },
  })
  useScene.getState().createNodes(parts.map((node) => ({ node, parentId: scene.level.id })))
  const before = useScene.getState().nodes
  const originalGuards = planBalconyStyle(before, [parts[0]!.id], { railing: 'rail' }).create
  const options = { axis: 'z' as const, coordinate: 20, copy: true }
  const [copyId] = commitMirror([parts[0]!.id], options)
  const nodes = useScene.getState().nodes
  const copy = nodes[copyId!] as SlabNode
  expect((copy.metadata.balcony as any).options.openEdge).toBe(2)
  const guards = planBalconyStyle(nodes, [copy.id], { railing: 'rail' }).create
  const edgeKey = (a: number[], b: number[]) => [a.join(','), b.join(',')].sort().join('|')
  expect(guards.map((g) => edgeKey(g.start, g.end)).sort()).toEqual(
    originalGuards
      .map((g) => edgeKey(mirrorPoint(g.start, options), mirrorPoint(g.end, options)))
      .sort(),
  )
  expect(guards).toHaveLength(7)
})

test('mirroring preserves facade settings while releasing generator ownership', () => {
  const config = { windows: { rows: 2, columns: 3 }, style: 'curtain', detached: false }
  scene.wall.metadata.proceduralFacade = config
  scene.window.metadata.facadeOwner = scene.wall.id
  scene.window.metadata.facadeCell = '0:1'
  const plan = planMirror(scene.nodes, [scene.wall.id], { axis: 'x', coordinate: 4, copy: true })
  const wall = plan.creates.find((n) => n.type === 'wall')!
  const window = plan.creates.find((n) => n.type === 'window')!
  expect(wall.metadata.proceduralFacade).toEqual({
    ...config,
    detached: true,
    detachedReason: 'Mirrored geometry.',
  })
  expect(window.metadata.facadeOwner).toBeUndefined()
  expect(window.metadata.facadeCell).toBeUndefined()
  expect(scene.wall.metadata.proceduralFacade).toEqual(config)
})
