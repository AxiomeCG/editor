import { getWallBaseElevationForNodes } from '../hooks/spatial-grid/spatial-grid-manager'
import {
  type AnyNode,
  DoorNode,
  type FenceNode,
  MaterialSchema,
  PanelNode,
  type SlabNode,
  type WallNode,
  WindowNode,
} from '../schema'
import {
  type FacadeSurface,
  readLiveWallFacade,
  readWallFacade,
  type WallFacade,
} from '../systems/facade/facade-config'
import {
  bayCladdingRects,
  type FacadeCladding,
  type FacadeFinish,
  type FacadeOpeningPlacement,
  type FacadeUnit,
  type FacadeUnitObstacle,
  FacadeUnitSchema,
  resolveFacadeUnit,
} from '../systems/facade/facade-unit'
import { indexRepetitions, type RepetitionPlan, reconcileRepetitions } from '../utils/repetition'
import { facadeBalconyNodes } from './facade-balconies'
import {
  type FacadeRun,
  type FacadeTargetWall,
  type FacadeWallTarget,
  facadeChains,
  facadeFace,
  facadeRuns,
} from './facade-runs'

/** Metadata a facade stamps on what it generates; releasing them detaches the node. */
export const FACADE_OWNERSHIP_KEYS = ['facadeOwner', 'facadeCell'] as const
export const MAX_FACADE_OPENINGS = 400
/** How far an opening may sit past a wall's end and still count as inside it. */
const HOST_TOLERANCE = 1e-6

export type FacadeOpeningNode = WindowNode | DoorNode
export type FacadeMaterialRefs = {
  finish?: string
  frame?: string
  /** Scene material per cladding, keyed by `facadeCladdingKey`. */
  cladding?: Record<string, string>
}
/** Claddings that look the same share one material. */
export const facadeCladdingKey = (cladding: Pick<FacadeCladding, 'finish' | 'color'>) =>
  `${cladding.finish}|${cladding.color}`
export type FacadeWallPlan = {
  wall: WallNode
  openings: RepetitionPlan<FacadeOpeningNode>
  balconies: RepetitionPlan<SlabNode | FenceNode>
  panels: RepetitionPlan<PanelNode>
  /** Null when the wall already carries this exact facade. */
  wallUpdate: Pick<WallNode, 'slots' | 'metadata'> | null
}
export type FacadeFillPlan = { walls: FacadeWallPlan[]; runs: FacadeRun[]; skipped: number }

/** Why a facade cannot be generated on this wall, as a sentence for the panel. */
export function facadeWallIssue(wall: WallNode, nodes: Record<string, AnyNode>): string | null {
  if (wall.metadata.linkedArray)
    return 'Edit the array source or make this copy real before applying a facade.'
  if (wall.curveOffset) return 'Facades currently support straight walls.'
  if (wall.parentId && nodes[wall.parentId]?.metadata.placeholderSource)
    return 'Edit the source floor or make this placeholder real first.'
  if (readWallFacade(wall.metadata)?.detached)
    return 'This facade is detached. Edit its openings directly, or undo the manual edit to restore it.'
  return null
}

const sameUnit = (a: FacadeUnit, b: FacadeUnit) => JSON.stringify(a) === JSON.stringify(b)

/** Walls already carrying this unit live on the same level: a fill extends through them. */
function liveWallsWithUnit(
  nodes: Record<string, AnyNode>,
  levelIds: Set<string>,
  unit: FacadeUnit,
) {
  return Object.values(nodes).filter((node): node is WallNode => {
    if (node.type !== 'wall' || !levelIds.has(node.parentId as string)) return false
    const facade = readLiveWallFacade(node.metadata)
    return !!facade && sameUnit(facade.unit, unit)
  })
}

function targetOf(wall: WallNode, targets: Record<string, FacadeWallTarget>): FacadeWallTarget {
  const stored = readWallFacade(wall.metadata)
  return targets[wall.id] ?? { surface: stored?.surface ?? 'exterior', face: stored?.face }
}

/** Every input a wall's share of the facade resolved against. When this drifts, it refills. */
function frameOf(
  wall: WallNode,
  runs: readonly FacadeRun[],
  nodes: Record<string, AnyNode>,
  unit: FacadeUnit,
) {
  const own = runs.filter((run) => run.walls.some((w) => w.wall.id === wall.id))
  return JSON.stringify([
    unit,
    wall.start,
    wall.end,
    wall.thickness,
    getWallBaseElevationForNodes(wall, nodes),
    own.map((run) => [
      run.key,
      run.start,
      run.end,
      run.height,
      run.normal,
      run.walls.map((w) => [w.wall.id, w.from, w.to]),
    ]),
  ])
}

