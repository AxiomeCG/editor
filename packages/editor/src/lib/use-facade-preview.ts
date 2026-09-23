'use client'
import {
  type AnyNode,
  type AnyNodeId,
  type FacadeUnit,
  type PanelNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  type FacadeOpeningNode,
  type FacadeScope,
  facadeScopeTargets,
  planFacadeFill,
  reclaimDetachedFacades,
} from '@pascal-app/core/building'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { useFacadeTool } from '../store/use-facade-tool'

/** A generated opening or balcony stands for the wall whose facade made it. */
export function facadeWallIds(nodes: Record<string, AnyNode>, ids: readonly string[]) {
  const walls = new Set<WallNode['id']>()
  for (const id of ids) {
    const node = nodes[id]
    if (node?.type === 'wall') walls.add(node.id)
    const owner = node?.metadata.facadeOwner
    if (typeof owner === 'string' && nodes[owner]?.type === 'wall')
      walls.add(owner as WallNode['id'])
  }
  return [...walls]
}

/** What the apply button fills: the picked walls, or the loop the first one belongs to. */
export function facadeApplyTargets(
  nodes: Record<string, AnyNode>,
  wallIds: readonly WallNode['id'][],
  scope: FacadeScope,
) {
  if (scope === 'wall') return { walls: wallIds.map((id) => nodes[id] as WallNode), targets: {} }
  return facadeScopeTargets(
    nodes as Record<AnyNodeId, AnyNode>,
    nodes[wallIds[0]!] as WallNode,
    scope,
  )
}

export type FacadePreview = {
  walls: { wall: WallNode; openings: FacadeOpeningNode[]; panels: PanelNode[] }[]
  balconies: AnyNode[]
  levelId: AnyNodeId | null
}

const EMPTY: FacadePreview = { walls: [], balconies: [], levelId: null }

/**
 * What applying would produce, planned without touching the store: the same
 * planner and targets as the apply button, detached walls taken back as
 * "Apply anyway" would.
 */
export function planFacadePreview(
  nodes: Record<string, AnyNode>,
  wallIds: readonly WallNode['id'][],
  scope: FacadeScope,
  unit: FacadeUnit,
): FacadePreview {
  if (!wallIds.length) return EMPTY
  const { walls, targets } = facadeApplyTargets(nodes, wallIds, scope)
  const reclaim = reclaimDetachedFacades(walls, nodes)
  const plan = planFacadeFill({ walls: reclaim.walls, nodes: reclaim.nodes, unit, targets })
  return {
    walls: plan.walls.map((wallPlan) => ({
      wall: wallPlan.wall,
      openings: wallPlan.openings.values,
      panels: wallPlan.panels.values,
    })),
    balconies: plan.walls.flatMap((wallPlan) => wallPlan.balconies.values),
    levelId: (walls[0]?.parentId as AnyNodeId | undefined) ?? null,
  }
}

export function useFacadePreview(): FacadePreview {
  const previewing = useFacadeTool((s) => s.previewing)
  const unit = useFacadeTool((s) => s.unit)
  const scope = useFacadeTool((s) => s.scope)
  const nodes = useScene((s) => s.nodes)
  const readOnly = useScene((s) => s.readOnly)
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  return useMemo(() => {
    if (!previewing || readOnly) return EMPTY
    try {
      return planFacadePreview(nodes, facadeWallIds(nodes, selectedIds), scope, unit)
    } catch {
      // The panel reports why on apply; the preview simply shows nothing.
      return EMPTY
    }
  }, [previewing, readOnly, nodes, selectedIds, scope, unit])
}
