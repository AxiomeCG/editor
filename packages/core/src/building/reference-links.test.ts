import { afterEach, beforeEach, expect, test } from 'bun:test'
import { DoorNode, type AnyNode, type GuideNode, type WallNode } from '../schema'
import { subscribeSceneCommits, type SceneCommit } from '../store/history-control'
import useScene from '../store/use-scene'
import { referenceChain } from './__fixtures__/reference-chain'
import { reconcileReferenceLinks } from './reference-links'

const originalRaf = globalThis.requestAnimationFrame
const originalCancel = globalThis.cancelAnimationFrame
let scene = referenceChain()
beforeEach(() => {
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  scene = referenceChain()
  useScene.setState({ nodes: scene.nodes, rootNodeIds: [scene.building.id], readOnly: false })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
})
afterEach(() => {
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancel
})

function expectScaled(before: AnyNode, after: AnyNode, origin: [number, number], ratio: number) {
  const point = (a: number[], b: number[]) => {
    expect(b[0]).toBeCloseTo(origin[0] + (a[0]! - origin[0]) * ratio, 8)
    expect(b[1]).toBeCloseTo(origin[1] + (a[1]! - origin[1]) * ratio, 8)
  }
  if (before.type === 'guide' && after.type === 'guide') {
    point([before.position[0], before.position[2]], [after.position[0], after.position[2]])
    expect(after.position[1]).toBe(before.position[1])
    expect(after.scale).toBeCloseTo(before.scale * ratio)
  } else if (
    (before.type === 'wall' && after.type === 'wall') ||
    (before.type === 'fence' && after.type === 'fence')
  ) {
    point(before.start, after.start)
    point(before.end, after.end)
    expect(after.height).toBe(before.height)
    expect(after.thickness).toBe(before.thickness)
  } else if (
    (before.type === 'slab' && after.type === 'slab') ||
    (before.type === 'zone' && after.type === 'zone')
  ) {
    before.polygon.forEach((p, index) => point(p, after.polygon[index]!))
  }
}

for (const index of [0, 1, 2])
  test(`rescaling plan ${index} updates the whole chain and its SVG geometry in one persisted undo`, () => {
    const guide = scene.guides[index]!
    const commits: SceneCommit[] = []
    const stop = subscribeSceneCommits((commit) => commits.push(commit))
    try {
      useScene.getState().updateNode(guide.id, { scale: guide.scale * 2 })
      const after = useScene.getState().nodes
      for (const before of [...scene.guides, ...scene.elements])
        expectScaled(before, after[before.id]!, [guide.position[0], guide.position[2]], 2)
      expect(commits).toHaveLength(1)
      for (const node of [...scene.guides, ...scene.elements]) {
        expect(commits[0]!.current.nodes[node.id]).toEqual(after[node.id])
        expect(commits[0]!.changedNodeIds?.has(node.id)).toBe(true)
      }
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes).toEqual(scene.nodes)
      useScene.temporal.getState().redo()
      expect(useScene.getState().nodes).toEqual(after)
    } finally {
      stop()
    }
  })

test('editing one wall detaches only that wall; undo restores its link', () => {
  const wall = scene.elements.find((node): node is WallNode => node.type === 'wall')!
  useScene.getState().updateNode(wall.id, { start: [wall.start[0] + 1, wall.start[1]] })
  const edited = useScene.getState().nodes[wall.id]!
  expect(edited.metadata.referenceOutline).toMatchObject({
    linked: false,
    detachedReason: 'geometry-edited',
  })
  useScene.getState().updateNode(scene.guides[0]!.id, { scale: 2 })
  expect(useScene.getState().nodes[wall.id]).toEqual(edited)
  const sibling = scene.elements.find((node) => node.type === 'wall' && node.id !== wall.id)!
  expect(useScene.getState().nodes[sibling.id]).not.toEqual(sibling)
  useScene.temporal.getState().undo()
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[wall.id]).toEqual(wall)
})

test('renaming and painting keep the reference link; explicit detachment survives reload', () => {
  const wall = scene.elements.find((node): node is WallNode => node.type === 'wall')!
  useScene.getState().updateNode(wall.id, { name: 'Named wall', materialPreset: 'brick' })
  expect(useScene.getState().nodes[wall.id]!.metadata.referenceOutline).toMatchObject({
    linked: true,
  })
  const current = useScene.getState().nodes[wall.id]!
  useScene
    .getState()
    .updateNode(wall.id, {
      metadata: {
        ...current.metadata,
        referenceOutline: { ...(current.metadata.referenceOutline as object), linked: false },
      },
    })
  useScene.setState({ nodes: JSON.parse(JSON.stringify(useScene.getState().nodes)) })
  const detached = useScene.getState().nodes[wall.id]
  useScene.getState().updateNode(scene.guides[0]!.id, { scale: 2 })
  expect(useScene.getState().nodes[wall.id]).toBe(detached)
})

