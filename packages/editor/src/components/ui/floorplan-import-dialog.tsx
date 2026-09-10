'use client'

import type { BuildingNode, LevelNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { CheckCircle2, Loader2, RotateCw, Ruler } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { useReducedMotion } from 'motion/react'
import type { FloorplanImportProvider } from '../../lib/floorplan-import/curated'
import { applyFloorplanReconstruction, type FloorplanImportResult, type FloorplanTarget } from '../../lib/floorplan-import/native'
import type { PlanPoint } from '../../lib/floorplan-import/schema'
import { useFloorplanImportPlacement } from '../../store/use-floorplan-import-placement'
import useEditor from '../../store/use-editor'
import { Button } from './primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './primitives/dialog'

const inputClassName = 'h-9 min-w-0 w-full rounded-md border bg-background px-2 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring'

function PlacementField({ label, value, step, disabled, onChange }: {
  label: string; value: number; step: number; disabled: boolean; onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return <label className="min-w-0 flex-1 space-y-1 text-xs">{label}<input className={inputClassName}
    type="number" step={step} disabled={disabled} value={draft ?? Number(value.toFixed(3))}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => {
      if (draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft))) onChange(Number(draft))
      setDraft(null)
    }}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(null) }
    }} /></label>
}

