'use client'
import {
  type AnyNode,
  type AnyNodeId,
  type LevelNode,
  useScene,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { useBalconyTool } from '../store/use-balcony-tool'
import useEditor from '../store/use-editor'
import { usePlanWorkspace } from '../store/use-plan-workspace'
import { type BalconyOptions, balconyFromWall, createBalconyParts } from '@pascal-app/core/building'

export function planSelectedBalconies(
  nodes: Record<string, AnyNode>,
  ids: readonly string[],
  level: LevelNode,
  options: BalconyOptions,
  elevation: number,
) {
  if (level.metadata.placeholderSource) throw Error('Choose an editable floor.')
  const sources = ids
    .map((id) => nodes[id])
    .filter(
      (n): n is WallNode | ZoneNode =>
        !!n && n.parentId === level.id && (n.type === 'wall' || n.type === 'zone'),
    )
  if (sources.length > 32) throw Error('Create balconies from at most 32 walls or zones at once.')
  return sources.flatMap((node) =>
    node.type === 'wall'
      ? balconyFromWall(node, level, nodes, options, elevation)
      : node.type === 'zone'
        ? createBalconyParts({
            level,
            polygon: node.polygon,
            walls: Object.values(nodes).filter((n): n is WallNode => n.type === 'wall'),
            nodes,
            options,
            elevation,
            metadata: { balconySourceZone: node.id },
          })
        : [],
  )
}

export function useBalconyPreview() {
  const { active, options, elevation } = useBalconyTool()
  const nodes = useScene((s) => s.nodes),
    readOnly = useScene((s) => s.readOnly)
  const selection = useViewer((s) => s.selection)
  const mode = useEditor((s) => s.mode),
    capture = useEditor((s) => s.captureMode.mode)
  const planOpen = usePlanWorkspace((s) => !!s.draft)
  const level = selection.levelId ? nodes[selection.levelId] : undefined
  const enabled = active && !readOnly && !planOpen && mode === 'select' && capture === 'idle'
  return useMemo(() => {
    if (!enabled || level?.type !== 'level')
      return { nodes: [] as AnyNode[], error: '', levelId: null as AnyNodeId | null }
    try {
      return {
        nodes: planSelectedBalconies(nodes, selection.selectedIds, level, options, elevation),
        error: '',
        levelId: level.id,
      }
    } catch (e) {
      return {
        nodes: [] as AnyNode[],
        error: e instanceof Error ? e.message : 'Cannot create this balcony.',
        levelId: level.id,
      }
    }
  }, [enabled, nodes, selection.selectedIds, level, options, elevation])
}
