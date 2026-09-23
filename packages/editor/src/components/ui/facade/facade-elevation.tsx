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
import { bayColor } from './facade-bay-colors'
import { materialSwatch } from './facade-material-field'
import { type FacadeScenario, PARTITION_MARGIN, PARTITION_THICKNESS, scenarioRuns } from '@pascal-app/core/building'

const RAILING_HEIGHT = 1.1
const SLAB_THICKNESS = 0.18
const MIN_RUN_WIDTH = 1
const NO_PARTITIONS: readonly number[] = []

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

const BAND = { top: 0.05, height: 0.22 }

const shift = (placement: FacadeBayPlacement, by: number, run: number): FacadeBayPlacement => ({
  ...placement,
  key: `${run}:${placement.key}`,
  left: placement.left + by,
  right: placement.right + by,
  opening: placement.opening && {
    ...placement.opening,
    left: placement.opening.left + by,
    right: placement.opening.right + by,
    x: placement.opening.x + by,
  },
  balcony: placement.balcony && {
    ...placement.balcony,
    left: placement.balcony.left + by,
    right: placement.balcony.right + by,
  },
})

/**
 * The unit resolved in every run of a scenario, placed in wall metres: each
 * interior wall ends a run and the unit starts again beside it.
 */
export function resolveScenario(unit: FacadeUnit, scenario: FacadeScenario) {
  const runs = scenarioRuns(scenario)
  const placements: FacadeBayPlacement[] = []
  let skipped = 0
  let error: string | null = null
  runs.forEach((run, index) => {
    const resolved = resolveElevation(unit, run.end - run.start, scenario.height)
    placements.push(...resolved.placements.map((p) => shift(p, run.start, index)))
    skipped += resolved.skipped
    error ??= resolved.error
  })
  return { runs, placements, skipped, error }
}

/**
 * The facade seen head-on, drawn from exactly what the resolver places. Corners
 * and interior walls end its runs; the selected bay's distances to its run's
 * ends are dimensioned.
 */
