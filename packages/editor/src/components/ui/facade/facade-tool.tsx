'use client'
import { type AnyNode, type AnyNodeId, readWallFacade, useScene, type WallNode } from '@pascal-app/core'
import { type FacadeScope, facadeScopeTargets } from '@pascal-app/core/building'
import { useViewer } from '@pascal-app/viewer'
import { useState } from 'react'
import { applyFacade, detachFacade, removeFacade } from '../../../lib/facade-fill'
import { useFacadeTool } from '../../../store/use-facade-tool'
import { SegmentedControl } from '../controls/segmented-control'
import { Button } from '../primitives/button'
import { FacadeElevation } from './facade-elevation'

/** A generated opening or balcony stands for the wall whose facade made it. */
function facadeWallIds(nodes: Record<string, AnyNode>, ids: readonly string[]) {
  const walls = new Set<WallNode['id']>()
  for (const id of ids) {
    const node = nodes[id]
    if (node?.type === 'wall') walls.add(node.id)
    const owner = node?.metadata.facadeOwner
    if (typeof owner === 'string' && nodes[owner]?.type === 'wall') walls.add(owner as WallNode['id'])
  }
  return [...walls]
}

export function FacadeTool() {
  const unit = useFacadeTool((s) => s.unit)
  const scope = useFacadeTool((s) => s.scope)
  const { setScope, setUnit, openStudio } = useFacadeTool.getState()
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const nodes = useScene((s) => s.nodes)
  const readOnly = useScene((s) => s.readOnly)
  const [message, setMessage] = useState('')

  const wallIds = facadeWallIds(nodes, selectedIds)
  const live = wallIds
    .map((id) => readWallFacade(nodes[id as AnyNodeId]!.metadata))
    .filter((facade) => facade && !facade.detached)
  const detached = wallIds.some((id) => readWallFacade(nodes[id as AnyNodeId]!.metadata)?.detached)
  const run = (action: () => string) => {
    try {
      setMessage(action())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Something went wrong.')
    }
  }

  const apply = () =>
    run(() => {
      const current = useScene.getState().nodes
      if (!wallIds.length) throw Error('Select a wall first.')
      const picked = current[wallIds[0] as AnyNodeId] as WallNode
      const { walls, targets } =
        scope === 'wall'
          ? { walls: wallIds.map((id) => current[id as AnyNodeId] as WallNode), targets: {} }
          : facadeScopeTargets(current, picked, scope)
      const result = applyFacade(
        walls.map((wall) => wall.id),
        unit,
        { targets },
      )
      const skipped = result.skipped
        ? ` ${result.skipped} ${result.skipped === 1 ? 'placement was' : 'placements were'} skipped to avoid overlaps or wall seams.`
        : ''
      return `Facade applied to ${result.walls} ${result.walls === 1 ? 'wall' : 'walls'}.${skipped}`
    })

  return (
    <section className="flex min-w-0 flex-col pier-3 pb-3" aria-label="Facade tool">
      <h2 className="px-2 text-sm font-medium">Facade</h2>
      <p className="px-2 text-[11px] leading-4 text-muted-foreground">
        A unit is the facade between two corners. It repeats and stretches along every run of the
        walls you apply it to, restarting at each corner and wherever a wall meets the facade.
      </p>

      <div className="mx-2 flex flex-col pier-2 rounded-lg border border-border/50 p-2">
        <div className="flex items-baseline justify-between pier-2">
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

      <fieldset disabled={readOnly} className="flex flex-col pier-2 px-2 disabled:opacity-50">
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
        <Button size="sm" className="text-xs" disabled={!wallIds.length} onClick={apply}>
          {wallIds.length ? 'Apply facade' : 'Select a wall to apply'}
        </Button>
      </fieldset>

      {(live.length > 0 || detached) && (
        <div className="mx-2 flex flex-col pier-2 rounded-lg border border-border/50 p-2">
          <span className="text-xs text-muted-foreground">
            {live.length
              ? `Selected ${live.length === 1 ? 'wall carries' : 'walls carry'} “${live[0]!.unit.name}”.`
              : 'This facade was made editable and no longer regenerates.'}
          </span>
          {live.length > 0 && (
            <div className="grid grid-cols-2 pier-2">
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
