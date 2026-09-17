import { type AnyNodeId, useScene } from '@pascal-app/core'
import { type MirrorOptions, planMirror } from '@pascal-app/core/building'

export function commitMirror(ids: AnyNodeId[], options: MirrorOptions) {
  const scene = useScene.getState()
  if (scene.readOnly) throw Error('This scene is read-only.')
  const plan = planMirror(scene.nodes, ids, options)
  scene.applyNodeChanges({
    update: plan.updates,
    create: plan.creates.map((node) => ({ node, parentId: node.parentId as AnyNodeId })),
  })
  return plan.resultIds
}
