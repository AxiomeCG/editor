'use client'
import {
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallThickness,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { clientToPlan } from '../../lib/floorplan/plan-coords'
import { bindWallSplitPointer } from '../../lib/wall-split-pointer'
import { wallSplitDistance } from '../../lib/wall-split-preview'
import { useWallSplit } from '../../store/use-wall-split'
import { useFloorplanRender } from './floorplan-render-context'

export function FloorplanWallSplitLayer() {
  const draft = useWallSplit((s) => s.draft)
  const wallId = draft?.wallId
  const wall = useScene((s) => (draft ? s.nodes[draft.wallId] : undefined))
  const levelId = useViewer((s) => s.selection.levelId)
  const context = useFloorplanRender()
  const upp = context?.unitsPerPixel ?? 0.01
  useEffect(() => {
    if (!wallId || useScene.getState().nodes[wallId]?.parentId !== levelId) return
    const scene = document.querySelector<SVGGElement>('g[data-floorplan-scene]')
    const surface = scene?.ownerSVGElement
    if (!surface) return
    return bindWallSplitPointer(surface, (event) => {
      if (!(event.target instanceof Node) || !surface.contains(event.target)) return null
      const point = clientToPlan(event.clientX, event.clientY)
      const current = useScene.getState().nodes[wallId]
      if (!point || current?.type !== 'wall') return null
      const distance = wallSplitDistance(current, point)
      // Only the selected wall's stroke is a target, including its endpoint exclusion zones.
      const preview = useWallSplit.getState().draft?.preview
      if (!preview) return null
      const frame = getFrame(current, distance)
      if (
        Math.hypot(frame.point.x - point[0], frame.point.y - point[1]) >
        getWallThickness(current) / 2 + 8 * upp
      )
        return null
      return distance
    })
  }, [wallId, levelId, upp])
  if (!draft || wall?.type !== 'wall' || wall.parentId !== levelId) return null
  const { point, normal } = draft.preview.frame
  const half = getWallThickness(wall) / 2 + 8 * upp
  const line = {
    x1: point.x - normal.x * half,
    y1: point.y - normal.y * half,
    x2: point.x + normal.x * half,
    y2: point.y + normal.y * half,
  }
  return (
    <g pointerEvents="none" data-testid="pascal-split-marker-2d">
      <line {...line} stroke="#f7f3ed" strokeWidth={7 * upp} strokeLinecap="round" />
      <line
        {...line}
        stroke={draft.preview.valid ? '#c86f45' : '#a63d2e'}
        strokeWidth={3 * upp}
        strokeLinecap="round"
      />
    </g>
  )
}

function getFrame(wall: WallNode, distance: number) {
  const length = getWallCurveLength(wall)
  return getWallCurveFrameAt(wall, length > 0 ? distance / length : 0)
}
