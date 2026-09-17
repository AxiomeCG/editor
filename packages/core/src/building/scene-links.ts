import type { AnyNode } from '../schema'
import { reconcileFloorNumbering } from './floor-numbering'
import { reconcileReferenceLinks } from './reference-links'

export function reconcileBuildingLinks(
  before: Record<string, AnyNode>,
  next: Record<string, AnyNode>,
  changedIds: Iterable<string>,
): AnyNode[] {
  const ids = [...changedIds]
  const referenceUpdates = reconcileReferenceLinks(before, next, ids)
  const resolved = referenceUpdates.length
    ? { ...next, ...Object.fromEntries(referenceUpdates.map((n) => [n.id, n])) }
    : next
  return [...referenceUpdates, ...reconcileFloorNumbering(before, resolved, ids)]
}
