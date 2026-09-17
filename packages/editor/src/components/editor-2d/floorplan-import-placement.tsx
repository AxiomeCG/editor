'use client'

import { useViewer } from '@pascal-app/viewer'
import { type PointerEvent, useRef } from 'react'
import useEditor, { isGridSnapActive } from '../../store/use-editor'
import { useFloorplanImportPlacement } from '../../store/use-floorplan-import-placement'
import useInteractionScope from '../../store/use-interaction-scope'

export function FloorplanImportPlacement2D() {
  const owner = useFloorplanImportPlacement((s) => s.owner)
  const target = useFloorplanImportPlacement((s) => s.target)
  const source = useFloorplanImportPlacement((s) => s.source)
  const placement = useFloorplanImportPlacement((s) => s.placement)
  const opacity = useFloorplanImportPlacement((s) => s.opacity)
  const levelId = useViewer((s) => s.selection.levelId)
  const wrapper = useRef<SVGGElement>(null)
  const drag = useRef<{
    owner: string
    x: number
    z: number
    startX: number
    startZ: number
  } | null>(null)
  const point = (event: PointerEvent<SVGImageElement>) => {
    const group = wrapper.current,
      svg = group?.ownerSVGElement,
      matrix = group?.getScreenCTM()
    if (!svg || !matrix) return null
    const value = svg.createSVGPoint()
    value.x = event.clientX
    value.y = event.clientY
    return value.matrixTransform(matrix.inverse())
  }
  if (!owner || !source || !target || target.levelId !== levelId) return null
  const width = source.width * source.metersPerPixel,
    depth = source.height * source.metersPerPixel
  return (
    <g ref={wrapper} data-floorplan-import-preview="">
      <g
        transform={`translate(${placement.x} ${placement.z}) rotate(${(-placement.rotation * 180) / Math.PI})`}
      >
        <image
          href={source.imageUrl}
          x={-width / 2}
          y={-depth / 2}
          width={width}
          height={depth}
          opacity={opacity / 100}
          style={{ cursor: 'move', pointerEvents: 'all', touchAction: 'none' }}
          aria-label="Drag the floorplan reference to position the import"
          onPointerDown={(event) => {
            if (useFloorplanImportPlacement.getState().committing || event.button !== 0) return
            const at = point(event)
            if (!at) return
            event.stopPropagation()
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { owner, x: placement.x, z: placement.z, startX: at.x, startZ: at.y }
            useInteractionScope
              .getState()
              .begin({ kind: 'handle-drag', nodeId: owner, handle: 'floorplan-import-position' })
          }}
          onPointerMove={(event) => {
            const active = drag.current,
              at = point(event)
            if (!active || !at || active.owner !== useFloorplanImportPlacement.getState().owner)
              return
            event.stopPropagation()
            let x = active.x + at.x - active.startX,
              z = active.z + at.y - active.startZ
            if (isGridSnapActive() && !event.altKey) {
              const step = useEditor.getState().gridSnapStep
              x = Math.round(x / step) * step
              z = Math.round(z / step) * step
            }
            useFloorplanImportPlacement.getState().move(owner, { x, z })
          }}
          onPointerUp={(event) => {
            if (!drag.current) return
            event.stopPropagation()
            drag.current = null
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId)
            useInteractionScope
              .getState()
              .endIf((scope) => scope.kind === 'handle-drag' && scope.nodeId === owner)
          }}
          onPointerCancel={() => {
            drag.current = null
            useInteractionScope
              .getState()
              .endIf((scope) => scope.kind === 'handle-drag' && scope.nodeId === owner)
          }}
        />
        <rect
          x={-width / 2}
          y={-depth / 2}
          width={width}
          height={depth}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      </g>
    </g>
  )
}
