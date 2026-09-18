'use client'

import { imagePointToLevel, outlineBatchPrimitiveNodes, reconcileOutlineWalls, strokeFootprint } from '@pascal-app/core/building'

import { type AnyNode, type LevelNode, useScene, type WallNode } from '@pascal-app/core'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'



import { type PlanWorkspaceDraft, workspaceShapeCandidates } from './workspace'

export function useWorkspacePreview(draft: PlanWorkspaceDraft | null) {
  const shape = draft?.mode === 'shapes' ? draft : null
  const level = useScene((s) => (shape ? s.nodes[shape.levelId] : undefined)) as
    | LevelNode
    | undefined
  const { guide, selected, kind, thickness, floorHeight, includeHoles, balcony, fillAsWall } =
    shape ?? {}
  const balconyHeight = kind === 'balcony' ? shape?.height : undefined
  const shapes = shape ? workspaceShapeCandidates(shape) : undefined
  const contours = useMemo(() => {
    if (!guide || !shapes) return []
    const ref = guide.metadata.planReference as { width: number; height: number }
    const transform = {
      metersPerPixel: (guide.scale * 10) / ref.width,
      rotation: guide.rotation[1],
      position: [guide.position[0], guide.position[2]] as [number, number],
    }
    return shapes.map((s) => ({
      id: s.id,
      points: (s.stroke
        ? strokeFootprint(s.points, (thickness ?? 0.18) / transform.metersPerPixel)
        : s.points
      ).map((p) => imagePointToLevel(p, ref, transform)),
      holes: includeHoles || fillAsWall
        ? s.holes.map((h) => h.map((p) => imagePointToLevel(p, ref, transform)))
        : [],
    }))
  }, [guide, shapes, includeHoles, fillAsWall, thickness])
  const existingWalls = useScene(
    useShallow((s) =>
      kind === 'walls' || kind === 'balcony'
        ? Object.values(s.nodes).filter(
            (n): n is WallNode => n.type === 'wall' && n.parentId === shape?.levelId,
          )
        : [],
    ),
  )
  const contextNodes = useScene((s) =>
    kind === 'balcony' || kind === 'unit' ? s.nodes : undefined,
  )
  const preview = useMemo((): { nodes: AnyNode[]; error: string } => {
    if (!guide || !level || !shapes || !selected?.length || !kind) return { nodes: [], error: '' }
    try {
      // Build once at storey height; a group transform changes the live preview height.
      return {
        nodes: outlineBatchPrimitiveNodes({
          guide,
          level,
          shapes: shapes
            .filter((s) => selected.includes(s.id))
            .map((s) => ({
              ...s,
              holes: fillAsWall || includeHoles ? s.holes : [],
            })),
          kind,
          fillAsWall,
          thickness,
          height: kind === 'balcony' ? balconyHeight : floorHeight,
          balcony,
          name: 'Plan preview',
          existingWalls: kind === 'balcony' ? existingWalls : [],
          contextNodes,
        }),
        error: '',
      }
    } catch (e) {
      return { nodes: [], error: e instanceof Error ? e.message : 'This shape cannot be extruded.' }
    }
  }, [
    guide,
    level,
    shapes,
    selected,
    kind,
    thickness,
    floorHeight,
    includeHoles,
    fillAsWall,
    balcony,
    balconyHeight,
    existingWalls,
    contextNodes,
  ])
  const height = shape?.height
  const shared = useMemo(() => {
    if (kind !== 'walls' || preview.error || !preview.nodes.length || !existingWalls.length)
      return { ...preview, reusedWallCount: 0 }
    try {
      const plan = reconcileOutlineWalls(
        preview.nodes as WallNode[],
        existingWalls,
        floorHeight!,
        height,
      )
      return { nodes: plan.nodes, error: '', reusedWallCount: plan.reusedWallIds.length }
    } catch (e) {
      return {
        nodes: [],
        error: e instanceof Error ? e.message : 'Unable to reconcile shared walls.',
        reusedWallCount: 0,
      }
    }
  }, [preview, kind, existingWalls, floorHeight, height])
  return { ...shared, contours }
}
