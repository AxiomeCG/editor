import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  applySceneSnapshot,
  DEFAULT_FACADE_UNIT,
  FacadeUnitSchema,
  LevelNode,
  readWallFacade,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { facadeScopeTargets } from '@pascal-app/core/building'
import { applyFacade, detachFacade, removeFacade } from './facade-fill'
import { subscribeFacadeResizes } from './facade-resize-sync'

type RafFn = (cb: (time: number) => void) => number
;(globalThis as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  cb: (time: number) => void,
) => {
  cb(0)
  return 0
}) as RafFn
;(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??= () => {}

const level = LevelNode.parse({ id: 'level_facade', level: 0, height: 3 })
const WALL_ID = 'wall_facade' as WallNode['id']
const unit = DEFAULT_FACADE_UNIT
const brick = FacadeUnitSchema.parse({
  ...DEFAULT_FACADE_UNIT,
  paint: { wall: 'library:flooring-rusticbrick', frame: 'library:preset-charcoal' },
})

const nodes = () => useScene.getState().nodes
const wall = () => nodes()[WALL_ID] as WallNode
const facadeWindows = () =>
  Object.values(nodes()).filter(
    (node): node is WindowNode => node.type === 'window' && node.metadata.facadeOwner === WALL_ID,
  )

let unsubscribe: (() => void) | undefined

beforeEach(() => {
  const host = WallNode.parse({
    id: WALL_ID,
    parentId: level.id,
    start: [0, 0],
    end: [8, 0],
    frontSide: 'interior',
    backSide: 'exterior',
    slots: { exterior: 'library:old-render' },
  })
  useScene.setState({
    nodes: { [level.id]: { ...level, children: [WALL_ID] }, [WALL_ID]: host } as Record<
      AnyNodeId,
      AnyNode
    >,
    rootNodeIds: [level.id],
    collections: {},
    materials: {},
    dirtyNodes: new Set(),
    readOnly: false,
  } as never)
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
})

afterEach(() => {
  unsubscribe?.()
  unsubscribe = undefined
})

describe('applyFacade', () => {
  test('hosts real windows in the wall and undoes as one step', () => {
    applyFacade([WALL_ID], unit)

    expect(facadeWindows()).toHaveLength(3)
    for (const window of facadeWindows()) expect(wall().children).toContain(window.id)
    expect(readWallFacade(wall().metadata)?.unit).toEqual(DEFAULT_FACADE_UNIT)

    useScene.temporal.getState().undo()
    expect(facadeWindows()).toHaveLength(0)
    expect(wall().metadata.proceduralFacade).toBeUndefined()
  })

  test('the unit paints with library references, adding no scene material', () => {
    applyFacade([WALL_ID], brick)

    expect(Object.keys(useScene.getState().materials)).toHaveLength(0)
    expect(wall().slots?.exterior).toBe('library:flooring-rusticbrick')
    expect(facadeWindows()[0]!.slots?.frame).toBe('library:preset-charcoal')
  })

  test('removal deletes the openings and restores the finish it replaced', () => {
    applyFacade([WALL_ID], brick)
    removeFacade([WALL_ID])

    expect(facadeWindows()).toHaveLength(0)
    expect(wall().slots?.exterior).toBe('library:old-render')
    expect(wall().slots?.lowerExterior).toBeUndefined()
    expect(wall().metadata.proceduralFacade).toBeUndefined()
  })

  test('detaching keeps the openings but releases them from the facade', () => {
    applyFacade([WALL_ID], unit)
    const ids = facadeWindows().map((window) => window.id)
    detachFacade([WALL_ID])

    for (const id of ids) {
      expect(nodes()[id as AnyNodeId]).toBeDefined()
      expect(nodes()[id as AnyNodeId]!.metadata.facadeOwner).toBeUndefined()
    }
    expect(readWallFacade(wall().metadata)?.detached).toBe(true)
  })
})

describe('subscribeFacadeResizes', () => {
  test('a longer wall refits its openings inside the same undo step', () => {
    applyFacade([WALL_ID], unit)
    unsubscribe = subscribeFacadeResizes()
    const before = facadeWindows().map((window) => window.id)

    useScene.getState().updateNode(WALL_ID, { end: [12, 0] })

    expect(facadeWindows().length).toBeGreaterThan(before.length)
    for (const id of before) expect(nodes()[id as AnyNodeId]).toBeDefined()

    useScene.temporal.getState().undo()
    expect(wall().end).toEqual([8, 0])
    expect(
      facadeWindows()
        .map((window) => window.id)
        .sort(),
    ).toEqual([...before].sort())
  })

  test('moving a partition that meets the facade refits it within the same undo step', () => {
    const points: [number, number][] = [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ]
    const walls = points.map((start, i) =>
      WallNode.parse({ parentId: level.id, start, end: points[(i + 1) % 4], thickness: 0.1 }),
    )
    const partition = WallNode.parse({
      parentId: level.id,
      start: [4, 0],
      end: [4, 6],
      thickness: 0.1,
    })
    useScene.setState({
      nodes: Object.fromEntries(
        [{ ...level, children: [...walls, partition].map((w) => w.id) }, ...walls, partition].map(
          (n) => [n.id, n],
        ),
      ) as Record<AnyNodeId, AnyNode>,
    } as never)
    useScene.temporal.getState().clear()
    const bottom = walls[0]!.id
    const { walls: loop, targets } = facadeScopeTargets(nodes(), walls[0]!, 'exterior')
    applyFacade(
      loop.map((w) => w.id),
      unit,
      { targets },
    )
    unsubscribe = subscribeFacadeResizes()
    const xs = () =>
      Object.values(nodes())
        .filter((n): n is WindowNode => n.type === 'window' && n.metadata.facadeOwner === bottom)
        .map((w) => Number(w.position[0].toFixed(3)))
        .sort((a, b) => a - b)
    const before = xs()

    useScene.getState().updateNode(partition.id, { start: [6, 0], end: [6, 6] })
    expect(xs()).not.toEqual(before)

    useScene.temporal.getState().undo()
    expect(xs()).toEqual(before)
  })

  test('editing a generated window by hand detaches the facade with a reason', () => {
    applyFacade([WALL_ID], unit)
    unsubscribe = subscribeFacadeResizes()
    const edited = facadeWindows()[0]!

    useScene.getState().updateNode(edited.id, { width: 1 })

    const config = readWallFacade(wall().metadata)
    expect(config?.detached).toBe(true)
    expect(config?.detachedReason).toBe('Window edited outside the facade.')
    expect(nodes()[edited.id]!.metadata.facadeOwner).toBeUndefined()
    expect((nodes()[edited.id] as WindowNode).width).toBe(1)
  })

  test('a collaboration snapshot is not a hand edit, so it never detaches', () => {
    applyFacade([WALL_ID], unit)
    unsubscribe = subscribeFacadeResizes()
    const window = facadeWindows()[0]!
    const state = useScene.getState()

    applySceneSnapshot(
      {
        nodes: { ...state.nodes, [window.id]: { ...window, width: 1 } },
        rootNodeIds: state.rootNodeIds,
        collections: state.collections,
        materials: state.materials,
        installedPlugins: state.installedPlugins ?? [],
      },
      { origin: 'host' },
    )

    expect(readWallFacade(wall().metadata)?.detached).toBeFalsy()
    expect(nodes()[window.id]!.metadata.facadeOwner).toBe(WALL_ID)
  })
})

describe('forcing a detached facade', () => {
  test('replaces what it had generated, keeps what was added by hand, and goes live again', () => {
    applyFacade([WALL_ID], unit)
    const generated = facadeWindows().length
    unsubscribe = subscribeFacadeResizes()
    useScene.getState().updateNode(facadeWindows()[0]!.id, { width: 0.5 })
    expect(readWallFacade(wall().metadata)?.detached).toBe(true)
    const byHand = WindowNode.parse({
      parentId: WALL_ID,
      wallId: WALL_ID,
      position: [7.6, 1.5, 0],
      width: 0.4,
    })
    useScene.getState().createNode(byHand, WALL_ID)

    // A plain apply refuses the detached wall; forcing takes it back.
    expect(() => applyFacade([WALL_ID], unit)).toThrow()
    applyFacade([WALL_ID], unit, { force: true })

    expect(readWallFacade(wall().metadata)?.detached).toBeFalsy()
    expect(nodes()[byHand.id]).toBeDefined()
    const windows = facadeWindows()
    expect(windows.length).toBeGreaterThan(0)
    expect(windows.length).toBeLessThanOrEqual(generated)
    expect(windows.every((w) => w.width !== 0.5)).toBe(true)
    const leftovers = Object.values(nodes()).filter(
      (n) => n.metadata.facadeReleasedFrom === WALL_ID,
    )
    expect(leftovers).toHaveLength(0)
  })
})
