'use client'

import { type AnyNode, getStoredLevelHeight, useScene } from '@pascal-app/core'
import {
  balconyElevation,
  constrainReferenceHeight,
  DEFAULT_BALCONY,
} from '@pascal-app/core/building'
import { useViewer } from '@pascal-app/viewer'
import {
  BrickWall,
  Check,
  CircleAlert,
  Crosshair,
  DoorOpen,
  Fence,
  Focus,
  Grid2x2,
  House,
  Layers,
  LoaderCircle,
  RotateCcw,
  Sofa,
  SquareDashed,
  Upload,
  X,
} from 'lucide-react'
import { type CSSProperties, useEffect, useState } from 'react'
import { measuredPlanScale } from '../../lib/plan-reference/calibration'
import type { ReferenceImage } from '../../lib/plan-reference/guides'

import { useVectorizePlan } from '../../lib/plan-reference/use-vectorize-plan'
import { useWorkspacePreview } from '../../lib/plan-reference/use-workspace-preview'
import {
  activeReferencePoints,
  followGuide,
  type ReferenceDraft,
  type WorkspaceKind,
  workspaceShapeCandidates,
} from '../../lib/plan-reference/workspace'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { ownsPlanWorkspace, usePlanWorkspace } from '../../store/use-plan-workspace'
import { cn } from '../../lib/utils'
import { BalconyControls } from './balcony-controls'
import { PropPicker } from './plan-prop-picker'
import { SegmentedControl } from './controls/segmented-control'
import { SliderControl } from './controls/slider-control'
import { Button } from './primitives/button'

const KINDS: {
  kind: WorkspaceKind
  label: string
  icon: typeof BrickWall
  /** Node type counted in the Create label; one per created element. */
  node: AnyNode['type']
  one: string
  many: string
}[] = [
  { kind: 'walls', label: 'Walls', icon: BrickWall, node: 'wall', one: 'wall', many: 'walls' },
  { kind: 'slab', label: 'Slab', icon: Layers, node: 'slab', one: 'slab', many: 'slabs' },
  { kind: 'zone', label: 'Zone', icon: SquareDashed, node: 'zone', one: 'zone', many: 'zones' },
  { kind: 'unit', label: 'Unit', icon: House, node: 'unit', one: 'unit', many: 'units' },
  {
    kind: 'balcony',
    label: 'Balcony',
    icon: Fence,
    node: 'slab',
    one: 'balcony',
    many: 'balconies',
  },
  { kind: 'door', label: 'Door', icon: DoorOpen, node: 'door', one: 'door', many: 'doors' },
  {
    kind: 'window',
    label: 'Window',
    icon: Grid2x2,
    node: 'window',
    one: 'window',
    many: 'windows',
  },
  { kind: 'prop', label: 'Prop', icon: Sofa, node: 'item', one: 'prop', many: 'props' },
]

function countOf(kind: WorkspaceKind, nodes: AnyNode[]) {
  const entry = KINDS.find((k) => k.kind === kind)!
  const count = nodes.filter((n) => n.type === entry.node).length
  return { count, noun: count === 1 ? entry.one : entry.many }
}

/** Names the outcome ("Create 2 windows") so the button says what it will do. */
function createLabel(kind: WorkspaceKind, nodes: AnyNode[]) {
  const { count, noun } = countOf(kind, nodes)
  return count ? `Create ${count} ${noun}` : 'Create'
}

/** Hosted openings have no drawn preview, so the summary is their feedback. */
function openingSummary(kind: 'door' | 'window', nodes: AnyNode[], selected: number) {
  if (!selected) return 'Select the shapes of each symbol on the plan.'
  const { count, noun } = countOf(kind, nodes)
  const walls = nodes.filter((n) => n.type === 'wall').length
  return `${count} ${noun}${walls ? ` · ${walls} new wall segment${walls === 1 ? '' : 's'}` : ''}`
}

function Hint({
  children,
  live,
  title,
}: {
  children: React.ReactNode
  live?: boolean
  title?: string
}) {
  return (
    <p
      aria-live={live ? 'polite' : undefined}
      className="truncate px-0.5 text-[11px] leading-4 text-muted-foreground"
      title={title ?? (typeof children === 'string' ? children : undefined)}
    >
      {children}
    </p>
  )
}

