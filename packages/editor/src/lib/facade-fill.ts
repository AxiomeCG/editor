import {
  type AnyNodeId,
  applyNodeRepetition,
  type FacadeUnit,
  generateSceneMaterialId,
  type MaterialSchema,
  readWallFacade,
  releaseNodeRepetition,
  runAsSingleSceneHistoryStep,
  SceneMaterial,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  FACADE_OWNERSHIP_KEYS,
  type FacadeMaterialRefs,
  type FacadeWallTarget,
  facadeCladdingKey,
  facadeFinishMaterial,
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

/** Reuse an identical scene material rather than adding a duplicate per fill. */
function sceneMaterialRef(material: MaterialSchema, name: string) {
  const scene = useScene.getState()
  const key = JSON.stringify(material)
  const existing = Object.values(scene.materials).find(
    (entry) => JSON.stringify(entry.material) === key,
  )
  if (existing) return `scene:${existing.id}`
  const entry = SceneMaterial.parse({ id: generateSceneMaterialId(), name, material })
  scene.addSceneMaterial(entry)
  return `scene:${entry.id}`
}

function facadeMaterialRefs(unit: FacadeUnit): FacadeMaterialRefs {
  const cladding: Record<string, string> = {}
  for (const bay of unit.bays)
    for (const panel of [bay.infill, bay.spandrel]) {
      if (!panel || cladding[facadeCladdingKey(panel)]) continue
      cladding[facadeCladdingKey(panel)] = sceneMaterialRef(
        facadeFinishMaterial(panel.finish, panel.color),
        `Facade · ${panel.finish} panel`,
      )
    }
  if (!unit.appearance) return { cladding }
  const { finish, wall, trim } = unit.appearance
  return {
    finish: sceneMaterialRef(facadeFinishMaterial(finish, wall), `Facade · ${finish}`),
    frame: sceneMaterialRef(facadeFinishMaterial('metal', trim), 'Facade · window frame'),
    cladding,
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
  // A dry plan first, so an invalid wall throws before any scene material is added.
  planFacadeFill({ walls, nodes: useScene.getState().nodes, unit, targets: options.targets })
  return generate(() => {
    const refs = facadeMaterialRefs(unit)
    const plan = planFacadeFill({
      walls,
      nodes: useScene.getState().nodes,
      unit,
      refs,
      ...options,
    })
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
