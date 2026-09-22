import {
  type AnyNode,
  type AnyNodeId,
  pauseSceneHistory,
  readWallFacade,
  resumeSceneHistory,
  type SceneCommit,
  subscribeSceneCommits,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { facadeLayoutFrame } from '@pascal-app/core/building'
import { applyFacade, detachFacade, isFacadeGeneration } from './facade-fill'
import { hasAuthoredRepetitionChange } from './repetition-authored-change'

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const PRESENTATION_FIELDS = new Set(['name', 'metadata', 'visible', 'camera', 'collectionIds'])
const WALL_FINISH_FIELDS = [
  'slots',
  'material',
  'interiorMaterial',
  'exteriorMaterial',
  'faceBands',
  'skirting',
  'crown',
  'chairRail',
] as const

function contentChanged(before: AnyNode, after: AnyNode) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].some(
    (key) =>
      !PRESENTATION_FIELDS.has(key) &&
      !equal(before[key as keyof AnyNode], after[key as keyof AnyNode]),
  )
}

/** The walls a node belongs to: its host, or the wall whose facade generated it. */
function hostIds(node: AnyNode | undefined, nodes: SceneCommit['current']['nodes']) {
  if (!node || node.type === 'wall') return []
  const wallId = 'wallId' in node ? node.wallId : undefined
  return [...new Set([node.parentId, wallId, node.metadata.facadeOwner])].filter(
    (id): id is WallNode['id'] => typeof id === 'string' && nodes[id as AnyNodeId]?.type === 'wall',
  )
}

/** Walls whose facade must detach because someone edited its result by hand, with why. */
function manualChanges(commit: SceneCommit) {
  const reasons = new Map<string, string>()
  // A split keeps the first wall's id. Both halves become manual geometry, or
  // resize sync would generate openings straight across the cut.
  const addedFacadeWalls = Object.values(commit.current.nodes).filter(
    (node): node is WallNode =>
      node.type === 'wall' &&
      !commit.before.nodes[node.id] &&
      !!node.metadata.proceduralFacade &&
      !node.metadata.linkedArray,
  )
  for (const added of addedFacadeWalls) {
    for (const before of Object.values(commit.before.nodes)) {
      if (
        before.type !== 'wall' ||
        before.parentId !== added.parentId ||
        !equal(before.metadata.proceduralFacade, added.metadata.proceduralFacade)
      )
        continue
      const current = commit.current.nodes[before.id]
      if (current?.type !== 'wall' || equal(before.end, current.end)) continue
      if (
        equal(before.start, current.start) &&
        equal(current.end, added.start) &&
        equal(before.end, added.end)
      ) {
        reasons.set(current.id, 'Wall split into independent sections.')
        reasons.set(added.id, 'Wall split into independent sections.')
      }
    }
  }

  const ids =
    commit.changedNodeIds ??
    new Set([...Object.keys(commit.before.nodes), ...Object.keys(commit.current.nodes)])
  for (const id of ids) {
    const before = commit.before.nodes[id as AnyNodeId]
    const after = commit.current.nodes[id as AnyNodeId]
    if (after?.metadata.isTransient || (!after && before?.metadata.isTransient)) continue
    if (before === after || (before && after && !contentChanged(before, after))) continue
    const hosts = new Set([
      ...hostIds(before, commit.before.nodes),
      ...hostIds(after, commit.current.nodes),
    ])
    const kind = (after ?? before)?.type ?? 'element'
    const verb = !before ? 'added' : !after ? 'removed' : 'edited'
    for (const host of hosts)
      reasons.set(host, `${kind[0]!.toUpperCase() + kind.slice(1)} ${verb} outside the facade.`)
    if (before?.type === 'wall' && after?.type === 'wall') {
      if (WALL_FINISH_FIELDS.some((key) => !equal(before[key], after[key])))
        reasons.set(id, 'Wall finish edited outside the facade.')
      if (after.curveOffset && !equal(before.curveOffset, after.curveOffset))
        reasons.set(id, 'Wall changed to a curved shape.')
    }
  }

  // Editing a shared scene material changes the result without changing any slot reference.
  const changedRefs = new Set(
    Object.keys(commit.before.materials)
      .filter(
        (id) =>
          !equal(
            commit.before.materials[id as keyof typeof commit.before.materials],
            commit.current.materials[id as keyof typeof commit.current.materials],
          ),
      )
      .map((id) => `scene:${id}`),
  )
  if (changedRefs.size)
    for (const node of Object.values(commit.current.nodes)) {
      if (
        !('slots' in node) ||
        !node.slots ||
        !Object.values(node.slots).some((ref) => changedRefs.has(ref))
      )
        continue
      if (node.type === 'wall') reasons.set(node.id, 'Wall material edited outside the facade.')
      for (const id of hostIds(node, commit.current.nodes))
        reasons.set(id, 'Opening material edited outside the facade.')
    }
  return reasons
}

