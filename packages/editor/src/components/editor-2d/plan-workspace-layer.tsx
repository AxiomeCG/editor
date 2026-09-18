'use client'

import { imagePointToLevel } from '@pascal-app/core/building'

import { useAssetUrl, useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import { type PlanPoint } from '../../lib/plan-reference/calibration'
import { useWorkspacePreview } from '../../lib/plan-reference/use-workspace-preview'
import { contourSvgPath } from '../../lib/plan-reference/vectorize'
import {
  activeReferencePoints,
  workspaceHandles,
  workspaceReferences,
} from '../../lib/plan-reference/workspace'
import { bindPlanWorkspacePointer } from '../../lib/plan-reference/workspace-pointer'
import { usePlanWorkspace } from '../../store/use-plan-workspace'
import { BalconyPreviewPlan, StandaloneBalconyPreview2D } from './balcony-preview'
import { useFloorplanRender } from './floorplan-render-context'

function PlanImage({
  url,
  ...props
}: {
  url: string
  x: number
  y: number
  width: number
  height: number
  opacity: number
}) {
  const resolved = useAssetUrl(url)
  return resolved ? <image href={resolved} {...props} /> : null
}

export function PlanWorkspace2D() {
  return (
    <>
      <StandaloneBalconyPreview2D />
      <PlanWorkspaceContent2D />
    </>
  )
}

function PlanWorkspaceContent2D() {
  const draft = usePlanWorkspace((s) => s.draft),
    hover = usePlanWorkspace((s) => s.hover)
  const levelId = useViewer((s) => s.selection.levelId)
  const root = useRef<SVGGElement>(null)
  const context = useFloorplanRender(),
    u = context?.unitsPerPixel ?? 0.05,
    rotation = context?.sceneRotationDeg ?? 0
  const { contours, nodes } = useWorkspacePreview(draft)
  const id = draft?.id
  useEffect(() => {
    const group = root.current,
      svg = group?.ownerSVGElement
    if (!id || !group || !svg) return
    const project = (point: PlanPoint) => {
      const matrix = group.getScreenCTM()
      if (!matrix) return null
      const p = svg.createSVGPoint()
      p.x = point[0]
      p.y = point[1]
      const screen = p.matrixTransform(matrix)
      return [screen.x, screen.y] as PlanPoint
    }
    return bindPlanWorkspacePointer({
      surface: svg,
      point: (e) => {
        const matrix = group.getScreenCTM()
        if (!matrix) return null
        const p = svg.createSVGPoint()
        p.x = e.clientX
        p.y = e.clientY
        const local = p.matrixTransform(matrix.inverse())
        return [local.x, local.y]
      },
      project,
      heightProject: (h, d) => {
        const p = project(h.point)
        return p && d.mode === 'shapes' ? [p[0], p[1] - (120 * h.height) / d.floorHeight] : p
      },
    })
  }, [id])
  if (!draft || draft.levelId !== levelId) return null
  const references = workspaceReferences(draft),
    handles = workspaceHandles(draft)
  const active = references.at(-1)!
  const measurements =
    draft.mode === 'references' && draft.stage !== 'adjust' ? activeReferencePoints(draft) : []
  const points = measurements.map((p) => imagePointToLevel(p, active.image, active.transform))
  const cursor =
    hover && draft.mode === 'references' && measurements.length === 1
      ? imagePointToLevel(hover, active.image, active.transform)
      : null
  const poly = (ps: PlanPoint[]) => ps.map((p) => p.join(',')).join(' ')
  return (
    <g ref={root} data-plan-workspace="" pointerEvents="none">
      {references.map((v) => {
        const width = v.image.width * v.transform.metersPerPixel,
          height = v.image.height * v.transform.metersPerPixel
        return (
          <g
            key={v.role}
            transform={`translate(${v.transform.position.join(' ')}) rotate(${(-v.transform.rotation * 180) / Math.PI})`}
          >
            <PlanImage
              url={v.image.url}
              x={-width / 2}
              y={-height / 2}
              width={width}
              height={height}
              opacity={v.opacity / 100}
            />
            <rect
              x={-width / 2}
              y={-height / 2}
              width={width}
              height={height}
              fill="none"
              stroke={v.role === 'floorplan' ? '#a78bfa' : '#94a3b8'}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      })}
      {contours.map((s) => {
        const selected = draft.mode === 'shapes' && draft.selected.includes(s.id)
        // Source strokes keep their authored width: the overlay must match the
        // plan's own linework, not collapse every line to one screen pixel.
        const sourceWidth = (s.strokeWidth ?? 1) * active.transform.metersPerPixel
        return (
          <path
            key={s.id}
            d={contourSvgPath(s)}
            fillRule="evenodd"
            fill={s.stroke ? 'none' : '#8b5cf6'}
            fillOpacity={selected ? 0.4 : 0.06}
            stroke="#8b5cf6"
            strokeOpacity={s.stroke && !selected ? 0.7 : 1}
            strokeWidth={s.stroke ? sourceWidth * (selected ? 1.5 : 1) : selected ? 2.5 : 1.2}
            vectorEffect={s.stroke ? undefined : 'non-scaling-stroke'}
          />
        )
      })}
      {draft.mode === 'shapes' && draft.kind === 'balcony' && <BalconyPreviewPlan nodes={nodes} />}
      {nodes.map((n) =>
        n.type === 'wall' ? (
          <line
            key={[...n.start, ...n.end].join(':')}
            x1={n.start[0]}
            y1={n.start[1]}
            x2={n.end[0]}
            y2={n.end[1]}
            stroke="#8b5cf6"
            strokeOpacity={0.6}
            strokeWidth={n.thickness}
          />
        ) : null,
      )}
      {points.length === 2 && (
        <polyline
          points={poly(points)}
          stroke="#7c3aed"
          strokeWidth={2}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {cursor && points[0] && (
        <>
          <line
            x1={points[0][0]}
            y1={points[0][1]}
            x2={cursor[0]}
            y2={cursor[1]}
            stroke="#7c3aed"
            strokeWidth={2}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
          {[
            [
              [0, hover![1]],
              [active.image.width, hover![1]],
            ],
            [
              [hover![0], 0],
              [hover![0], active.image.height],
            ],
          ].map((line, i) => (
            <polyline
              key={i}
              points={poly(
                line.map((p) => imagePointToLevel(p as PlanPoint, active.image, active.transform)),
              )}
              stroke="#7c3aed"
              opacity={0.4}
              strokeWidth={1}
              strokeDasharray="3 4"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </>
      )}
      {points.map((p, i) => (
        <g key={i} transform={`translate(${p.join(' ')}) rotate(${-rotation})`}>
          <circle r={5 * u} fill="#7c3aed" stroke="white" strokeWidth={1.5 * u} />
          <text
            x={9 * u}
            y={-9 * u}
            fontSize={12 * u}
            fill="#6d28d9"
            paintOrder="stroke"
            stroke="white"
            strokeWidth={3 * u}
          >
            {draft.mode === 'references' && draft.stage === 'measure' ? 'A' : 'B'}
            {i + 1}
          </text>
        </g>
      ))}
      {handles.map((h) => (
        <g key={h.id} transform={`translate(${h.point.join(' ')}) rotate(${-rotation})`}>
          {h.id === 'height' && draft.mode === 'shapes' && (
            <>
              <line y1={0} y2={-120 * u} stroke="#a78bfa" strokeWidth={2 * u} />
              <line
                x1={-9 * u}
                x2={9 * u}
                y1={-120 * u}
                y2={-120 * u}
                stroke="#a78bfa"
                strokeWidth={2 * u}
              />
            </>
          )}
          <g
            transform={
              h.id === 'height' && draft.mode === 'shapes'
                ? `translate(0 ${(-120 * u * h.height) / draft.floorHeight})`
                : undefined
            }
          >
            {h.id === 'scale' ? (
              <rect
                x={-5 * u}
                y={-5 * u}
                width={10 * u}
                height={10 * u}
                fill="#8b5cf6"
                stroke="white"
                strokeWidth={1.5 * u}
              />
            ) : (
              <circle
                r={h.id === 'anchor' ? 5 * u : 7 * u}
                fill={h.id === 'anchor' ? '#fbbf24' : '#8b5cf6'}
                stroke="white"
                strokeWidth={1.5 * u}
              />
            )}
            <text
              x={11 * u}
              y={4 * u}
              fontSize={11 * u}
              fill="#6d28d9"
              paintOrder="stroke"
              stroke="white"
              strokeWidth={3 * u}
            >
              {h.label}
            </text>
          </g>
        </g>
      ))}
    </g>
  )
}
