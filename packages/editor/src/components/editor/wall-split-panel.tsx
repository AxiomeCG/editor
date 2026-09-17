'use client'
import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Crosshair, Scissors, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import {
  getLinearUnitLabel,
  linearControlValueToMeters,
  metersToLinearUnit,
} from '../../lib/measurements'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { useWallSplit } from '../../store/use-wall-split'
import { SliderControl } from '../ui/controls/slider-control'
import { Button } from '../ui/primitives/button'

export function WallSplitPanel() {
  const draft = useWallSplit((s) => s.draft)
  const wallId = draft?.wallId
  const unit = useViewer((s) => s.unit)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!wallId) return
    const close = useWallSplit.getState().close
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        close()
      }
    }
    const stopScene = useScene.subscribe((state, previous) => {
      if (state.readOnly || state.nodes[wallId]?.type !== 'wall') close()
      else if (state.nodes !== previous.nodes) {
        const current = useWallSplit.getState().draft
        if (current) useWallSplit.getState().update(current.preview.distance)
      }
    })
    const stopScope = useInteractionScope.subscribe(({ scope }) => {
      if (scope.kind !== 'drafting' || scope.tool !== 'wall-split') close()
    })
    const stopEditor = useEditor.subscribe((state) => {
      if (
        state.mode !== 'select' ||
        state.isCaptureMode ||
        state.isPreviewMode ||
        state.isFirstPersonMode
      )
        close()
    })
    panel.current?.focus({ preventScroll: true })
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      stopScene()
      stopScope()
      stopEditor()
    }
  }, [wallId])
  useEffect(() => () => useWallSplit.getState().close(), [])
  if (!draft) return null
  const { preview, input } = draft
  return (
    <div
      ref={panel}
      role="dialog"
      aria-labelledby="wall-split-title"
      aria-describedby="wall-split-help"
      tabIndex={-1}
      className="pointer-events-auto absolute bottom-28 left-3 z-40 w-60 space-y-2 overflow-y-auto rounded-xl border border-border bg-background/95 p-3 shadow-xl outline-none"
      style={{ maxHeight: 'calc(100% - 9rem)', maxWidth: 'calc(100% - 1.5rem)' }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <h3 id="wall-split-title" className="flex items-center gap-1.5 text-xs font-medium">
          <Scissors className="size-3.5" />
          Split wall
        </h3>
        <button
          type="button"
          aria-label="Cancel split"
          title="Cancel (Esc)"
          onClick={() => useWallSplit.getState().close()}
          className="rounded p-1 text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <SliderControl
        label="From start"
        value={metersToLinearUnit(preview.distance, unit)}
        onChange={(value) =>
          useWallSplit
            .getState()
            .update(
              linearControlValueToMeters(value, unit, { minMeters: 0, maxMeters: preview.length }),
              'distance',
            )
        }
        min={0}
        max={metersToLinearUnit(preview.length, unit)}
        unit={getLinearUnitLabel(unit)}
        step={0.01}
        precision={2}
        manageHistory={false}
        liveText
      />
      <p
        id="wall-split-help"
        className={`text-[11px] leading-4 ${preview.valid ? 'text-muted-foreground' : 'text-destructive'}`}
        role="status"
      >
        {preview.message ||
          (input === 'pointer'
            ? 'Point at the wall. Click to split at the mark.'
            : 'The mark shows the cut. Adjust or split.')}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-pressed={input === 'pointer'}
          className="h-7 flex-1 gap-1 text-xs"
          onClick={() => useWallSplit.getState().pick()}
        >
          <Crosshair className="size-3" />
          Pick point
        </Button>
        <Button
          size="sm"
          className="h-7 flex-1 text-xs"
          disabled={!preview.valid}
          onClick={() => useWallSplit.getState().commit()}
        >
          Split
        </Button>
      </div>
    </div>
  )
}
