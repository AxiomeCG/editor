import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type DoorNode,
  type FenceNode,
  LevelNode,
  type PanelNode,
  type SlabNode,
  WallNode,
  WindowNode,
} from '../schema'
import { readWallFacade, type WallFacade } from '../systems/facade/facade-config'
import { DEFAULT_FACADE_UNIT, FacadeUnitSchema } from '../systems/facade/facade-unit'
import {
  FACADE_RELEASED_KEY,
  type FacadeFillPlan,
  type FacadeScenePatch,
  facadeFillPatches,
  facadeLayoutFrame,
  planFacadeFill,
  reclaimDetachedFacades,
} from './facade'
import { facadeScopeTargets } from './facade-scope'

const level = LevelNode.parse({ level: 0, height: 3 })
const straightWall = (length = 8, extra: Partial<WallNode> = {}) =>
  WallNode.parse({
    parentId: level.id,
    start: [0, 0],
    end: [length, 0],
    thickness: 0.2,
    frontSide: 'interior',
    backSide: 'exterior',
    ...extra,
  })
const scene = (...nodes: AnyNode[]) =>
  Object.fromEntries([level, ...nodes].map((n) => [n.id, n])) as Record<string, AnyNode>

/** What the store would hold after committing a plan: generated nodes hosted, removed ones gone. */
function commit(nodes: Record<string, AnyNode>, plan: FacadeFillPlan) {
  const next = { ...nodes }
  for (const wallPlan of plan.walls) {
    for (const node of [...wallPlan.openings.removed, ...wallPlan.balconies.removed])
      delete next[node.id]
    for (const node of [...wallPlan.openings.values, ...wallPlan.balconies.values])
      next[node.id] = node
  }
  for (const wallPlan of plan.walls) {
    const wall = next[wallPlan.wall.id] as WallNode
    const handPlaced = wall.children.filter(
      (id) => next[id] && next[id]!.metadata.facadeOwner !== wall.id,
    )
    next[wall.id] = {
      ...wall,
      ...wallPlan.wallUpdate,
      children: [...handPlaced, ...wallPlan.openings.values.map((node) => node.id)],
    } as WallNode
  }
  return next
}
const windowsOf = (plan: FacadeFillPlan) =>
  plan.walls.flatMap((wallPlan) => wallPlan.openings.values)

