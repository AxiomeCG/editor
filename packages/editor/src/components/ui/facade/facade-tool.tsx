'use client'
import { type AnyNodeId, readWallFacade, useScene } from '@pascal-app/core'
import type { FacadeScope } from '@pascal-app/core/building'
import { useViewer } from '@pascal-app/viewer'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { applyFacade, detachFacade, removeFacade } from '../../../lib/facade-fill'
import { facadeApplyTargets, facadeWallIds } from '../../../lib/use-facade-preview'
import { useFacadeTool } from '../../../store/use-facade-tool'
import { SegmentedControl } from '../controls/segmented-control'
import { Button } from '../primitives/button'
import { FacadeElevation } from './facade-elevation'

export function FacadeTool() {
  const unit = useFacadeTool((s) => s.unit)
  const scope = useFacadeTool((s) => s.scope)
  const { setScope, setUnit, openStudio, setPreviewing } = useFacadeTool.getState()
  useEffect(() => () => setPreviewing(false), [setPreviewing])
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const nodes = useScene((s) => s.nodes)
  const readOnly = useScene((s) => s.readOnly)
  const [message, setMessage] = useState('')
  const [applying, setApplying] = useState(false)
  /** Walls in the target whose facade is detached: applying needs the user's go-ahead. */
  const [detachedInTarget, setDetachedInTarget] = useState<{ count: number; reason?: string } | null>(
    null,
  )

  const wallIds = facadeWallIds(nodes, selectedIds)
  const live = wallIds
    .map((id) => readWallFacade(nodes[id as AnyNodeId]!.metadata))
    .filter((facade) => facade && !facade.detached)
  const detachedConfig = wallIds
    .map((id) => readWallFacade(nodes[id as AnyNodeId]!.metadata))
    .find((facade) => facade?.detached)
  const detached = !!detachedConfig
  const run = (action: () => string) => {
    try {
      setMessage(action())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Something went wrong.')
    }
  }

  /**
   * Show progress until the viewer has rebuilt what the fill touched: planning
   * takes a frame, the walls and openings appear over the next few.
   */
  const withProgress = (action: () => void) => {
    setApplying(true)
    const started = performance.now()
    const settle = () => {
      if (useScene.getState().dirtyNodes.size > 0 && performance.now() - started < 8000)
        requestAnimationFrame(settle)
      else setApplying(false)
    }
    // Two frames, so the spinner paints before the synchronous fill runs.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        try {
          action()
        } finally {
          requestAnimationFrame(settle)
        }
      }),
    )
  }

  const apply = (force = false) => {
    const current = useScene.getState().nodes
    if (!wallIds.length) return setMessage('Select a wall first.')
    let target: ReturnType<typeof facadeApplyTargets>
    try {
      target = facadeApplyTargets(current, wallIds, scope)
    } catch (error) {
      return setMessage(error instanceof Error ? error.message : 'Something went wrong.')
    }
    const { walls, targets } = target
    const held = walls
      .map((wall) => readWallFacade(wall.metadata))
      .filter((facade) => facade?.detached)
    if (held.length && !force) {
      setMessage('')
      return setDetachedInTarget({ count: held.length, reason: held[0]?.detachedReason })
    }
    setDetachedInTarget(null)
    withProgress(() =>
      run(() => {
        const result = applyFacade(
          walls.map((wall) => wall.id),
          unit,
          { targets, force },
        )
        const skipped = result.skipped
          ? ` ${result.skipped} ${result.skipped === 1 ? 'placement was' : 'placements were'} skipped to avoid overlaps or wall seams.`
          : ''
        return `Facade applied to ${result.walls} ${result.walls === 1 ? 'wall' : 'walls'}.${skipped}`
      }),
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-3 pb-3" aria-label="Facade tool">
      <h2 className="px-2 text-sm font-medium">Facade</h2>
      <p className="px-2 text-[11px] leading-4 text-muted-foreground">
        A unit is the facade between two corners. It repeats and stretches along every run of the
        walls you apply it to, restarting at each corner and wherever a wall meets the facade.
      </p>

      <div className="mx-2 flex flex-col gap-2 rounded-lg border border-border/50 p-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm">{unit.name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {unit.bays.length} {unit.bays.length === 1 ? 'bay' : 'bays'}
          </span>
        </div>
        <FacadeElevation unit={unit} width={8} height={3} compact className="h-24" />
        <Button size="sm" variant="outline" className="text-xs" onClick={openStudio}>
          Design unit
        </Button>
      </div>

      <fieldset disabled={readOnly} className="flex flex-col gap-2 px-2 disabled:opacity-50">
        <span className="text-xs text-muted-foreground">Apply to</span>
        <SegmentedControl<FacadeScope>
          value={scope}
          onChange={setScope}
          options={[
            { value: 'wall', label: 'Selected walls' },
            { value: 'exterior', label: 'Outside loop' },
            { value: 'interior', label: 'Inside loop' },
          ]}
        />
        <Button
          size="sm"
          className="text-xs"
          disabled={!wallIds.length || applying}
          aria-busy={applying}
          onPointerEnter={() => setPreviewing(true)}
          onPointerLeave={() => setPreviewing(false)}
          onFocus={() => setPreviewing(true)}
          onBlur={() => setPreviewing(false)}
          onClick={() => {
            setPreviewing(false)
            apply()
          }}
        >
          {applying && <Loader2 className="size-3.5 animate-spin" />}
          {applying ? 'Applying…' : wallIds.length ? 'Apply facade' : 'Select a wall to apply'}
        </Button>
        {detachedInTarget && !applying && (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 p-2">
            <p className="text-[11px] leading-4 text-muted-foreground">
              {detachedInTarget.count === 1 ? 'One wall' : `${detachedInTarget.count} walls`} in this
              target {detachedInTarget.count === 1 ? 'has' : 'have'} a detached facade
              {detachedInTarget.reason ? ` (${detachedInTarget.reason.replace(/\.$/, '').toLowerCase()})` : ''}.
              Applying anyway replaces what the facade generated there, edits included; elements
              added by hand stay.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setDetachedInTarget(null)}>
                Cancel
              </Button>
              <Button size="sm" className="text-xs" onClick={() => apply(true)}>
                Apply anyway
              </Button>
            </div>
          </div>
        )}
      </fieldset>

      {(live.length > 0 || detached) && (
        <div className="mx-2 flex flex-col gap-2 rounded-lg border border-border/50 p-2">
          <span className="text-xs text-muted-foreground">
            {live.length
              ? `Selected ${live.length === 1 ? 'wall carries' : 'walls carry'} “${live[0]!.unit.name}”.`
              : `This facade no longer regenerates: ${(detachedConfig?.detachedReason ?? 'it was made editable.').replace(/^./, (c) => c.toLowerCase())}`}
          </span>
          {!live.length && detachedConfig && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              disabled={applying}
              onClick={() =>
                withProgress(() =>
                  run(() => {
                    applyFacade(wallIds, detachedConfig.unit, { force: true })
                    return 'Facade restored; what it had generated was replaced.'
                  }),
                )
              }
            >
              Restore facade
            </Button>
          )}
          {live.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => {
                  setUnit(live[0]!.unit)
                  openStudio()
                }}
              >
                Edit its unit
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() =>
                  run(() => {
                    setUnit(live[0]!.unit)
                    return `Now applying “${live[0]!.unit.name}”.`
                  })
                }
              >
                Pick up unit
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() =>
                  run(() => {
                    detachFacade(wallIds)
                    return 'Openings kept as ordinary, editable elements.'
                  })
                }
              >
                Make editable
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() =>
                  run(() => {
                    removeFacade(wallIds)
                    return 'Facade removed.'
                  })
                }
              >
                Remove
              </Button>
            </div>
          )}
        </div>
      )}

      {message && (
        <p role="status" className="px-2 text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </section>
  )
}
