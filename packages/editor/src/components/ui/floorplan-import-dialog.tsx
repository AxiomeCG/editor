'use client'

import type { LevelNode } from '@pascal-app/core'
import {
  AlertTriangle,
  CheckCircle2,
  Crop,
  FileUp,
  Loader2,
  Ruler,
  X,
} from 'lucide-react'
import type {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  FloorplanAction,
  FloorplanFeatures,
  FloorplanMask,
  FloorplanRequest,
  FloorplanResponse,
  FloorplanDraft,
  FloorplanGenerator,
  FloorplanProgress,
  ImportIssue,
  PlanPoint,
} from '../../lib/floorplan-import/schema'
import { floorplanFeaturesSchema } from '../../lib/floorplan-import/schema'
import type {
  FloorplanImportResult,
  FloorplanTarget,
} from '../../lib/floorplan-import/native'
import {
  applyFloorplanImport,
  getFloorplanImportCatalog,
  inspectFloorplanImport,
} from '../../lib/floorplan-import/native'
import type {
  FloorplanCrop,
  FloorplanSource,
  PreparedFloorplanSource,
  RenderedFloorplanPage,
} from '../../lib/floorplan-import/source'
import { openFloorplanSource } from '../../lib/floorplan-import/source'
import { cn } from '../../lib/utils'
import { Button } from './primitives/button'
import { FloorplanReviewViewport } from './floorplan-review-viewport'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './primitives/dialog'

type ImportState =
  | 'choosing'
  | 'ready'
  | 'generating'
  | 'needs-input'
  | 'applying'
  | 'complete'
  | 'failed'

type FailureStep = 'source' | 'generate' | 'apply'
type CalibrationPoints = [PlanPoint | null, PlanPoint | null]
type ReviewStep = 'source' | FloorplanAction | 'native'
const WORKFLOW_STEPS: { id: ReviewStep; label: string }[] = [
  { id: 'source', label: 'Source' },
  { id: 'extract', label: 'Evidence' },
  { id: 'segment', label: 'Masks' },
  { id: 'interpret', label: 'Interpretation' },
  { id: 'review', label: 'Review' },
  { id: 'native', label: 'Native preview' },
]
const ACTION_ORDER: FloorplanAction[] = ['extract', 'segment', 'interpret', 'review']
type StageInput = Pick<FloorplanRequest, 'features' | 'masks' | 'candidateJson' | 'calibration'>

const EMPTY_CALIBRATION: CalibrationPoints = [null, null]
const PROGRESS_LABELS: Record<FloorplanProgress, string> = {
  extracting: 'Reading drawing',
  segmenting: 'Generating semantic masks',
  interpreting: 'Identifying elements',
  reviewing: 'Reviewing source evidence',
  checking: 'Checking floor',
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return 'The floorplan import failed. Try again or choose a different source.'
}

function reportedModelCost(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('modelCost' in error)) return null
  const cost = error.modelCost
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null
}

function getReviewIssues(draft: FloorplanDraft, target: FloorplanTarget): ImportIssue[] {
  const issues = [...draft.issues, ...inspectFloorplanImport(draft, target)]
  const unique = new Map<string, ImportIssue>()
  for (const issue of issues) unique.set(issue.id, issue)
  return [...unique.values()]
}

function getCalibration(points: CalibrationPoints, distanceText: string) {
  const [start, end] = points
  const distanceMeters = Number(distanceText)
  if (
    !start || !end || !Number.isFinite(distanceMeters) ||
    distanceMeters <= 0 || distanceMeters > 10000
  ) return null
  const pixelDistance = Math.hypot(end[0] - start[0], end[1] - start[1])
  if (pixelDistance < 2) return null
  return { start, end, distanceMeters, metersPerPixel: distanceMeters / pixelDistance }
}

function DraftOverlay({ draft }: { draft: FloorplanDraft }) {
  const wallsById = useMemo(
    () => new Map(draft.walls.map((wall) => [wall.id, wall])),
    [draft.walls],
  )
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      viewBox={`0 0 ${draft.source.width} ${draft.source.height}`}
    >
      <path
        d={[draft.floor.polygon, ...draft.floor.holes]
          .map((ring) => `M ${ring.map((point) => point.join(' ')).join(' L ')} Z`)
          .join(' ')}
        fill="rgba(59,130,246,0.08)"
        fillRule="evenodd"
        stroke="rgb(59,130,246)"
        strokeDasharray="8 5"
        strokeWidth="2"
      />
      {draft.zones.map((zone) => (
        <polygon
          fill="rgba(16,185,129,0.12)"
          key={`zone-${zone.id}`}
          points={zone.polygon.map((point) => point.join(',')).join(' ')}
          stroke="rgb(16,185,129)"
          strokeWidth="1.5"
        />
      ))}
      {draft.walls.map((wall) => (
        <line
          key={`wall-${wall.id}`}
          stroke="rgb(225,29,72)"
          strokeLinecap="round"
          strokeWidth={Math.max(2, wall.thickness)}
          x1={wall.start[0]}
          x2={wall.end[0]}
          y1={wall.start[1]}
          y2={wall.end[1]}
        />
      ))}
      {draft.openings.map((opening) => {
        const wall = wallsById.get(opening.wallId)
        if (!wall) return null
        const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
        if (wallLength === 0) return null
        const unitX = (wall.end[0] - wall.start[0]) / wallLength
        const unitY = (wall.end[1] - wall.start[1]) / wallLength
        const centerX = wall.start[0] + unitX * opening.offset
        const centerY = wall.start[1] + unitY * opening.offset
        return (
          <line
            key={`opening-${opening.id}`}
            stroke="rgb(250,204,21)"
            strokeLinecap="round"
            strokeWidth={Math.max(4, wall.thickness + 2)}
            x1={centerX - unitX * opening.width / 2}
            x2={centerX + unitX * opening.width / 2}
            y1={centerY - unitY * opening.width / 2}
            y2={centerY + unitY * opening.width / 2}
          />
        )
      })}
      {draft.items.map((item) => (
        <rect
          fill="rgba(168,85,247,0.18)"
          height={item.depth}
          key={`item-${item.id}`}
          stroke="rgb(147,51,234)"
          strokeWidth="1.5"
          transform={`rotate(${item.rotation * 180 / Math.PI} ${item.position[0]} ${item.position[1]})`}
          width={item.width}
          x={item.position[0] - item.width / 2}
          y={item.position[1] - item.depth / 2}
        />
      ))}
      {draft.dimensions.map((dimension) => (
        <line
          key={`dimension-${dimension.id}`}
          stroke="rgb(14,116,144)"
          strokeDasharray="4 3"
          strokeWidth="1.5"
          x1={dimension.baseline[0][0]}
          x2={dimension.baseline[1][0]}
          y1={dimension.baseline[0][1]}
          y2={dimension.baseline[1][1]}
        />
      ))}
    </svg>
  )
}

function CalibrationOverlay({ points }: { points: CalibrationPoints }) {
  const [start, end] = points
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
      {start && end && (
        <line
          stroke="rgb(37,99,235)"
          strokeDasharray="6 4"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          x1={`${start[0]}%`}
          x2={`${end[0]}%`}
          y1={`${start[1]}%`}
          y2={`${end[1]}%`}
        />
      )}
    </svg>
  )
}

