'use client'

import {
  type AnyNode,
  type GuideNode,
  type LevelNode,
  planarizeWallBatch,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  imagePointToLevel,
  outlineBatchPrimitiveNodes,
  propPlacementNodes,
  propSymbolFrames,
  reconcileOutlineWalls,
  type SymbolFrame,
} from '@pascal-app/core/building'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import type { PlanPoint } from './calibration'
import { propCatalogItem } from './prop-catalog'
import type { PlanShape } from './selection-geometry'
import { type PlanWorkspaceDraft, workspaceShapeCandidates } from './workspace'

/** Traced shapes (image pixels) placed in level metres, where both overlays draw them. */
export function levelContours(guide: GuideNode, shapes: PlanShape[], withHoles: boolean) {
  const ref = guide.metadata.planReference as { width: number; height: number }
  const transform = {
    metersPerPixel: (guide.scale * 10) / ref.width,
    rotation: guide.rotation[1],
    position: [guide.position[0], guide.position[2]] as PlanPoint,
  }
  const toLevel = (p: PlanPoint) => imagePointToLevel(p, ref, transform)
  return shapes.map((s) => ({
    id: s.id,
    points: s.points.map(toLevel),
    holes: withHoles ? s.holes.map((h) => h.map(toLevel)) : [],
    stroke: s.stroke,
    strokeWidth: s.strokeWidth,
  }))
}

export function useWorkspacePreview(draft: PlanWorkspaceDraft | null) {
  const shape = draft?.mode === 'shapes' ? draft : null
  const level = useScene((s) => (shape ? s.nodes[shape.levelId] : undefined)) as
    | LevelNode
    | undefined
  const {
    guide,
    selected,
    kind,
    thickness,
    floorHeight,
    includeHoles,
    balcony,
    fillAsWall,
    symbolGrouping,
    propItemId,
    propTurns,
  } = shape ?? {}
  const balconyHeight = kind === 'balcony' ? shape?.height : undefined
  const shapes = shape ? workspaceShapeCandidates(shape) : undefined
  const contours = useMemo(
    () => (guide && shapes ? levelContours(guide, shapes, !!(includeHoles || fillAsWall)) : []),
    [guide, shapes, includeHoles, fillAsWall],
  )
  const existingWalls = useScene(
    useShallow((s) =>
      kind === 'walls' || kind === 'balcony' || kind === 'door' || kind === 'window'
        ? Object.values(s.nodes).filter(
            (n): n is WallNode => n.type === 'wall' && n.parentId === shape?.levelId,
          )
        : [],
    ),
  )
  const contextNodes = useScene((s) =>
    kind === 'balcony' || kind === 'unit' ? s.nodes : undefined,
  )
  // Props bypass the outline builder: they are catalog items, not traced primitives.
  const props = useMemo((): { frames: SymbolFrame[]; nodes: AnyNode[]; error: string } => {
    if (kind !== 'prop' || !guide || !level || !shapes || !selected?.length)
      return { frames: [], nodes: [], error: '' }
    try {
      const picked = shapes.filter((s) => selected.includes(s.id))
      const item = propCatalogItem(propItemId)
      return {
        frames: propSymbolFrames({ guide, level, shapes: picked, grouping: symbolGrouping }).map(
          (symbol) => symbol.frame,
        ),
        nodes: item
          ? propPlacementNodes({
              guide,
              level,
              shapes: picked,
              grouping: symbolGrouping,
              asset: item,
              quarterTurns: propTurns,
              name: item.name,
            })
          : [],
        error: '',
      }
    } catch (e) {
      return {
        frames: [],
        nodes: [],
        error: e instanceof Error ? e.message : 'These shapes cannot hold a prop.',
      }
    }
  }, [guide, level, shapes, selected, kind, symbolGrouping, propItemId, propTurns])
  const preview = useMemo((): { nodes: AnyNode[]; error: string } => {
    if (!guide || !level || !shapes || !selected?.length || !kind || kind === 'prop')
      return { nodes: [], error: '' }
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
          existingWalls:
            kind === 'balcony' || kind === 'door' || kind === 'window' ? existingWalls : [],
          contextNodes,
          openingGrouping: symbolGrouping,
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
    symbolGrouping,
  ])
  const height = shape?.height
  const levelId = shape?.levelId
  const shared = useMemo(() => {
    if (kind !== 'walls' || preview.error || !preview.nodes.length || !levelId)
      return { ...preview, reusedWallCount: 0 }
    try {
      const plan = existingWalls.length
        ? reconcileOutlineWalls(preview.nodes as WallNode[], existingWalls, floorHeight!, height)
        : { nodes: preview.nodes as WallNode[], reusedWallIds: [] }
      // Same joins the commit makes, so the preview shows the walls as created.
      const network = planarizeWallBatch(
        plan.nodes,
        Object.fromEntries(existingWalls.map((wall) => [wall.id, wall])),
        levelId,
      )
      return { nodes: network.walls, error: '', reusedWallCount: plan.reusedWallIds.length }
    } catch (e) {
      return {
        nodes: [],
        error: e instanceof Error ? e.message : 'Unable to reconcile shared walls.',
        reusedWallCount: 0,
      }
    }
  }, [preview, kind, existingWalls, floorHeight, height, levelId])
  return kind === 'prop'
    ? { nodes: props.nodes, error: props.error, reusedWallCount: 0, contours, propFrames: props.frames }
    : { ...shared, contours, propFrames: props.frames }
}