/**
 * The layout frame a live facade wall would get from a refill now. Resize sync
 * compares it with the stored frame, so moving a partition that meets the
 * facade — which moves a junction — refits it like a resize does.
 */
export function facadeLayoutFrame(
  wall: WallNode,
  nodes: Record<string, AnyNode>,
  facade: WallFacade,
) {
  const mates = liveWallsWithUnit(nodes, new Set([wall.parentId as string]), facade.unit)
  const chain = facadeChains(
    [wall, ...mates.filter((mate) => mate.id !== wall.id)].map((w) => ({
      wall: w,
      face: facadeFace(w, targetOf(w, {})),
    })),
  ).find((c) => c.some((t) => t.wall.id === wall.id))
  return frameOf(wall, facadeRuns(nodes, chain ?? []), nodes, facade.unit)
}

const FINISH_PATTERNS: Partial<Record<FacadeFinish, string>> = {
  brick:
    '<path d="M0 0H480M0 180H480M0 360H480M0 0V180M240 0V180M120 180V360M360 180V360" stroke="#aaa" stroke-width="7"/>',
  siding: '<path d="M0 90H480M0 180H480M0 270H480" stroke="#bbb" stroke-width="5"/>',
  stone: '<path d="M0 180H480M240 0V180M120 180V360" stroke="#ccc" stroke-width="4"/>',
  timber:
    '<path d="M80 0V360M160 0V360M240 0V360M320 0V360M400 0V360" stroke="#bcbcbc" stroke-width="5"/>',
}