describe('planFacadeFill', () => {
  test('the default unit resolves to a centred row of real windows owned by the wall', () => {
    const wall = straightWall()
    const plan = planFacadeFill({ walls: [wall], nodes: scene(wall), unit: DEFAULT_FACADE_UNIT })
    const windows = windowsOf(plan) as WindowNode[]

    // 7.6 m between margins fits three 1.4 m windows at a 1 m pier, centred.
    expect(windows.map((w) => w.position[0]).sort((a, b) => a - b)).toEqual(
      [1.6, 4, 6.4].map((x) => expect.closeTo(x, 6)),
    )
    for (const window of windows) {
      expect(window.type).toBe('window')
      expect(window.parentId).toBe(wall.id)
      expect(window.wallId).toBe(wall.id)
      expect(window.position[1]).toBeCloseTo(1.6, 6)
      expect(window.metadata.facadeOwner).toBe(wall.id)
    }
    const config = plan.walls[0]!.wallUpdate!.metadata.proceduralFacade as WallFacade
    expect(config.unit).toEqual(DEFAULT_FACADE_UNIT)
    expect(config.surface).toBe('exterior')
    expect(config.face).toBe('back')
  })

  test('refilling keeps node ids and only adds the cells a longer wall gains', () => {
    const wall = straightWall()
    const first = planFacadeFill({ walls: [wall], nodes: scene(wall), unit: DEFAULT_FACADE_UNIT })
    let nodes = commit(scene(wall), first)
    const ids = windowsOf(first).map((node) => node.id)

    const again = planFacadeFill({
      walls: [nodes[wall.id] as WallNode],
      nodes,
      unit: DEFAULT_FACADE_UNIT,
    })
    expect(again.walls[0]!.openings.added).toHaveLength(0)
    expect(again.walls[0]!.openings.updated).toHaveLength(0)
    expect(again.walls[0]!.wallUpdate).toBeNull()

    nodes = { ...nodes, [wall.id]: { ...(nodes[wall.id] as WallNode), end: [12, 0] } as WallNode }
    const longer = planFacadeFill({
      walls: [nodes[wall.id] as WallNode],
      nodes,
      unit: DEFAULT_FACADE_UNIT,
    })
    // 11.6 m between margins now fits five: the first three keep their nodes.
    const kept = windowsOf(longer).map((node) => node.id)
    for (const id of ids) expect(kept).toContain(id)
    expect(longer.walls[0]!.openings.added).toHaveLength(2)
  })

  test('hand-placed openings are obstacles, never owned or removed', () => {
    const wall = straightWall()
    const manual = WindowNode.parse({
      parentId: wall.id,
      wallId: wall.id,
      position: [4, 1.6, 0],
      width: 1.4,
      height: 1.6,
    })
    const hosting = { ...wall, children: [manual.id] } as WallNode
    const plan = planFacadeFill({
      walls: [hosting],
      nodes: scene(hosting, manual),
      unit: DEFAULT_FACADE_UNIT,
    })

    expect(windowsOf(plan).map((node) => node.id)).not.toContain(manual.id)
    expect(plan.walls[0]!.openings.removed).toHaveLength(0)
    for (const window of windowsOf(plan))
      expect(Math.abs(window.position[0] - 4)).toBeGreaterThan(1.4)
  })

  test('changing an opening from window to door replaces the node', () => {
    const wall = straightWall()
    const unitOf = (kind: 'window' | 'door') =>
      FacadeUnitSchema.parse({
        name: 'Single',
        bays: [{ key: 'a', width: 1, widthMode: 'fixed', opening: { kind, width: 1, height: 2 } }],
      })
    const nodes = commit(
      scene(wall),
      planFacadeFill({ walls: [wall], nodes: scene(wall), unit: unitOf('window') }),
    )
    const plan = planFacadeFill({
      walls: [nodes[wall.id] as WallNode],
      nodes,
      unit: unitOf('door'),
    })

    expect(plan.walls[0]!.openings.removed.map((node) => node.type)).toEqual(['window'])
    expect(plan.walls[0]!.openings.added.map((node) => node.type)).toEqual(['door'])
  })

  test('the unit paints only the filled face and remembers what it replaced', () => {
    const wall = straightWall(8, { slots: { exterior: 'library:old-render' } })
    const plan = planFacadeFill({
      walls: [wall],
      nodes: scene(wall),
      unit: { ...DEFAULT_FACADE_UNIT, paint: { wall: 'scene:brick', frame: 'scene:frame' } },
    })
    const update = plan.walls[0]!.wallUpdate!
    const config = update.metadata.proceduralFacade as WallFacade

    expect(update.slots?.exterior).toBe('scene:brick')
    expect(update.slots?.lowerExterior).toBe('scene:brick')
    expect(update.slots?.interior).toBeUndefined()
    expect(config.previousSlots!.exterior).toBe('library:old-render')
    expect(config.previousSlots!.lowerExterior).toBeNull()
    expect(windowsOf(plan)[0]!.slots?.frame).toBe('scene:frame')
  })

  test('a repeating door bay puts a native balcony in front of each door', () => {
    const wall = straightWall(10)
    const plan = planFacadeFill({
      walls: [wall],
      nodes: scene(wall),
      unit: FacadeUnitSchema.parse({
        name: 'Door bays',
        paint: { frame: 'library:preset-charcoal' },
        bays: [
          {
            key: 'bay',
            width: 2.4,
            pier: 0.6,
            endPier: 0.3,
            opening: { kind: 'door', width: 1.2, height: 2.2 },
            balcony: {
              depth: 1.2,
              railing: 'glass',
              deckMaterial: 'library:concrete-raw',
              railingMaterial: 'library:metal-steel',
            },
          },
        ],
      }),
    })
    const parts = plan.walls[0]!.balconies.values
    const decks = parts.filter((node): node is SlabNode => node.type === 'slab')
    const guards = parts.filter((node): node is FenceNode => node.type === 'fence')

    expect(windowsOf(plan).map((node) => node.type)).toEqual(['door', 'door', 'door'])
    for (const door of windowsOf(plan))
      expect(door.slots).toMatchObject({
        frame: 'library:preset-charcoal',
        panel: 'library:preset-charcoal',
      })
    expect(decks).toHaveLength(3)
    expect(guards).toHaveLength(9)
    for (const deck of decks) {
      expect(deck.metadata.facadeOwner).toBe(wall.id)
      expect((deck.metadata.balcony as { id: string }).id).toBe(deck.id)
      // The deck projects out of the exterior (back, -z) face.
      expect(Math.max(...deck.polygon.map((p) => p[1]))).toBeLessThan(0)
      expect(deck.slots?.surface).toBe('library:concrete-raw')
    }
    for (const guard of guards) {
      expect(decks.map((deck) => deck.id)).toContain(guard.supportSlabId)
      expect(guard.slots).toMatchObject({
        posts: 'library:metal-steel',
        rail: 'library:metal-steel',
        infill: 'library:preset-glass',
      })
    }
  })

  test('refuses curved walls with a sentence the panel can show', () => {
    const wall = straightWall(8, { curveOffset: 0.5 })
    expect(() =>
      planFacadeFill({ walls: [wall], nodes: scene(wall), unit: DEFAULT_FACADE_UNIT }),
    ).toThrow('Facades currently support straight walls.')
  })
})