export function FloorplanImportDialog({ open, level, target, targetError, floorplanImport, restoreFocusRef, onOpenChange, onApplied }: {
  open: boolean
  level: LevelNode
  target: FloorplanTarget | null
  targetError: string | null
  floorplanImport?: FloorplanImportProvider
  restoreFocusRef: RefObject<HTMLButtonElement | null>
  onOpenChange: (open: boolean) => void
  onApplied: (result: FloorplanImportResult) => void
}) {
  const owner = useId()
  const source = useFloorplanImportPlacement(s => s.source)
  const reconstruction = useFloorplanImportPlacement(s => s.reconstruction)
  const placement = useFloorplanImportPlacement(s => s.placement)
  const opacity = useFloorplanImportPlacement(s => s.opacity)
  const activeLevel = useViewer(s => s.selection.levelId)
  const reduceMotion = useReducedMotion()
  const [busy, setBusy] = useState<'generate' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [points, setPoints] = useState<PlanPoint[]>([])
  const [distance, setDistance] = useState('')
  const [picking, setPicking] = useState(false)
  const [cursor, setCursor] = useState<PlanPoint>([0, 0])
  const image = useRef<HTMLImageElement>(null)
  const imageButton = useRef<HTMLButtonElement>(null)
  const operation = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open || !floorplanImport) return
    const store = useFloorplanImportPlacement.getState()
    store.claim(owner, floorplanImport.source, target)
    setError(null); setPoints([]); setDistance(''); setPicking(false); setBusy(null)
    useEditor.getState().setTool(null)
    if (target) useViewer.getState().setSelection({ buildingId: target.buildingId as BuildingNode['id'], levelId: target.levelId as LevelNode['id'], selectedIds: [] })
    const unsubscribe = useFloorplanImportPlacement.subscribe(state => {
      if (state.owner && state.owner !== owner) { operation.current?.abort(); onOpenChange(false) }
    })
    return () => { unsubscribe(); operation.current?.abort(); useFloorplanImportPlacement.getState().release(owner) }
  }, [open, floorplanImport, target, owner, onOpenChange])

  const measuredScale = useMemo(() => {
    if (points.length !== 2 || !Number.isFinite(Number(distance)) || Number(distance) <= 0) return null
    const pixels = Math.hypot(points[1]![0] - points[0]![0], points[1]![1] - points[0]![1])
    const scale = Number(distance) / pixels
    return pixels >= 1 && scale >= .0001 && scale <= .2 ? scale : null
  }, [points, distance])
  useEffect(() => {
    if (!measuredScale || !open) return
    operation.current?.abort()
    useFloorplanImportPlacement.getState().setScale(owner, measuredScale)
  }, [measuredScale, owner, open])

  const pick = (point: PlanPoint) => {
    setPoints(previous => previous.length === 2 ? [point] : [...previous, point])
    if (points.length === 1) setPicking(false)
  }
  const generate = async (withMotion: boolean) => {
    if (!floorplanImport || !source || !target || busy) return
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller
    setBusy('generate'); setError(null)
    try {
      const result = await floorplanImport.reconstruct({ metersPerPixel: source.metersPerPixel, wallHeight: target.levelHeight }, { signal: controller.signal })
      controller.signal.throwIfAborted()
      useFloorplanImportPlacement.getState().show(owner, result, withMotion && !reduceMotion)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'The prepared plan could not be generated.')
    } finally { if (operation.current === controller) { operation.current = null; setBusy(null) } }
  }
  const confirm = async () => {
    if (!reconstruction || !target || busy || activeLevel !== target.levelId) return
    const controller = new AbortController(); operation.current = controller
    useFloorplanImportPlacement.getState().setCommitting(owner, true)
    setBusy('apply'); setError(null)
    try {
      const result = await applyFloorplanReconstruction({ reconstruction, target, placement, opacity, signal: controller.signal })
      onApplied(result); onOpenChange(false)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'The floorplan could not be imported.')
    } finally {
      useFloorplanImportPlacement.getState().setCommitting(owner, false)
      if (operation.current === controller) { operation.current = null; setBusy(null) }
    }
  }
  const wrongFloor = !!target && activeLevel !== target.levelId

  return <Dialog open={open} modal={false} onOpenChange={onOpenChange}>
    <DialogContent className="top-20 right-4 left-auto max-h-[calc(100vh-6rem)] w-[360px] max-w-[calc(100vw-2rem)] translate-x-0 translate-y-0 gap-4 overflow-y-auto p-4 sm:max-w-[360px]"
      onInteractOutside={event => event.preventDefault()}
      onCloseAutoFocus={event => { event.preventDefault(); restoreFocusRef.current?.focus() }}>
      <DialogHeader>
        <DialogTitle>Import floorplan</DialogTitle>
        <DialogDescription>{target?.levelName ?? level.name ?? 'Selected floor'} · Replicate + Astra</DialogDescription>
      </DialogHeader>
      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-2 text-xs"><span className="font-medium">Prewarmed example</span><span className="text-muted-foreground">No model charge</span></div>
        <p className="mt-1 text-xs text-muted-foreground">Saved detection and review from the three-bedroom plan. Generate native Pascal geometry locally.</p>
      </div>
      {!floorplanImport && <p role="alert" className="text-sm text-destructive">This editor host has not supplied the prepared floorplan.</p>}
      {source && <>
        <div className="rounded-lg border bg-white p-2 text-center">
          <button ref={imageButton} type="button" className={`relative inline-block max-w-full outline-none focus-visible:ring-2 focus-visible:ring-primary ${picking ? 'cursor-crosshair ring-2 ring-primary' : ''}`}
            aria-label={picking ? 'Choose two scale points. Arrow keys move the pixel cursor; Enter selects.' : 'Source floorplan'}
            onClick={event => {
              if (!picking || !image.current || event.detail === 0) return
              const rect = image.current.getBoundingClientRect()
              const x = (event.clientX - rect.left) / rect.width * source.width, y = (event.clientY - rect.top) / rect.height * source.height
              if (x >= 0 && y >= 0 && x <= source.width && y <= source.height) pick([x, y])
            }}
            onKeyDown={event => {
              if (!picking) return
              if (event.key.startsWith('Arrow')) { event.preventDefault(); const step = event.shiftKey ? 10 : 1
                setCursor(([x, y]) => [Math.max(0, Math.min(source.width, x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0))), Math.max(0, Math.min(source.height, y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)))])
              } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(cursor) }
            }}>
            <img ref={image} src={source.imageUrl} alt={source.name} className="block max-h-60 w-auto max-w-full" />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${source.width} ${source.height}`} aria-hidden="true">
              {points.length === 2 && <line x1={points[0]![0]} y1={points[0]![1]} x2={points[1]![0]} y2={points[1]![1]} stroke="#2166d1" strokeWidth={3} />}
              {points.map(([x, y], index) => <circle key={index} cx={x} cy={y} r={7} fill="#2166d1" stroke="white" strokeWidth={2} />)}
              {picking && <path d={`M ${cursor[0] - 10} ${cursor[1]} h20 M ${cursor[0]} ${cursor[1] - 10} v20`} stroke="#2166d1" strokeWidth={2} />}
            </svg>
          </button>
        </div>
        <div className="space-y-2">
          <Button type="button" variant="outline" size="sm" className="w-full" disabled={busy === 'apply'} onClick={() => { setPoints([]); setPicking(true); setCursor([source.width / 2, source.height / 2]); imageButton.current?.focus() }}><Ruler className="mr-2 size-4" />Set scale from two points</Button>
          {(picking || points.length > 0) && <label className="block space-y-1 text-xs">Known distance · metres<input className={inputClassName} type="number" inputMode="decimal" min="0.001" step="any" value={distance} disabled={busy === 'apply'} onChange={event => setDistance(event.target.value)} aria-describedby="floorplan-calibration-note" /></label>}
          <p id="floorplan-calibration-note" className="text-xs text-muted-foreground">{measuredScale ? `Measured scale: ${measuredScale.toFixed(6)} m/px.` : points.length ? `${points.length}/2 points selected. Enter their real distance.` : `Prepared scale: ${source.metersPerPixel.toFixed(6)} m/px. Measure a known dimension to recalibrate.`}</p>
        </div>
        <Button type="button" disabled={!target || !!busy || (points.length > 0 && !measuredScale)} onClick={event => void generate(event.detail !== 0)}>
          {busy === 'generate' ? <Loader2 className="mr-2 size-4 animate-spin" /> : reconstruction ? <CheckCircle2 className="mr-2 size-4" /> : null}
          {busy === 'generate' ? 'Building native geometry…' : reconstruction ? 'Regenerate preview' : 'Generate prewarmed plan'}
        </Button>
        {reconstruction && <p className="text-xs text-muted-foreground">{reconstruction.counts.walls} walls · {reconstruction.counts.openings} openings · {reconstruction.counts.zones} named zones · {reconstruction.counts.items} approximate props</p>}
        <section className="space-y-3 border-t pt-3" aria-labelledby="floorplan-placement-title">
          <h3 id="floorplan-placement-title" className="text-sm font-medium">Place on this floor</h3>
          <p className="text-xs text-muted-foreground">Drag the reference image in 2D or 3D. Position and rotation apply to the complete reconstruction.</p>
          <div className="grid grid-cols-2 gap-2">
            <PlacementField label="X · metres" value={placement.x} step={.1} disabled={busy === 'apply'} onChange={x => useFloorplanImportPlacement.getState().move(owner, { x })} />
            <PlacementField label="Z · metres" value={placement.z} step={.1} disabled={busy === 'apply'} onChange={z => useFloorplanImportPlacement.getState().move(owner, { z })} />
          </div>
          <div className="flex items-end gap-2"><PlacementField label="Rotation · degrees" value={placement.rotation * 180 / Math.PI} step={15} disabled={busy === 'apply'} onChange={degrees => useFloorplanImportPlacement.getState().move(owner, { rotation: degrees * Math.PI / 180 })} />
            <Button type="button" variant="outline" size="icon" aria-label="Rotate floorplan 90 degrees" disabled={busy === 'apply'} onClick={() => useFloorplanImportPlacement.getState().move(owner, { rotation: placement.rotation + Math.PI / 2 })}><RotateCw className="size-4" /></Button></div>
          <label className="block space-y-1 text-xs">Reference opacity · {opacity}%<input className="w-full accent-primary" type="range" min="0" max="100" step="1" value={opacity} disabled={busy === 'apply'} onChange={event => useFloorplanImportPlacement.getState().setOpacity(owner, Number(event.target.value))} /></label>
        </section>
        <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">Nothing is added until you confirm. Geometry and open-plan zones are approximations; the source image is retained as an editable reference. Cancel leaves the scene unchanged.</p>
      </>}
      {(targetError || error || wrongFloor) && <p role="alert" className="text-sm text-destructive">{targetError || error || 'Return to the target floor before confirming this import.'}</p>}
      <DialogFooter className="sticky -bottom-4 -mx-4 -mb-4 border-t bg-background p-4">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="button" disabled={!reconstruction || !!busy || !!targetError || wrongFloor} onClick={() => void confirm()}>{busy === 'apply' && <Loader2 className="mr-2 size-4 animate-spin" />}Confirm import</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