export function FacadeElevation({
  unit,
  width,
  height,
  partitions = NO_PARTITIONS,
  onPartitionsChange,
  selectedBay = null,
  hoveredBay = null,
  onSelectBay,
  onHoverBay,
  onBayChange,
  onResize,
  compact = false,
  className,
}: {
  unit: FacadeUnit
  width: number
  height: number
  /** Interior walls meeting the facade, in metres from its left corner. */
  partitions?: readonly number[]
  onPartitionsChange?: (partitions: number[]) => void
  selectedBay?: string | null
  /** The bay under the pointer in any studio view. */
  hoveredBay?: string | null
  onSelectBay?: (key: string) => void
  onHoverBay?: (key: string | null) => void
  /** Makes the selected bay's children draggable: opening, panels and, when locked, its width. */
  onBayChange?: (bay: FacadeBay) => void
  onResize?: (width: number) => void
  compact?: boolean
  className?: string
}) {
  const svg = useRef<SVGSVGElement>(null)
  const resolution = useMemo(
    () => resolveScenario(unit, { width, height, partitions }),
    [unit, width, height, partitions],
  )
  const { runs } = resolution
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

        {/* Every bay's extent: outlined in its colour, filled when selected. Gaps are piers. */}
        {resolution.placements.map((placement) => {
          const color = bayColor(unit, placement.bay)
          const isSelected = placement.bay === selectedBay || placement.bay === hoveredBay
          return (
            <rect
              key={`span:${placement.key}`}
              x={placement.left}
              y={0}
              width={placement.right - placement.left}
              height={height}
              fill={color}
              fillOpacity={isSelected ? 0.14 : 0}
              stroke={color}
              strokeOpacity={isSelected ? 1 : 0.55}
              strokeDasharray="4 3"
              strokeWidth={isSelected ? 1.5 : 1}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}

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

        {resolution.placements.map((placement) => {
          const width = placement.right - placement.left
          const bay = unit.bays.find((b) => b.key === placement.bay)
          const isSelected = placement.bay === selectedBay
          return (
            <g key={`band:${placement.key}`}>
              <rect
                x={placement.left}
                y={height + BAND.top}
                width={width}
                height={compact ? BAND.height / 2 : BAND.height}
                rx={0.04}
                fill={bayColor(unit, placement.bay)}
                fillOpacity={selectedBay === null || isSelected ? 0.9 : 0.45}
              />
              {!compact && width > 0.5 && (
                <text
                  x={placement.left + width / 2}
                  y={height + BAND.top + BAND.height * 0.72}
                  textAnchor="middle"
                  fontSize={0.14}
                  className="pointer-events-none fill-neutral-950 font-medium"
                >
                  {bay?.name ?? placement.bay}
                </text>
              )}
            </g>
          )
        })}

        {onSelectBay &&
          resolution.placements.map((placement) => (
            <rect
              key={`hit:${placement.key}`}
              x={placement.left}
              y={-0.1}
              width={placement.right - placement.left}
              height={height + BAND.top + BAND.height + 0.1}
              fill="transparent"
              className="cursor-pointer"
              onPointerEnter={() => onHoverBay?.(placement.bay)}
              onPointerLeave={() => onHoverBay?.(null)}
              onClick={() => onSelectBay(placement.bay)}
            >
              <title>{unit.bays.find((m) => m.key === placement.bay)?.name ?? placement.bay}</title>
            </rect>
          ))}

        {partitions.map((x, index) => (
          <Partition
            // biome-ignore lint/suspicious/noArrayIndexKey: a partition's identity is its place in the list
            key={index}
            x={x}
            height={height}
            active={x >= PARTITION_MARGIN && x <= width - PARTITION_MARGIN}
            onMove={
              onPartitionsChange &&
              ((clientX) => {
                const at = toRun(clientX)
                if (at === null) return
                const next = [...partitions]
                next[index] = Math.min(
                  width - PARTITION_MARGIN,
                  Math.max(PARTITION_MARGIN, Math.round(at * 20) / 20),
                )
                onPartitionsChange(next)
              })
            }
            onRemove={
              onPartitionsChange && (() => onPartitionsChange(partitions.filter((_, i) => i !== index)))
            }
          />
        ))}

        {!compact && (
          <>
            {runs.length > 1
              ? runs.map((run) => (
                  <Dimension key={run.start} from={run.start} to={run.end} at={height + 0.6} />
                ))
              : selected.length > 0 && (
                  <>
                    <Dimension from={0} to={selected[0]!.left} at={height + 0.6} />
                    <Dimension from={selected.at(-1)!.right} to={width} at={height + 0.6} />
                  </>
                )}
            <Dimension from={0} to={width} at={height + 1.05} />
          </>
        )}

        {onBayChange && !compact && selected[0] && (
          <BayHandles
            bay={unit.bays.find((b) => b.key === selectedBay)!}
            placement={selected[0]}
            height={height}
            color={bayColor(unit, selected[0].bay)}
            toRun={toRun}
            onChange={onBayChange}
          />
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

const snap = (value: number) => Math.round(value * 20) / 20
const MIN_OPENING = 0.3
const MIN_PANEL = 0.05

/**
 * Handles on the selected bay's first placement, with each child's width read
 * out above the wall. Dragging edits the unit as the flex model reads it: in a
 * bay that hugs its content a wider panel or opening pushes the bay; in a
 * locked bay the opening stays centred and the panels fill what is left.
 */
function BayHandles({
  bay,
  placement,
  height,
  color,
  toRun,
  onChange,
}: {
  bay: FacadeBay
  placement: FacadeBayPlacement
  height: number
  color: string
  toRun: (clientX: number) => number | null
  onChange: (bay: FacadeBay) => void
}) {
  const hugs = bay.fit === 'content'
  const { opening } = placement
  // The drag in progress: where it started and how to turn a delta into a bay,
  // captured at pointer-down so each step measures from the start, not the last step.
  const drag = useRef<{ from: number; apply: (delta: number) => FacadeBay | null } | null>(null)
  const rects = bayCladdingRects(bay, placement, height)
  const panel = (part: string) => rects.find((rect) => rect.part === part)
  const infillLeft = panel('infill-left')
  const infillRight = panel('infill-right')
  const handleY = opening ? (opening.bottom + opening.top) / 2 : height / 2

  /** A draggable edge: `apply` gets how far the pointer moved, in metres. */
  const edge = (key: string, x: number, title: string, apply: (delta: number) => FacadeBay | null) => (
    <g
      key={key}
      className="cursor-ew-resize"
      onPointerDown={(event) => {
        const from = toRun(event.clientX)
        if (from === null) return
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { from, apply }
      }}
      onPointerMove={(event) => {
        const at = toRun(event.clientX)
        if (!drag.current || at === null) return
        const next = drag.current.apply(at - drag.current.from)
        if (next) onChange(next)
      }}
      onPointerUp={() => {
        drag.current = null
      }}
    >
      <rect
        x={x - 0.05}
        y={height - handleY - 0.3}
        width={0.1}
        height={0.6}
        rx={0.05}
        fill={color}
        stroke="#0a0a0a"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <rect x={x - 0.15} y={0} width={0.3} height={height} fill="transparent">
        <title>{title}</title>
      </rect>
    </g>
  )

  const widthOf = (from: number, to: number) => to - from
  // Dragging starts from the unit as it was when the pointer went down.
  const base = bay
  const openingWidth = opening ? widthOf(opening.left, opening.right) : 0
  const centred = !hugs && bay.opening?.widthMode === 'fixed'
  const withOpening = (width: number): FacadeBay | null =>
    base.opening ? { ...base, opening: { ...base.opening, width: Math.max(MIN_OPENING, snap(width)) } } : null
  const withPanel = (width: number): FacadeBay | null =>
    base.infill ? { ...base, infill: { ...base.infill, width: Math.max(MIN_PANEL, snap(width)) } } : null

  const labels = [
    infillLeft && { key: 'l', from: infillLeft.left, to: infillLeft.right },
    opening && { key: 'o', from: opening.left, to: opening.right },
    infillRight && { key: 'r', from: infillRight.left, to: infillRight.right },
  ].filter((label): label is { key: string; from: number; to: number } => !!label)

  return (
    <g>
      {labels.map((label) => (
        <text
          key={label.key}
          x={(label.from + label.to) / 2}
          y={-0.12}
          textAnchor="middle"
          fontSize={0.15}
          fill={color}
          className="pointer-events-none font-mono"
        >
          {(label.to - label.from).toFixed(2)}
        </text>
      ))}
      {opening &&
        bay.opening?.widthMode === 'fixed' && [
          edge('opening-left', opening.left, 'Drag to resize the opening', (d) =>
            withOpening(openingWidth - d * (centred ? 2 : 1)),
          ),
          edge('opening-right', opening.right, 'Drag to resize the opening', (d) =>
            withOpening(openingWidth + d * (centred ? 2 : 1)),
          ),
        ]}
      {infillLeft &&
        edge('infill-left', infillLeft.left, 'Drag to resize the panel', (d) =>
          withPanel(widthOf(infillLeft.left, infillLeft.right) - d),
        )}
      {infillRight &&
        edge('infill-right', infillRight.right, 'Drag to resize the panel', (d) =>
          withPanel(widthOf(infillRight.left, infillRight.right) + d),
        )}
      {!hugs &&
        bay.widthMode !== 'stretch' &&
        !infillRight &&
        edge('bay-right', placement.right, 'Drag to resize the bay', (d) => ({
          ...base,
          width: Math.max(MIN_OPENING, snap(placement.right - placement.left + d)),
        }))}
    </g>
  )
}

/** An interior wall meeting the facade: it ends a run. Drag to move, × to remove. */
function Partition({
  x,
  height,
  active,
  onMove,
  onRemove,
}: {
  x: number
  height: number
  active: boolean
  onMove?: (clientX: number) => void
  onRemove?: () => void
}) {
  const half = PARTITION_THICKNESS / 2
  return (
    <g opacity={active ? 1 : 0.35}>
      <rect
        x={x - half}
        y={0}
        width={PARTITION_THICKNESS}
        height={height}
        className="fill-amber-400/70 stroke-amber-300"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {onMove && (
        <rect
          x={x - 0.25}
          y={-0.1}
          width={0.5}
          height={height + 0.1}
          fill="transparent"
          className="cursor-ew-resize"
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) onMove(event.clientX)
          }}
        >
          <title>Interior wall at {metres(x)}: drag to move it</title>
        </rect>
      )}
      {onRemove && (
        <g
          role="button"
          aria-label={`Remove the interior wall at ${metres(x)}`}
          className="cursor-pointer"
          onClick={onRemove}
        >
          <circle cx={x} cy={-0.32} r={0.16} className="fill-amber-400" />
          <path
            d={`M${x - 0.06} ${-0.38}L${x + 0.06} ${-0.26}M${x + 0.06} ${-0.38}L${x - 0.06} ${-0.26}`}
            className="stroke-neutral-900"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
    </g>
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