function SourcePreview({
  source,
  draft,
  calibrationPoints,
  calibrationMode,
  onCalibrationPoint,
}: {
  source: PreparedFloorplanSource
  draft: FloorplanDraft | null
  calibrationPoints: CalibrationPoints
  calibrationMode: boolean
  onCalibrationPoint: (point: PlanPoint) => void
}) {
  const normalizedPoints = calibrationPoints.map((point) => point
    ? [point[0] / source.width * 100, point[1] / source.height * 100] as PlanPoint
    : null) as CalibrationPoints

  return (
    <div className="flex justify-center overflow-auto rounded-md border bg-muted/30 p-2">
      <button
        aria-label={calibrationMode
          ? 'Floorplan preview. Choose two reference points for scale calibration.'
          : 'Prepared floorplan preview'}
        className={cn(
          'relative inline-block max-w-full rounded-sm bg-white text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
          calibrationMode ? 'cursor-crosshair' : 'cursor-default',
        )}
        disabled={!calibrationMode}
        onClick={(event) => {
          if (!calibrationMode) return
          if (event.detail === 0) {
            onCalibrationPoint(calibrationPoints[0] && !calibrationPoints[1]
              ? [source.width * 0.75, source.height * 0.5]
              : [source.width * 0.25, source.height * 0.5])
            return
          }
          const bounds = event.currentTarget.getBoundingClientRect()
          onCalibrationPoint([
            (event.clientX - bounds.left) / bounds.width * source.width,
            (event.clientY - bounds.top) / bounds.height * source.height,
          ])
        }}
        style={{ width: `min(${source.width}px, ${46 * source.width / source.height}vh)` }}
        type="button"
      >
        <img
          alt="Prepared floorplan source"
          className="block h-auto w-full select-none"
          draggable={false}
          height={source.height}
          src={source.imageDataUrl}
          width={source.width}
        />
        {draft && <DraftOverlay draft={draft} />}
        <CalibrationOverlay points={normalizedPoints} />
        {normalizedPoints.map((point, index) => point && (
          <span
            className="pointer-events-none absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-blue-600 font-semibold text-[10px] text-white shadow"
            key={`calibration-${index}`}
            style={{ left: `${point[0]}%`, top: `${point[1]}%` }}
          >
            {index + 1}
          </span>
        ))}
      </button>
    </div>
  )
}

