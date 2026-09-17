import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  GuideNode,
  LevelNode,
  useScene,
} from '@pascal-app/core'
import { imagePointToLevel } from '@pascal-app/core/building'
import { useViewer } from '@pascal-app/viewer'
import { getPlanMatchAnchors } from '../lib/plan-reference/matching'
import { guideReference, workspaceReferences } from '../lib/plan-reference/workspace'
import { usePlanWorkspace } from './use-plan-workspace'

function fixture() {
  const building = BuildingNode.parse({})
  const otherBuilding = BuildingNode.parse({})
  const sourceLevel = LevelNode.parse({ parentId: building.id, level: 1, visible: false })
  const targetLevel = LevelNode.parse({ parentId: building.id, level: 2, baseElevation: 1.2 })
  const otherLevel = LevelNode.parse({ parentId: otherBuilding.id, level: 1 })
  const anchor = GuideNode.parse({
    name: 'Calibrated plan',
    parentId: sourceLevel.id,
    url: '/source.png',
    position: [12, 0.03, -7],
    rotation: [0, 0.6, 0],
    scale: 2,
    visible: false,
    scaleReference: {
      start: [0, 0],
      end: [20, 0],
      realLengthMeters: 20,
      measuredLengthUnits: 20,
      metersPerUnit: 1,
      label: 'Known length',
    },
    metadata: { planReference: { width: 1000, height: 800, assetId: 'source' } },
  })
  const target = GuideNode.parse({
    name: 'Target plan',
    parentId: targetLevel.id,
    url: '/target.png',
    position: [-4, 0.075, 8],
    rotation: [0, -0.2, 0],
    metadata: { planReference: { width: 600, height: 400, assetId: 'target' } },
  })
  sourceLevel.children = [anchor.id]
  targetLevel.children = [target.id]
  building.children = [sourceLevel.id, targetLevel.id]
  otherBuilding.children = [otherLevel.id]
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, otherBuilding, sourceLevel, targetLevel, otherLevel, anchor, target].map((node) => [
      node.id,
      node,
    ]),
  )
  return { nodes, building, otherBuilding, sourceLevel, targetLevel, otherLevel, anchor, target }
}

let scene = fixture()
const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
beforeEach(() => {
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  usePlanWorkspace.getState().close()
  scene = fixture()
  useScene.setState({
    nodes: scene.nodes,
    rootNodeIds: [scene.building.id, scene.otherBuilding.id],
    readOnly: false,
  })
  useScene.temporal.getState().clear()
  useViewer.getState().setSelection({ levelId: scene.targetLevel.id, selectedIds: [] })
  useViewer.getState().setShowGuides(true)
})
afterEach(() => {
  usePlanWorkspace.getState().close()
  globalThis.requestAnimationFrame = originalRaf
  globalThis.cancelAnimationFrame = originalCancelRaf
})

function matchSpans() {
  const workspace = usePlanWorkspace.getState()
  workspace.openGuide(scene.targetLevel, scene.target, scene.anchor)
  expect(usePlanWorkspace.getState().error).toBe('')
  workspace.pick([250, 300])
  workspace.pick([650, 420])
  workspace.setStage('unit-span')
  workspace.pick([130, 70])
  workspace.pick([130, 270])
  workspace.setStage('adjust')
  expect(usePlanWorkspace.getState().error).toBe('')
}

test('Match offers calibrated plans across this building, with this floor first', () => {
  const sameFloor = GuideNode.parse({
    ...scene.anchor,
    id: undefined,
    parentId: scene.targetLevel.id,
  })
  const otherBuilding = GuideNode.parse({
    ...scene.anchor,
    id: undefined,
    parentId: scene.otherLevel.id,
  })
  const uncalibrated = GuideNode.parse({ ...scene.anchor, id: undefined, scaleReference: null })
  const orphan = GuideNode.parse({ ...scene.anchor, id: undefined, parentId: null })
  for (const guide of [sameFloor, otherBuilding, uncalibrated, orphan])
    scene.nodes[guide.id] = guide
  expect(getPlanMatchAnchors(scene.target, scene.nodes).map((guide) => guide.id)).toEqual([
    sameFloor.id,
    scene.anchor.id,
  ])
  expect(getPlanMatchAnchors(orphan, scene.nodes)).toEqual([])
})

