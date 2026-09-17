'use client'
import { runAsSingleSceneHistoryStep, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { selectedBalconies } from '../../lib/balcony-style'
import { planSelectedBalconies, useBalconyPreview } from '../../lib/use-balcony-preview'
import { useBalconyTool } from '../../store/use-balcony-tool'
import { BalconyControls } from './balcony-controls'
import { BalconySelectionControls } from './balcony-selection-controls'
import { SliderControl } from './controls/slider-control'
import { Button } from './primitives/button'

export function BalconyTool() {
  const { options, elevation, setOptions, setElevation, setActive } = useBalconyTool()
  const preview = useBalconyPreview(),
    [message, setMessage] = useState('')
  const ids = useViewer((s) => s.selection.selectedIds)
  const nodes = useScene((s) => s.nodes)
  const editing = selectedBalconies(nodes, ids).length > 0
  const readOnly = useScene((s) => s.readOnly)
  useEffect(() => {
    setActive(true)
    return () => setActive(false)
  }, [setActive])
  const create = () => {
    if (useScene.getState().readOnly) return
    try {
      const { nodes } = useScene.getState(),
        { selection } = useViewer.getState()
      const level = selection.levelId ? nodes[selection.levelId] : undefined
      if (level?.type !== 'level') throw Error('Select an editable floor.')
      const parts = planSelectedBalconies(nodes, selection.selectedIds, level, options, elevation)
      if (!parts.length) throw Error('Select a wall or zone first.')
      runAsSingleSceneHistoryStep(useScene, () =>
        useScene.getState().createNodes(parts.map((node) => ({ node, parentId: level.id }))),
      )
      useViewer.getState().setSelection({ selectedIds: parts.map((n) => n.id) })
      setMessage('Balcony created. The slab and railings are independently editable.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not create balcony.')
    }
  }
  const slabs = preview.nodes.filter((n) => n.type === 'slab')
  if (editing) return <BalconySelectionControls />
  return (
    <section className="flex min-w-0 flex-col gap-3 pb-3" aria-label="Balcony tool">
      <h2 className="px-2 text-sm font-medium">Balcony</h2>
      <p className="px-2 text-[11px] leading-4 text-muted-foreground">
        Select walls to project a balcony, or a zone to use its outline. The purple preview shows
        what will be created.
      </p>
      <fieldset disabled={readOnly} className="flex flex-col gap-2 disabled:opacity-50">
        <BalconyControls
          value={options}
          onChange={setOptions}
          edges={!slabs.length || slabs.some((s) => !!s.metadata.balconySourceWall)}
          areaEdges={
            slabs.length === 1 && !slabs[0]!.metadata.balconySourceWall
              ? slabs[0]!.polygon.length
              : 0
          }
        />
        <SliderControl
          label="Elevation offset"
          value={elevation}
          min={0}
          max={20}
          step={0.05}
          unit="m"
          precision={2}
          manageHistory={false}
          restoreOnCommit={false}
          liveText
          onChange={setElevation}
        />
        <Button
          size="sm"
          className="text-xs"
          disabled={!preview.nodes.length || !!preview.error}
          onClick={create}
        >
          Create {slabs.length > 1 ? `${slabs.length} balconies` : 'balcony'}
        </Button>
      </fieldset>
      <p className="px-2 text-[11px] leading-4 text-muted-foreground">
        For an SVG: select Areas or Edges in the reference tool, then choose Balcony.
      </p>
      {(preview.error || message) && (
        <p role={preview.error ? 'alert' : 'status'} className="px-2 text-xs text-muted-foreground">
          {preview.error || message}
        </p>
      )}
    </section>
  )
}
