'use client'

import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  nodeRegistry,
} from '@pascal-app/core'
import { AlertTriangle, Box, Eye, EyeOff, Layers3, Loader2 } from 'lucide-react'
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type {
  FloorplanDraft,
  FloorplanFeatures,
  FloorplanMask,
  PlanPoint,
} from '../../lib/floorplan-import/schema'
import { floorplanDraftSchema } from '../../lib/floorplan-import/schema'
import {
  type FloorplanPreparedPreview,
  type FloorplanTarget,
  prepareFloorplanPreview,
} from '../../lib/floorplan-import/native'
import { cn } from '../../lib/utils'
import { FloorplanPreview, type FloorplanRenderStatus } from '../viewer/floorplan-preview'
import { Button } from './primitives/button'

export type FloorplanReviewMode = 'evidence' | 'semantic' | 'native'

export interface FloorplanReviewViewportProps {
  sourceUrl: string
  features: FloorplanFeatures | null
  masks: FloorplanMask[]
  draft: FloorplanDraft | null
  levelHeight: number
  target: FloorplanTarget | null
  mode: FloorplanReviewMode
  onNativePreviewReady?: (ready: boolean) => void
}

type SourceSize = { width: number; height: number }
type SemanticGroup = 'floor' | 'structure' | 'zones' | 'props'
type NativeGroup = SemanticGroup | 'dimensions'
type Presentation = 'top' | 'oblique' | 'exploded'

const GROUP_COLORS = {
  floor: '#2563eb',
  structure: '#e11d48',
  opening: '#ca8a04',
  zones: '#059669',
  props: '#9333ea',
  evidence: '#0284c7',
  axis: '#ea580c',
  region: '#7c3aed',
} as const

const EVIDENCE_LAYERS = [
  ['strokes', 'Observed strokes'],
  ['bands', 'Candidate bands'],
  ['axes', 'Region axes'],
  ['regions', 'Regions'],
  ['masks', 'SAM masks'],
] as const

const DEFAULT_SEMANTIC_GROUPS: Record<SemanticGroup, boolean> = {
  floor: true,
  structure: true,
  zones: true,
  props: true,
}
const DEFAULT_NATIVE_GROUPS: Record<NativeGroup, boolean> = {
  ...DEFAULT_SEMANTIC_GROUPS,
  dimensions: true,
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'The native floorplan preview could not be prepared.'
}

function sourceSize(
  features: FloorplanFeatures | null,
  draft: FloorplanDraft | null,
  masks: FloorplanMask[],
  natural: SourceSize | null,
): SourceSize | null {
  if (draft?.source?.width && draft.source.height) {
    return { width: draft.source.width, height: draft.source.height }
  }
  if (features?.width && features.height) {
    return { width: features.width, height: features.height }
  }
  const mask = masks[0]
  if (mask?.width && mask.height) return { width: mask.width, height: mask.height }
  return natural
}

function ToggleButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <Button
      aria-pressed={active}
      className="h-7 gap-1.5 px-2 text-[11px]"
      onClick={onClick}
      size="sm"
      type="button"
      variant={active ? 'secondary' : 'outline'}
    >
      {active ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
      {children}
    </Button>
  )
}

function EmptyPreview({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="grid min-h-72 place-items-center rounded-md border bg-muted/20 p-8 text-center">
      <div className="max-w-sm">
        <AlertTriangle className="mx-auto mb-3 size-5 text-muted-foreground" />
        <p className="font-medium text-sm">{title}</p>
        <p className="mt-1 text-muted-foreground text-xs">{detail}</p>
      </div>
    </div>
  )
}

