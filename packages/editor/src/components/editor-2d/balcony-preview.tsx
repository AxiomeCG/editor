'use client'
import type { AnyNode } from '@pascal-app/core'
import { useBalconyPreview } from '../../lib/use-balcony-preview'

export function BalconyPreviewPlan({ nodes }: { nodes: AnyNode[] }) {
  return (
    <g pointerEvents="none" data-balcony-preview="">
      {nodes.map((n) => {
        if (n.type === 'slab') {
          const d = [n.polygon, ...n.holes]
            .map((loop) => `M${loop.map((p) => p.join(',')).join('L')}Z`)
            .join(' ')
          return (
            <path
              key={n.id}
              d={d}
              fill="#8b5cf6"
              fillOpacity={0.25}
              fillRule="evenodd"
              stroke="#8b5cf6"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )
        }
        if (n.type === 'fence')
          return (
            <line
              key={n.id}
              x1={n.start[0]}
              y1={n.start[1]}
              x2={n.end[0]}
              y2={n.end[1]}
              stroke="#7c3aed"
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
          )
        return null
      })}
    </g>
  )
}
export function StandaloneBalconyPreview2D() {
  const preview = useBalconyPreview()
  return <BalconyPreviewPlan nodes={preview.nodes} />
}
