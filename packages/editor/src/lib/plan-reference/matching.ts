import type { AnyNode, GuideNode, LevelNode } from '@pascal-app/core'
import { guideReference, type ReferenceDraft } from './workspace'

export function getPlanMatchAnchors(
  target: GuideNode,
  nodes: Record<string, AnyNode>,
): GuideNode[] {
  const level = target.parentId ? nodes[target.parentId] : undefined
  if (level?.type !== 'level') return []
  const building = level.parentId ? nodes[level.parentId] : undefined
  return Object.values(nodes)
    .filter((node): node is GuideNode => {
      if (node.type !== 'guide' || node.id === target.id || !node.scaleReference) return false
      const anchorLevel = node.parentId ? nodes[node.parentId] : undefined
      if (anchorLevel?.type !== 'level') return false
      return (
        anchorLevel.id === level.id ||
        (building?.type === 'building' && anchorLevel.parentId === building.id)
      )
    })
    .sort(
      (a, b) =>
        Number(b.parentId === level.id) - Number(a.parentId === level.id) ||
        (nodes[a.parentId!] as LevelNode).level - (nodes[b.parentId!] as LevelNode).level ||
        (a.name ?? '').localeCompare(b.name ?? '') ||
        a.id.localeCompare(b.id),
    )
}

/** A match moves only the target. The calibrated anchor remains fixed. */
export function guideReferenceDraft(
  level: LevelNode,
  target: GuideNode,
  nodes: Record<string, AnyNode>,
  anchor?: GuideNode,
): ReferenceDraft {
  if (target.parentId !== level.id || level.metadata.placeholderSource)
    throw Error('Choose a plan on the editable floor.')
  if (anchor && !getPlanMatchAnchors(target, nodes).some((node) => node.id === anchor.id))
    throw Error('Choose a different, calibrated plan in the same building.')
  const plan = guideReference(target),
    map = anchor ? guideReference(anchor) : plan
  return {
    id: crypto.randomUUID(),
    mode: 'references',
    levelId: level.id,
    originals: anchor ? [target, anchor] : [target],
    ...(anchor
      ? { guidePair: { targetId: target.id, anchorId: anchor.id } }
      : { singleGuideId: target.id }),
    stage: anchor ? 'map-span' : 'measure',
    plans: [plan.image],
    maps: [map.image],
    plan: plan.image,
    map: map.image,
    planTransform: plan.transform,
    mapTransform: map.transform,
    dimension: [],
    meters: 0,
    planEdge: [],
    mapEdge: [],
    baseline: null,
    anchor: [plan.image.width / 2, plan.image.height / 2],
    pickingAnchor: false,
    opacity: target.opacity,
  }
}