test('new matching keeps the anchor fixed while moving the target and its descendants', () => {
  const [a, b, c] = scene.guides as [GuideNode, GuideNode, GuideNode]
  const next = {
    ...b,
    scale: 4,
    metadata: {
      ...b.metadata,
      planReference: {
        ...(b.metadata.planReference as object),
        alignment: {
          anchorGuideId: a.id,
          targetGuideId: b.id,
          targetEdge: [
            [1, 1],
            [2, 2],
          ],
        },
      },
    },
  }
  useScene.getState().updateNode(b.id, next)
  expect(useScene.getState().nodes[a.id]).toEqual(a)
  expect((useScene.getState().nodes[c.id] as GuideNode).scale).toBe(6)
})

test('conflicting edits are rejected atomically, with no history entry', () => {
  const [a, b] = scene.guides as [GuideNode, GuideNode, GuideNode]
  expect(() =>
    useScene.getState().updateNodes([
      { id: a.id, data: { scale: 2 } },
      { id: b.id, data: { scale: 8 } },
    ]),
  ).toThrow('conflicting')
  expect(useScene.getState().nodes).toEqual(scene.nodes)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('deleting a source preserves and detaches the derived geometry', () => {
  const guide = scene.guides[0]!
  useScene.getState().deleteNode(guide.id)
  const element = scene.elements.find(
    (node) => (node.metadata.referenceOutline as { guideId: string }).guideId === guide.id,
  )!
  expect(useScene.getState().nodes[element.id]!.metadata.referenceOutline).toMatchObject({
    linked: false,
    detachedReason: 'source-unavailable',
  })
})

test('cycles terminate, and references in other buildings stay independent', () => {
  const [a, , c] = scene.guides as [GuideNode, GuideNode, GuideNode]
  a.metadata.planReference = {
    ...(a.metadata.planReference as object),
    alignment: { anchorGuideId: c.id },
  }
  const next = { ...scene.nodes, [a.id]: { ...a, scale: 2 } }
  const updates = reconcileReferenceLinks(scene.nodes, next, [a.id])
  expect(updates.filter((node) => node.type === 'guide')).toHaveLength(3)
  const detachedLevel = { ...scene.levels[2]!, parentId: null }
  const separated = { ...scene.nodes, [detachedLevel.id]: detachedLevel }
  expect(
    reconcileReferenceLinks(separated, { ...separated, [a.id]: next[a.id]! }, [a.id]).some(
      (node) => node.id === c.id,
    ),
  ).toBe(false)
})

test('a quarter turn and translation move the complete chain, slab cutouts and hosted openings', () => {
  const guide = scene.guides[0]!
  const wall = scene.elements.find((n): n is WallNode => n.type === 'wall')!
  const door = DoorNode.parse({
    parentId: wall.id,
    wallId: wall.id,
    position: [1, 1.05, 0],
    width: 0.9,
  })
  useScene.getState().createNode(door, wall.id)
  const slab = scene.elements.find((n) => n.type === 'slab')!
  if (slab.type !== 'slab') throw Error('Expected slab')
  const hole: [number, number][] = [
    [10, -5],
    [11, -5],
    [11, -4],
  ]
  // Fixture setup keeps the opening in the authored reference footprint.
  useScene.setState((s) => ({ nodes: { ...s.nodes, [slab.id]: { ...slab, holes: [hole] } } }))
  useScene.temporal.getState().clear()
  useScene
    .getState()
    .updateNode(guide.id, {
      rotation: [0, Math.PI / 2, 0],
      position: [20, guide.position[1], 10],
      scale: 2,
    })
  const nodes = useScene.getState().nodes
  const movedWall = nodes[wall.id] as WallNode
  expect(movedWall.start[0]).toBeCloseTo(20 + 2 * (wall.start[1] + 5))
  expect(movedWall.start[1]).toBeCloseTo(10 - 2 * (wall.start[0] - 10))
  const movedSlab = nodes[slab.id]
  if (movedSlab?.type !== 'slab') throw Error('Expected slab')
  expect(movedSlab.holes[0]).toEqual([
    [20, 10],
    [20, 8],
    [22, 8],
  ])
  expect((nodes[door.id] as DoorNode).position).toEqual([2, 1.05, 0])
  expect((nodes[door.id] as DoorNode).width).toBe(0.9)
  expect(movedWall.metadata.referenceOutline).toMatchObject({ linked: true })
  expect((nodes[scene.guides[2]!.id] as GuideNode).rotation[1]).toBeCloseTo(0.6 + Math.PI / 2)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
})
