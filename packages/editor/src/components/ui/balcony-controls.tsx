'use client'
import { useViewer } from '@pascal-app/viewer'
import { ArrowLeftRight } from 'lucide-react'
import type { BalconyOptions } from '@pascal-app/core/building'
import { SliderControl } from './controls/slider-control'
import { Button } from './primitives/button'

export function BalconyControls({
  value,
  onChange,
  edges = false,
  areaEdges = 0,
}: {
  value: BalconyOptions
  onChange: (value: BalconyOptions) => void
  edges?: boolean
  areaEdges?: number
}) {
  const materialsVisible = useViewer((s) => s.textures && s.shading === 'rendered')
  const number = (
    label: string,
    key: 'depth' | 'thickness' | 'railingHeight',
    min: number,
    max: number,
  ) => (
    <SliderControl
      label={label}
      value={value[key]}
      min={min}
      max={max}
      precision={2}
      step={0.05}
      unit="m"
      manageHistory={false}
      restoreOnCommit={false}
      liveText
      onChange={(n) => onChange({ ...value, [key]: n })}
    />
  )
  return (
    <div className="flex flex-col gap-1.5">
      {edges && (
        <>
          {number('Projection', 'depth', 0.2, 10)}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            aria-pressed={value.reverse}
            onClick={() => onChange({ ...value, reverse: !value.reverse })}
          >
            <ArrowLeftRight className="size-3.5" /> Flip side
          </Button>
        </>
      )}
      {number('Slab thickness', 'thickness', 0.02, 1)}
      <label className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
        Railing
        <select
          aria-label="Balcony railing"
          value={value.railing}
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-foreground"
          onChange={(e) =>
            onChange({ ...value, railing: e.target.value as BalconyOptions['railing'] })
          }
        >
          <option value="slat">Vertical bars</option>
          <option value="rail">Horizontal rails</option>
          <option value="glass">Glass</option>
          <option value="none">None</option>
        </select>
      </label>
      {value.railing !== 'none' && number('Railing height', 'railingHeight', 0.3, 3)}
      {value.railing === 'glass' && !materialsVisible && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => {
            useViewer.getState().setTextures(true)
            useViewer.getState().setShading('rendered')
          }}
        >
          Show glass materials
        </Button>
      )}
      {areaEdges > 0 && value.railing !== 'none' && (
        <label className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          Open edge
          <select
            aria-label="Balcony open edge"
            value={value.openEdge ?? ''}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-foreground"
            onChange={(e) =>
              onChange({
                ...value,
                openEdge: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          >
            <option value="">Auto · walls only</option>
            {Array.from({ length: areaEdges }, (_, i) => (
              <option key={i} value={i}>
                Edge {i + 1}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
