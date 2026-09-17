'use client'
import {
  type AnyNodeId,
  getStoredLevelHeight,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type BalconyOptions, DEFAULT_BALCONY } from '@pascal-app/core/building'
import {
  applyBalconyStyle,
  type BalconyStylePatch,
  balconyRailingStyle,
  planBalconyStyle,
  selectedBalconies,
} from '../../lib/balcony-style'
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
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </PanelSection>
  )
}
