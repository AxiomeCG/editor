'use client'
import {
  bayCladdingRects,
  type FacadeBay,
  type FacadeBayPlacement,
  type FacadeOpeningPlacement,
  type FacadeUnit,
  type FacadeUnitResolution,
  resolveFacadeUnit,
} from '@pascal-app/core'
import { useId, useMemo, useRef } from 'react'
import { cn } from '../../../lib/utils'
import { materialSwatch } from './facade-material-field'

const RAILING_HEIGHT = 1.1
const SLAB_THICKNESS = 0.18
const MIN_RUN_WIDTH = 1

export function resolveElevation(
  unit: FacadeUnit,
  width: number,
  height: number,
): FacadeUnitResolution & { error: string | null } {
  try {
    return { ...resolveFacadeUnit(unit, { width, height }), error: null }
  } catch (error) {
    return { placements: [], skipped: 0, error: (error as Error).message }
  }
}

const metres = (value: number) => `${value.toFixed(2)} m`

/**
 * One run seen head-on, drawn from exactly what the resolver places. Corners
 * are the run's two ends; the selected bay's distances to them are dimensioned.
 */
export function FacadeElevation({
  unit,
  width,
  height,
  selectedBay = null,
  onSelectBay,
  onResize,
  compact = false,
  className,
}: {
  unit: FacadeUnit
  width: number
  height: number
  selectedBay?: string | null
  onSelectBay?: (key: string) => void
  onResize?: (width: number) => void
  compact?: boolean
  className?: string
}) {
  const svg = useRef<SVGSVGElement>(null)
  const resolution = useMemo(() => resolveElevation(unit, width, height), [unit, width, height])
  const pad = compact ? 0.3 : 0.8
  const below = compact ? 0.4 : 1.3
  // SVG y grows downwards; facade y grows up from the floor.
  const y = (up: number) => height - up
  const trimColor = materialSwatch(unit.paint.frame)?.color ?? '#d4d4d8'
  const paint = usePaintFills(unit)
  const wallFill = paint.fill(unit.paint.wall)
  const selected = resolution.placements.filter((p) => p.bay === selectedBay)

  const toRun = (clientX: number) => {
    const element = svg.current
    const matrix = element?.getScreenCTM()
    if (!element || !matrix) return null
    const point = element.createSVGPoint()
    point.x = clientX
    return point.matrixTransform(matrix.inverse()).x
  }

  return (
    <div className={cn('relative flex min-h-0 flex-col', className)}>
      <svg
        ref={svg}
        viewBox={`${-pad} ${-pad} ${width + pad * 2} ${height + pad + below}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full select-none"
        role="img"
        aria-label={`${unit.name}, ${metres(width)} run`}
      >
        {paint.defs}
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          className={cn('stroke-border', !wallFill && 'fill-neutral-600/60')}
          style={wallFill ? { fill: wallFill, fillOpacity: 0.7 } : undefined}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={-pad}
          x2={width + pad}
          y1={height}
          y2={height}
          className="stroke-muted-foreground"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {[0, width].map((x) => (
          <line
            key={x}
            x1={x}
            x2={x}
            y1={-0.15}
            y2={height}
            className="stroke-foreground"
            strokeWidth={3}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {selected.map((placement) => (
          <rect
            key={`span:${placement.key}`}
            x={placement.left}
            y={0}
            width={placement.right - placement.left}
            height={height}
            className="fill-primary/10 stroke-primary"
            strokeDasharray="4 3"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {resolution.placements.map((placement) => (
          <Placement
            key={placement.key}
            placement={placement}
            bay={unit.bays.find((b) => b.key === placement.bay)}
            runHeight={height}
            y={y}
            trim={trimColor}
            fill={paint.fill}
            selected={placement.bay === selectedBay}
          />
        ))}

        {onSelectBay &&
          resolution.placements.map((placement) => (
            <rect
              key={`hit:${placement.key}`}
              x={placement.left}
              y={-0.1}
              width={placement.right - placement.left}
              height={height + SLAB_THICKNESS + 0.1}
              fill="transparent"
              className="cursor-pointer"
              onClick={() => onSelectBay(placement.bay)}
            >
              <title>{unit.bays.find((m) => m.key === placement.bay)?.name ?? placement.bay}</title>
            </rect>
          ))}

        {!compact && (
          <>
            {selected.length > 0 && (
              <>
                <Dimension from={0} to={selected[0]!.left} at={height + 0.45} />
                <Dimension from={selected.at(-1)!.right} to={width} at={height + 0.45} />
              </>
            )}
            <Dimension from={0} to={width} at={height + 0.95} />
          </>
        )}

        {onResize && (
          <g
            className="cursor-ew-resize"
            onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
              const x = toRun(event.clientX)
              if (x !== null) onResize(Math.max(MIN_RUN_WIDTH, Math.round(x * 20) / 20))
            }}
          >
            <rect x={width - 0.12} y={height / 2 - 0.45} width={0.24} height={0.9} rx={0.08} className="fill-foreground" />
            <rect x={width - 0.3} y={0} width={0.6} height={height} fill="transparent">
              <title>Drag to change the run width</title>
            </rect>
          </g>
        )}
      </svg>
      {(resolution.error || resolution.skipped > 0) && !compact && (
        <p
          role={resolution.error ? 'alert' : 'status'}
          className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm"
        >
          {resolution.error ??
            `${resolution.skipped} ${resolution.skipped === 1 ? 'placement' : 'placements'} skipped: they would overlap an earlier bay.`}
        </p>
      )}
    </div>
  )
}

function Placement({
  placement,
  bay,
  runHeight,
  y,
  trim,
  fill,
  selected,
}: {
  placement: FacadeBayPlacement
  bay: FacadeBay | undefined
  runHeight: number
  y: (up: number) => number
  trim: string
  fill: (ref: string | undefined) => string | undefined
  selected: boolean
}) {
  const { opening, balcony } = placement
  return (
    <g opacity={selected ? 1 : 0.9}>
      {bay &&
        bayCladdingRects(bay, placement, runHeight).map((rect) => (
          <rect
            key={rect.part}
            x={rect.left}
            y={y(rect.top)}
            width={rect.right - rect.left}
            height={rect.top - rect.bottom}
            fill={fill(rect.cladding.material)}
            className="stroke-black/30"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      {opening && (
        <>
          <rect
            x={opening.left}
            y={y(opening.top)}
            width={opening.right - opening.left}
            height={opening.top - opening.bottom}
            fill="#9cc3d8"
            fillOpacity={0.9}
            stroke={trim}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {divisions(opening).map(([x1, y1, x2, y2]) => (
            <line
              key={`${x1}:${y1}:${x2}:${y2}`}
              x1={x1}
              x2={x2}
              y1={y(y1)}
              y2={y(y2)}
              stroke={trim}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </>
      )}
      {balcony && <Balcony left={balcony.left} right={balcony.right} railing={balcony.railing} y={y} />}
    </g>
  )
}

/**
 * Every paint the unit uses, as SVG fills: the catalog thumbnail tiled at a
 * metre, over its swatch colour. Ids are per instance; the card and the
 * studio draw the same unit at once.
 */
function usePaintFills(unit: FacadeUnit) {
  // `useId` returns characters a `url(#…)` reference would need escaped.
  const prefix = useId().replace(/[^\w-]/g, '')
  return useMemo(() => {
    const refs = [
      ...new Set(
        [unit.paint.wall, ...unit.bays.flatMap((bay) => [bay.infill?.material, bay.spandrel?.material])].filter(
          (ref): ref is string => !!ref,
        ),
      ),
    ]
    const fills = new Map<string, string>()
    const patterns = refs.flatMap((ref, index) => {
      const swatch = materialSwatch(ref)
      if (!swatch) return []
      if (!swatch.image) {
        fills.set(ref, swatch.color)
        return []
      }
      const id = `${prefix}paint-${index}`
      fills.set(ref, `url(#${id})`)
      return [
        <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={1} height={1}>
          <rect width={1} height={1} fill={swatch.color} />
          <image href={swatch.image} width={1} height={1} preserveAspectRatio="xMidYMid slice" />
        </pattern>,
      ]
    })
    return {
      defs: patterns.length ? <defs>{patterns}</defs> : null,
      fill: (ref: string | undefined) => (ref ? fills.get(ref) : undefined),
    }
  }, [unit, prefix])
}

/** Mullions and transoms of a window, or the meeting line of a two-leaf door, in run metres. */
function divisions(opening: FacadeOpeningPlacement): [number, number, number, number][] {
  const lines: [number, number, number, number][] = []
  const width = opening.right - opening.left
  const height = opening.top - opening.bottom
  const { style } = opening
  const columns =
    opening.kind === 'door'
      ? style.doorType === 'double' || (style.doorType === 'french' && width >= 1.1)
        ? 2
        : 1
      : style.columns
  const rows = opening.kind === 'door' ? 1 : style.rows
  for (let c = 1; c < columns; c++) {
    const x = opening.left + (width * c) / columns
    lines.push([x, opening.bottom, x, opening.top])
  }
  for (let r = 1; r < rows; r++) {
    const at = opening.bottom + (height * r) / rows
    lines.push([opening.left, at, opening.right, at])
  }
  return lines
}

function Balcony({
  left,
  right,
  railing,
  y,
}: {
  left: number
  right: number
  railing: 'slat' | 'rail' | 'glass'
  y: (up: number) => number
}) {
  const bars =
    railing === 'slat'
      ? Array.from({ length: Math.max(1, Math.floor((right - left) / 0.12)) }, (_, i) => left + 0.06 + i * 0.12)
      : []
  return (
    // Strokes are set per shape: 1 user unit here is a metre, and vector-effect is not inherited.
    <g className="stroke-neutral-200">
      <rect
        x={left}
        y={y(0)}
        width={right - left}
        height={SLAB_THICKNESS}
        className="fill-neutral-400"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {railing === 'glass' && (
        <rect
          x={left}
          y={y(RAILING_HEIGHT)}
          width={right - left}
          height={RAILING_HEIGHT}
          fill="#cfe6f2"
          fillOpacity={0.35}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <line x1={left} x2={right} y1={y(RAILING_HEIGHT)} y2={y(RAILING_HEIGHT)} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {railing === 'rail' &&
        [0.35, 0.7].map((h) => (
          <line key={h} x1={left} x2={right} y1={y(h)} y2={y(h)} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
      {bars.map((x) => (
        <line key={x} x1={x} x2={x} y1={y(RAILING_HEIGHT)} y2={y(0)} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      {[left, right].map((x) => (
        <line key={x} x1={x} x2={x} y1={y(RAILING_HEIGHT)} y2={y(0)} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ))}
    </g>
  )
}

function Dimension({ from, to, at }: { from: number; to: number; at: number }) {
  if (to - from < 0.005) return null
  return (
    <g className="stroke-muted-foreground text-muted-foreground">
      <line x1={from} x2={to} y1={at} y2={at} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {[from, to].map((x) => (
        <line key={x} x1={x} x2={x} y1={at - 0.12} y2={at + 0.12} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      <text
        x={(from + to) / 2}
        y={at - 0.1}
        textAnchor="middle"
        fontSize={0.2}
        className="fill-current stroke-none"
      >
        {metres(to - from)}
      </text>
    </g>
  )
}