for (const sourceFloor of [0, 2, 5]) {
  test(`matching from floor ${sourceFloor} preserves the reference and saves only the target in one undo`, () => {
    scene.sourceLevel.level = sourceFloor
    if (sourceFloor === 2) {
      scene.anchor.parentId = scene.targetLevel.id
      scene.sourceLevel.children = []
      scene.targetLevel.children.push(scene.anchor.id)
    }
    const before = structuredClone(useScene.getState().nodes)
    matchSpans()
    const draft = usePlanWorkspace.getState().draft!
    expect(draft.levelId).toBe(scene.targetLevel.id)
    expect(workspaceReferences(draft)).toHaveLength(2)
    expect(useScene.getState().nodes).toEqual(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    usePlanWorkspace.getState().commit()
    expect(usePlanWorkspace.getState().error).toBe('')
    expect(usePlanWorkspace.getState().draft).toBeNull()
    const after = useScene.getState().nodes
    expect(
      (Object.keys(after) as AnyNodeId[]).filter(
        (id) => JSON.stringify(after[id]) !== JSON.stringify(before[id]),
      ),
    ).toEqual([scene.target.id])
    const saved = after[scene.target.id] as GuideNode
    expect(saved.parentId).toBe(scene.targetLevel.id)
    expect(saved.position[1]).toBe(scene.target.position[1])
    const reference = guideReference(scene.anchor)
    const target = guideReference(saved)
    for (const [sourcePoint, targetPoint] of [
      [
        [250, 300],
        [130, 70],
      ],
      [
        [650, 420],
        [130, 270],
      ],
    ] as const) {
      const expected = imagePointToLevel([...sourcePoint], reference.image, reference.transform)
      const actual = imagePointToLevel([...targetPoint], target.image, target.transform)
      expect(actual[0]).toBeCloseTo(expected[0], 8)
      expect(actual[1]).toBeCloseTo(expected[1], 8)
    }
    expect(saved.scaleReference!.realLengthMeters).toBeCloseTo(Math.hypot(400, 120) * 0.02, 8)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(before)
  })
}

test('cancel leaves both floors and scene history unchanged', () => {
  const before = useScene.getState().nodes
  matchSpans()
  usePlanWorkspace.getState().close()
  expect(useScene.getState().nodes).toBe(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(useViewer.getState().showGuides).toBe(true)
})

test('a plan on another building cannot start a match', () => {
  scene.anchor.parentId = scene.otherLevel.id
  usePlanWorkspace.getState().openGuide(scene.targetLevel, scene.target, scene.anchor)
  expect(usePlanWorkspace.getState().draft).toBeNull()
  expect(usePlanWorkspace.getState().error).toContain('same building')
})

test('moving the source floor to another building during matching blocks the save', () => {
  matchSpans()
  useScene.getState().updateNode(scene.sourceLevel.id, { parentId: scene.otherBuilding.id })
  const before = useScene.getState().nodes
  usePlanWorkspace.getState().commit()
  expect(usePlanWorkspace.getState().error).toContain('same building')
  expect(useScene.getState().nodes).toBe(before)
})

test('single-plan calibration still uses a human-entered measurement', () => {
  const workspace = usePlanWorkspace.getState()
  workspace.openGuide(scene.targetLevel, scene.target)
  workspace.pick([100, 100])
  workspace.pick([300, 100])
  workspace.setStage('adjust')
  expect(usePlanWorkspace.getState().error).toContain('measurement')
  workspace.change((draft) => (draft.mode === 'references' ? { ...draft, meters: 8 } : draft))
  workspace.setStage('adjust')
  workspace.commit()
  expect(usePlanWorkspace.getState().error).toBe('')
  const saved = useScene.getState().nodes[scene.target.id] as GuideNode
  expect(saved.scaleReference!.realLengthMeters).toBeCloseTo(8)
  expect(guideReference(saved).transform.metersPerPixel).toBeCloseTo(0.04)
})

test('recalibrating the matched plan scales the anchor and retains the match in one undo', () => {
  matchSpans()
  usePlanWorkspace.getState().commit()
  const before = structuredClone(useScene.getState().nodes)
  const target = before[scene.target.id] as GuideNode
  const workspace = usePlanWorkspace.getState()
  workspace.openGuide(scene.targetLevel, target)
  workspace.pick([100, 100])
  workspace.pick([300, 100])
  const meters = guideReference(target).transform.metersPerPixel * 200 * 2
  workspace.change((draft) => (draft.mode === 'references' ? { ...draft, meters } : draft))
  workspace.setStage('adjust')
  workspace.commit()
  expect(usePlanWorkspace.getState().error).toBe('')
  const after = useScene.getState().nodes
  expect((after[scene.anchor.id] as GuideNode).scale).toBeCloseTo(scene.anchor.scale * 2)
  expect((after[scene.target.id] as GuideNode).scale).toBeCloseTo(target.scale * 2)
  expect((after[scene.target.id]!.metadata.planReference as any).alignment.anchorGuideId).toBe(
    scene.anchor.id,
  )
  expect(useScene.temporal.getState().pastStates).toHaveLength(2)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes).toEqual(before)
})