function CropEditor({
  rendered,
  crop,
  onCropChange,
}: {
  rendered: RenderedFloorplanPage
  crop: FloorplanCrop
  onCropChange: (crop: FloorplanCrop) => void
}) {
  const dragStart = useRef<PlanPoint | null>(null)

  const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>): PlanPoint => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return [
      Math.max(0, Math.min(rendered.width, (event.clientX - bounds.left) / bounds.width * rendered.width)),
      Math.max(0, Math.min(rendered.height, (event.clientY - bounds.top) / bounds.height * rendered.height)),
    ]
  }

  const updateDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return
    const point = pointFromEvent(event)
    const x = Math.min(dragStart.current[0], point[0])
    const y = Math.min(dragStart.current[1], point[1])
    onCropChange({
      x,
      y,
      width: Math.max(2, Math.abs(point[0] - dragStart.current[0])),
      height: Math.max(2, Math.abs(point[1] - dragStart.current[1])),
    })
  }

  return (
    <div className="grid gap-3">
      <div className="flex justify-center overflow-auto rounded-md border bg-muted/30 p-2">
        <div
          className="relative inline-block max-w-full cursor-crosshair touch-none"
          style={{ width: `min(${rendered.width}px, ${38 * rendered.width / rendered.height}vh)` }}
          onPointerCancel={() => { dragStart.current = null }}
          onPointerDown={(event) => {
            dragStart.current = pointFromEvent(event)
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={updateDrag}
          onPointerUp={(event) => {
            updateDrag(event)
            dragStart.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
        >
          <img
            alt="Original source sheet"
            className="block h-auto w-full select-none"
            draggable={false}
            height={rendered.height}
            src={rendered.previewDataUrl}
            width={rendered.width}
          />
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full"
            preserveAspectRatio="none"
            viewBox={`0 0 ${rendered.width} ${rendered.height}`}
          >
            <path
              d={`M0 0H${rendered.width}V${rendered.height}H0Z M${crop.x} ${crop.y}V${crop.y + crop.height}H${crop.x + crop.width}V${crop.y}Z`}
              fill="rgba(15,23,42,0.48)"
              fillRule="evenodd"
            />
            <rect
              fill="none"
              height={crop.height}
              stroke="rgb(59,130,246)"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
              width={crop.width}
              x={crop.x}
              y={crop.y}
            />
          </svg>
        </div>
      </div>
      <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <legend className="sr-only">Crop coordinates in source pixels</legend>
        {([
          ['x', 'Left', rendered.width - 2],
          ['y', 'Top', rendered.height - 2],
          ['width', 'Width', rendered.width - crop.x],
          ['height', 'Height', rendered.height - crop.y],
        ] as const).map(([key, label, max]) => (
          <label className="grid gap-1 text-xs" key={key}>
            <span className="text-muted-foreground">{label}</span>
            <input
              className="h-8 rounded-md border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              max={Math.max(2, Math.round(max))}
              min={key === 'width' || key === 'height' ? 2 : 0}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (!Number.isFinite(value)) return
                const minimum = key === 'width' || key === 'height' ? 2 : 0
                onCropChange({ ...crop, [key]: Math.max(minimum, Math.min(max, value)) })
              }}
              type="number"
              value={Math.round(crop[key])}
            />
          </label>
        ))}
      </fieldset>
    </div>
  )
}

function CalibrationControls({
  points,
  distance,
  width,
  height,
  active,
  disabled,
  onActiveChange,
  onDistanceChange,
  onPointsChange,
  onApply,
}: {
  points: CalibrationPoints
  distance: string
  width: number
  height: number
  active: boolean
  disabled: boolean
  onActiveChange: (active: boolean) => void
  onDistanceChange: (distance: string) => void
  onPointsChange: (points: CalibrationPoints) => void
  onApply: () => void
}) {
  const calibration = getCalibration(points, distance)
  const coordinateFields = [
    { label: 'Point 1 X', pointIndex: 0, axis: 0, max: width },
    { label: 'Point 1 Y', pointIndex: 0, axis: 1, max: height },
    { label: 'Point 2 X', pointIndex: 1, axis: 0, max: width },
    { label: 'Point 2 Y', pointIndex: 1, axis: 1, max: height },
  ] as const

  return (
    <section
      aria-disabled={disabled}
      aria-labelledby="floorplan-scale-title"
      className="grid gap-2 rounded-md border p-3"
    >
      <fieldset className="contents" disabled={disabled}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium text-sm" id="floorplan-scale-title">Known distance</h3>
            <p className="text-muted-foreground text-xs">Optional before generation; required if the drawing has no reliable scale.</p>
          </div>
          <Button
            aria-pressed={active}
            onClick={() => onActiveChange(!active)}
            size="sm"
            type="button"
            variant={active ? 'secondary' : 'outline'}
          >
            <Ruler /> {active ? 'Click two points' : 'Choose two points'}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {coordinateFields.map((field) => (
            <label className="grid gap-1 text-xs" key={field.label}>
              <span className="text-muted-foreground">{field.label}</span>
              <input
                aria-label={`${field.label} in pixels`}
                className="h-8 rounded-md border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                max={field.max}
                min={0}
                onChange={(event) => {
                  const next = [...points] as CalibrationPoints
                  const current = next[field.pointIndex] ?? [0, 0]
                  const input = Number(event.target.value)
                  const coordinate = Number.isFinite(input)
                    ? Math.min(field.max, Math.max(0, input))
                    : 0
                  next[field.pointIndex] = current.map((value, axis) =>
                    axis === field.axis ? coordinate : value) as PlanPoint
                  onPointsChange(next)
                }}
                placeholder="—"
                type="number"
                value={points[field.pointIndex]?.[field.axis] ?? ''}
              />
            </label>
          ))}
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Distance (m)</span>
            <input
              aria-describedby="floorplan-calibration-help"
              aria-invalid={
                distance !== '' &&
                (!Number.isFinite(Number(distance)) ||
                  Number(distance) <= 0 || Number(distance) > 10000)
              }
              className="h-8 rounded-md border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              max="10000"
              min="0.001"
              onChange={(event) => onDistanceChange(event.target.value)}
              placeholder="e.g. 4.2"
              step="0.001"
              type="number"
              value={distance}
            />
          </label>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground" id="floorplan-calibration-help">
            {calibration ? `${calibration.metersPerPixel.toFixed(5)} metres per pixel` : 'Select two distinct points and enter their real distance.'}
          </span>
          <div className="flex gap-2">
            {(points[0] || points[1]) && (
              <Button onClick={() => onPointsChange(EMPTY_CALIBRATION)} size="sm" type="button" variant="ghost">Clear</Button>
            )}
            <Button disabled={!calibration} onClick={onApply} size="sm" type="button" variant="outline">Use distance</Button>
          </div>
        </div>
      </fieldset>
    </section>
  )
}

export function FloorplanImportDialog({
  open,
  level,
  target,
  targetError,
  generateFloorplan,
  restoreFocusRef,
  onOpenChange,
  onApplied,
}: {
  open: boolean
  level: LevelNode
  target: FloorplanTarget | null
  targetError: string | null
  generateFloorplan?: FloorplanGenerator
  restoreFocusRef: RefObject<HTMLButtonElement | null>
  onOpenChange: (open: boolean) => void
  onApplied: (result: FloorplanImportResult) => void
}) {
  const [state, setState] = useState<ImportState>('choosing')
  const [source, setSource] = useState<FloorplanSource | null>(null)
  const [rendered, setRendered] = useState<RenderedFloorplanPage | null>(null)
  const [prepared, setPrepared] = useState<PreparedFloorplanSource | null>(null)
  const [page, setPage] = useState(1)
  const [crop, setCrop] = useState<FloorplanCrop | null>(null)
  const [editingCrop, setEditingCrop] = useState(false)
  const [calibrationPoints, setCalibrationPoints] = useState<CalibrationPoints>(EMPTY_CALIBRATION)
  const [calibrationDistance, setCalibrationDistance] = useState('')
  const [calibrationMode, setCalibrationMode] = useState(false)
  const [consent, setConsent] = useState(false)
  const [draft, setDraft] = useState<FloorplanDraft | null>(null)
  const [acceptedWarnings, setAcceptedWarnings] = useState<string[]>([])
  const [assumptionsConfirmed, setAssumptionsConfirmed] = useState(false)
  const [progress, setProgress] = useState<FloorplanProgress>('extracting')
  const [result, setResult] = useState<FloorplanImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failureStep, setFailureStep] = useState<FailureStep>('source')
  const [sourceBusy, setSourceBusy] = useState(false)
  const [activeStep, setActiveStep] = useState<ReviewStep>('source')
  const [features, setFeatures] = useState<FloorplanFeatures | null>(null)
  const [masks, setMasks] = useState<FloorplanMask[]>([])
  const [checkpoints, setCheckpoints] = useState<Partial<Record<FloorplanAction, FloorplanResponse>>>({})
  const [candidateJson, setCandidateJson] = useState<string | null>(null)
  const [artifactText, setArtifactText] = useState('')
  const [nativePreviewReady, setNativePreviewReady] = useState(false)
  const [lastAction, setLastAction] = useState<FloorplanAction>('extract')
  const [attempts, setAttempts] = useState<Array<{
    action: FloorplanAction
    durationMs: number
    cost: number | null
    models: string[]
    error: string | null
    input: StageInput
    output: FloorplanResponse | null
  }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const chooseFileButtonRef = useRef<HTMLButtonElement>(null)
  const sourceRef = useRef<FloorplanSource | null>(null)
  const sourceAttempt = useRef(0)
  const generationAttempt = useRef(0)
  const sourceAbort = useRef<AbortController | null>(null)
  const generationInFlight = useRef(false)
  const applyInFlight = useRef(false)
  const generationAbort = useRef<AbortController | null>(null)
  const pendingStage = useRef<{ action: FloorplanAction; started: number; input: StageInput } | null>(null)
  const catalog = useMemo(() => open ? getFloorplanImportCatalog() : [], [open])
  const catalogIds = useMemo(() => new Set(catalog.map((entry) => entry.id)), [catalog])

  const reviewIssues = useMemo(() => {
    if (!draft || !target) return []
    try {
      return getReviewIssues(draft, target)
    } catch (inspectionError) {
      return [{
        id: 'native-inspection-failed',
        message: errorMessage(inspectionError),
        severity: 'blocking' as const,
        relatedIds: [],
      }]
    }
  }, [draft, target])
  const blockingIssues = reviewIssues.filter((issue) => issue.severity === 'blocking')
  const warningIssues = reviewIssues.filter((issue) => issue.severity === 'warning')
  const warningsAccepted = warningIssues.every((issue) => acceptedWarnings.includes(issue.id))
  const unresolvedItems =
    draft?.items.filter((item) => item.assetId === null || !catalogIds.has(item.assetId)) ?? []

  const selectedCheckpoint = activeStep === 'source' || activeStep === 'native'
    ? null : checkpoints[activeStep] ?? null
  const inspectionDraft = activeStep === 'interpret' ? selectedCheckpoint?.draft ?? null : draft
  const busy = state === 'generating' || state === 'applying' || sourceBusy
  const remoteReady = !!generateFloorplan && !!target && !!prepared && consent && !busy
  const modelReady = remoteReady && !!features && features.points.length >= 3 &&
    features.lines.some((line) => line.id.startsWith('L')) && features.regions.length > 0
  const costSummary = useMemo(() => {
    let reported = 0
    let unknownAttempts = 0
    let remoteAttempts = 0
    for (const attempt of attempts) {
      if (attempt.action === 'extract') continue
      remoteAttempts += 1
      if (attempt.cost === null) unknownAttempts += 1
      else reported += attempt.cost
    }
    return { reported, unknownAttempts, remoteAttempts }
  }, [attempts])

  const clearWorkflow = useCallback(() => {
    setActiveStep('source')
    setFeatures(null)
    setMasks([])
    setCheckpoints({})
    setCandidateJson(null)
    setArtifactText('')
    setNativePreviewReady(false)
    pendingStage.current = null
  }, [])

  const selectStep = (step: ReviewStep) => {
    if (step === activeStep) return
    setActiveStep(step)
    setNativePreviewReady(false)
    setCalibrationMode(false)
    setArtifactText(step === 'extract' || step === 'segment'
      ? JSON.stringify(features, null, 2)
      : candidateJson ?? '')
  }

  const changeMasks = (nextMasks: FloorplanMask[]) => {
    setMasks(nextMasks)
    setCheckpoints((current) => ({ ...current, interpret: undefined, review: undefined }))
    setCandidateJson(null)
    setDraft(null)
    setNativePreviewReady(false)
    setAcceptedWarnings([])
    setAssumptionsConfirmed(false)
  }

  const useArtifactEdits = () => {
    try {
      if (activeStep === 'extract' || activeStep === 'segment') {
        const decoded: unknown = JSON.parse(artifactText)
        const parsed = floorplanFeaturesSchema.safeParse(decoded)
        if (!parsed.success) throw new Error(parsed.error.issues.slice(0, 4)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
        if (parsed.data.width !== prepared?.width || parsed.data.height !== prepared.height) {
          throw new Error('Evidence dimensions must match the prepared source image.')
        }
        setFeatures(parsed.data)
        setMasks([])
        setCheckpoints((current) => ({
          extract: current.extract ? { ...current.extract, features: parsed.data } : undefined,
        }))
        setCandidateJson(null)
        setActiveStep('extract')
      } else {
        if (artifactText.trim().length === 0) {
          throw new Error('The retained proposal text cannot be empty.')
        }
        setCandidateJson(artifactText)
        setCheckpoints((current) => ({ ...current, review: undefined }))
        setActiveStep('interpret')
      }
      setDraft(null)
      setNativePreviewReady(false)
      setAcceptedWarnings([])
      setAssumptionsConfirmed(false)
      setError(null)
      setState('needs-input')
    } catch (editError) {
      setError(errorMessage(editError))
    }
  }

  const downloadInspection = () => {
    const data = {
      source: prepared ? {
        name: source?.fileName, page: prepared.page, width: prepared.width,
        height: prepared.height, crop: prepared.crop, imageDataUrl: prepared.imageDataUrl,
      } : null,
      target, calibration: getCalibration(calibrationPoints, calibrationDistance),
      features, masks, checkpoints, candidateJson, draft, attempts,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'floorplan-inspection.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const invalidateGeneratedResult = () => {
    generationInFlight.current = false
    generationAttempt.current += 1
    generationAbort.current?.abort()
    clearWorkflow()
    setDraft(null)
    setResult(null)
    setAcceptedWarnings([])
    setAssumptionsConfirmed(false)
    setError(null)
    setState(prepared ? 'ready' : 'choosing')
  }

  const disposeSource = useCallback(() => {
    sourceAttempt.current += 1
    sourceAbort.current?.abort()
    sourceAbort.current = null
    const current = sourceRef.current
    sourceRef.current = null
    setSource(null)
    if (current) void current.dispose()
  }, [])

  useEffect(() => {
    if (open) {
      clearWorkflow()
      setAttempts([])
      setState('choosing')
      setSourceBusy(false)
      setRendered(null)
      setPrepared(null)
      setPage(1)
      setCrop(null)
      setEditingCrop(false)
      setCalibrationPoints(EMPTY_CALIBRATION)
      setCalibrationDistance('')
      setCalibrationMode(false)
      setConsent(false)
      setDraft(null)
      setAcceptedWarnings([])
      setAssumptionsConfirmed(false)
      setResult(null)
      setError(null)
      setFailureStep('source')
      return
    }

    generationAttempt.current += 1
    generationAbort.current?.abort()
    generationAbort.current = null
    generationInFlight.current = false
    setState('choosing')
    setSourceBusy(false)
    setRendered(null)
    setPrepared(null)
    setDraft(null)
    setResult(null)
    setError(null)
    disposeSource()
  }, [open, disposeSource, clearWorkflow])

  useEffect(() => () => {
    generationAbort.current?.abort()
    sourceAbort.current?.abort()
    if (sourceRef.current) void sourceRef.current.dispose()
  }, [])

  const prepareRendered = async (
    activeSource: FloorplanSource,
    nextRendered: RenderedFloorplanPage,
    nextCrop: FloorplanCrop | null,
    attempt: number,
  ) => {
    const nextPrepared = await activeSource.preparePage(nextRendered, nextCrop)
    if (attempt !== sourceAttempt.current) return
    setPrepared(nextPrepared)
    setState('ready')
    setError(null)
  }

  const renderPage = async (activeSource: FloorplanSource, nextPage: number) => {
    const attempt = ++sourceAttempt.current
    sourceAbort.current?.abort()
    const controller = new AbortController()
    sourceAbort.current = controller
    setSourceBusy(true)
    setError(null)
    clearWorkflow()
    setRendered(null)
    setPrepared(null)
    setCrop(null)
    setConsent(false)
    setEditingCrop(false)
    setCalibrationPoints(EMPTY_CALIBRATION)
    setCalibrationDistance('')
    setDraft(null)
    setResult(null)
    setState('choosing')
    let nextRendered: RenderedFloorplanPage | null = null
    try {
      nextRendered = await activeSource.renderPage(nextPage, controller.signal)
      if (attempt !== sourceAttempt.current || controller.signal.aborted) return
      setRendered(nextRendered)
      await prepareRendered(activeSource, nextRendered, null, attempt)
    } catch (sourceError) {
      if (controller.signal.aborted || attempt !== sourceAttempt.current) return
      if (nextRendered) {
        setCrop({
          x: nextRendered.width * 0.1,
          y: nextRendered.height * 0.1,
          width: nextRendered.width * 0.8,
          height: nextRendered.height * 0.8,
        })
        setEditingCrop(true)
      }
      setError(errorMessage(sourceError))
      setFailureStep('source')
      setState('failed')
    } finally {
      if (attempt === sourceAttempt.current) setSourceBusy(false)
    }
  }

  const chooseFile = async (file: File) => {
    disposeSource()
    clearWorkflow()
    setRendered(null)
    setPrepared(null)
    setDraft(null)
    setResult(null)
    setError(null)
    setConsent(false)
    setState('choosing')
    setSourceBusy(true)
    const attempt = ++sourceAttempt.current
    try {
      const nextSource = await openFloorplanSource(file)
      if (attempt !== sourceAttempt.current) {
        await nextSource.dispose()
        return
      }
      sourceRef.current = nextSource
      setSource(nextSource)
      setPage(1)
      await renderPage(nextSource, 1)
    } catch (sourceError) {
      if (attempt !== sourceAttempt.current) return
      setError(errorMessage(sourceError))
      setFailureStep('source')
      setState('failed')
      setSourceBusy(false)
    }
  }

  const applyCrop = async (nextCrop: FloorplanCrop | null) => {
    if (!source || !rendered) return
    const attempt = ++sourceAttempt.current
    setSourceBusy(true)
    setError(null)
    setConsent(false)
    invalidateGeneratedResult()
    setCalibrationPoints(EMPTY_CALIBRATION)
    setCalibrationDistance('')
    try {
      const nextPrepared = await source.preparePage(rendered, nextCrop)
      if (attempt !== sourceAttempt.current) return
      setCrop(nextPrepared.crop)
      setPrepared(nextPrepared)
      setEditingCrop(false)
      setState('ready')
    } catch (cropError) {
      if (attempt !== sourceAttempt.current) return
      setError(errorMessage(cropError))
      if (prepared) {
        setState('ready')
      } else {
        setFailureStep('source')
        setState('failed')
      }
    } finally {
      if (attempt === sourceAttempt.current) setSourceBusy(false)
    }
  }

  const applyCalibration = () => {
    const calibration = getCalibration(calibrationPoints, calibrationDistance)
    if (!calibration) return
    setCalibrationMode(false)
    if (!draft) return
    setDraft({
      ...draft,
      source: {
        ...draft.source,
        metersPerPixel: calibration.metersPerPixel,
        scaleSource: 'user',
      },
    })
    setAcceptedWarnings([])
    setNativePreviewReady(false)
    setAssumptionsConfirmed(false)
    setState('needs-input')
  }

  const commitDraft = async (candidate: FloorplanDraft, warningIds: string[]) => {
    if (
      !target || !prepared || applyInFlight.current || !checkpoints.review ||
      !nativePreviewReady || activeStep !== 'native' ||
      state === 'applying' || state === 'complete'
    ) return
    let currentIssues: ImportIssue[]
    try {
      currentIssues = getReviewIssues(candidate, target)
    } catch (inspectionError) {
      setError(errorMessage(inspectionError))
      setFailureStep('apply')
      setState('failed')
      return
    }
    if (currentIssues.some((issue) => issue.severity === 'blocking')) {
      setDraft(candidate)
      setState('needs-input')
      return
    }
    const unacceptedWarning = currentIssues.some(
      (issue) => issue.severity === 'warning' && !warningIds.includes(issue.id),
    )
    if (unacceptedWarning) {
      setDraft(candidate)
      setState('needs-input')
      return
    }

    applyInFlight.current = true
    setState('applying')
    setError(null)
    try {
      const imported = await applyFloorplanImport({
        draft: candidate,
        target,
        sourceFile: prepared.sourceFile,
        acceptedWarnings: warningIds,
      })
      setResult(imported)
      setState('complete')
      onApplied(imported)
    } catch (applyError) {
      setError(errorMessage(applyError))
      setFailureStep('apply')
      setState('failed')
    } finally {
      applyInFlight.current = false
    }
  }

  const generate = async (action: FloorplanAction) => {
    if (
      !generateFloorplan || !target || !prepared ||
      (action !== 'extract' && !consent) ||
      generationInFlight.current || applyInFlight.current ||
      (action !== 'extract' && !features) ||
      (action === 'review' && !candidateJson?.trim())
    ) return
    generationInFlight.current = true
    const calibration = getCalibration(calibrationPoints, calibrationDistance)
    const attempt = ++generationAttempt.current
    const started = performance.now()
    const input: StageInput = {
      features: action === 'extract' ? null : features,
      masks: action === 'extract' ? [] : masks,
      candidateJson: action === 'review' ? candidateJson : null,
      calibration: calibration ? {
        start: calibration.start, end: calibration.end, distanceMeters: calibration.distanceMeters,
      } : null,
    }
    pendingStage.current = { action, started, input }
    generationAbort.current?.abort()
    const controller = new AbortController()
    generationAbort.current = controller
    setLastAction(action)
    setState('generating')
    setProgress(action === 'segment' ? 'segmenting' : action === 'interpret'
      ? 'interpreting' : action === 'review' ? 'reviewing' : 'extracting')
    setError(null)
    setDraft(null)
    setResult(null)
    setAcceptedWarnings([])
    setAssumptionsConfirmed(false)
    setNativePreviewReady(false)
    setCheckpoints((current) => Object.fromEntries(Object.entries(current)
      .filter(([key]) => ACTION_ORDER.indexOf(key as FloorplanAction) < ACTION_ORDER.indexOf(action))))
    if (action === 'extract') {
      setFeatures(null)
      setMasks([])
    }
    if (action !== 'review') setCandidateJson(null)
    try {
      const response = await generateFloorplan({
        action,
        imageDataUrl: prepared.imageDataUrl,
        name: (source?.fileName || prepared.sourceFile.name).slice(0, 200),
        page: prepared.page,
        ...input,
        levelHeight: target.levelHeight,
        catalog,
        consent,
      }, {
        signal: controller.signal,
        onProgress: (nextProgress) => {
          if (attempt === generationAttempt.current && !controller.signal.aborted) setProgress(nextProgress)
        },
      })
      if (attempt !== generationAttempt.current || controller.signal.aborted) return
      if (response.stage !== action) throw new Error('The server returned a different processing stage. No result was applied.')
      setFeatures(response.features)
      setMasks(response.masks)
      setCheckpoints((current) => ({ ...current, [action]: response }))
      setCandidateJson(response.candidateJson)
      setDraft(response.draft)
      setActiveStep(action)
      setArtifactText(response.candidateJson ?? JSON.stringify(response.features, null, 2))
      setAttempts((current) => [...current, {
        action, durationMs: performance.now() - started,
        cost: response.usage.cost, models: response.usage.models, error: null, input, output: response,
      }])
      setState('needs-input')
    } catch (generationError) {
      if (controller.signal.aborted || attempt !== generationAttempt.current) return
      const message = errorMessage(generationError)
      setAttempts((current) => [...current, {
        action, durationMs: performance.now() - started, cost: action === 'extract' ? 0 : reportedModelCost(generationError), models: [], error: message, input, output: null,
      }])
      setError(message)
      setFailureStep('generate')
      setState('failed')
    } finally {
      if (attempt === generationAttempt.current) {
        generationInFlight.current = false
        pendingStage.current = null
      }
    }
  }

  const stopStage = () => {
    const pending = pendingStage.current
    if (pending) setAttempts((current) => [...current, {
      action: pending.action, durationMs: performance.now() - pending.started,
      cost: pending.action === 'extract' ? 0 : null, models: [], error: 'Stopped by user',
      input: pending.input, output: null,
    }])
    pendingStage.current = null
    generationAttempt.current += 1
    generationAbort.current?.abort()
    generationInFlight.current = false
    setState(prepared ? 'needs-input' : 'choosing')
    setError('Stage stopped. Earlier evidence remains available. The provider may still charge for work already started.')
  }

  const requestClose = () => {
    if (state === 'applying') return
    generationAttempt.current += 1
    generationAbort.current?.abort()
    generationInFlight.current = false
    onOpenChange(false)
  }

  const fileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void chooseFile(file)
  }

  const retry = () => {
    if (failureStep === 'apply' && draft) {
      void commitDraft(draft, acceptedWarnings)
    } else if (failureStep === 'generate') {
      void generate(lastAction)
    } else {
      fileInputRef.current?.click()
    }
  }

  const canConfirmReview =
    !!draft && blockingIssues.length === 0 && warningsAccepted && unresolvedItems.length === 0 &&
    (draft.assumptions.length === 0 || assumptionsConfirmed)

  return (
    <Dialog onOpenChange={(nextOpen) => { if (!nextOpen) requestClose() }} open={open}>
      <DialogContent
        aria-busy={state === 'generating' || state === 'applying' || sourceBusy}
        className="flex max-h-[calc(100vh-2rem)] w-[min(96vw,1200px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          restoreFocusRef.current?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (state === 'applying') event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (state === 'applying') event.preventDefault()
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          chooseFileButtonRef.current?.focus()
        }}
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-14">
          <DialogTitle>Import from floorplan — {target?.levelName ?? level.name}</DialogTitle>
          <DialogDescription>
            Inspect each step before creating editable Pascal nodes. Nothing is added to the floor until you select Apply.
          </DialogDescription>
          <button
            aria-label="Close floorplan import"
            className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={state === 'applying'}
            onClick={requestClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </DialogHeader>

        {state !== 'complete' && (
          <nav aria-label="Floorplan import steps" className="flex shrink-0 gap-1 overflow-x-auto border-b px-4 py-2">
            {WORKFLOW_STEPS.map((step, index) => (
              <Button
                aria-current={activeStep === step.id ? 'step' : undefined}
                disabled={busy || (step.id !== 'source' && (step.id === 'native'
                  ? !draft || !checkpoints.review
                  : step.id === 'segment' ? !features : !checkpoints[step.id]))}
                key={step.id}
                onClick={() => selectStep(step.id)}
                size="sm"
                type="button"
                variant={activeStep === step.id ? 'secondary' : 'ghost'}
              >
                <span className="tabular-nums text-muted-foreground">{index + 1}</span> {step.label}
              </Button>
            ))}
          </nav>
        )}

        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-4">
            {targetError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm" role="alert">
                {targetError}
              </div>
            )}
            {!generateFloorplan && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">
                <div className="font-medium">Floorplan generation is unavailable in this editor.</div>
                <div className="mt-1 text-muted-foreground">Configure the editor host with a server-side OPENROUTER_API_KEY and its floorplan generation callback. No drawing will be uploaded.</div>
              </div>
            )}
            {target && (
              <dl className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border bg-muted/20 px-3 py-2 text-xs">
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">Target floor:</dt>
                  <dd className="font-medium">{target.levelName}</dd>
                </div>
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">Stored height:</dt>
                  <dd className="font-medium">{target.levelHeight.toFixed(2)} m</dd>
                </div>
              </dl>
            )}

            {state !== 'complete' && activeStep === 'source' && (
              <section className="grid gap-2" aria-labelledby="floorplan-source-title">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-medium text-sm" id="floorplan-source-title">Source drawing</h3>
                    <p className="text-muted-foreground text-xs">PNG, JPEG, WebP, or PDF. Selection and preparation stay in this browser.</p>
                  </div>
                  <Button
                    disabled={state === 'generating' || state === 'applying'}
                    onClick={() => fileInputRef.current?.click()}
                    ref={chooseFileButtonRef}
                    size="sm"
                    type="button"
                    aria-label="Choose floorplan source file"
                    variant="outline"
                  >
                    <FileUp /> {source ? 'Choose another file' : 'Choose file'}
                  </Button>
                  <input
                    accept="image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf"
                    aria-label="Choose floorplan source file"
                    className="sr-only"
                    onChange={fileChange}
                    ref={fileInputRef}
                    type="file"
                  />
                </div>

                {source?.kind === 'pdf' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span>PDF page</span>
                    <select
                      className="h-8 rounded-md border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      disabled={sourceBusy || state === 'generating' || state === 'applying'}
                      onChange={(event) => {
                        const nextPage = Number(event.target.value)
                        setPage(nextPage)
                        void renderPage(source, nextPage)
                      }}
                      value={page}
                    >
                      {Array.from({ length: source.pageCount }, (_, index) => (
                        <option key={index + 1} value={index + 1}>Page {index + 1}</option>
                      ))}
                    </select>
                    <span className="text-muted-foreground text-xs">of {source.pageCount}</span>
                  </label>
                )}

                {sourceBusy && (
                  <div className="flex min-h-36 items-center justify-center gap-2 rounded-md border text-muted-foreground text-sm" role="status">
                    <Loader2 className="size-4 animate-spin" /> Preparing source
                  </div>
                )}

                {rendered && !sourceBusy && editingCrop && crop && (
                  <div className="grid gap-3">
                    <CropEditor crop={crop} onCropChange={setCrop} rendered={rendered} />
                    <div className="flex justify-end gap-2">
                      <Button onClick={() => setEditingCrop(false)} size="sm" type="button" variant="ghost">Cancel crop</Button>
                      <Button onClick={() => void applyCrop(crop)} size="sm" type="button">Use crop</Button>
                    </div>
                  </div>
                )}

                {rendered && !sourceBusy && !editingCrop && !prepared && (
                  <div className="grid gap-2">
                    <img
                      alt="Selected floorplan source"
                      className="max-h-[44vh] w-full rounded-md border bg-white object-contain"
                      height={rendered.height}
                      src={rendered.previewDataUrl}
                      width={rendered.width}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{source?.fileName} · {rendered.width} × {rendered.height}px</span>
                      <Button
                        onClick={() => {
                          setCrop({
                            x: rendered.width * 0.1,
                            y: rendered.height * 0.1,
                            width: rendered.width * 0.8,
                            height: rendered.height * 0.8,
                          })
                          setEditingCrop(true)
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Crop /> Select a smaller crop
                      </Button>
                    </div>
                  </div>
                )}

                {prepared && rendered && !sourceBusy && !editingCrop && (
                  <div className="grid gap-2">
                    <SourcePreview
                      calibrationMode={
                        calibrationMode && state !== 'generating' && state !== 'applying'
                      }
                      calibrationPoints={calibrationPoints}
                      draft={null}
                      onCalibrationPoint={(point) => {
                        setCalibrationPoints((current) => current[0] && !current[1]
                          ? [current[0], point]
                          : [point, null])
                      }}
                      source={prepared}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{source?.fileName} · {prepared.width} × {prepared.height}px{prepared.page ? ` · page ${prepared.page}` : ''}</span>
                      <div className="flex gap-1">
                        <Button
                          disabled={state === 'generating' || state === 'applying'}
                          onClick={() => {
                            invalidateGeneratedResult()
                            setCrop(crop ?? {
                              x: rendered.width * 0.1,
                              y: rendered.height * 0.1,
                              width: rendered.width * 0.8,
                              height: rendered.height * 0.8,
                            })
                            setEditingCrop(true)
                          }}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <Crop /> {crop ? 'Change crop' : 'Select crop'}
                        </Button>
                        {crop && (
                          <Button
                            disabled={state === 'generating' || state === 'applying'}
                            onClick={() => void applyCrop(null)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            Reset crop
                          </Button>
                        )}
                      </div>
                    </div>
                    {crop && (
                      <details className="rounded-md border px-3 py-2 text-xs">
                        <summary className="cursor-pointer font-medium">Original source sheet</summary>
                        <img
                          alt="Original uncropped source sheet"
                          className="mt-2 max-h-48 max-w-full rounded border bg-white object-contain"
                          height={rendered.height}
                          src={rendered.previewDataUrl}
                          width={rendered.width}
                        />
                      </details>
                    )}
                  </div>
                )}
              </section>
            )}

            {prepared && state !== 'complete' && activeStep === 'source' && (
              <CalibrationControls
                active={calibrationMode}
                disabled={state === 'generating' || state === 'applying'}
                distance={calibrationDistance}
                height={prepared.height}
                onActiveChange={setCalibrationMode}
                onApply={applyCalibration}
                onDistanceChange={setCalibrationDistance}
                onPointsChange={setCalibrationPoints}
                points={calibrationPoints}
                width={prepared.width}
              />
            )}

            {prepared && state !== 'complete' && (
              <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <input
                  checked={consent}
                  className="mt-0.5 size-4 accent-primary"
                  disabled={state === 'generating' || state === 'applying'}
                  onChange={(event) => setConsent(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="font-medium">Allow remote model processing</span>
                  <span className="mt-0.5 block text-muted-foreground text-xs">Evidence extraction uses only this editor server. Interpretation and review each send the prepared drawing to one OpenRouter model. Optional SAM segmentation sends it to fal for three groups: walls, openings, and props. Each remote step is paid and starts only when you select its button. Apply saves the prepared image as a project source guide.</span>
                </span>
              </label>
            )}

            {prepared && activeStep !== 'source' && state !== 'complete' && (
              <section className="grid gap-3" aria-label="Stage inspection">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium text-sm">{WORKFLOW_STEPS.find((step) => step.id === activeStep)?.label}</h3>
                    <p className="text-xs text-muted-foreground">
                      {activeStep === 'extract' ? 'Classical lines and regions are evidence, not recognized walls or rooms.'
                        : activeStep === 'segment' ? 'SAM masks are optional suggestions. Inspect coverage and shape before using them.'
                        : activeStep === 'native' ? 'This preview uses native Pascal conversion. It does not change your scene.'
                        : 'Inspect semantic groups and their source references before continuing.'}
                    </p>
                  </div>
                  <Button onClick={downloadInspection} size="sm" type="button" variant="outline">Save inspection data</Button>
                </div>
                <FloorplanReviewViewport
                  draft={inspectionDraft}
                  features={features}
                  levelHeight={target?.levelHeight ?? 3}
                  masks={masks}
                  mode={activeStep === 'native' ? 'native' : activeStep === 'extract' || activeStep === 'segment' ? 'evidence' : 'semantic'}
                  onNativePreviewReady={setNativePreviewReady}
                  sourceUrl={prepared.imageDataUrl}
                  target={target}
                />
                {activeStep === 'segment' && checkpoints.segment && (
                  <fieldset className="grid gap-2 rounded-md border p-3">
                    <legend className="px-1 text-sm font-medium">Masks included in interpretation</legend>
                    {checkpoints.segment.masks.length === 0 && <p className="text-xs text-muted-foreground">SAM returned no usable masks. You can continue with source evidence alone.</p>}
                    {checkpoints.segment.masks.map((mask) => (
                      <label className="flex items-center gap-2 text-xs" key={mask.id}>
                        <input type="checkbox" disabled={busy} checked={masks.some((entry) => entry.id === mask.id)} onChange={(event) => changeMasks(event.target.checked ? [...masks, mask] : masks.filter((entry) => entry.id !== mask.id))} />
                        <span>{mask.label} · {(mask.coverage * 100).toFixed(1)}% coverage · score {mask.score === null ? 'unavailable' : mask.score.toFixed(2)}</span>
                      </label>
                    ))}
                    <p className="text-xs text-muted-foreground">A score does not prove that a mask identifies the correct object. Excluding a mask invalidates later proposals.</p>
                  </fieldset>
                )}
                {selectedCheckpoint && (
                  <p className="text-xs text-muted-foreground">
                    {selectedCheckpoint.usage.models.join(' → ') || (activeStep === 'extract' ? 'Local extraction' : 'No remote model call')} · Reported cost: {selectedCheckpoint.usage.cost === null ? 'unavailable' : `$${selectedCheckpoint.usage.cost.toFixed(5)}`}
                  </p>
                )}
                {selectedCheckpoint && selectedCheckpoint.issues.length > 0 && !inspectionDraft && (
                  <ul className="list-disc space-y-1 rounded-md border p-3 pl-7 text-sm" aria-label="Stage issues">
                    {selectedCheckpoint.issues.map((issue) => <li key={issue.id} className={issue.severity === 'blocking' ? 'text-destructive' : ''}>{issue.message}</li>)}
                  </ul>
                )}
                {selectedCheckpoint?.candidateJson && (
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm font-medium">Retained model candidate · untrusted</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{selectedCheckpoint.candidateJson}</pre>
                  </details>
                )}
                {activeStep !== 'native' && (
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      {activeStep === 'extract' || activeStep === 'segment'
                        ? 'Inspect or correct feature evidence JSON'
                        : 'Inspect or edit retained proposal text'}
                    </summary>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {activeStep === 'extract' || activeStep === 'segment'
                        ? 'Edits must remain strict feature-ledger JSON and invalidate later results. They do not start a model call.'
                        : 'Malformed or truncated model text can remain unchanged here. Using edits only retains the text; the explicit independent review is a separate paid call that must reconstruct supported facts from the original evidence.'}
                    </p>
                    <label className="mt-2 grid gap-1 text-xs">
                      <span>{activeStep === 'extract' || activeStep === 'segment' ? 'Feature evidence JSON' : 'Untrusted proposal text for independent review'}</span>
                      <textarea aria-describedby={error ? 'floorplan-import-error' : undefined} className="min-h-48 w-full rounded-md border bg-background p-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={busy} onChange={(event) => setArtifactText(event.target.value)} value={artifactText} spellCheck={false} />
                    </label>
                    <Button className="mt-2" disabled={busy || !artifactText.trim()} onClick={useArtifactEdits} size="sm" type="button" variant="outline">
                      {activeStep === 'extract' || activeStep === 'segment' ? 'Use feature JSON' : 'Use retained text'}
                    </Button>
                  </details>
                )}
              </section>
            )}

            {state === 'generating' && (
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm" role="status" aria-live="polite">
                <Loader2 className="size-4 animate-spin" /> {PROGRESS_LABELS[progress]}
              </div>
            )}

            {draft && state !== 'complete' && state !== 'generating' && (activeStep === 'review' || activeStep === 'native') && (
              <section className="grid gap-3" aria-labelledby="floorplan-review-title">
                <div>
                  <h3 className="font-medium text-sm" id="floorplan-review-title">Review before creating the floor</h3>
                  <p className="text-muted-foreground text-xs">Resolve blockers, inspect the native preview, then select Apply. To correct geometry, edit the proposal JSON and run the reviewer again.</p>
                </div>

                {blockingIssues.length > 0 && (
                  <div className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3" role="alert">
                    <div className="flex items-center gap-2 font-medium text-destructive text-sm"><AlertTriangle className="size-4" /> Resolve before importing</div>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {blockingIssues.map((issue) => <li key={issue.id}>{issue.message}</li>)}
                    </ul>
                  </div>
                )}

                {warningIssues.length > 0 && (
                  <fieldset className="grid gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                    <legend className="px-1 font-medium text-sm">Warnings requiring acceptance</legend>
                    {warningIssues.map((issue) => (
                      <label className="flex items-start gap-2 text-sm" key={issue.id}>
                        <input
                          checked={acceptedWarnings.includes(issue.id)}
                          className="mt-0.5 size-4 accent-primary"
                          onChange={(event) => setAcceptedWarnings((current) => event.target.checked
                            ? [...current, issue.id]
                            : current.filter((id) => id !== issue.id))}
                          type="checkbox"
                        />
                        <span>{issue.message}</span>
                      </label>
                    ))}
                  </fieldset>
                )}

                {draft.assumptions.length > 0 && (
                  <div className="grid gap-2 rounded-md border p-3">
                    <div className="font-medium text-sm">Assumptions</div>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {draft.assumptions.map((assumption, index) => (
                        <li key={`${index}-${assumption}`}>{assumption}</li>
                      ))}
                    </ul>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        checked={assumptionsConfirmed}
                        className="mt-0.5 size-4 accent-primary"
                        onChange={(event) => setAssumptionsConfirmed(event.target.checked)}
                        type="checkbox"
                      />
                      <span>I reviewed these assumptions and want to create the floor with them.</span>
                    </label>
                  </div>
                )}

                {draft.items.length > 0 && (
                  <fieldset className="grid gap-2 rounded-md border p-3">
                    <legend className="px-1 font-medium text-sm">Catalog matches</legend>
                    <p className="text-muted-foreground text-xs">Detected props are not replaced with placeholder geometry. Select a real native catalog item for each one.</p>
                    {draft.items.map((item) => (
                      <label className="grid gap-1 text-sm" key={item.id}>
                        <span>{item.label}</span>
                        <select
                          className="h-9 rounded-md border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onChange={(event) => {
                            const assetId = event.target.value || null
                            setDraft((current) => current ? {
                              ...current,
                              items: current.items.map((candidate) => candidate.id === item.id
                                ? { ...candidate, assetId }
                                : candidate),
                              issues: current.issues.filter(
                                (issue) => issue.id !== `floorplan-prop-asset-${item.id}`,
                              ),
                            } : current)
                            setAcceptedWarnings([])
                            setNativePreviewReady(false)
                            setAssumptionsConfirmed(false)
                          }}
                          value={item.assetId ?? ''}
                        >
                          <option value="">Select a catalog item…</option>
                          {catalog.map((entry) => (
                            <option key={entry.id} value={entry.id}>{entry.name} · {entry.category} · {entry.width.toFixed(2)} × {entry.depth.toFixed(2)}m</option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </fieldset>
                )}
              </section>
            )}

            {attempts.length > 0 && (
              <section aria-label="Import processing cost" aria-live="polite" className="rounded-md border bg-muted/20 p-3">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="text-sm font-medium">{costSummary.unknownAttempts ? 'Known model cost · total incomplete' : 'Total reported model cost'}</h3>
                  <strong className="font-mono text-base tabular-nums">${costSummary.reported.toFixed(5)} <span className="text-xs font-normal">USD</span></strong>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {costSummary.remoteAttempts} remote-stage attempts in this import session, including retries and stopped stages. Local extraction has no model charge.
                  {costSummary.unknownAttempts > 0 && ` ${costSummary.unknownAttempts} attempt(s) have no reported charge. Their cost is not included; check provider billing for the final total.`}
                </p>
              </section>
            )}
            {attempts.length > 0 && (
              <details className="rounded-md border p-3 text-xs">
                <summary className="cursor-pointer font-medium">Processing history · {attempts.length} attempts</summary>
                <ol className="mt-2 space-y-2">
                  {attempts.map((attempt, index) => <li key={index}>
                    {attempt.action} · {(attempt.durationMs / 1000).toFixed(1)} s · {attempt.cost === null ? 'cost unavailable' : `$${attempt.cost.toFixed(5)}`}
                    {attempt.models.length > 0 && <span> · {attempt.models.join(', ')}</span>}
                    {attempt.error && <p className="text-destructive">{attempt.error}</p>}
                  </li>)}
                </ol>
              </details>
            )}
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm" id="floorplan-import-error" role="alert">
                {error}
              </div>
            )}

            {state === 'applying' && (
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm" role="status" aria-live="assertive">
                <Loader2 className="size-4 animate-spin" /> Creating floor. This short step cannot be cancelled.
              </div>
            )}

            {state === 'complete' && result && (
              <div className="grid gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4" role="status" aria-live="polite">
                <div className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-5 text-emerald-600" /> Floor created</div>
                <p className="text-muted-foreground text-sm">The editable floor is selected. Its source guide is visible and can be toggled with the ordinary level reference controls. Use the editor’s normal Undo command to undo this import.</p>
                <p className="text-sm">
                  {costSummary.unknownAttempts ? 'Known model cost' : 'Final reported model cost'}: <strong className="font-mono">${costSummary.reported.toFixed(5)} USD</strong>.
                  {costSummary.unknownAttempts > 0 && ' Total incomplete: unreported charges are listed in processing history above.'}
                </p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                  {Object.entries(result.counts).map(([kind, count]) => (
                    <div className="flex justify-between gap-2" key={kind}><dt className="capitalize text-muted-foreground">{kind}</dt><dd>{count}</dd></div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-wrap border-t px-5 py-3">
          {state === 'complete' ? (
            <Button onClick={requestClose} type="button">Close</Button>
          ) : (
            <>
              <Button disabled={state === 'applying'} onClick={requestClose} type="button" variant="ghost">Close</Button>
              {state === 'generating' ? (
                <Button onClick={stopStage} type="button" variant="outline">Stop stage</Button>
              ) : state !== 'applying' && (
                <>
                  {state === 'failed' && failureStep === 'source' && <Button disabled={sourceBusy} onClick={retry} type="button" variant="outline">Choose source again</Button>}
                  {activeStep === 'source' && prepared && (
                    <Button disabled={!generateFloorplan || !target || sourceBusy || editingCrop} onClick={() => void generate('extract')} type="button">Extract evidence</Button>
                  )}
                  {(activeStep === 'extract' || activeStep === 'segment') && features && (
                    <>
                      <Button disabled={!remoteReady} onClick={() => void generate('segment')} type="button" variant="outline">Run SAM · 3 groups</Button>
                      <Button disabled={!modelReady} onClick={() => void generate('interpret')} type="button">{masks.length ? 'Interpret drawing' : 'Interpret without SAM'}</Button>
                    </>
                  )}
                  {activeStep === 'interpret' && (
                    <>
                      <Button disabled={!modelReady} onClick={() => void generate('interpret')} type="button" variant="outline">Run interpreter again</Button>
                      <Button disabled={!modelReady || !candidateJson?.trim()} onClick={() => void generate('review')} type="button">Run independent review</Button>
                    </>
                  )}
                  {activeStep === 'review' && (
                    <>
                      <Button disabled={!modelReady || !candidateJson?.trim()} onClick={() => void generate('review')} type="button" variant="outline">Run reviewer again</Button>
                      <Button disabled={!draft || blockingIssues.length > 0} onClick={() => selectStep('native')} type="button">Inspect native preview</Button>
                    </>
                  )}
                  {activeStep === 'native' && draft && (
                    <div className="flex flex-col items-end gap-1">
                      <Button disabled={!canConfirmReview || !nativePreviewReady || !checkpoints.review} onClick={() => void commitDraft(draft, acceptedWarnings)} type="button">Apply to {target?.levelName ?? 'floor'}</Button>
                      {(!canConfirmReview || !nativePreviewReady) && <p className="max-w-sm text-right text-xs text-muted-foreground">{!canConfirmReview ? 'Resolve blockers and accept warnings and assumptions above.' : 'Wait for the native preview to load. Preview errors must be resolved before Apply.'}</p>}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
