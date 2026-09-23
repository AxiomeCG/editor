'use client'
import { panelDepthOffset, type WallNode } from '@pascal-app/core'
import { useFacadePreview } from '../../lib/use-facade-preview'
import { BalconyPreviewPlan } from './balcony-preview'

/** A wall-local x and depth, in plan coordinates. The front face is the left normal. */
function planPoint(wall: WallNode, along: number, depth: number): [number, number] {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz) || 1
  const [ux, uz] = [dx / length, dz / length]
  return [wall.start[0] + ux * along - uz * depth, wall.start[1] + uz * along + ux * depth]
}

/** The plan twin of the 3D facade ghost: openings on the wall axis, panels on their face. */
export function StandaloneFacadePreview2D() {
  const preview = useFacadePreview()
  if (!preview.walls.length && !preview.balconies.length) return null
  return (
    <g pointerEvents="none" data-facade-preview="">
      {preview.walls.flatMap(({ wall, openings, panels }) => [
        ...openings.map((opening) => {
          const [x1, y1] = planPoint(wall, opening.position[0] - opening.width / 2, 0)
          const [x2, y2] = planPoint(wall, opening.position[0] + opening.width / 2, 0)
          return (
            <line
              key={opening.id}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#8b5cf6"
              strokeOpacity={0.55}
              strokeWidth={5}
              vectorEffect="non-scaling-stroke"
            />
          )
        }),
        ...panels.map((panel) => {
          const depth = panelDepthOffset(panel, wall)
          const [x1, y1] = planPoint(wall, panel.position[0] - panel.width / 2, depth)
          const [x2, y2] = planPoint(wall, panel.position[0] + panel.width / 2, depth)
          return (
            <line
              key={panel.id}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#8b5cf6"
              strokeOpacity={0.4}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          )
        }),
      ])}
      <BalconyPreviewPlan nodes={preview.balconies} />
    </g>
  )
}