describe('facades across walls', () => {
  test('an opening straddling a wall seam is skipped; the others land in the right wall', () => {
    const left = straightWall(4)
    // Drawn backwards, so its local x runs against the facade.
    const right = WallNode.parse({
      parentId: level.id,
      start: [8, 0],
      end: [4, 0],
      thickness: 0.2,
      frontSide: 'exterior',
      backSide: 'interior',
    })
    const plan = planFacadeFill({
      walls: [left, right],
      nodes: scene(left, right),
      unit: DEFAULT_FACADE_UNIT,
    })

    expect(plan.runs).toHaveLength(1)
    // The middle window of three would straddle x = 4.
    expect(plan.skipped).toBe(1)
    const [first] = plan.walls.find((p) => p.wall.id === left.id)!.openings.values
    const [last] = plan.walls.find((p) => p.wall.id === right.id)!.openings.values
    expect(first!.position[0]).toBeCloseTo(1.6, 6)
    // Axis x = 6.4 is 1.6 m from the reversed wall's start at x = 8.
    expect(last!.position[0]).toBeCloseTo(1.6, 6)
  })

  test('moving a partition that meets the facade drifts its layout frame', () => {
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
    let nodes = scene(...walls, partition)
    const { walls: loop, targets } = facadeScopeTargets(nodes, walls[0]!, 'exterior')
    nodes = commit(
      nodes,
      planFacadeFill({ walls: loop, nodes, unit: DEFAULT_FACADE_UNIT, targets }),
    )

    const bottom = nodes[walls[0]!.id] as WallNode
    const stored = readWallFacade(bottom.metadata)!
    expect(facadeLayoutFrame(bottom, nodes, stored)).toBe(stored.layoutFrame!)

    nodes = {
      ...nodes,
      [partition.id]: { ...partition, start: [5, 0], end: [5, 6] } as WallNode,
    }
    expect(facadeLayoutFrame(bottom, nodes, stored)).not.toBe(stored.layoutFrame!)
  })
})