/** A metre-scaled finish; glazing is always a native window, never painted. */
export function facadeFinishMaterial(finish: FacadeFinish, color: string): MaterialSchema {
  const pattern = FINISH_PATTERNS[finish]
  const reflective = finish === 'metal' || finish === 'glass'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><path fill="#fff" d="M0 0H480V360H0Z"/>${pattern ?? ''}</svg>`
  return MaterialSchema.parse({
    preset: 'custom',
    properties: { color, roughness: reflective ? 0.35 : 0.88, metalness: reflective ? 0.65 : 0 },
    ...(pattern
      ? {
          texture: {
            url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
            // The pattern tile is 0.48 × 0.36 m.
            repeat: [1 / 0.48, 1 / 0.36],
          },
        }
      : {}),
  })
}

/** The wall slots a finish paints: the whole face plus its four band slots. */
export function facadeSurfaceSlots(surface: FacadeSurface): string[] {
  const sides = surface === 'both' ? (['interior', 'exterior'] as const) : [surface]
  return sides.flatMap((side) => {
    const suffix = side === 'interior' ? 'Interior' : 'Exterior'
    return [side, ...['lower', 'middle', 'upper', 'top'].map((band) => `${band}${suffix}`)]
  })
}

type DesiredOpening = { cell: string; opening: FacadeOpeningPlacement; x: number }

function buildOpening(
  wall: WallNode,
  desired: DesiredOpening,
  old: FacadeOpeningNode | undefined,
  frameRef: string | undefined,
): FacadeOpeningNode {
  const { opening } = desired
  const common = {
    ...old,
    parentId: wall.id,
    wallId: wall.id,
    position: [desired.x, opening.y, 0] as [number, number, number],
    width: opening.right - opening.left,
    height: opening.top - opening.bottom,
    slots: { ...old?.slots, ...(frameRef ? { frame: frameRef } : {}) },
    metadata: { ...old?.metadata, facadeOwner: wall.id, facadeCell: desired.cell },
  }
  return opening.kind === 'door'
    ? DoorNode.parse({ name: 'Facade door', ...common })
    : WindowNode.parse({ name: 'Facade window', ...common })
}

type DesiredPanel = {
  cell: string
  x: number
  width: number
  bottom: number
  top: number
  cladding: FacadeCladding
  infill: boolean
}

function buildPanel(
  wall: WallNode,
  side: 'front' | 'back',
  desired: DesiredPanel,
  old: PanelNode | undefined,
  ref: string | undefined,
): PanelNode {
  return PanelNode.parse({
    name: desired.infill ? 'Facade infill' : 'Facade spandrel',
    ...old,
    parentId: wall.id,
    wallId: wall.id,
    side,
    position: [desired.x, (desired.bottom + desired.top) / 2, 0],
    width: desired.width,
    height: desired.top - desired.bottom,
    thickness: desired.cladding.thickness,
    offset: desired.cladding.standoff,
    slots: { ...old?.slots, ...(ref ? { surface: ref } : {}) },
    metadata: { ...old?.metadata, facadeOwner: wall.id, facadeCell: desired.cell },
  })
}

/** Where a point on the run axis falls in a wall's own coordinate along its length. */
const wallLocal = (w: FacadeRun['walls'][number], along: number) =>
  w.reversed ? w.to - along : along - w.from

/**
 * Plan a facade fill without touching the store. The picked walls extend
 * through collinear walls already carrying the same unit, split into runs at
 * every junction, and the unit resolves once per run. Every wall is planned
 * before any is committed, so an invalid wall cannot leave a selection
 * half-filled; the same plan drives the preview and the commit.
 */
export function planFacadeFill({
  walls,
  nodes,
  unit: input,
  targets = {},
  refs = {},
  sourceItemId,
}: {
  walls: readonly WallNode[]
  nodes: Record<string, AnyNode>
  unit: FacadeUnit
  targets?: Record<string, FacadeWallTarget>
  refs?: FacadeMaterialRefs
  sourceItemId?: string
}): FacadeFillPlan {
  if (!walls.length) throw Error('Select a wall before applying a facade.')
  // Canonical key order, so a unit matches the same unit stored on neighbouring walls.
  const unit = FacadeUnitSchema.parse(input)
  for (const wall of walls) {
    const issue = facadeWallIssue(wall, nodes)
    if (issue) throw Error(issue)
  }
  const picked = new Set<string>(walls.map((wall) => wall.id))
  const levels = new Set(walls.map((wall) => wall.parentId as string))
  const candidates = [
    ...new Map(
      [...walls, ...liveWallsWithUnit(nodes, levels, unit)].map((wall) => [wall.id, wall]),
    ).values(),
  ]
  const chains = facadeChains(
    candidates.map(
      (wall): FacadeTargetWall => ({ wall, face: facadeFace(wall, targetOf(wall, targets)) }),
    ),
  ).filter((chain) => chain.some((t) => picked.has(t.wall.id)))
  const planned = chains.flat()
  const runs = facadeRuns(nodes, planned)

  const children = (wall: WallNode) =>
    wall.children.map((id) => nodes[id]).filter((node): node is AnyNode => !!node)
  const isOpening = (node: AnyNode): node is FacadeOpeningNode =>
    node.type === 'window' || node.type === 'door'
  const balconiesByOwner = new Map<string, (SlabNode | FenceNode)[]>()
  for (const node of Object.values(nodes)) {
    const owner = node.metadata.facadeOwner
    if ((node.type !== 'slab' && node.type !== 'fence') || typeof owner !== 'string') continue
    balconiesByOwner.set(owner, [...(balconiesByOwner.get(owner) ?? []), node])
  }
  const previousBalconies = new Map(
    planned.map(({ wall }) => [
      wall.id as string,
      indexRepetitions(balconiesByOwner.get(wall.id) ?? [], (node) =>
        String(node.metadata.facadeCell),
      ),
    ]),
  )

  const desiredOpenings = new Map<string, DesiredOpening[]>()
  const desiredBalconies = new Map<string, (SlabNode | FenceNode)[]>()
  const desiredPanels = new Map<string, DesiredPanel[]>()
  const bayByKey = new Map(unit.bays.map((bay) => [bay.key, bay]))
  const push = <T>(map: Map<string, T[]>, key: string, values: T[]) =>
    map.set(key, [...(map.get(key) ?? []), ...values])
  let skipped = 0

  for (const run of runs) {
    // Openings placed by hand stay put; the unit flows around them.
    const obstacles: FacadeUnitObstacle[] = run.walls.flatMap((w) =>
      children(w.wall)
        .filter((node) => isOpening(node) && node.metadata.facadeOwner !== w.wall.id)
        .map((node) => {
          const opening = node as FacadeOpeningNode
          const along = w.reversed ? w.to - opening.position[0] : w.from + opening.position[0]
          return {
            left: along - opening.width / 2 - run.start,
            right: along + opening.width / 2 - run.start,
            bottom: opening.position[1] - opening.height / 2,
            top: opening.position[1] + opening.height / 2,
          }
        }),
    )
    const resolved = resolveFacadeUnit(
      unit,
      { width: run.end - run.start, height: run.height },
      obstacles,
    )
    skipped += resolved.skipped
    for (const placement of resolved.placements) {
      if (placement.opening) {
        const left = run.start + placement.opening.left
        const right = run.start + placement.opening.right
        // An opening straddling two walls could not be cut into either.
        const host = run.walls.find(
          (w) => w.from - HOST_TOLERANCE <= left && right <= w.to + HOST_TOLERANCE,
        )
        if (!host) {
          skipped++
          continue
        }
        push(desiredOpenings, host.wall.id, [
          {
            cell: `${placement.opening.kind}:${run.key}:${placement.key}`,
            opening: placement.opening,
            x: wallLocal(host, (left + right) / 2),
          },
        ])
      }
      if (placement.balcony) {
        const centre = run.start + (placement.balcony.left + placement.balcony.right) / 2
        const host =
          run.walls.find((w) => w.from <= centre && centre <= w.to) ??
          run.walls.reduce((best, w) =>
            Math.abs((w.from + w.to) / 2 - centre) < Math.abs((best.from + best.to) / 2 - centre)
              ? w
              : best,
          )
        push(
          desiredBalconies,
          host.wall.id,
          facadeBalconyNodes({
            run,
            balcony: placement.balcony,
            host: host.wall,
            cell: `balcony:${run.key}:${placement.key}`,
            nodes,
            previous: previousBalconies.get(host.wall.id)!,
          }),
        )
      }
      const bay = bayByKey.get(placement.bay)
      // Cladding is surface, so a strip crossing a wall seam becomes one panel per wall.
      for (const rect of bay ? bayCladdingRects(bay, placement, run.height) : []) {
        for (const w of run.walls) {
          const left = Math.max(run.start + rect.left, w.from)
          const right = Math.min(run.start + rect.right, w.to)
          if (right - left < 0.02) continue
          push(desiredPanels, w.wall.id, [
            {
              cell: `panel:${run.key}:${placement.key}:${rect.part}`,
              x: wallLocal(w, (left + right) / 2),
              width: right - left,
              bottom: rect.bottom,
              top: rect.top,
              cladding: rect.cladding,
              infill: rect.part.startsWith('infill'),
            },
          ])
        }
      }
    }
  }

  const plans = planned.map(({ wall, face }): FacadeWallPlan => {
    const stored = readWallFacade(wall.metadata)
    const surface = targetOf(wall, targets).surface
    const owned = children(wall).filter(
      (node): node is FacadeOpeningNode => isOpening(node) && node.metadata.facadeOwner === wall.id,
    )
    const openings = reconcileRepetitions({
      desired: desiredOpenings.get(wall.id) ?? [],
      previous: indexRepetitions(owned, (node) => String(node.metadata.facadeCell)),
      keyOf: (desired) => desired.cell,
      build: (desired, old) => buildOpening(wall, desired, old, refs.frame),
    })
    const ownedPanels = children(wall).filter(
      (node): node is PanelNode => node.type === 'panel' && node.metadata.facadeOwner === wall.id,
    )
    const panels = reconcileRepetitions({
      desired: desiredPanels.get(wall.id) ?? [],
      previous: indexRepetitions(ownedPanels, (node) => String(node.metadata.facadeCell)),
      keyOf: (desired) => desired.cell,
      build: (desired, old) =>
        buildPanel(wall, face, desired, old, refs.cladding?.[facadeCladdingKey(desired.cladding)]),
    })
    const balconies = reconcileRepetitions({
      desired: desiredBalconies.get(wall.id) ?? [],
      previous: previousBalconies.get(wall.id)!,
      keyOf: (node) => String(node.metadata.facadeCell),
      build: (node) => node,
    })

    const slots = { ...wall.slots }
    const previousSlots = { ...stored?.previousSlots }
    const appliedSlots = { ...stored?.appliedSlots }
    if (refs.finish)
      for (const slot of facadeSurfaceSlots(surface)) {
        if (!Object.hasOwn(previousSlots, slot)) previousSlots[slot] = slots[slot] ?? null
        slots[slot] = refs.finish
        appliedSlots[slot] = refs.finish
      }
    const config: WallFacade = {
      unit,
      sourceItemId: sourceItemId ?? stored?.sourceItemId,
      surface,
      face,
      layoutFrame: frameOf(wall, runs, nodes, unit),
      previousSlots,
      appliedSlots,
      detached: false,
    }
    const unchanged =
      JSON.stringify(wall.slots ?? {}) === JSON.stringify(slots) &&
      JSON.stringify(wall.metadata.proceduralFacade) === JSON.stringify(config)
    return {
      wall,
      openings,
      balconies,
      panels,
      wallUpdate: unchanged
        ? null
        : { slots, metadata: { ...wall.metadata, proceduralFacade: config } },
    }
  })
  const total = plans.reduce((sum, plan) => sum + plan.openings.values.length, 0)
  if (total > MAX_FACADE_OPENINGS)
    throw Error(`Fill fewer walls at once; this selection exceeds ${MAX_FACADE_OPENINGS} openings.`)
  return { walls: plans, runs, skipped }
}
