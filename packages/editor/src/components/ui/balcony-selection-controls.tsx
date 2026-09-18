'use client'
import {
  type AnyNode,
  type AnyNodeId,
  getStoredLevelHeight,
  runAsSingleSceneHistoryStep,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import {
  type BalconyOpeningKind,
  type BalconyOptions,
  DEFAULT_BALCONY,
  planBalconyOpening,
} from '@pascal-app/core/building'
import { useViewer } from '@pascal-app/viewer'
import { DoorOpen, Grid2x2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyBalconyStyle,
  type BalconyStylePatch,
  balconyRailingStyle,
  planBalconyStyle,
  selectedBalconies,
} from '../../lib/balcony-style'
import { ActionButton, ActionGroup } from './controls/action-button'
import { PanelSection } from './controls/panel-section'
import { SliderControl } from './controls/slider-control'
import { previewMultiNodeFields } from './panels/multi-field-value'

export function BalconySelectionControls() {
  const ids = useViewer((s) => s.selection.selectedIds)
  const nodes = useScene((s) => s.nodes),
    readOnly = useScene((s) => s.readOnly)
  const [error, setError] = useState('')
  const previewFields = useRef(new Map<AnyNodeId, string[]>())
  const clearPreview = useCallback(() => {
    for (const [id, fields] of previewFields.current) {
      useLiveNodeOverrides.getState().clearFields(id, fields)
      useScene.getState().markDirty(id)
    }
    previewFields.current.clear()
  }, [])
  useEffect(() => {
    void ids // A changed selection ends the previous preview session.
    return clearPreview
  }, [ids, clearPreview])
  const balconies = selectedBalconies(nodes, ids)
  if (!balconies.length) return null
  const guards = balconies.flatMap((b) => b.guards)
  const styles = new Set(
    balconies.flatMap((b) => (b.guards.length ? b.guards.map(balconyRailingStyle) : ['none'])),
  )
  const style = styles.size === 1 ? [...styles][0]! : ''
  const height = guards[0]?.height ?? DEFAULT_BALCONY.railingHeight
  const maxHeight = Math.min(
    3,
    ...balconies.map(({ slab }) => {
      const level = slab.parentId ? nodes[slab.parentId as AnyNodeId] : undefined
      return level?.type === 'level' ? getStoredLevelHeight(level) - slab.elevation : 0
    }),
  )
  const disabled =
    readOnly ||
    balconies.some((b) =>
      [b.slab, ...b.guards].some((n) => n.metadata.linkedArray || n.metadata.facadeOwner),
    )
  const change = (patch: BalconyStylePatch) => {
    clearPreview()
    try {
      applyBalconyStyle(ids, patch)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update this balcony.')
    }
  }
  // One opening per selected balcony, planned in turn so two decks on the same
  // wall don't claim the same stretch; all in one undo step.
  const addAccess = (kind: BalconyOpeningKind) => {
    clearPreview()
    try {
      let working: Record<string, AnyNode> = useScene.getState().nodes
      const openings = balconies.map(({ slab }) => {
        const opening = planBalconyOpening(slab, working, kind)
        const wall = working[opening.parentId!] as WallNode
        working = {
          ...working,
          [opening.id]: opening,
          [wall.id]: { ...wall, children: [...wall.children, opening.id] },
        }
        return opening
      })
      runAsSingleSceneHistoryStep(useScene, () =>
        useScene
          .getState()
          .createNodes(openings.map((node) => ({ node, parentId: node.parentId as AnyNodeId }))),
      )
      // Select what was added so its size and position can be tuned right away.
      useViewer.getState().setSelection({ selectedIds: openings.map((opening) => opening.id) })
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : `Unable to add a ${kind}.`)
    }
  }
  const preview = (patch: BalconyStylePatch) => {
    if (disabled) return
    try {
      const plan = planBalconyStyle(useScene.getState().nodes, ids, patch)
      const entries = plan.update.map(({ id, data }) => {
        const { metadata: _metadata, ...fields } = data
        previewFields.current.set(id, Object.keys(fields))
        return [id, fields] as const
      })
      previewMultiNodeFields(entries)
      setError('')
    } catch (e) {
      clearPreview()
      setError(e instanceof Error ? e.message : 'Unable to preview this style.')
    }
  }
  return (
    <PanelSection title={balconies.length === 1 ? 'Balcony' : `${balconies.length} balconies`}>
      <p className="text-[11px] leading-4 text-muted-foreground">
        {disabled
          ? 'Edit the source, or make linked copies real first.'
          : 'Style applies to the whole balcony. Each part stays editable.'}
      </p>
      <fieldset disabled={disabled} className="space-y-1 disabled:opacity-50">
        <label className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          Railing
          <select
            aria-label="Selected balcony railing"
            value={style}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-foreground"
            onChange={(e) => change({ railing: e.target.value as BalconyOptions['railing'] })}
          >
            {styles.size > 1 && (
              <option value="" disabled>
                Mixed
              </option>
            )}
            <option value="slat">Vertical bars</option>
            <option value="rail">Horizontal rails</option>
            <option value="glass">Glass</option>
            <option value="none">None</option>
          </select>
        </label>
        {guards.length > 0 && style !== 'none' && (
          <SliderControl
            label="Railing height"
            unit="m"
            precision={2}
            step={0.05}
            min={0.3}
            max={maxHeight}
            value={height}
            mixed={guards.some((g) => g.height !== height)}
            manageHistory={false}
            restoreOnCommit={false}
            onChange={(railingHeight) => preview({ railingHeight })}
            onCommit={(railingHeight) => change({ railingHeight })}
            disabled={disabled || maxHeight < 0.3}
          />
        )}
        <SliderControl
          label="Slab thickness"
          unit="m"
          precision={2}
          step={0.01}
          min={0.02}
          max={1}
          value={balconies[0]!.slab.thickness}
          mixed={balconies.some((b) => b.slab.thickness !== balconies[0]!.slab.thickness)}
          manageHistory={false}
          restoreOnCommit={false}
          onChange={(thickness) => preview({ thickness })}
          onCommit={(thickness) => change({ thickness })}
          disabled={disabled}
        />
      </fieldset>
      <div className="space-y-1.5 border-border/50 border-t pt-2">
        <p className="text-[11px] leading-4 text-muted-foreground">
          Access: opens the wall the balcony runs along.
        </p>
        <ActionGroup>
          <ActionButton
            icon={<Grid2x2 className="size-3.5" />}
            label="Add window"
            disabled={disabled}
            onClick={() => addAccess('window')}
          />
          <ActionButton
            icon={<DoorOpen className="size-3.5" />}
            label="Add French door"
            disabled={disabled}
            onClick={() => addAccess('door')}
          />
        </ActionGroup>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </PanelSection>
  )
}