describe('bay cladding', () => {
  const victorBay = FacadeUnitSchema.parse({
    name: 'Mid-section',
    bays: [
      {
        key: 'bay',
        width: 2.4,
        pier: 0.6,
        endPier: 0.3,
        widthMode: 'repeat',
        opening: { width: 1.4, height: 1.6, sill: 0.9 },
        infill: { material: 'library:preset-charcoal' },
        spandrel: { material: 'library:flooring-rusticbrick', thickness: 0.05 },
      },
    ],
  })
  const panelsOf = (plan: FacadeFillPlan) =>
    plan.walls.flatMap((wallPlan) => wallPlan.panels.values)

  test('each bay gets infill beside its opening and spandrels below and above it', () => {
    const wall = straightWall(10)
    const plan = planFacadeFill({ walls: [wall], nodes: scene(wall), unit: victorBay })
    const panels = panelsOf(plan)
    const first = panels.filter((p) => String(p.metadata.facadeCell).includes(':bay:0:'))
    const byPart = Object.fromEntries(
      first.map((p) => [String(p.metadata.facadeCell).split(':').at(-1), p]),
    ) as Record<string, PanelNode>

    // Three bays of 2.4 m, each a 1.4 m window with 0.5 m of infill either side.
    expect(windowsOf(plan)).toHaveLength(3)
    expect(panels).toHaveLength(12)
    expect(byPart['infill-left']!.width).toBeCloseTo(0.5, 9)
    expect(byPart['infill-left']!.height).toBeCloseTo(3, 9)
    expect(byPart['spandrel-below']!.width).toBeCloseTo(1.4, 9)
    expect(byPart['spandrel-below']!.height).toBeCloseTo(0.9, 9)
    expect(byPart['spandrel-above']!.height).toBeCloseTo(3 - 2.5, 9)
    expect(byPart['spandrel-below']!.thickness).toBeCloseTo(0.05, 9)
    for (const panel of panels) {
      expect(panel.parentId).toBe(wall.id)
      expect(panel.metadata.facadeOwner).toBe(wall.id)
      // The wall's exterior is its back, so the panels go there.
      expect(panel.side).toBe('back')
    }
  })

  test('each panel is painted with its cladding material', () => {
    const wall = straightWall(10)
    const plan = planFacadeFill({ walls: [wall], nodes: scene(wall), unit: victorBay })
    const refs = new Set(
      panelsOf(plan).map(
        (p) => `${String(p.metadata.facadeCell).split(':').at(-1)}=${p.slots?.surface}`,
      ),
    )
    expect(refs).toEqual(
      new Set([
        'infill-left=library:preset-charcoal',
        'infill-right=library:preset-charcoal',
        'spandrel-below=library:flooring-rusticbrick',
        'spandrel-above=library:flooring-rusticbrick',
      ]),
    )
  })

  test('a bay without an opening is infill from end to end', () => {
    const wall = straightWall(6)
    const unit = FacadeUnitSchema.parse({
      name: 'Blank',
      bays: [
        {
          key: 'blank',
          width: 1,
          widthMode: 'stretch',
          infill: { material: 'library:wood-woodplank48' },
        },
      ],
    })
    const panels = panelsOf(planFacadeFill({ walls: [wall], nodes: scene(wall), unit }))
    expect(panels).toHaveLength(1)
    expect(panels[0]!.width).toBeCloseTo(6, 9)
  })

  test('cladding across a wall seam becomes one panel per wall', () => {
    const left = straightWall(4)
    const right = straightWall(4, { start: [4, 0], end: [8, 0] })
    const unit = FacadeUnitSchema.parse({
      name: 'Band',
      bays: [
        {
          key: 'band',
          width: 1,
          widthMode: 'stretch',
          infill: { material: 'library:flooring-wallstone1' },
        },
      ],
    })
    const plan = planFacadeFill({ walls: [left, right], nodes: scene(left, right), unit })
    const widths = plan.walls.map((wallPlan) => wallPlan.panels.values.map((p) => p.width))
    expect(widths).toEqual([[expect.closeTo(4, 9)], [expect.closeTo(4, 9)]])
  })
})

