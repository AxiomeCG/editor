import type { AnyNode, AnyNodeId, SceneCommit } from '@pascal-app/core'

/** Placement drafts are cursor feedback. They must not rewrite a saved generator. */
export function hasAuthoredRepetitionChange(commit: SceneCommit) {
  const ids =
    commit.changedNodeIds ??
    new Set([...Object.keys(commit.before.nodes), ...Object.keys(commit.current.nodes)])
  const authored = (node: AnyNode | undefined, nodes: Record<AnyNodeId, AnyNode>) => {
    if (!node || node.metadata.isTransient) return undefined
    if (!('children' in node)) return node
    return {
      ...node,
      children: node.children.filter((id) => !nodes[id as AnyNodeId]?.metadata.isTransient),
    }
  }
  for (const id of ids) {
    const before = commit.before.nodes[id as AnyNodeId],
      after = commit.current.nodes[id as AnyNodeId]
    if (before === after) continue
    if (
      JSON.stringify(authored(before, commit.before.nodes)) !==
      JSON.stringify(authored(after, commit.current.nodes))
    )
      return true
  }
  return false
}