/** A native checkbox (keyboard + screen reader) dressed as the editor's toggle row. */
function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="group flex h-8 cursor-pointer items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-2.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-[#3e3e3e] hover:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/60">
      {label}
      <input
        type="checkbox"
        className="size-3.5 cursor-pointer accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="px-0.5 pt-1 text-[11px] font-medium text-muted-foreground">{children}</h3>
}

const field =
  'h-7 min-w-0 rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-primary'
const hints = {
  measure: 'Pick the two ends of a known length on the plan.',
  'unit-span': 'Pick a shared span on the first plan, such as the room width.',
  'map-span': 'Pick that same span on the second plan, in the same direction.',
  adjust: 'Drag to move. Use the corner to scale, or the round handle to rotate.',
}

function ReferenceControls({ draft }: { draft: ReferenceDraft }) {
  const state = usePlanWorkspace.getState()
  const direct = !!(draft.singleGuideId || draft.guidePair)
  const [busy, setBusy] = useState(false),
    [unit, setUnit] = useState<'m' | 'ft'>('ft')
  const role = draft.stage === 'map-span' ? 'sitemap' : 'floorplan'
  const image = role === 'floorplan' ? draft.plan : draft.map,
    catalog = role === 'floorplan' ? draft.plans : draft.maps
  const measured = measuredPlanScale(draft.dimension, draft.meters)
  const points = activeReferencePoints(draft)
  const change = (patch: Partial<ReferenceDraft>) =>
    state.change((d) => (d.mode === 'references' ? { ...d, ...patch } : d))
  const upload = async (file: File) => {
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 6 * 1024 * 1024
    ) {
      usePlanWorkspace.setState({ error: 'Choose a PNG, JPEG or WebP under 6 MB.' })
      return
    }
    setBusy(true)
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const decoded = new Image()
      decoded.src = url
      await decoded.decode()
      const entry: ReferenceImage = {
        id: crypto.randomUUID(),
        name: file.name,
        url,
        width: decoded.naturalWidth,
        height: decoded.naturalHeight,
      }
      if (usePlanWorkspace.getState().draft?.id === draft.id) state.chooseImage(role, entry)
    } catch {
      usePlanWorkspace.setState({ error: 'This image could not be opened.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {direct ? (
        <p className="truncate px-1 text-xs font-medium" title={image.name}>
          {draft.guidePair ? `${role === 'sitemap' ? 'Reference' : 'Plan to align'} · ` : ''}
          {image.name}
        </p>
      ) : (
        <div className="flex gap-1.5">
          <select
            className={`${field} flex-1`}
            aria-label={role === 'floorplan' ? 'First plan' : 'Second plan'}
            value={image.id}
            disabled={busy}
            onChange={(e) => {
              const next = catalog.find((v) => v.id === e.target.value)
              if (next) state.chooseImage(role, next)
            }}
          >
            {!catalog.some((v) => v.id === image.id) && (
              <option value={image.id}>{image.name}</option>
            )}
            {catalog.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <label
            className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border hover:bg-accent"
            title="Upload reference image"
          >
            <Upload className="size-3.5" />
            <input
              className="absolute inset-0 w-full cursor-pointer opacity-0"
              type="file"
              aria-label={`Upload ${role === 'floorplan' ? 'unit plan' : 'sitemap'}`}
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void upload(file)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      )}
      <p className="text-[11px] leading-4 text-muted-foreground">
        {draft.pickingAnchor
          ? 'Click a point on the plan to pin it while scaling.'
          : draft.guidePair && draft.stage === 'map-span'
            ? 'Pick a span on the calibrated reference.'
            : draft.guidePair && draft.stage === 'unit-span'
              ? 'Pick the same span on this plan, in the same direction.'
              : hints[draft.stage]}
      </p>
      {draft.stage === 'measure' && (
        <div className="flex gap-1.5">
          <input
            aria-label="Known length"
            className={`${field} w-0 flex-1`}
            type="number"
            min={0.001}
            step="any"
            placeholder="Known length"
            value={
              draft.meters ? Number((draft.meters / (unit === 'ft' ? 0.3048 : 1)).toFixed(6)) : ''
            }
            onChange={(e) =>
              change({ meters: Number(e.target.value) * (unit === 'ft' ? 0.3048 : 1) })
            }
          />
          <select
            className={field}
            aria-label="Measurement unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as 'm' | 'ft')}
          >
            <option value="ft">ft</option>
            <option value="m">m</option>
          </select>
        </div>
      )}
      {draft.stage === 'adjust' ? (
        <>
          <SliderControl
            label="Scale correction"
            value={
              (100 * draft.planTransform.metersPerPixel) /
              (draft.baseline?.metersPerPixel ?? draft.planTransform.metersPerPixel)
            }
            unit="%"
            precision={1}
            min={25}
            max={400}
            step={0.1}
            manageHistory={false}
            liveText
            onChange={(scale) => state.correct({ scale: scale / 100 })}
          />
          <SliderControl
            label="Rotation"
            value={(draft.planTransform.rotation * 180) / Math.PI}
            unit="°"
            precision={1}
            step={0.1}
            manageHistory={false}
            liveText
            onChange={(rotation) => state.correct({ rotation: (rotation * Math.PI) / 180 })}
          />
          <SliderControl
            label="Opacity"
            value={draft.opacity}
            unit="%"
            min={0}
            max={100}
            step={1}
            manageHistory={false}
            liveText
            onChange={(opacity) => change({ opacity })}
          />
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={draft.pickingAnchor ? 'secondary' : 'ghost'}
              aria-pressed={draft.pickingAnchor}
              className="h-7 flex-1 px-2 text-xs"
              onClick={() => change({ pickingAnchor: !draft.pickingAnchor })}
            >
              <Crosshair className="size-3.5" /> Anchor
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              title="Restore the measured scale around the anchor"
              onClick={() => state.correct({ scale: 1 })}
            >
              <RotateCcw className="size-3.5" /> Scale
            </Button>
          </div>
          <div className="flex gap-1.5 border-t border-border pt-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => state.setStage(draft.guidePair ? 'map-span' : 'measure')}
            >
              Remeasure
            </Button>
            <Button size="sm" className="h-7 flex-1 text-xs" onClick={state.commit}>
              Apply references
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{points.length}/2 points · Hold Shift for straight</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1 text-[11px]"
              disabled={!points.length}
              onClick={() =>
                change({
                  [draft.stage === 'measure'
                    ? 'dimension'
                    : draft.stage === 'unit-span'
                      ? 'planEdge'
                      : 'mapEdge']: [],
                })
              }
            >
              Clear
            </Button>
          </div>
          <div className="flex gap-1.5">
            {draft.stage !== 'measure' && !(draft.guidePair && draft.stage === 'map-span') && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  state.setStage(
                    draft.guidePair
                      ? 'map-span'
                      : draft.stage === 'unit-span'
                        ? 'measure'
                        : 'unit-span',
                  )
                }
              >
                Back
              </Button>
            )}
            {(draft.stage === 'map-span' || (draft.guidePair && draft.stage === 'unit-span')) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={points.length !== 2}
                onClick={() =>
                  draft.guidePair && draft.stage === 'unit-span'
                    ? change({ planEdge: [...draft.planEdge].reverse() })
                    : change({ mapEdge: [...draft.mapEdge].reverse() })
                }
              >
                Reverse
              </Button>
            )}
            <Button
              size="sm"
              className="h-7 flex-1 text-xs"
              disabled={busy || (draft.stage === 'measure' ? !measured : points.length !== 2)}
              onClick={() =>
                state.setStage(
                  draft.singleGuideId
                    ? 'adjust'
                    : draft.guidePair
                      ? draft.stage === 'map-span'
                        ? 'unit-span'
                        : 'adjust'
                      : draft.stage === 'measure'
                        ? 'unit-span'
                        : draft.stage === 'unit-span'
                          ? 'map-span'
                          : 'adjust',
                )
              }
            >
              {draft.singleGuideId
                ? 'Review scale'
                : draft.guidePair
                  ? draft.stage === 'map-span'
                    ? 'Match on this plan'
                    : 'Overlay & adjust'
                  : draft.stage === 'measure'
                    ? 'Match a span'
                    : draft.stage === 'unit-span'
                      ? 'Find it on second plan'
                      : 'Overlay & adjust'}
            </Button>
          </div>
        </>
      )}
    </>
  )
}