/**
 * Keep live facades fitted to their walls. Runs inside the originating edit's
 * undo step: a resize refills, a hand edit to the result detaches instead.
 */
export function subscribeFacadeResizes(report: (message: string) => void = () => {}) {
  let syncing = false
  return subscribeSceneCommits((commit) => {
    if (
      syncing ||
      isFacadeGeneration() ||
      commit.origin === 'load' ||
      !hasAuthoredRepetitionChange(commit) ||
      useScene.getState().readOnly
    )
      return
    const reasons = manualChanges(commit)
    const changedLevels = new Set<string>(
      Object.values(commit.current.nodes)
        .filter(
          (node) =>
            node.type === 'level' &&
            node.height !== (commit.before.nodes[node.id] as typeof node | undefined)?.height,
        )
        .map((node) => node.id),
    )
    const candidates = Object.values(commit.current.nodes).filter((node): node is WallNode => {
      // A linked array owns its copied subtree; only the source facade generates it.
      if (node.type !== 'wall' || node.metadata.linkedArray) return false
      const config = readWallFacade(node.metadata)
      if (!config?.layoutFrame || config.detached) return false
      const before = commit.before.nodes[node.id]
      return (
        reasons.has(node.id) ||
        (before?.type === 'wall' &&
          (!equal(before.start, node.start) ||
            !equal(before.end, node.end) ||
            before.height !== node.height ||
            before.thickness !== node.thickness ||
            before.supportSlabId !== node.supportSlabId ||
            before.supportOffset !== node.supportOffset ||
            before.frontSide !== node.frontSide ||
            before.backSide !== node.backSide ||
            facadeLayoutFrame(node, commit.current.nodes, config) !== config.layoutFrame ||
            (!!node.parentId && changedLevels.has(node.parentId))))
      )
    })
    const orphaned = Object.values(commit.current.nodes).filter(
      (node) =>
        typeof node.metadata.facadeOwner === 'string' &&
        !commit.current.nodes[node.metadata.facadeOwner as AnyNodeId],
    )
    if (!candidates.length && !orphaned.length) return

    syncing = true
    const wasTracking = useScene.temporal.getState().isTracking
    if (wasTracking) pauseSceneHistory(useScene)
    try {
      if (orphaned.length) useScene.getState().deleteNodes(orphaned.map((node) => node.id))
      for (const candidate of candidates) {
        const wall = useScene.getState().nodes[candidate.id]
        if (wall?.type !== 'wall') continue
        const reason = reasons.get(wall.id)
        if (reason) {
          detachFacade([wall.id], reason)
          report('Facade detached. Your manual edits are preserved.')
          continue
        }
        const config = readWallFacade(wall.metadata)
        if (
          !config ||
          facadeLayoutFrame(wall, useScene.getState().nodes, config) === config.layoutFrame
        )
          continue
        try {
          applyFacade([wall.id], config.unit)
          report('Facade openings refitted to the resized wall.')
        } catch (error) {
          report(`Facade resize: ${(error as Error).message}`)
        }
      }
    } finally {
      if (wasTracking) resumeSceneHistory(useScene)
      syncing = false
    }
  })
}