function DrawingStage({
  children,
  onSourceSize,
  presentation = 'top',
  size,
  sourceUrl,
}: {
  children: ReactNode
  onSourceSize: (size: SourceSize) => void
  presentation?: Presentation
  size: SourceSize | null
  sourceUrl: string
}) {
  const [sourceError, setSourceError] = useState(false)
  const transform =
    presentation === 'oblique'
      ? 'perspective(1100px) rotateX(48deg) rotateZ(-2deg) scale(.9)'
      : undefined

  useEffect(() => {
    setSourceError(false)
  }, [sourceUrl])

  return (
    <div className="flex min-h-72 min-w-0 items-center justify-center overflow-hidden rounded-md border bg-muted/20 p-3">
      <div
        className="relative max-h-full w-full max-w-full origin-center overflow-visible bg-background shadow-sm transition-transform"
        style={{
          aspectRatio: size ? `${size.width} / ${size.height}` : undefined,
          transform,
          transformStyle: 'preserve-3d',
        }}
      >
        <img
          alt="Floorplan source"
          className={cn(
            'block size-full select-none object-fill',
            presentation === 'exploded' && 'opacity-70',
          )}
          draggable={false}
          onError={() => setSourceError(true)}
          onLoad={(event) => {
            setSourceError(false)
            const image = event.currentTarget
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              onSourceSize({ width: image.naturalWidth, height: image.naturalHeight })
            }
          }}
          src={sourceUrl}
        />
        {children}
        {sourceError ? (
          <div className="absolute inset-0 grid place-items-center bg-background/95 p-6 text-center text-destructive text-xs">
            The source image could not be decoded. Replace it before reviewing this coordinate space.
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SourceMismatchNotice({ natural, size }: { natural: SourceSize | null; size: SourceSize | null }) {
  if (!natural || !size || (natural.width === size.width && natural.height === size.height)) return null
  return (
    <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
      Source is {natural.width} × {natural.height}, but review coordinates are {size.width} × {size.height}.
      Overlays are shown in the declared coordinate space and must be corrected upstream before Apply.
    </p>
  )
}

function maskCaveat(mask: FloorplanMask): string {
  if (mask.coverage <= 0) return 'Empty mask — no foreground was returned.'
  if (mask.coverage >= 0.995) return 'Full-frame mask — inspect before using it as evidence.'
  return 'Coverage is foreground area, not semantic confidence.'
}

function EvidenceMode({
  features,
  masks,
  natural,
  onSourceSize,
  size,
  sourceUrl,
}: {
  features: FloorplanFeatures | null
  masks: FloorplanMask[]
  natural: SourceSize | null
  onSourceSize: (size: SourceSize) => void
  size: SourceSize | null
  sourceUrl: string
}) {
  const [groups, setGroups] = useState({ strokes: true, bands: true, axes: true, regions: true, masks: true })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const points = useMemo(
    () => new Map(features?.points.map((point) => [point.id, point.point]) ?? []),
    [features],
  )
  const validMasks = size
    ? masks.filter((mask) => mask.width === size.width && mask.height === size.height)
    : []
  const invalidMasks = masks.filter(
    (mask) => !size || mask.width !== size.width || mask.height !== size.height,
  )

  const inspectable = [
    ...(features?.lines.map((line) => ({
      id: line.id,
      label: line.id.startsWith('L') ? `Candidate band · ${line.width.toFixed(1)} px` : 'Observed stroke',
    })) ?? []),
    ...(features?.regions.map((region) => ({ id: region.id, label: 'Candidate region' })) ?? []),
  ]
  const bandCount = features?.lines.reduce((count, line) => count + Number(line.id.startsWith('L')), 0) ?? 0

  return (
    <div className="grid min-h-0 gap-2">
      <div aria-label="Evidence layers" className="flex flex-wrap gap-1.5" role="group">
        {EVIDENCE_LAYERS.map(([group, label]) => (
          <ToggleButton
            active={groups[group]}
            key={group}
            onClick={() => setGroups((current) => ({ ...current, [group]: !current[group] }))}
          >
            {label}
          </ToggleButton>
        ))}
      </div>
      <div className="grid min-h-0 gap-2 lg:grid-cols-[minmax(0,1fr)_13rem]">
        <DrawingStage onSourceSize={onSourceSize} size={size} sourceUrl={sourceUrl}>
          {size ? (
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
              preserveAspectRatio="none"
              viewBox={`0 0 ${size.width} ${size.height}`}
            >
              {groups.masks &&
                validMasks.map((mask, index) => (
                  <image
                    height={size.height}
                    href={mask.imageDataUrl}
                    key={mask.id}
                    opacity={0.2 + (index % 3) * 0.06}
                    preserveAspectRatio="none"
                    style={{ mixBlendMode: 'multiply' }}
                    width={size.width}
                  />
                ))}
              {groups.regions &&
                features?.regions.map((region) => {
                  const polygon = region.pointIds
                    .map((id) => points.get(id))
                    .filter((point): point is PlanPoint => point !== undefined)
                  const highlighted = selectedId === region.id
                  return polygon.length >= 3 ? (
                    <polygon
                      fill="rgba(124,58,237,.12)"
                      key={region.id}
                      points={polygon.map((point) => point.join(',')).join(' ')}
                      stroke={GROUP_COLORS.region}
                      strokeWidth={highlighted ? 4 : 2}
                    />
                  ) : (
                    <rect
                      fill="rgba(124,58,237,.12)"
                      height={region.depth}
                      key={region.id}
                      stroke={GROUP_COLORS.region}
                      strokeWidth={highlighted ? 4 : 2}
                      transform={`rotate(${(region.angle * 180) / Math.PI} ${region.center[0]} ${region.center[1]})`}
                      width={region.width}
                      x={region.center[0] - region.width / 2}
                      y={region.center[1] - region.depth / 2}
                    />
                  )
                })}
              {groups.axes &&
                features?.regions.map((region) => {
                  const half = Math.max(region.width, region.depth) / 2
                  const dx = Math.cos(region.angle) * half
                  const dy = Math.sin(region.angle) * half
                  return (
                    <line
                      key={`axis-${region.id}`}
                      stroke={GROUP_COLORS.axis}
                      strokeDasharray="7 5"
                      strokeWidth="2"
                      x1={region.center[0] - dx}
                      x2={region.center[0] + dx}
                      y1={region.center[1] - dy}
                      y2={region.center[1] + dy}
                    />
                  )
                })}
              {features?.lines.map((line) => {
                const candidate = line.id.startsWith('L')
                if (!(candidate ? groups.bands : groups.strokes)) return null
                const start = points.get(line.startId)
                const end = points.get(line.endId)
                if (!start || !end) return null
                const highlighted = selectedId === line.id
                return (
                  <g key={line.id} stroke={highlighted ? '#0f172a' : GROUP_COLORS.evidence}>
                    {candidate ? (
                      <line
                        strokeOpacity={highlighted ? 0.25 : 0.12}
                        strokeWidth={line.width}
                        x1={start[0]}
                        x2={end[0]}
                        y1={start[1]}
                        y2={end[1]}
                      />
                    ) : null}
                    <line
                      strokeDasharray={candidate ? '4 3' : undefined}
                      strokeWidth={highlighted ? 3 : 1}
                      x1={start[0]}
                      x2={end[0]}
                      y1={start[1]}
                      y2={end[1]}
                    />
                  </g>
                )
              })}
            </svg>
          ) : null}
        </DrawingStage>
        <aside className="grid content-start gap-2 overflow-auto rounded-md border bg-background p-2 text-xs lg:max-h-[34rem]">
          <SourceMismatchNotice natural={natural} size={size} />
          {!features ? (
            <p className="text-muted-foreground">No extracted feature ledger yet. The untouched source remains available.</p>
          ) : (
            <div>
              <p className="font-medium">Extracted evidence</p>
              <p className="text-muted-foreground">
                {features.lines.length - bandCount} observed strokes · {bandCount} candidate bands · {features.regions.length} regions · {features.points.length} points
              </p>
              <p className="mt-1 text-muted-foreground">
                Bands show measured width, not confirmed walls. Furniture outlines can also be candidates.
              </p>
            </div>
          )}
          {inspectable.length > 0 ? (
            <div className="grid max-h-44 gap-1 overflow-auto" aria-label="Evidence source IDs">
              {inspectable.map((entry) => (
                <button
                  aria-pressed={selectedId === entry.id}
                  className={cn(
                    'rounded border px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selectedId === entry.id && 'bg-accent',
                  )}
                  key={entry.id}
                  onClick={() => setSelectedId(entry.id)}
                  type="button"
                >
                  <span className="block font-medium">{entry.label}</span>
                  <code className="break-all text-[10px] text-muted-foreground">{entry.id}</code>
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <p className="font-medium">Semantic masks</p>
            {masks.length === 0 ? (
              <p className="text-muted-foreground">No SAM masks were returned. Classical evidence is still available; this is not a segmentation success.</p>
            ) : (
              masks.map((mask) => (
                <div className="rounded border p-2" key={mask.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{mask.label}</span>
                    <span className="tabular-nums text-muted-foreground">{(mask.coverage * 100).toFixed(1)}%</span>
                  </div>
                  <code className="block break-all text-[10px] text-muted-foreground">{mask.id}</code>
                  <p className="mt-1 text-[10px] text-muted-foreground">{maskCaveat(mask)}</p>
                  {mask.score !== null ? (
                    <p className="text-[10px] text-muted-foreground">Provider score: {mask.score.toFixed(3)}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
          {invalidMasks.length > 0 ? (
            <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive">
              {invalidMasks.length} mask{invalidMasks.length === 1 ? '' : 's'} do not match the source dimensions and are not overlaid.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

function polygonPath(rings: PlanPoint[][]): string {
  return rings
    .map((ring) => `M ${ring.map((point) => `${point[0]} ${point[1]}`).join(' L ')} Z`)
    .join(' ')
}

function openingLine(
  opening: FloorplanDraft['openings'][number],
  walls: Map<string, FloorplanDraft['walls'][number]>,
): { start: PlanPoint; end: PlanPoint } | null {
  const wall = walls.get(opening.wallId)
  if (!wall) return null
  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)
  if (length <= 0) return null
  const ux = dx / length
  const uy = dy / length
  const center: PlanPoint = [wall.start[0] + ux * opening.offset, wall.start[1] + uy * opening.offset]
  return {
    start: [center[0] - (ux * opening.width) / 2, center[1] - (uy * opening.width) / 2],
    end: [center[0] + (ux * opening.width) / 2, center[1] + (uy * opening.width) / 2],
  }
}

function layerStyle(presentation: Presentation, index: number): CSSProperties {
  if (presentation !== 'exploded') return {}
  return {
    filter: index > 0 ? 'drop-shadow(0 3px 2px rgb(15 23 42 / .18))' : undefined,
    transform: `translateY(${-index * 13}px)`,
    transition: 'transform 180ms ease',
  }
}

function SemanticMode({
  draft,
  levelHeight,
  natural,
  onSourceSize,
  size,
  sourceUrl,
}: {
  draft: FloorplanDraft | null
  levelHeight: number
  natural: SourceSize | null
  onSourceSize: (size: SourceSize) => void
  size: SourceSize | null
  sourceUrl: string
}) {
  const parsed = useMemo(() => (draft ? floorplanDraftSchema.safeParse(draft) : null), [draft])
  const [groups, setGroups] = useState(DEFAULT_SEMANTIC_GROUPS)
  const [presentation, setPresentation] = useState<Presentation>('oblique')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (!draft) {
    return <EmptyPreview title="No semantic proposal" detail="Run Interpret or Review to create a semantic draft. No geometry has been synthesized." />
  }
  if (!parsed?.success) {
    const issue = parsed?.error.issues[0]
    return (
      <EmptyPreview
        title="Semantic draft is invalid"
        detail={`${issue?.path.join('.') || 'draft'}: ${issue?.message ?? 'The draft does not satisfy the local schema.'}`}
      />
    )
  }

  const validDraft = parsed.data
  const walls = new Map(validDraft.walls.map((wall) => [wall.id, wall]))
  const entries = [
    { id: 'floor', label: 'Floor surface', group: 'floor', featureIds: [] as string[] },
    ...validDraft.walls.map((wall) => ({
      id: wall.id,
      label: 'Wall',
      group: 'structure',
      featureIds: wall.featureIds,
    })),
    ...validDraft.openings.map((opening) => ({
      id: opening.id,
      label: opening.kind,
      group: 'structure',
      featureIds: opening.featureIds,
    })),
    ...validDraft.zones.map((zone) => ({
      id: zone.id,
      label: zone.name,
      group: 'zones',
      featureIds: zone.featureIds,
    })),
    ...validDraft.items.map((item) => ({
      id: item.id,
      label: item.label,
      group: 'props',
      featureIds: item.featureIds,
    })),
  ]

  return (
    <div className="grid min-h-0 gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div aria-label="Semantic groups" className="flex flex-wrap gap-1.5" role="group">
          {(Object.keys(groups) as SemanticGroup[]).map((group) => (
            <ToggleButton
              active={groups[group]}
              key={group}
              onClick={() => setGroups((current) => ({ ...current, [group]: !current[group] }))}
            >
              {group === 'structure' ? 'Walls / openings' : group[0]!.toUpperCase() + group.slice(1)}
            </ToggleButton>
          ))}
        </div>
        <div aria-label="Semantic presentation" className="flex gap-1" role="group">
          {(['top', 'oblique', 'exploded'] as Presentation[]).map((view) => (
            <Button
              aria-pressed={presentation === view}
              className="h-7 px-2 text-[11px] capitalize"
              key={view}
              onClick={() => setPresentation(view)}
              size="sm"
              type="button"
              variant={presentation === view ? 'secondary' : 'outline'}
            >
              {view === 'exploded' ? <Layers3 className="size-3" /> : null}
              {view}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid min-h-0 gap-2 lg:grid-cols-[minmax(0,1fr)_13rem]">
        <DrawingStage
          onSourceSize={onSourceSize}
          presentation={presentation}
          size={size}
          sourceUrl={sourceUrl}
        >
          {size && groups.floor ? (
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
              preserveAspectRatio="none"
              style={layerStyle(presentation, 1)}
              viewBox={`0 0 ${size.width} ${size.height}`}
            >
              <path
                d={polygonPath([validDraft.floor.polygon, ...validDraft.floor.holes])}
                fill="rgba(37,99,235,.14)"
                fillRule="evenodd"
                stroke={selectedId === 'floor' ? '#0f172a' : GROUP_COLORS.floor}
                strokeWidth={selectedId === 'floor' ? 4 : 2}
              />
            </svg>
          ) : null}
          {size && groups.zones ? (
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
              preserveAspectRatio="none"
              style={layerStyle(presentation, 2)}
              viewBox={`0 0 ${size.width} ${size.height}`}
            >
              {validDraft.zones.map((zone) => (
                <g key={zone.id}>
                  <polygon
                    fill="rgba(5,150,105,.16)"
                    points={zone.polygon.map((point) => point.join(',')).join(' ')}
                    stroke={selectedId === zone.id ? '#0f172a' : GROUP_COLORS.zones}
                    strokeDasharray={zone.enclosed ? undefined : '8 5'}
                    strokeWidth={selectedId === zone.id ? 4 : 2}
                  />
                  <text
                    fill={GROUP_COLORS.zones}
                    fontSize={Math.max(10, Math.min(size.width, size.height) * 0.018)}
                    textAnchor="middle"
                    x={zone.polygon.reduce((sum, point) => sum + point[0], 0) / zone.polygon.length}
                    y={zone.polygon.reduce((sum, point) => sum + point[1], 0) / zone.polygon.length}
                  >
                    {zone.name}
                  </text>
                </g>
              ))}
            </svg>
          ) : null}
          {size && groups.structure ? (
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
              preserveAspectRatio="none"
              style={layerStyle(presentation, 3)}
              viewBox={`0 0 ${size.width} ${size.height}`}
            >
              {validDraft.walls.map((wall) => (
                <line
                  key={wall.id}
                  stroke={selectedId === wall.id ? '#0f172a' : GROUP_COLORS.structure}
                  strokeLinecap="round"
                  strokeWidth={selectedId === wall.id ? Math.max(5, wall.thickness + 3) : Math.max(2, wall.thickness)}
                  x1={wall.start[0]}
                  x2={wall.end[0]}
                  y1={wall.start[1]}
                  y2={wall.end[1]}
                />
              ))}
              {validDraft.openings.map((opening) => {
                const line = openingLine(opening, walls)
                if (!line) return null
                return (
                  <line
                    key={opening.id}
                    stroke={selectedId === opening.id ? '#0f172a' : GROUP_COLORS.opening}
                    strokeLinecap="round"
                    strokeWidth={selectedId === opening.id ? 8 : 6}
                    x1={line.start[0]}
                    x2={line.end[0]}
                    y1={line.start[1]}
                    y2={line.end[1]}
                  />
                )
              })}
            </svg>
          ) : null}
          {size && groups.props ? (
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
              preserveAspectRatio="none"
              style={layerStyle(presentation, 4)}
              viewBox={`0 0 ${size.width} ${size.height}`}
            >
              {validDraft.items.map((item) => (
                <g
                  key={item.id}
                  transform={`translate(${item.position[0]} ${item.position[1]}) rotate(${(item.rotation * 180) / Math.PI})`}
                >
                  <rect
                    fill="rgba(147,51,234,.18)"
                    height={item.depth}
                    stroke={selectedId === item.id ? '#0f172a' : GROUP_COLORS.props}
                    strokeWidth={selectedId === item.id ? 4 : 2}
                    width={item.width}
                    x={-item.width / 2}
                    y={-item.depth / 2}
                  />
                </g>
              ))}
            </svg>
          ) : null}
        </DrawingStage>
        <aside className="grid content-start gap-2 overflow-auto rounded-md border bg-background p-2 text-xs lg:max-h-[34rem]">
          <SourceMismatchNotice natural={natural} size={size} />
          <div>
            <p className="font-medium">Source-aligned proposal</p>
            <p className="text-muted-foreground">
              Coordinates remain source pixels. {levelHeight.toFixed(2)} m is presentation height only until scale is accepted.
            </p>
          </div>
          <div className="grid max-h-72 gap-1 overflow-auto" aria-label="Semantic source IDs">
            {entries.map((entry) => (
              <button
                aria-pressed={selectedId === entry.id}
                className={cn(
                  'rounded border px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selectedId === entry.id && 'bg-accent',
                )}
                key={`${entry.group}-${entry.id}`}
                onClick={() => setSelectedId(entry.id)}
                type="button"
              >
                <span className="block font-medium capitalize">{entry.label}</span>
                <code className="block break-all text-[10px] text-muted-foreground">{entry.id}</code>
                {entry.featureIds.length > 0 ? (
                  <span className="block break-all text-[10px] text-muted-foreground">
                    Evidence: {entry.featureIds.join(', ')}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}

function nodeGroup(node: AnyNode): NativeGroup | null {
  switch (node.type) {
    case 'slab':
      return 'floor'
    case 'wall':
    case 'door':
    case 'window':
      return 'structure'
    case 'zone':
      return 'zones'
    case 'item':
    case 'cabinet':
    case 'cabinet-module':
      return 'props'
    case 'construction-dimension':
      return 'dimensions'
    default:
      return null
  }
}

function buildNativeScene(
  preview: FloorplanPreparedPreview,
  target: FloorplanTarget,
  groups: Record<NativeGroup, boolean>,
): Record<string, AnyNode> {
  const included = new Set<string>()
  for (const node of Object.values(preview.nodes)) {
    const group = nodeGroup(node)
    if (group && groups[group]) included.add(node.id)
  }

  const nodes: Record<string, AnyNode> = Object.create(null)
  for (const node of Object.values(preview.nodes)) {
    if (!included.has(node.id)) continue
    if ('children' in node && Array.isArray(node.children)) {
      nodes[node.id] = {
        ...node,
        children: node.children.filter(
          (id): id is AnyNodeId => typeof id === 'string' && included.has(id),
        ),
      } as AnyNode
    } else {
      nodes[node.id] = node
    }
  }

  const topLevelIds = preview.topLevelIds.filter((id) => included.has(id))
  const level = LevelNode.parse({
    id: target.levelId,
    name: target.levelName,
    parentId: target.buildingId,
    children: topLevelIds,
    level: 0,
    height: target.levelHeight,
  })
  const building = BuildingNode.parse({
    id: target.buildingId,
    name: 'Floorplan preview',
    parentId: null,
    children: [level.id],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  })
  nodes[level.id] = level
  nodes[building.id] = building
  return nodes
}

function nativeAssetInventory(preview: FloorplanPreparedPreview): {
  urls: string[]
  missingNodeLabels: string[]
} {
  const urls = new Set<string>()
  const missingNodeLabels: string[] = []
  for (const node of Object.values(preview.nodes)) {
    if (node.type !== 'item') continue
    const url = node.asset.floorPlanUrl
    if (url) urls.add(url)
    else missingNodeLabels.push(node.name?.trim() || node.id)
  }
  return { urls: [...urls], missingNodeLabels }
}

function missingNativeRenderers(preview: FloorplanPreparedPreview): string[] {
  const missing = new Set<string>()
  for (const node of Object.values(preview.nodes)) {
    if (!nodeGroup(node)) continue
    if (!nodeRegistry.get(node.type)?.floorplan) missing.add(node.type)
  }
  return [...missing].sort()
}

function NativeMode({
  draft,
  levelHeight,
  onReady,
  target,
}: {
  draft: FloorplanDraft | null
  levelHeight: number
  onReady?: (ready: boolean) => void
  target: FloorplanTarget | null
}) {
  const [groups, setGroups] = useState(DEFAULT_NATIVE_GROUPS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [assetState, setAssetState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [assetError, setAssetError] = useState<string | null>(null)
  const [nativeRender, setNativeRender] = useState<{
    scene: Record<string, AnyNode> | null
    error: string | null
  }>({ scene: null, error: null })

  const prepared = useMemo<
    { preview: FloorplanPreparedPreview; error: null } | { preview: null; error: string }
  >(() => {
    if (!draft) return { preview: null, error: 'No reviewed draft is available for native preparation.' }
    if (!target) return { preview: null, error: 'The import target is unavailable.' }
    if (Math.abs(levelHeight - target.levelHeight) > 1e-9) {
      return {
        preview: null,
        error: 'The target level height changed. Review the updated target before preparing native geometry.',
      }
    }
    try {
      return { preview: prepareFloorplanPreview(draft, target), error: null }
    } catch (error) {
      return { preview: null, error: errorMessage(error) }
    }
  }, [draft, levelHeight, target])

  const assetInventory = useMemo(
    () =>
      prepared.preview
        ? nativeAssetInventory(prepared.preview)
        : { urls: [], missingNodeLabels: [] },
    [prepared.preview],
  )
  const rendererError = useMemo(() => {
    if (!prepared.preview) return null
    const missingRenderers = missingNativeRenderers(prepared.preview)
    const problems: string[] = []
    if (missingRenderers.length > 0) {
      problems.push(
        `Native renderers are unavailable for: ${missingRenderers.join(', ')}. Load Pascal's built-in node plugin before opening this review.`,
      )
    }
    if (assetInventory.missingNodeLabels.length > 0) {
      problems.push(
        `Actual catalog plan assets are missing for: ${assetInventory.missingNodeLabels.join(', ')}. Generic footprint fallbacks are not accepted for import review.`,
      )
    }
    return problems.length > 0 ? problems.join(' ') : null
  }, [assetInventory.missingNodeLabels, prepared.preview])

  const sceneNodes = useMemo(
    () =>
      prepared.preview && target ? buildNativeScene(prepared.preview, target, groups) : null,
    [groups, prepared.preview, target],
  )

  const handleRenderStatus = useCallback(
    (status: FloorplanRenderStatus) => {
      const failure = status.failures[0]
      setNativeRender({
        scene: sceneNodes,
        error: failure
          ? `Native ${failure.nodeType} renderer failed for ${failure.nodeId}: ${failure.message}`
          : null,
      })
    },
    [sceneNodes],
  )

  useEffect(() => {
    setAssetError(null)
    if (!prepared.preview || rendererError) {
      setAssetState('error')
      return
    }

    const urls = assetInventory.urls
    let cancelled = false
    setAssetState('loading')
    if (urls.length === 0) {
      const frame = requestAnimationFrame(() => {
        if (!cancelled) setAssetState('ready')
      })
      return () => {
        cancelled = true
        cancelAnimationFrame(frame)
      }
    }

    const images: HTMLImageElement[] = []
    Promise.all(
      urls.map(async (url) => {
        const image = new Image()
        images.push(image)
        image.decoding = 'async'
        image.src = url
        try {
          await image.decode()
        } catch {
          throw new Error(`Catalog plan asset failed to load: ${url}`)
        }
      }),
    )
      .then(() => {
        if (!cancelled) setAssetState('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setAssetState('error')
        setAssetError(errorMessage(error))
      })

    return () => {
      cancelled = true
      for (const image of images) {
        image.src = ''
      }
    }
  }, [assetInventory.urls, prepared.preview, rendererError])

  useEffect(() => {
    onReady?.(false)
    const renderedCurrentScene = nativeRender.scene === sceneNodes
    const allGroupsVisible = Object.values(groups).every(Boolean)
    if (
      !allGroupsVisible ||
      assetState !== 'ready' ||
      !prepared.preview ||
      !sceneNodes ||
      rendererError ||
      !renderedCurrentScene ||
      nativeRender.error
    )
      return
    const frame = requestAnimationFrame(() => onReady?.(true))
    return () => {
      cancelAnimationFrame(frame)
      onReady?.(false)
    }
  }, [assetState, groups, nativeRender, onReady, prepared.preview, rendererError, sceneNodes])

  if (!prepared.preview || !target) {
    return <EmptyPreview title="Native preview unavailable" detail={prepared.error ?? 'The import target is unavailable.'} />
  }
  if (rendererError) {
    return <EmptyPreview title="Native preview unavailable" detail={rendererError} />
  }

  if (!sceneNodes) {
    return <EmptyPreview title="Native preview unavailable" detail="The prepared native graph is empty." />
  }
  const mappings = Object.entries(prepared.preview.sourceToNative)

  return (
    <div className="grid min-h-0 gap-2">
      <div aria-label="Native preview groups" className="flex flex-wrap gap-1.5" role="group">
        {(Object.keys(groups) as NativeGroup[]).map((group) => (
          <ToggleButton
            active={groups[group]}
            key={group}
            onClick={() => setGroups((current) => ({ ...current, [group]: !current[group] }))}
          >
            {group === 'structure' ? 'Walls / openings' : group[0]!.toUpperCase() + group.slice(1)}
          </ToggleButton>
        ))}
      </div>
      {!Object.values(groups).every(Boolean) && (
        <p className="text-xs text-muted-foreground" role="status">
          Restore all native groups before Apply so every proposed object is checked.
        </p>
      )}
      <div className="grid min-h-0 gap-2 lg:grid-cols-[minmax(0,1fr)_13rem]">
        <div className="relative min-h-72 overflow-hidden rounded-md border bg-muted/20">
          {assetState === 'ready' ? (
            <>
              <FloorplanPreview
                className="absolute inset-0 size-full"
                levelId={target.levelId}
                navigationVisible
                onRenderStatus={handleRenderStatus}
                scene={{ nodes: sceneNodes }}
                showCompass={false}
                showLevelSelector={false}
                synchronizeNavigation={false}
              />
              {nativeRender.scene !== sceneNodes ? (
                <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/70 text-muted-foreground">
                  <div className="text-center">
                    <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
                    <p className="text-xs">Checking native floorplan builders…</p>
                  </div>
                </div>
              ) : nativeRender.error ? (
                <div className="absolute inset-0 grid place-items-center bg-background/95 p-6 text-center text-destructive">
                  <div>
                    <AlertTriangle className="mx-auto mb-2 size-5" />
                    <p className="text-xs">{nativeRender.error}</p>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="grid size-full min-h-72 place-items-center p-6 text-center text-muted-foreground">
              {assetState === 'loading' ? (
                <div>
                  <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
                  <p className="text-xs">Loading actual Pascal catalog plan assets…</p>
                </div>
              ) : (
                <div>
                  <AlertTriangle className="mx-auto mb-2 size-5" />
                  <p className="text-xs">{assetError ?? 'Native preview assets could not be loaded.'}</p>
                </div>
              )}
            </div>
          )}
        </div>
        <aside className="grid content-start gap-2 overflow-auto rounded-md border bg-background p-2 text-xs lg:max-h-[34rem]">
          <div>
            <div className="flex items-center gap-1.5 font-medium">
              <Box className="size-3.5" /> Native adapter graph
            </div>
            <p className="mt-1 text-muted-foreground">
              {prepared.preview.counts.walls} walls · {prepared.preview.counts.openings} openings ·{' '}
              {prepared.preview.counts.zones} zones · {prepared.preview.counts.items} props
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Read-only top view. It uses the same prepared nodes and Pascal floorplan builders as Apply; no scene or asset-save mutation occurs.
            </p>
          </div>
          <div className="grid max-h-72 gap-1 overflow-auto" aria-label="Native source mappings">
            {mappings.map(([sourceId, nativeIds]) => (
              <button
                aria-pressed={selectedId === sourceId}
                className={cn(
                  'rounded border px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selectedId === sourceId && 'bg-accent',
                )}
                key={sourceId}
                onClick={() => setSelectedId(sourceId)}
                type="button"
              >
                <code className="block break-all text-[10px] font-medium">{sourceId}</code>
                <span className="block break-all text-[10px] text-muted-foreground">
                  {nativeIds.join(', ')}
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}

export function FloorplanReviewViewport({
  sourceUrl,
  features,
  masks,
  draft,
  levelHeight,
  target,
  mode,
  onNativePreviewReady,
}: FloorplanReviewViewportProps) {
  const [natural, setNatural] = useState<SourceSize | null>(null)
  const size =
    mode === 'evidence'
      ? sourceSize(features, null, masks, natural)
      : sourceSize(null, draft, masks, natural)
  useEffect(() => {
    if (mode !== 'native' || !sourceUrl) onNativePreviewReady?.(false)
  }, [mode, onNativePreviewReady, sourceUrl])
  useEffect(() => {
    setNatural(null)
  }, [sourceUrl])

  if (!sourceUrl) {
    return <EmptyPreview title="Source unavailable" detail="Choose a source drawing before reviewing evidence." />
  }

  if (mode === 'evidence') {
    return (
      <EvidenceMode
        features={features}
        masks={masks}
        natural={natural}
        onSourceSize={setNatural}
        size={size}
        sourceUrl={sourceUrl}
      />
    )
  }

  if (mode === 'semantic') {
    return (
      <SemanticMode
        draft={draft}
        natural={natural}
        levelHeight={levelHeight}
        onSourceSize={setNatural}
        size={size}
        sourceUrl={sourceUrl}
      />
    )
  }
  return (
    <NativeMode
      draft={draft}
      levelHeight={levelHeight}
      onReady={onNativePreviewReady}
      target={target}
    />
  )
}
