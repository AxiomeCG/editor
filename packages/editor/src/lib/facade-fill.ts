import {
  type AnyNodeId,
  type FacadeUnit,
  readWallFacade,
  runAsSingleSceneHistoryStep,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  FACADE_OWNERSHIP_KEYS,
  FACADE_RELEASED_KEY,
  type FacadeWallTarget,
  facadeFillPatches,
  planFacadeFill,
  reclaimDetachedFacades,
} from '@pascal-app/core/building'

let generationDepth = 0
/** True while a facade is writing, so its own commits never re-trigger resize sync. */
export const isFacadeGeneration = () => generationDepth > 0
function generate<T>(run: () => T): T {
  generationDepth++
  try {
    return runAsSingleSceneHistoryStep(useScene, run)
  } finally {
    generationDepth--
  }
}

const currentWalls = (ids: readonly WallNode['id'][]) => {
  const nodes = useScene.getState().nodes
  return ids
    .map((id) => nodes[id as AnyNodeId])
    .filter((node): node is WallNode => node?.type === 'wall')
}

const assertEditable = () => {
  if (useScene.getState().readOnly) throw Error('This scene is read-only.')
}

/**
 * Fill walls with a facade in one undo step. Throws a sentence the panel can show.
 * `force` takes back detached facades first: what they released is replaced.
 */
export function applyFacade(
  wallIds: readonly WallNode['id'][],
  unit: FacadeUnit,
  {
    force = false,
    ...options
  }: {
    targets?: Record<string, FacadeWallTarget>
    sourceItemId?: string
    force?: boolean
    /** Remove the existing openings the fill's openings overlap, rather than flowing around them. */
    replaceExisting?: boolean
  } = {},
) {
  assertEditable()
  return generate(() => {
    const reclaim = force
      ? reclaimDetachedFacades(currentWalls(wallIds), useScene.getState().nodes)
      : {
          walls: currentWalls(wallIds),
          nodes: useScene.getState().nodes,
          removed: [],
          reclaimed: [],
        }
    const { nodes } = reclaim
    const plan = planFacadeFill({ walls: reclaim.walls, nodes, unit, ...options })
    // One store write per kind, however many walls: every write fans out to every scene subscriber.
    const patches = facadeFillPatches(plan, nodes)
    const scene = useScene.getState()
    const removed = [
      ...reclaim.removed,
      ...patches.flatMap((p) => (p.op === 'delete' ? [p.id] : [])),
    ]
    const created = patches.flatMap((p) =>
      p.op === 'create' ? [{ node: p.node, parentId: p.parentId }] : [],
    )
    const updated = [
      // A reclaimed wall is live again even when its refill changes nothing else.
      ...reclaim.reclaimed.map((wall) => ({ id: wall.id, data: { metadata: wall.metadata } })),
      ...patches.flatMap((p) => (p.op === 'update' ? [{ id: p.id, data: p.data }] : [])),
    ]
    if (removed.length) scene.deleteNodes(removed)
    if (created.length) scene.createNodes(created)
    if (updated.length) scene.updateNodes(updated)
    return { walls: plan.walls.length, skipped: plan.skipped, replaced: plan.displaced.length }
  })
}

/** Delete what a live facade generated and restore the finishes it replaced. */
export function removeFacade(wallIds: readonly WallNode['id'][]) {
  assertEditable()
  generate(() => {
    for (const wall of currentWalls(wallIds)) {
      const config = readWallFacade(wall.metadata)
      if (!config || config.detached) continue
      const slots = { ...wall.slots }
      // Restore only slots still showing the facade finish; a repaint since wins.
      for (const [slot, previous] of Object.entries(config.previousSlots ?? {}))
        if (slots[slot] === config.appliedSlots?.[slot]) {
          if (previous === null) delete slots[slot]
          else slots[slot] = previous
        }
      const owned = Object.values(useScene.getState().nodes)
        .filter((node) => node.metadata.facadeOwner === wall.id)
        .map((node) => node.id)
      if (owned.length) useScene.getState().deleteNodes(owned)
      const { proceduralFacade: _, ...metadata } = wall.metadata
      useScene.getState().updateNode(wall.id, { slots, metadata })
    }
  })
}

/** Keep the geometry and ids but release them from the facade, which stops regenerating. */
export function detachFacade(
  wallIds: readonly WallNode['id'][],
  reason = 'Made editable from the facade panel.',
) {
  assertEditable()
  generate(() => {
    const walls = currentWalls(wallIds).filter((wall) => {
      const config = readWallFacade(wall.metadata)
      return config && !config.detached
    })
    const owners = new Set<string>(walls.map((wall) => wall.id))
    const released = Object.values(useScene.getState().nodes).flatMap((node) => {
      const owner = node.metadata.facadeOwner as string
      if (!owners.has(owner)) return []
      const metadata: Record<string, unknown> = { ...node.metadata, [FACADE_RELEASED_KEY]: owner }
      for (const key of FACADE_OWNERSHIP_KEYS) delete metadata[key]
      return [{ id: node.id, data: { metadata } }]
    })
    if (released.length) useScene.getState().updateNodes(released)
    for (const wall of walls)
      useScene.getState().updateNode(wall.id, {
        metadata: {
          ...wall.metadata,
          proceduralFacade: {
            ...readWallFacade(wall.metadata),
            detached: true,
            detachedReason: reason,
          },
        },
      })
  })
}