describe('opening styles', () => {
  test('a window carries its operation and pane grid; a door bay makes French doors', () => {
    const wall = straightWall(10)
    const unit = FacadeUnitSchema.parse({
      name: 'Styled',
      bays: [
        {
          key: 'windows',
          width: 1.6,
          widthMode: 'fixed',
          horizontal: 'left',
          offsetX: 0.5,
          opening: { width: 1.6, height: 1.8, sill: 0.8, windowType: 'casement', columns: 2 },
        },
        {
          key: 'door',
          width: 1.4,
          widthMode: 'fixed',
          horizontal: 'right',
          offsetX: 0.5,
          opening: { kind: 'door', width: 1.4, height: 2.2 },
        },
      ],
    })
    const plan = planFacadeFill({ walls: [wall], nodes: scene(wall), unit })
    const [window] = windowsOf(plan).filter((n) => n.type === 'window') as WindowNode[]
    const [door] = windowsOf(plan).filter((n) => n.type === 'door') as DoorNode[]

    expect(window!.windowType).toBe('casement')
    expect(window!.columnRatios).toEqual([1, 1])
    expect(door!.doorType).toBe('french')
    expect(door!.leafCount).toBe(2)
    expect(door!.segments[0]!.type).toBe('glass')
  })
})

describe('fill patches', () => {
  /** A minimal store: what the MCP bridges and the editor do with the same patches. */
  function applyPatches(nodes: Record<string, AnyNode>, patches: FacadeScenePatch[]) {
    const next = { ...nodes }
    for (const patch of patches) {
      if (patch.op === 'delete') delete next[patch.id]
      else if (patch.op === 'create') {
        next[patch.node.id] = patch.node
        const parent = patch.parentId && next[patch.parentId]
        if (parent && 'children' in parent)
          next[parent.id] = { ...parent, children: [...parent.children, patch.node.id] } as AnyNode
      } else next[patch.id] = { ...next[patch.id]!, ...patch.data } as AnyNode
    }
    return next
  }
  const unit = FacadeUnitSchema.parse({
    ...DEFAULT_FACADE_UNIT,
    paint: { wall: 'library:flooring-rusticbrick' },
    bays: [
      {
        ...DEFAULT_FACADE_UNIT.bays[0],
        balcony: { depth: 1 },
        spandrel: { material: 'library:preset-charcoal' },
      },
    ],
  })

  test('one batch creates the fill: removals, then creations, then updates', () => {
    const wall = straightWall(10)
    const nodes = scene(wall)
    const plan = planFacadeFill({ walls: [wall], nodes, unit })
    const patches = facadeFillPatches(plan, nodes)
    const ops = patches.map((p) => p.op)

    expect(ops.lastIndexOf('delete')).toBeLessThan(ops.indexOf('create'))
    expect(ops.lastIndexOf('create')).toBeLessThan(ops.indexOf('update'))
    const created = patches.flatMap((p) => (p.op === 'create' ? [p.node.type] : []))
    expect(created.filter((type) => type === 'window')).toHaveLength(windowsOf(plan).length)
    expect(created).toContain('panel')
    expect(created).toContain('slab')
    const wallUpdate = patches.find((p) => p.op === 'update' && p.id === wall.id)
    expect(wallUpdate).toBeDefined()
  })

  test('re-applying the same unit produces no patches', () => {
    const wall = straightWall(10)
    let nodes = scene(wall)
    nodes = applyPatches(
      nodes,
      facadeFillPatches(planFacadeFill({ walls: [wall], nodes, unit }), nodes),
    )
    const again = planFacadeFill({ walls: [nodes[wall.id] as WallNode], nodes, unit })
    expect(facadeFillPatches(again, nodes)).toEqual([])
  })
})

