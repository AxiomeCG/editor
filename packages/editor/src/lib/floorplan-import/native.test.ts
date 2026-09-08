import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

let assetSaveHook: (() => void | Promise<void>) | null = null
mock.module('idb-keyval', () => ({
  get: async () => undefined,
  set: async () => {
    await assetSaveHook?.()
  },
}))

import {
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  GuideNode,
  LevelNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { applyFloorplanImport, captureFloorplanTarget, inspectFloorplanImport } from './native'
import type { FloorplanDraft } from './schema'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const BUILDING_ID = 'building_floorplan-native' as AnyNodeId
const LEVEL_ID = 'level_floorplan-native' as AnyNodeId

function hasMetadataKey(node: { metadata?: unknown }, key: string) {
  const metadata = node.metadata
  return Boolean(
    metadata && typeof metadata === 'object' && !Array.isArray(metadata) && key in metadata,
  )
}

function resetScene() {
  const level = LevelNode.parse({
    id: LEVEL_ID,
    name: 'Ground floor',
    parentId: BUILDING_ID,
    children: [],
    level: 0,
    height: 3,
  })
  const building = BuildingNode.parse({
    id: BUILDING_ID,
    name: 'Building',
    parentId: null,
    children: [LEVEL_ID],
  })
  useScene.setState({
    nodes: { [BUILDING_ID]: building, [LEVEL_ID]: level },
    rootNodeIds: [BUILDING_ID],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    installedPlugins: [],
    readOnly: false,
  } as never)
  clearSceneHistory()
}

function draft(overrides: Partial<FloorplanDraft> = {}): FloorplanDraft {
  return {
    version: 1,
    id: 'draft_native-test',
    source: {
      name: 'native-test.png',
      page: null,
      width: 100,
      height: 100,
      metersPerPixel: 0.1,
      originPx: [50, 50],
      scaleSource: 'user',
    },
    floor: {
      polygon: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      holes: [],
    },
    walls: [
      { id: 'w1', start: [0, 0], end: [100, 0], thickness: 2, featureIds: ['line:1'] },
      { id: 'w2', start: [100, 0], end: [100, 100], thickness: 2, featureIds: ['line:2'] },
      { id: 'w3', start: [100, 100], end: [0, 100], thickness: 2, featureIds: ['line:3'] },
      { id: 'w4', start: [0, 100], end: [0, 0], thickness: 2, featureIds: ['line:4'] },
    ],
    openings: [],
    zones: [
      {
        id: 'zone:office',
        name: 'Office',
        roomNumber: '101',
        nameSource: 'drawing',
        polygon: [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ],
        enclosed: true,
        boundaryWallIds: ['w1', 'w2', 'w3', 'w4'],
        featureIds: ['region:1'],
      },
    ],
    items: [
      {
        id: '__proto__',
        label: 'Single bed',
        assetId: 'single-bed',
        position: [50, 55],
        rotation: Math.PI / 2,
        width: 10.8,
        depth: 21.4,
        featureIds: ['region:2'],
      },
    ],
    dimensions: [
      {
        id: 'dimension:width',
        start: { wallId: 'w1', featureId: 'wall:start' },
        end: { wallId: 'w1', featureId: 'wall:end' },
        baseline: [
          [0, -10],
          [100, -10],
        ],
        sourceMeters: 10,
        sourceText: '10.00 m',
      },
    ],
    assumptions: ['Opening heights use the selected level height context.'],
    issues: [],
    ...overrides,
  }
}

function rasterFile() {
  return new File([new Uint8Array([137, 80, 78, 71])], 'native-test.png', {
    type: 'image/png',
  })
}

beforeEach(() => {
  assetSaveHook = null
  resetScene()
})

afterEach(() => {
  assetSaveHook = null
})

describe('floorplan native inspection', () => {
  test('capture rejects a wrong node and inspection rejects a stale target without following selection', () => {
    expect(() => captureFloorplanTarget(BUILDING_ID)).toThrow('existing level')

    const target = captureFloorplanTarget(LEVEL_ID)
    useScene.getState().updateNode(LEVEL_ID, { name: 'Changed while interpreting' })

    expect(inspectFloorplanImport(draft(), target).map((entry) => entry.id)).toContain(
      'native:target-stale',
    )
  })

  test('calibration resolves only the deterministic native scale blocker', () => {
    const target = captureFloorplanTarget(LEVEL_ID)
    const unscaled = draft({
      source: { ...draft().source, metersPerPixel: null, scaleSource: 'unknown' },
      issues: [
        {
          id: 'review-wall-evidence',
          message: 'Wall evidence still conflicts',
          severity: 'blocking',
          relatedIds: ['w1'],
        },
      ],
    })

    expect(inspectFloorplanImport(unscaled, target).map((entry) => entry.id)).toContain(
      'native:missing-scale',
    )
    const calibrated = {
      ...unscaled,
      source: { ...unscaled.source, metersPerPixel: 0.1, scaleSource: 'user' as const },
    }
    const calibratedIssueIds = inspectFloorplanImport(calibrated, target).map((entry) => entry.id)
    expect(calibratedIssueIds).not.toContain('native:missing-scale')
    expect(calibratedIssueIds).toContain('review-wall-evidence')
  })

  test('opening bounds and overlaps are blocking', () => {
    const target = captureFloorplanTarget(LEVEL_ID)
    const invalid = draft({
      openings: [
        {
          id: 'opening:outside',
          wallId: 'w1',
          kind: 'door',
          offset: 5,
          width: 20,
          height: 2.1,
          sillHeight: 0,
          doorType: 'hinged',
          hingesSide: 'left',
          swingDirection: 'inward',
          side: 'front',
          featureIds: ['region:door-1'],
        },
        {
          id: 'opening:overlap',
          wallId: 'w1',
          kind: 'window',
          offset: 10,
          width: 20,
          height: 1.2,
          sillHeight: 0.8,
          doorType: 'hinged',
          hingesSide: 'right',
          swingDirection: 'outward',
          side: 'back',
          featureIds: ['region:window-1'],
        },
      ],
    })

    const issueIds = inspectFloorplanImport(invalid, target).map((entry) => entry.id)
    expect(issueIds).toContain('native:opening-bounds:opening:outside')
    expect(issueIds).toContain('native:opening-overlap:opening:outside:opening:overlap')
  })

  test('contained vertices do not permit geometry to bridge a concave floor cutout', () => {
    const target = captureFloorplanTarget(LEVEL_ID)
    const original = draft()
    const invalid = draft({
      floor: {
        polygon: [
          [0, 0],
          [30, 0],
          [30, 70],
          [70, 70],
          [70, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ],
        holes: [],
      },
      zones: [{ ...original.zones[0]!, enclosed: false, boundaryWallIds: [] }],
      items: [{ ...original.items[0]!, position: [50, 50], rotation: 0, width: 80, depth: 80 }],
    })

    const blockers = inspectFloorplanImport(invalid, target)
      .filter((entry) => entry.severity === 'blocking')
      .map((entry) => entry.id)
    expect(blockers).toEqual(
      expect.arrayContaining([
        'native:wall-outside-floor:w1',
        'native:zone-outside-floor:zone:office',
        'native:item-outside-floor:__proto__',
      ]),
    )
  })

  test('an enclosed zone needs a complete native wall enclosure', () => {
    const target = captureFloorplanTarget(LEVEL_ID)
    const invalid = draft({
      zones: [
        {
          ...draft().zones[0]!,
          boundaryWallIds: ['w1', 'w2'],
        },
      ],
    })

    expect(inspectFloorplanImport(invalid, target).map((entry) => entry.id)).toContain(
      'native:zone-not-enclosed:zone:office',
    )
  })
})

describe('floorplan native apply', () => {
  test('creates hosted editable native nodes and undo/redo leaves the initial level intact', async () => {
    const target = captureFloorplanTarget(LEVEL_ID)
    const validDraft = draft({
      openings: [
        {
          id: 'opening:door',
          wallId: 'w1',
          kind: 'door',
          offset: 50,
          width: 10,
          height: 2.1,
          sillHeight: 0,
          doorType: 'hinged',
          hingesSide: 'left',
          swingDirection: 'inward',
          side: 'front',
          featureIds: ['region:door'],
        },
      ],
    })

    const result = await applyFloorplanImport({
      draft: validDraft,
      target,
      sourceFile: rasterFile(),
      acceptedWarnings: [],
    })
    const nodes = useScene.getState().nodes
    const opening = Object.values(nodes).find((node) => node.type === 'door')
    const wall = Object.values(nodes).find(
      (node) =>
        node.type === 'wall' &&
        'children' in node &&
        Array.isArray(node.children) &&
        opening !== undefined &&
        node.children.includes(opening.id),
    )
    const guide = nodes[result.guideId as AnyNodeId]

    expect(result.counts).toEqual({
      walls: 4,
      openings: 1,
      zones: 1,
      items: 1,
      dimensions: 1,
      surfaces: 1,
    })
    expect(opening?.parentId).toBe(wall?.id)
    expect(wall && 'children' in wall ? wall.children : []).toContain(opening!.id)
    expect(guide?.type).toBe('guide')
    expect(guide?.metadata).toMatchObject({
      floorplanImport: {
        draftId: validDraft.id,
        transform: { sourceAxes: 'pixel-x-right-y-down', nativeAxes: 'level-x-right-z-down' },
      },
    })
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[LEVEL_ID]).toBeDefined()
    for (const id of result.nodeIds)
      expect(useScene.getState().nodes[id as AnyNodeId]).toBeUndefined()

    useScene.temporal.getState().redo()
    for (const id of result.nodeIds)
      expect(useScene.getState().nodes[id as AnyNodeId]).toBeDefined()
  })

  test('a target populated while the asset save awaits cannot receive late import nodes', async () => {
    const target = captureFloorplanTarget(LEVEL_ID)
    let intruderId: AnyNodeId | null = null
    assetSaveHook = () => {
      const intruder = WallNode.parse({ start: [20, 20], end: [21, 20], thickness: 0.1 })
      intruderId = intruder.id
      useScene.getState().createNode(intruder, LEVEL_ID)
    }

    await expect(
      applyFloorplanImport({
        draft: draft(),
        target,
        sourceFile: rasterFile(),
        acceptedWarnings: [],
      }),
    ).rejects.toThrow('empty level')

    const nodes = useScene.getState().nodes
    expect(intruderId && nodes[intruderId]).toBeDefined()
    expect(
      Object.values(nodes).filter((node) => hasMetadataKey(node, 'floorplanSource')),
    ).toHaveLength(0)
    expect(
      Object.values(nodes).filter((node) => hasMetadataKey(node, 'floorplanImport')),
    ).toHaveLength(0)
  })

  test('a commit fault rolls back every generated node and preserves past and future history', async () => {
    const priorGuide = GuideNode.parse({
      name: 'Undoable guide',
      url: 'https://example.com/guide.png',
    })
    useScene.getState().createNode(priorGuide, LEVEL_ID)
    useScene.temporal.getState().undo()
    const target = captureFloorplanTarget(LEVEL_ID)
    const temporalBefore = useScene.temporal.getState()
    const pastCount = temporalBefore.pastStates.length
    const futureCount = temporalBefore.futureStates.length
    const realApply = useScene.getState().applyNodeChanges
    const sabotagedApply: typeof realApply = (changes) => {
      realApply(changes)
      const firstCreatedId = changes.create?.[0]?.node.id
      if (firstCreatedId) realApply({ delete: [firstCreatedId] })
    }
    useScene.setState({ applyNodeChanges: sabotagedApply })

    try {
      await expect(
        applyFloorplanImport({
          draft: draft(),
          target,
          sourceFile: rasterFile(),
          acceptedWarnings: [],
        }),
      ).rejects.toThrow('did not create node')
    } finally {
      useScene.setState({ applyNodeChanges: realApply })
    }

    expect(
      Object.values(useScene.getState().nodes)
        .map((node) => node.id)
        .sort(),
    ).toEqual([BUILDING_ID, LEVEL_ID].sort())
    expect(useScene.temporal.getState().pastStates).toHaveLength(pastCount)
    expect(useScene.temporal.getState().futureStates).toHaveLength(futureCount)
  })
})
