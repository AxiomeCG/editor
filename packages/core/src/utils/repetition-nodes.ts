import { areSemanticValuesEqual } from './semantic-equal'
import type { AnyNode, AnyNodeId } from '../schema'
import type { RepetitionPlan } from './repetition'

type RepetitionScene = {
  nodes: Record<AnyNodeId, AnyNode>
  createNodes: (ops: { node: AnyNode; parentId?: AnyNodeId }[]) => void
  updateNodes: (ops: { id: AnyNodeId; data: Partial<AnyNode> }[]) => void
  deleteNodes: (ids: AnyNodeId[]) => void
}

/** Native-node adapter. The caller owns the transaction and generator guard.
 * A renderer-only consumer can use the same plan without this adapter.
 */
export function applyNodeRepetition<T extends AnyNode>(
  plan: RepetitionPlan<T>,
  getScene: () => RepetitionScene,
) {
  if (plan.removed.length) getScene().deleteNodes(plan.removed.map((node) => node.id))
  if (plan.added.length) {
    getScene().createNodes(
      plan.added.map((node) => ({
        // The store attaches descendants. Pre-populated children would duplicate them.
        node: ('children' in node ? { ...node, children: [] } : node) as AnyNode,
        parentId: (node.parentId ?? undefined) as AnyNodeId | undefined,
      })),
    )
  }
  const scene = getScene()
  const updates = [...plan.added, ...plan.updated]
    .filter((node) => !areSemanticValuesEqual(scene.nodes[node.id], node))
    .map((node) => ({ id: node.id, data: node }))
  if (updates.length) scene.updateNodes(updates)
}

/** Release a generator's ownership while retaining native geometry and IDs. */
export function releaseNodeRepetition(
  nodes: readonly AnyNode[],
  metadataKeys: readonly string[],
  getScene: () => RepetitionScene,
) {
  const updates = nodes
    .filter((node) => metadataKeys.some((key) => Object.hasOwn(node.metadata, key)))
    .map((node) => {
      const metadata = { ...node.metadata }
      for (const key of metadataKeys) delete metadata[key]
      return { id: node.id, data: { metadata } }
    })
  if (updates.length) getScene().updateNodes(updates)
}