describe('forcing a detached facade back', () => {
  test('removes only what it released, and the wall plans again', () => {
    const base = straightWall(10)
    const released = WindowNode.parse({
      parentId: base.id,
      wallId: base.id,
      position: [2, 1.6, 0],
      metadata: { [FACADE_RELEASED_KEY]: base.id },
    })
    const byHand = WindowNode.parse({ parentId: base.id, wallId: base.id, position: [8, 1.6, 0] })
    const config = planFacadeFill({ walls: [base], nodes: scene(base), unit: DEFAULT_FACADE_UNIT })
      .walls[0]!.wallUpdate!.metadata.proceduralFacade as WallFacade
    const wall = {
      ...base,
      children: [released.id, byHand.id],
      metadata: {
        proceduralFacade: { ...config, detached: true, detachedReason: 'Window edited.' },
      },
    } as WallNode
    const nodes = scene(wall, released, byHand)
    expect(() => planFacadeFill({ walls: [wall], nodes, unit: DEFAULT_FACADE_UNIT })).toThrow()

    const reclaim = reclaimDetachedFacades([wall], nodes)

    expect(reclaim.removed).toEqual([released.id])
    expect(reclaim.nodes[released.id]).toBeUndefined()
    expect(reclaim.nodes[byHand.id]).toBeDefined()
    expect((reclaim.nodes[wall.id] as WallNode).children).toEqual([byHand.id])
    expect(readWallFacade(reclaim.walls[0]!.metadata)?.detached).toBeUndefined()
    const plan = planFacadeFill({
      walls: reclaim.walls,
      nodes: reclaim.nodes,
      unit: DEFAULT_FACADE_UNIT,
    })
    expect(windowsOf(plan).length).toBeGreaterThan(0)
  })

  test('leaves live facades alone', () => {
    const wall = straightWall(8)
    const nodes = scene(wall)
    expect(reclaimDetachedFacades([wall], nodes)).toMatchObject({ removed: [], reclaimed: [] })
  })
})

describe('facing the facade', () => {
  const pinnedLeft = FacadeUnitSchema.parse({
    name: 'Door at the left',
    bays: [
      {
        key: 'door',
        width: 1.2,
        widthMode: 'fixed',
        horizontal: 'left',
        offsetX: 0.4,
        opening: { kind: 'door', width: 1, height: 2.1 },
      },
    ],
  })
  /** The door's centre, in plan x, for a wall from x 0 to 10 along z 0. */
  const doorX = (extra: Partial<WallNode>) => {
    const wall = straightWall(10, extra)
    const plan = planFacadeFill({ walls: [wall], nodes: scene(wall), unit: pinnedLeft })
    const door = plan.walls[0]!.openings.values[0]!
    return door.position[0]
  }

  test('a bay pinned left is at the left for someone facing the filled face, whichever side it is', () => {
    // Exterior on the back (-z): standing outside, looking toward +z, left is +x.
    expect(doorX({ frontSide: 'interior', backSide: 'exterior' })).toBeCloseTo(10 - 0.4 - 0.6, 9)
    // Exterior on the front (+z): standing outside, looking toward -z, left is -x.
    expect(doorX({ frontSide: 'exterior', backSide: 'interior' })).toBeCloseTo(0.4 + 0.6, 9)
  })
})

describe('replacing existing openings', () => {
  test('existing windows in the way are replaced instead of skipping the fill', () => {
    const base = straightWall(8)
    const oldWindows = [2, 4, 6].map((x) =>
      WindowNode.parse({ parentId: base.id, wallId: base.id, position: [x, 1.6, 0], width: 1 }),
    )
    const wall = { ...base, children: oldWindows.map((w) => w.id) } as WallNode
    const nodes = scene(wall, ...oldWindows)

    const blocked = planFacadeFill({ walls: [wall], nodes, unit: DEFAULT_FACADE_UNIT })
    expect(blocked.displaced).toEqual([])
    expect(windowsOf(blocked).length).toBeLessThan(3)

    const replaced = planFacadeFill({
      walls: [wall],
      nodes,
      unit: DEFAULT_FACADE_UNIT,
      replaceExisting: true,
    })
    expect(windowsOf(replaced)).toHaveLength(3)
    expect(replaced.displaced.map((node) => node.id).sort()).toEqual(
      oldWindows.map((w) => w.id).sort(),
    )
    const deletes = facadeFillPatches(replaced, nodes).filter((p) => p.op === 'delete')
    expect(deletes.map((p) => (p as { id: string }).id).sort()).toEqual(
      oldWindows.map((w) => w.id).sort(),
    )
  })
})
