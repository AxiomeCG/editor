'use client'
import {
  emitter,
  resolveTerrainWallConstructionOptions,
  useScene,
  type WallNode,
  type WallPlanPoint,
  wallRectangleCorners,
} from '@pascal-app/core'
import {
  type FloorplanToolContext,
  formatLinearMeasurement,
  isMagneticSnapActive,
  markToolCancelConsumed,
  snapWallDraftPointDetailed,
  triggerSFX,
  useEditor,
  useFloorplanRender,
  useInteractionScope,
  useWallSnapIndicator,
} from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { useWallDrawingMode } from './drawing-mode'
import { createWallRectangle } from './rectangle-command'

export default function WallFloorplanTool(props: FloorplanToolContext) {
  const mode = useWallDrawingMode((s) => s.mode)
  return mode === 'rectangle' ? <RectangleFloorplanTool {...props} /> : null
}

function RectangleFloorplanTool({ activeLevelId, unit, metricNotation }: FloorplanToolContext) {
  const group = useRef<SVGGElement>(null)
  const renderContext = useFloorplanRender()
  const [draft, setDraft] = useState<{ start: WallPlanPoint; end: WallPlanPoint } | null>(null)
  const [message, setMessage] = useState('')
  const [cursor, setCursor] = useState<WallPlanPoint | null>(null)
  useEffect(() => {
    const svg = group.current?.ownerSVGElement
    if (!svg || !activeLevelId) return
    let start: WallPlanPoint | null = null
    let down: [number, number] | null = null
    let construction: ReturnType<typeof resolveTerrainWallConstructionOptions> | undefined
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'wall' })
    const pointFor = (e: MouseEvent): WallPlanPoint | null => {
      const matrix = group.current?.getScreenCTM()
      if (!matrix) return null
      const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse())
      const result = snapWallDraftPointDetailed({
        point: [point.x, point.y],
        walls: Object.values(useScene.getState().nodes).filter(
          (n): n is WallNode => n.type === 'wall' && n.parentId === activeLevelId,
        ),
        magnetic: isMagneticSnapActive(),
        bypassSnap: e.altKey,
      })
      useWallSnapIndicator.getState().set(
        result.snap
          ? {
              x: result.point[0],
              z: result.point[1],
              kind: result.snap,
              wallIds: result.targetWallIds,
            }
          : null,
      )
      return result.point
    }
    const claim = (e: Event) => {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey) return
      claim(e)
      down = [e.clientX, e.clientY]
    }
    const onMove = (e: PointerEvent) => {
      if (e.buttons & 6 || e.metaKey || e.ctrlKey) return
      claim(e)
      const point = pointFor(e)
      setCursor(point)
      setMessage('')
      if (start && point) setDraft({ start, end: point })
    }
    const cancel = () => {
      if (start) markToolCancelConsumed()
      start = null
      down = null
      setDraft(null)
      setMessage('')
      setCursor(null)
      useWallSnapIndicator.getState().clear()
    }
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey) return
      claim(e)
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) {
        down = null
        return
      }
      down = null
      const point = pointFor(e)
      if (!point) return
      if (!start) {
        start = point
        construction = resolveTerrainWallConstructionOptions(
          useScene.getState().nodes,
          activeLevelId,
          point,
          useEditor.getState().toolDefaults.wall,
        )
        setDraft({ start, end: point })
        setMessage('')
        return
      }
      try {
        createWallRectangle(
          activeLevelId,
          start,
          point,
          useEditor.getState().toolDefaults.wall ?? {},
          construction,
        )
        cancel()
        triggerSFX('sfx:structure-build')
      } catch (error) {
        setMessage((error as Error).message)
      }
    }
    const stopDouble = (e: MouseEvent) => {
      if (e.button === 0) claim(e)
    }
    const leave = () => {
      setCursor(null)
      useWallSnapIndicator.getState().clear()
    }
    svg.addEventListener('pointerdown', onDown, true)
    svg.addEventListener('pointermove', onMove, true)
    svg.addEventListener('click', onClick, true)
    svg.addEventListener('dblclick', stopDouble, true)
    svg.addEventListener('pointerleave', leave)
    emitter.on('tool:cancel', cancel)
    return () => {
      svg.removeEventListener('pointerdown', onDown, true)
      svg.removeEventListener('pointermove', onMove, true)
      svg.removeEventListener('click', onClick, true)
      svg.removeEventListener('dblclick', stopDouble, true)
      svg.removeEventListener('pointerleave', leave)
      useWallSnapIndicator.getState().clear()
      emitter.off('tool:cancel', cancel)
      useInteractionScope.getState().endIf((s) => s.kind === 'drafting' && s.tool === 'wall')
    }
  }, [activeLevelId])
  const points = draft ? wallRectangleCorners(draft.start, draft.end) : []
  const targetSize = 6 * (renderContext?.unitsPerPixel ?? 0.01)
  return (
    <g ref={group} pointerEvents="none">
      {cursor && (
        <g stroke="#818cf8" strokeWidth={1.5} vectorEffect="non-scaling-stroke" fill="none">
          <circle cx={cursor[0]} cy={cursor[1]} r={targetSize} vectorEffect="non-scaling-stroke" />
          <path
            d={`M${cursor[0] - targetSize * 1.5} ${cursor[1]}h${targetSize * 3}M${cursor[0]} ${cursor[1] - targetSize * 1.5}v${targetSize * 3}`}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
      {draft && (
        <rect
          x={draft.start[0] - targetSize / 2}
          y={draft.start[1] - targetSize / 2}
          width={targetSize}
          height={targetSize}
          fill="#818cf8"
        />
      )}
      {!!points.length && (
        <polygon
          points={points.map((p) => p.join(',')).join(' ')}
          fill="#818cf81a"
          stroke={message ? '#ef4444' : '#818cf8'}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {draft && (
        <text
          x={draft.end[0]}
          y={draft.end[1] - 0.2}
          fill={message ? '#ef4444' : '#818cf8'}
          fontSize={12 * (renderContext?.unitsPerPixel ?? 0.01)}
        >
          {message ||
            `${formatLinearMeasurement(Math.abs(draft.end[0] - draft.start[0]), unit, metricNotation)} × ${formatLinearMeasurement(Math.abs(draft.end[1] - draft.start[1]), unit, metricNotation)}`}
        </text>
      )}
    </g>
  )
}
