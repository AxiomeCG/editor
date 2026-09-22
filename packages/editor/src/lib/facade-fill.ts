import {
  type AnyNodeId,
  applyNodeRepetition,
  type FacadeUnit,
  readWallFacade,
  releaseNodeRepetition,
  runAsSingleSceneHistoryStep,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  FACADE_OWNERSHIP_KEYS,
  type FacadeWallTarget,
  planFacadeFill,
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

/** Fill walls with a facade in one undo step. Throws a sentence the panel can show. */
export function applyFacade(
  wallIds: readonly WallNode['id'][],
  unit: FacadeUnit,
  options: { targets?: Record<string, FacadeWallTarget>; sourceItemId?: string } = {},
) {
  assertEditable()
  const walls = currentWalls(wallIds)
  return generate(() => {
    const plan = planFacadeFill({ walls, nodes: useScene.getState().nodes, unit, ...options })
    for (const wallPlan of plan.walls) {
      applyNodeRepetition(wallPlan.openings, useScene.getState)
      applyNodeRepetition(wallPlan.balconies, useScene.getState)
      applyNodeRepetition(wallPlan.panels, useScene.getState)
      if (wallPlan.wallUpdate) useScene.getState().updateNode(wallPlan.wall.id, wallPlan.wallUpdate)
    }
    return { walls: plan.walls.length, skipped: plan.skipped }
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
    releaseNodeRepetition(
      Object.values(useScene.getState().nodes).filter((node) =>
        owners.has(node.metadata.facadeOwner as string),
      ),
      FACADE_OWNERSHIP_KEYS,
      useScene.getState,
    )
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