export function PlanWorkspacePanel({ style }: { style?: CSSProperties }) {
  const draft = usePlanWorkspace((s) => s.draft),
    error = usePlanWorkspace((s) => s.error),
    message = usePlanWorkspace((s) => s.message),
    whitespaceBusy = usePlanWorkspace((s) => s.whitespaceBusy)
  const state = usePlanWorkspace.getState(),
    preview = useWorkspacePreview(draft)
  const tracing = useVectorizePlan(draft)
  useEffect(() => {
    const stopIfInvalid = () => {
      const d = usePlanWorkspace.getState().draft
      if (!d) return
      const scene = useScene.getState(),
        editor = useEditor.getState()
      const level = scene.nodes[d.levelId]
      if (
        !ownsPlanWorkspace() ||
        scene.readOnly ||
        level?.type !== 'level' ||
        level.metadata.placeholderSource ||
        useViewer.getState().selection.levelId !== d.levelId ||
        editor.mode !== 'select' ||
        editor.captureMode.mode !== 'idle' ||
        editor.isPreviewMode ||
        editor.isFirstPersonMode ||
        editor.workspaceMode === 'studio'
      ) {
        state.close()
        return
      }
      if (d.mode === 'shapes') {
        const live = scene.nodes[d.guide.id]
        if (live?.type !== 'guide') {
          state.close()
          return
        }
        // A moved / rescaled / rotated guide drags the whole workspace with it;
        // otherwise the overlay and its commits land at the old frame.
        if (JSON.stringify(live) !== JSON.stringify(d.guide)) {
          const next = followGuide(d, live)
          if (next) state.change((current) => (current === d ? next : current))
          else state.close()
          return
        }
        if (d.floorHeight !== getStoredLevelHeight(level)) {
          const floorHeight = getStoredLevelHeight(level)
          state.change((current) =>
            current.mode === 'shapes'
              ? {
                  ...current,
                  floorHeight,
                  height:
                    current.kind === 'balcony'
                      ? balconyElevation(
                          current.height,
                          floorHeight,
                          current.balcony ?? DEFAULT_BALCONY,
                        )
                      : current.height === current.floorHeight
                        ? floorHeight
                        : constrainReferenceHeight(current.height, floorHeight),
                }
              : current,
          )
        }
      }
    }
    const subscriptions = [
      useScene.subscribe(stopIfInvalid),
      useViewer.subscribe(stopIfInvalid),
      useEditor.subscribe(stopIfInvalid),
      useInteractionScope.subscribe(stopIfInvalid),
    ]
    const key = (e: KeyboardEvent) => {
      if (
        !usePlanWorkspace.getState().draft ||
        (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true]')
      )
        return
      if (e.key === 'Escape' && useInteractionScope.getState().scope.kind !== 'handle-drag') {
        e.preventDefault()
        e.stopImmediatePropagation()
        state.close()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => {
      subscriptions.forEach((unsubscribe) => {
        unsubscribe()
      })
      window.removeEventListener('keydown', key, true)
      state.close()
    }
  }, [state.close, state.change])
  if (!draft) return null
  const candidates = draft.mode === 'shapes' ? workspaceShapeCandidates(draft) : []
  const problem = error || preview.error
  const feedback = problem ? (
    <p
      key={problem}
      role="alert"
      className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2 py-1.5 text-[11px] leading-4 text-destructive transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:translate-y-0.5 starting:opacity-0 motion-reduce:transition-none"
    >
      <CircleAlert className="mt-px size-3 shrink-0" strokeWidth={2.5} />
      {problem}
    </p>
  ) : null
  return (
    <section
      aria-label={draft.mode === 'references' ? 'Plan references' : 'Extrude plan shapes'}
      className={cn(
        // A parallel, non-blocking tool: a frosted layer over the plan, no scrim.
        'fixed z-40 origin-bottom-left space-y-1.5 overflow-y-auto overscroll-contain rounded-2xl border border-border/60 bg-background/90 p-2.5 text-foreground shadow-2xl backdrop-blur-xl',
        '[@media(prefers-reduced-transparency:reduce)]:bg-background [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none',
        // Grows out of its bottom-left anchor on open; closing (often Esc) stays instant.
        'transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:translate-y-1 starting:scale-[0.98] starting:opacity-0 motion-reduce:transition-none',
      )}
      style={style}
    >
      <div className="flex h-7 items-center gap-1">
        <h2 className="text-xs font-semibold">
          {draft.mode === 'references' ? 'Plan references' : 'Plan shapes'}
        </h2>
        {draft.mode === 'shapes' && (
          <span
            aria-label={`${draft.selected.length} selected`}
            className={cn(
              'rounded-full px-1.5 py-px text-[11px] font-medium tabular-nums transition-colors duration-150',
              draft.selected.length
                ? 'bg-primary/15 text-primary'
                : 'bg-white/5 text-muted-foreground',
            )}
          >
            {draft.selected.length}{' '}
            {draft.selectionMode === 'edges'
              ? 'edges'
              : draft.selectionMode === 'areas'
                ? 'areas'
                : 'shapes'}
          </span>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto size-7 rounded-lg transition-[background-color,transform] duration-150 ease-out active:scale-[0.94]"
          aria-label="Fit reference in view"
          title="Fit reference"
          onClick={state.focus}
        >
          <Focus className="size-3.5" />
        </Button>
        {draft.mode === 'shapes' && (
          // Done keeps the plan guides visible afterwards; ✕ restores how they were.
          <button
            type="button"
            className="h-6 rounded-full bg-primary/15 px-2.5 text-[11px] font-medium text-primary outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-primary/25 focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.95]"
            onClick={() => state.close(true)}
          >
            Done
          </button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          className="size-7 rounded-lg transition-[background-color,transform] duration-150 ease-out active:scale-[0.94]"
          aria-label="Close reference tool"
          onClick={() => state.close()}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {draft.mode === 'references' ? (
        <ReferenceControls key={draft.id} draft={draft} />
      ) : (
        <>
          <SegmentedControl
            aria-label="Selection target"
            className="h-7"
            value={draft.selectionMode ?? 'source'}
            onChange={state.setSelectionMode}
            options={[
              { value: 'areas', label: 'Areas', title: 'Select areas enclosed by visible lines' },
              { value: 'edges', label: 'Edges', title: 'Select individual sides and lines' },
              {
                value: 'source',
                label: 'Source',
                title: 'Original SVG shapes, which may span several areas',
              },
            ]}
          />
          <Hint
            title={
              draft.selectionMode === 'areas'
                ? 'Click an area to toggle it. Clicking whitespace no area covers traces that room. Shift-click bypasses the height handle.'
                : undefined
            }
          >
            {draft.selectionMode === 'areas'
              ? 'Click areas, or inside a room to fill it.'
              : draft.selectionMode === 'edges'
                ? 'Click edges to select them.'
                : 'Alt-click picks the shape underneath.'}
          </Hint>
          {(draft.selectionMode === 'areas' || draft.selectionMode === 'edges') &&
            draft.kind !== 'door' &&
            draft.kind !== 'window' &&
            draft.kind !== 'prop' && (
            <SliderControl
              label="Close gaps up to"
              value={draft.gapTolerance}
              min={0}
              max={2}
              step={0.01}
              precision={2}
              unit="m"
              manageHistory={false}
              onChange={(gapTolerance) =>
                state.change((d) => (d.mode === 'shapes' ? { ...d, gapTolerance } : d))
              }
            />
          )}
          {whitespaceBusy && draft.selectionMode === 'areas' && (
            <p
              role="status"
              className="flex items-center gap-1.5 px-0.5 text-[11px] leading-4 text-muted-foreground"
            >
              <LoaderCircle className="size-3 animate-spin [animation-duration:700ms]" />
              Filling region…
            </p>
          )}
          {draft.traceOptions && (
            <div className="space-y-1 border-b border-border pb-2">
              <div className="flex gap-1" role="group" aria-label="Vectorize regions">
                {(['ink', 'spaces'] as const).map((mode) => (
                  <Button
                    key={mode}
                    size="sm"
                    variant={draft.traceOptions!.mode === mode ? 'secondary' : 'ghost'}
                    className="h-7 flex-1 text-xs"
                    aria-pressed={draft.traceOptions!.mode === mode}
                    onClick={() =>
                      state.change((d) =>
                        d.mode === 'shapes' && d.traceOptions
                          ? {
                              ...d,
                              traceOptions: { ...d.traceOptions, mode },
                              kind: mode === 'ink' ? 'slab' : 'walls',
                              includeHoles: mode === 'ink',
                            }
                          : d,
                      )
                    }
                  >
                    {mode === 'ink' ? 'Ink' : 'Spaces'}
                  </Button>
                ))}
              </div>
              <SliderControl
                label="Threshold"
                value={draft.traceOptions.threshold}
                min={20}
                max={240}
                step={1}
                manageHistory={false}
                onChange={(threshold) =>
                  state.change((d) =>
                    d.mode === 'shapes' && d.traceOptions
                      ? { ...d, traceOptions: { ...d.traceOptions, threshold } }
                      : d,
                  )
                }
              />
              <SliderControl
                label="Ignore specks"
                value={draft.traceOptions.minArea}
                min={4}
                max={500}
                step={4}
                manageHistory={false}
                onChange={(minArea) =>
                  state.change((d) =>
                    d.mode === 'shapes' && d.traceOptions
                      ? { ...d, traceOptions: { ...d.traceOptions, minArea } }
                      : d,
                  )
                }
              />
              <p role="status" className="text-[11px] leading-4 text-muted-foreground">
                {tracing
                  ? 'Tracing locally…'
                  : `${draft.shapes.length} contours · review before creating`}
              </p>
            </div>
          )}
          {draft.vectors && (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 flex-1 text-[11px]"
                disabled={tracing}
                onClick={state.keepVectors}
              >
                Keep SVG guide
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 flex-1 text-[11px]"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([draft.vectors!.svg], { type: 'image/svg+xml' }),
                  )
                  const a = document.createElement('a')
                  a.href = url
                  a.download = 'plan-vectors.svg'
                  a.click()
                  setTimeout(() => URL.revokeObjectURL(url), 1000)
                }}
              >
                Download SVG
              </Button>
            </div>
          )}
          <SectionLabel>
            Create as{' '}
            <span className="text-foreground">{KINDS.find((k) => k.kind === draft.kind)?.label}</span>
          </SectionLabel>
          <div
            className="grid grid-cols-8 gap-0.5 rounded-lg border border-border/50 bg-[#2C2C2E] p-[3px]"
            role="group"
            aria-label="Primitive type"
          >
            {KINDS.map(({ kind, label, icon: Icon }) => {
              const selected = draft.kind === kind
              return (
                <button
                  key={kind}
                  type="button"
                  aria-label={label}
                  aria-pressed={selected}
                  title={label}
                  className={cn(
                    'flex h-7 items-center justify-center rounded-md outline-none transition-[color,background-color,box-shadow,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.94]',
                    selected
                      ? 'bg-[#3e3e3e] text-foreground shadow-sm ring-1 ring-border/50'
                      : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
                  )}
                  onClick={() =>
                    state.change((d) =>
                      d.mode === 'shapes'
                        ? {
                            ...d,
                            kind,
                            height:
                              kind === 'balcony'
                                ? 0
                                : kind === 'slab'
                                  ? Math.min(0.18, d.floorHeight)
                                  : d.floorHeight,
                            balcony: d.balcony ?? { ...DEFAULT_BALCONY },
                          }
                        : d,
                    )
                  }
                >
                  <Icon
                    className={cn(
                      'size-4 transition-colors duration-150',
                      selected && 'text-primary',
                    )}
                    strokeWidth={1.75}
                  />
                </button>
              )
            })}
          </div>
          {(draft.kind === 'door' || draft.kind === 'window' || draft.kind === 'prop') && (
            <>
              <SegmentedControl
                aria-label="Symbol grouping"
                className="h-7"
                value={draft.symbolGrouping ?? 'touching'}
                onChange={(symbolGrouping) =>
                  state.change((d) => (d.mode === 'shapes' ? { ...d, symbolGrouping } : d))
                }
                options={[
                  {
                    value: 'touching',
                    label: 'Touching shapes',
                    title: `Shapes that touch form one ${draft.kind}; separate clusters stay separate`,
                  },
                  {
                    value: 'separate',
                    label: 'Each shape',
                    title: `Every selected shape becomes its own ${draft.kind}`,
                  },
                ]}
              />
              {draft.kind === 'prop' ? (
                <PropPicker draft={draft} frames={preview.propFrames} />
              ) : (
                !preview.error && (
                  <Hint
                    live
                    title="Openings sit on a wall, or span a gap between two wall ends — the missing wall segment is added for you."
                  >
                    {openingSummary(draft.kind, preview.nodes, draft.selected.length)}
                  </Hint>
                )
              )}
            </>
          )}
          {draft.kind === 'unit' && (
            <Hint title="Each area becomes an apartment Unit. Use the Units list to assign its room zones.">
              Each area becomes an apartment unit.
            </Hint>
          )}
          {draft.kind === 'balcony' && (
            <>
              <BalconyControls
                value={draft.balcony ?? DEFAULT_BALCONY}
                edges={candidates.some((s) => s.stroke && draft.selected.includes(s.id))}
                areaEdges={
                  draft.selected.length === 1
                    ? (candidates.find((s) => !s.stroke && s.id === draft.selected[0])?.points
                        .length ?? 0)
                    : 0
                }
                onChange={(balcony) =>
                  state.change((d) =>
                    d.mode === 'shapes'
                      ? {
                          ...d,
                          balcony,
                          height: balconyElevation(d.height, d.floorHeight, balcony),
                        }
                      : d,
                  )
                }
              />
              <Hint title="Each area becomes a separate balcony. Edges next to existing walls stay open. Select a slab or railing afterward to change its balcony style.">
                Each area becomes its own balcony.
              </Hint>
            </>
          )}
          {!draft.fillAsWall &&
            draft.kind !== 'door' &&
            draft.kind !== 'window' &&
            draft.kind !== 'prop' &&
            candidates.some((s) => draft.selected.includes(s.id) && s.holes.length) && (
              <CheckRow
                label="Include inner contours"
                checked={draft.includeHoles}
                onChange={(includeHoles) =>
                  state.change((d) => (d.mode === 'shapes' ? { ...d, includeHoles } : d))
                }
              />
            )}
          {draft.kind === 'walls' && (
            <CheckRow
              label="Fill = wall body"
              checked={draft.fillAsWall}
              onChange={(fillAsWall) =>
                state.change((d) => (d.mode === 'shapes' ? { ...d, fillAsWall } : d))
              }
            />
          )}
          {draft.kind === 'walls' && draft.fillAsWall && (
            <Hint title="Selected areas become one thick wall along the band's centreline. Works on uniform-width bands; other shapes still outline their contours.">
              Bands become one wall on their centreline.
            </Hint>
          )}
          {draft.kind !== 'zone' &&
            draft.kind !== 'unit' &&
            draft.kind !== 'door' &&
            draft.kind !== 'window' &&
            draft.kind !== 'prop' && (
            <>
              <SliderControl
                label={draft.kind === 'balcony' ? 'Deck elevation' : 'Height'}
                value={draft.height}
                min={draft.kind === 'balcony' ? 0 : 0.02}
                max={
                  draft.kind === 'balcony'
                    ? Math.max(
                        0,
                        draft.floorHeight -
                          ((draft.balcony ?? DEFAULT_BALCONY).railing === 'none'
                            ? 0
                            : (draft.balcony ?? DEFAULT_BALCONY).railingHeight),
                      )
                    : draft.floorHeight
                }
                step={0.01}
                precision={2}
                unit="m"
                manageHistory={false}
                liveText
                onChange={(height) =>
                  state.change((d) =>
                    d.mode === 'shapes'
                      ? {
                          ...d,
                          height:
                            d.kind === 'balcony'
                              ? balconyElevation(
                                  height,
                                  d.floorHeight,
                                  d.balcony ?? DEFAULT_BALCONY,
                                )
                              : constrainReferenceHeight(height, d.floorHeight),
                        }
                      : d,
                  )
                }
              />
              {/* Only offered when there is something to reset. */}
              {draft.kind !== 'balcony' && draft.height !== draft.floorHeight && (
                <button
                  type="button"
                  className="ml-auto flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground outline-none transition-[color,background-color,transform] duration-150 ease-out hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.96]"
                  onClick={() =>
                    state.change((d) => (d.mode === 'shapes' ? { ...d, height: d.floorHeight } : d))
                  }
                >
                  <RotateCcw className="size-3" />
                  Floor height · {draft.floorHeight.toFixed(2)} m
                </button>
              )}
            </>
          )}
          {draft.kind !== 'balcony' &&
            draft.kind !== 'unit' &&
            draft.kind !== 'door' &&
            draft.kind !== 'window' &&
            draft.kind !== 'prop' &&
            (draft.kind === 'walls' ||
              candidates.some((s) => s.stroke && draft.selected.includes(s.id))) && (
              <SliderControl
                label={draft.kind === 'walls' ? 'Wall thickness' : 'Line width'}
                value={draft.thickness}
                min={0.02}
                max={1}
                step={0.01}
                precision={2}
                unit="m"
                manageHistory={false}
                liveText
                onChange={(thickness) =>
                  state.change((d) => (d.mode === 'shapes' ? { ...d, thickness } : d))
                }
              />
            )}
          {draft.kind === 'walls' && preview.reusedWallCount > 0 && (
            <Hint live title="Adjacent units share one wall automatically.">
              {preview.nodes.length
                ? `${preview.reusedWallCount} existing shared walls reused`
                : 'These walls already exist.'}
            </Hint>
          )}
          {message && (
            // Keyed so each new creation replays the entrance and reads as fresh feedback.
            <p
              key={message}
              role="status"
              className="flex items-start gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1.5 text-[11px] leading-4 text-emerald-300 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:translate-y-0.5 starting:opacity-0 motion-reduce:transition-none"
            >
              <Check className="mt-px size-3 shrink-0" strokeWidth={2.5} />
              {message}
            </p>
          )}
          {feedback}
          {/* Pinned to the panel's bottom edge so Create never scrolls out of reach. */}
          <div className="sticky -bottom-2.5 -mx-2.5 -mb-2.5 flex items-center gap-1 border-t border-border/60 bg-background/95 px-2.5 pt-2 pb-2.5 backdrop-blur-xl [@media(prefers-reduced-transparency:reduce)]:bg-background">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-lg px-2.5 text-xs transition-[background-color,transform] duration-150 ease-out active:scale-[0.96]"
              disabled={candidates.length > 512 || !candidates.length}
              onClick={() =>
                state.change((d) =>
                  d.mode === 'shapes'
                    ? { ...d, selected: workspaceShapeCandidates(d).map((s) => s.id) }
                    : d,
                )
              }
            >
              All
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-lg px-2.5 text-xs transition-[background-color,transform] duration-150 ease-out active:scale-[0.96]"
              disabled={!draft.selected.length}
              onClick={() =>
                state.change((d) => (d.mode === 'shapes' ? { ...d, selected: [] } : d))
              }
            >
              Clear
            </Button>
            <Button
              size="sm"
              className="h-7 flex-1 rounded-lg text-xs tabular-nums transition-[background-color,opacity,transform] duration-150 ease-out active:scale-[0.97]"
              disabled={tracing || !preview.nodes.length || !!preview.error}
              onClick={state.commit}
            >
              {createLabel(draft.kind, preview.nodes)}
            </Button>
          </div>
        </>
      )}
      {draft.mode === 'references' && feedback}
    </section>
  )
}
