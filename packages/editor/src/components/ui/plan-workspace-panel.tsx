'use client'

import { constrainReferenceHeight } from '@pascal-app/core/building'

import { getStoredLevelHeight, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Crosshair, Focus, RotateCcw, Upload, X } from 'lucide-react'
import { type CSSProperties, useEffect, useState } from 'react'
import { balconyElevation, DEFAULT_BALCONY } from '@pascal-app/core/building'
import { measuredPlanScale } from '../../lib/plan-reference/calibration'
import type { ReferenceImage } from '../../lib/plan-reference/guides'

import { useVectorizePlan } from '../../lib/plan-reference/use-vectorize-plan'
import { useWorkspacePreview } from '../../lib/plan-reference/use-workspace-preview'
import {
  activeReferencePoints,
  type ReferenceDraft,
  workspaceShapeCandidates,
} from '../../lib/plan-reference/workspace'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { ownsPlanWorkspace, usePlanWorkspace } from '../../store/use-plan-workspace'
import { BalconyControls } from './balcony-controls'
import { SliderControl } from './controls/slider-control'
import { Button } from './primitives/button'

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
    message = usePlanWorkspace((s) => s.message)
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
      )
        state.close()
      else if (d.mode === 'shapes' && d.floorHeight !== getStoredLevelHeight(level)) {
        const floorHeight = getStoredLevelHeight(level)
        state.change(() => ({
          ...d,
          floorHeight,
          height:
            d.kind === 'balcony'
              ? balconyElevation(d.height, floorHeight, d.balcony ?? DEFAULT_BALCONY)
              : d.height === d.floorHeight
                ? floorHeight
                : constrainReferenceHeight(d.height, floorHeight),
        }))
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
  return (
    <section
      aria-label={draft.mode === 'references' ? 'Plan references' : 'Extrude plan shapes'}
      className="fixed z-40 space-y-2 overflow-y-auto overscroll-contain rounded-xl border border-border bg-background p-3 text-foreground shadow-xl"
      style={style}
    >
      <div className="flex h-6 items-center gap-1">
        <h2 className="mr-auto text-xs font-semibold">
          {draft.mode === 'references'
            ? 'Plan references'
            : `${draft.selected.length} ${draft.selectionMode === 'edges' ? 'edges' : draft.selectionMode === 'areas' ? 'areas' : 'shapes'} selected`}
        </h2>
        <Button
          size="icon-sm"
          variant="ghost"
          className="size-7"
          aria-label="Fit reference in view"
          title="Fit reference"
          onClick={state.focus}
        >
          <Focus className="size-3.5" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="size-7"
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
          <div
            className="flex rounded-md bg-muted p-0.5"
            role="group"
            aria-label="Selection target"
          >
            {(['areas', 'edges', 'source'] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                className="h-7 flex-1 px-2 text-xs"
                variant={(draft.selectionMode ?? 'source') === mode ? 'secondary' : 'ghost'}
                aria-pressed={(draft.selectionMode ?? 'source') === mode}
                title={
                  mode === 'areas'
                    ? 'Select areas enclosed by visible lines'
                    : mode === 'edges'
                      ? 'Select individual sides and lines'
                      : 'Original SVG shapes, which may span several areas'
                }
                onClick={() => state.setSelectionMode(mode)}
              >
                {mode === 'areas' ? 'Areas' : mode === 'edges' ? 'Edges' : 'Source'}
              </Button>
            ))}
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {draft.selectionMode === 'areas'
              ? 'Click areas to add or remove them. Shift-click bypasses the height handle.'
              : draft.selectionMode === 'edges'
                ? 'Click individual edges to select them.'
                : 'Original shapes · Alt-click to pick underneath.'}
          </p>
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
          <div className="grid grid-cols-3 rounded-md bg-muted p-0.5" role="group" aria-label="Primitive type">
            {(['walls', 'slab', 'zone', 'unit', 'balcony'] as const).map((kind) => (
              <Button
                key={kind}
                size="sm"
                className="h-7 flex-1 px-2 text-xs"
                variant={draft.kind === kind ? 'secondary' : 'ghost'}
                aria-pressed={draft.kind === kind}
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
                {kind === 'walls'
                  ? 'Walls'
                  : kind === 'slab'
                    ? 'Slab'
                    : kind === 'balcony'
                      ? 'Balcony'
                      : kind === 'unit'
                        ? 'Unit'
                      : 'Zone'}
              </Button>
            ))}
          </div>
          {draft.kind === 'unit' && (
            <p className="px-2 text-[11px] leading-4 text-muted-foreground">
              Each area becomes an apartment Unit. Use the Units list to assign its room zones.
            </p>
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
              <p className="px-2 text-[11px] leading-4 text-muted-foreground">
                Each area becomes a separate balcony. Edges next to existing walls stay open. Select
                a slab or railing afterward to change its balcony style.
              </p>
            </>
          )}
          {!draft.fillAsWall &&
            candidates.some((s) => draft.selected.includes(s.id) && s.holes.length) && (
            <label className="flex items-center gap-2 px-2 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={draft.includeHoles}
                onChange={(e) =>
                  state.change((d) =>
                    d.mode === 'shapes' ? { ...d, includeHoles: e.target.checked } : d,
                  )
                }
              />
              Include inner contours
            </label>
          )}
          {draft.kind === 'walls' && (
            <label className="flex items-center gap-2 px-2 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={draft.fillAsWall}
                onChange={(e) =>
                  state.change((d) =>
                    d.mode === 'shapes' ? { ...d, fillAsWall: e.target.checked } : d,
                  )
                }
              />
              Fill = wall body
            </label>
          )}
          {draft.kind === 'walls' && draft.fillAsWall && (
            <p className="px-2 text-[11px] leading-4 text-muted-foreground">
              Selected areas become one thick wall along the band's centreline. Works on uniform-width
              bands; other shapes still outline their contours.
            </p>
          )}
          {draft.kind !== 'zone' && draft.kind !== 'unit' && (
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
              {draft.kind !== 'balcony' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-full text-[11px]"
                  aria-pressed={draft.height === draft.floorHeight}
                  onClick={() =>
                    state.change((d) => (d.mode === 'shapes' ? { ...d, height: d.floorHeight } : d))
                  }
                >
                  To floor height · {draft.floorHeight.toFixed(2)} m
                </Button>
              )}
            </>
          )}
          {draft.kind !== 'balcony' && draft.kind !== 'unit' &&
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
          {draft.kind === 'walls' && (
            <p role="status" className="px-2 text-[11px] leading-4 text-muted-foreground">
              {preview.reusedWallCount
                ? preview.nodes.length
                  ? `${preview.reusedWallCount} existing shared walls reused`
                  : 'These walls already exist.'
                : 'Adjacent units share one wall automatically.'}
            </p>
          )}
          <div className="flex items-center gap-1 border-t border-border pt-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
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
              className="h-7 px-2 text-xs"
              onClick={() =>
                state.change((d) => (d.mode === 'shapes' ? { ...d, selected: [] } : d))
              }
            >
              Clear
            </Button>
            <Button
              size="sm"
              className="h-7 flex-1 text-xs"
              disabled={tracing || !preview.nodes.length || !!preview.error}
              onClick={state.commit}
            >
              {draft.kind === 'balcony'
                ? `Create ${preview.nodes.filter((n) => n.type === 'slab').length === 1 ? 'balcony' : `${preview.nodes.filter((n) => n.type === 'slab').length || ''} balconies`}`
                : draft.kind === 'unit'
                  ? `Create ${preview.nodes.filter(n => n.type === 'unit').length} units`
                : `Create ${preview.nodes.length || ''}`}
            </Button>
          </div>
        </>
      )}
      {draft.mode === 'shapes' && (
        <>
          {message && (
            <p role="status" className="text-[11px] leading-4 text-muted-foreground">
              {message}
            </p>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-full text-xs"
            onClick={() => state.close(true)}
          >
            Done
          </Button>
        </>
      )}
      {(error || preview.error) && (
        <p role="alert" className="text-[11px] leading-4 text-destructive">
          {error || preview.error}
        </p>
      )}
    </section>
  )
}
