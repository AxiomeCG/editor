'use client'
import {
  type FacadeBay,
  type FacadeUnit,
  FacadeUnitSchema,
} from '@pascal-app/core'
import { Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '../../../lib/utils'
import {
  type FacadeStudioScenario,
  type FacadeStudioView,
  useFacadeTool,
} from '../../../store/use-facade-tool'
import { PanelSection } from '../controls/panel-section'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { Button } from '../primitives/button'
import { FacadeBay3D } from './facade-bay-3d'
import { FacadeElevation, resolveElevation, resolveScenario } from './facade-elevation'
import { FacadeBayControls, newOpening } from './facade-bay-controls'
import { MaterialField } from './facade-material-field'
import { type FacadeScenario, nextPartition, SCENARIO_WIDTHS } from './facade-scenario'

const NO_PARTITIONS: readonly number[] = []

const SCENARIO_HELP: Record<FacadeStudioScenario, string> = {
  run: 'One run, corner to corner. Drag the right corner to test other lengths.',
  partitions:
    'Interior walls meeting the facade end a run; the unit starts again in each room. Drag them.',
  widths: 'The unit at several run widths, like breakpoints.',
}


function describe(bay: FacadeBay) {
  const size =
    bay.widthMode === 'stretch'
      ? 'Stretches'
      : bay.widthMode === 'fixed'
        ? `Fixed · ${bay.horizontal === 'center' ? 'centre' : bay.horizontal}`
        : 'Repeats'
  const parts = [
    bay.opening?.kind === 'door' ? 'door' : bay.opening ? 'window' : null,
    bay.balcony ? 'balcony' : null,
  ].filter(Boolean)
  return `${size} · ${parts.length ? parts.join(' + ') : 'blank'}`
}

function nextKey(bays: readonly FacadeBay[]) {
  const taken = new Set(bays.map((m) => m.key))
  let index = bays.length + 1
  while (taken.has(`bay-${index}`)) index++
  return `bay-${index}`
}

/**
 * The isolated surface where one facade unit is designed: a single run drawn
 * head-on at a test width, and the constraints tying each bay to its corners.
 */
export function FacadeStudio() {
  const draft = useFacadeTool((s) => s.draft)
  const selectedBay = useFacadeTool((s) => s.selectedBay)
  const testWidth = useFacadeTool((s) => s.testWidth)
  const testHeight = useFacadeTool((s) => s.testHeight)
  const studioView = useFacadeTool((s) => s.studioView)
  const scenarioKind = useFacadeTool((s) => s.scenario)
  const partitions = useFacadeTool((s) => s.partitions)
  const { setDraft, selectBay, setTestSize, setStudioView, closeStudio, setScenario, setPartitions } =
    useFacadeTool.getState()
  const scenario = useMemo<FacadeScenario>(
    () => ({
      width: testWidth,
      height: testHeight,
      partitions: scenarioKind === 'partitions' ? partitions : NO_PARTITIONS,
    }),
    [testWidth, testHeight, scenarioKind, partitions],
  )
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useFacadeTool.getState().closeStudio(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!draft) return null
  const update = (patch: Partial<FacadeUnit>) => {
    setError('')
    setDraft({ ...draft, ...patch })
  }
  const bays = draft.bays
  const placed = new Map<string, number>()
  for (const placement of resolveScenario(draft, scenario).placements)
    placed.set(placement.bay, (placed.get(placement.bay) ?? 0) + 1)
  const index = bays.findIndex((m) => m.key === selectedBay)
  const bay = index >= 0 ? bays[index] : undefined
  const replace = (next: FacadeBay) =>
    update({ bays: bays.map((m) => (m.key === next.key ? next : m)) })

  const addBay = () => {
    // Pinned, so it takes its place at once and the repeating bays visibly reflow around it.
    const base: FacadeBay = {
      key: nextKey(bays),
      width: 1.2,
      horizontal: 'left',
      widthMode: 'fixed',
      offsetX: 0.4,
      endPier: 0.4,
      pier: 1,
      remainder: 'center',
    }
    const added = { ...base, opening: newOpening(base) }
    update({ bays: [...bays, added] })
    selectBay(added.key)
  }
  const chooseScenario = (next: FacadeStudioScenario) => {
    setScenario(next)
    if (next !== 'partitions' || partitions.length) return
    const at = nextPartition({ ...scenario, partitions: [] })
    if (at !== null) setPartitions([at])
  }
  const addPartition = () => {
    const at = nextPartition(scenario)
    if (at !== null) setPartitions([...partitions, at].sort((a, b) => a - b))
  }

  const done = () => {
    const parsed = FacadeUnitSchema.safeParse(draft)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'This unit is not valid yet.')
      return
    }
    setDraft(parsed.data)
    closeStudio(true)
  }

  return (
    <div className="absolute inset-0 flex bg-background text-foreground" aria-label="Facade studio">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-border/50 border-b px-4 py-2">
          <span className="text-sm font-medium">Facade studio</span>
          <SegmentedControl<FacadeStudioScenario>
            className="w-72"
            value={scenarioKind}
            onChange={chooseScenario}
            options={[
              { value: 'run', label: 'One run' },
              { value: 'partitions', label: 'Interior walls' },
              { value: 'widths', label: 'Widths' },
            ]}
          />
          {scenarioKind === 'partitions' && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={nextPartition(scenario) === null}
              onClick={addPartition}
            >
              <Plus className="size-3.5" />
              Interior wall
            </Button>
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {SCENARIO_HELP[scenarioKind]}
          </span>
          <SegmentedControl<FacadeStudioView>
            className="w-44"
            value={studioView}
            onChange={setStudioView}
            options={[
              { value: '3d', label: '3D' },
              { value: '2d', label: '2D' },
              { value: 'split', label: 'Split' },
            ]}
          />
          <div className="flex w-[420px] gap-2">
            <SliderControl
              label="Test run"
              value={testWidth}
              min={1}
              max={40}
              step={0.1}
              precision={2}
              unit="m"
              manageHistory={false}
              restoreOnCommit={false}
              liveText
              onChange={(width) => setTestSize({ width })}
            />
            <SliderControl
              label="Storey"
              value={testHeight}
              min={2}
              max={8}
              step={0.05}
              precision={2}
              unit="m"
              manageHistory={false}
              restoreOnCommit={false}
              liveText
              onChange={(height) => setTestSize({ height })}
            />
          </div>
        </div>
        {studioView !== '2d' && (
          <FacadeBay3D
            className={studioView === 'split' ? 'basis-3/5' : 'flex-1'}
            unit={draft}
            scenario={scenario}
          />
        )}
        {studioView !== '3d' && scenarioKind === 'widths' && (
          <FacadeWidths
            className={cn(
              'min-h-0 px-8 py-4',
              studioView === 'split' ? 'basis-2/5 border-border/50 border-t' : 'flex-1',
            )}
            unit={draft}
            height={testHeight}
            selectedBay={selectedBay}
            onSelectBay={selectBay}
          />
        )}
        {studioView !== '3d' && scenarioKind !== 'widths' && (
          <FacadeElevation
            className={cn(
              'min-h-0 p-8',
              studioView === 'split' ? 'basis-2/5 border-border/50 border-t' : 'flex-1',
            )}
            unit={draft}
            width={testWidth}
            height={testHeight}
            partitions={scenario.partitions}
            onPartitionsChange={setPartitions}
            selectedBay={selectedBay}
            onSelectBay={selectBay}
            onResize={(width) => setTestSize({ width })}
          />
        )}
      </div>

      <aside className="flex w-[360px] shrink-0 flex-col border-border/50 border-l">
        <div className="flex items-center gap-2 px-3 py-3">
          <input
            aria-label="Unit name"
            value={draft.name}
            onChange={(event) => update({ name: event.target.value })}
            className="h-9 min-w-0 flex-1 rounded-md border border-border/50 bg-transparent px-2 font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          />
          <Button size="icon-sm" variant="ghost" aria-label="Close without saving" onClick={() => closeStudio(false)}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto">
          <PanelSection title="Paint">
            <p className="text-[11px] leading-4 text-muted-foreground">
              From the paint library. Left as is, the walls and frames keep their own paint.
            </p>
            <MaterialField
              label="Wall"
              value={draft.paint.wall}
              onChange={(wall) => update({ paint: { ...draft.paint, wall } })}
              onClear={() => update({ paint: { ...draft.paint, wall: undefined } })}
            />
            <MaterialField
              label="Frames"
              value={draft.paint.frame}
              onChange={(frame) => update({ paint: { ...draft.paint, frame } })}
              onClear={() => update({ paint: { ...draft.paint, frame: undefined } })}
            />
          </PanelSection>

          <PanelSection title="Bays">
            <p className="text-[11px] leading-4 text-muted-foreground">
              Pinned bays take their place first; repeating and stretching bays fill the space
              left between them. Within each kind, the higher bay wins where two overlap.
            </p>
            <ul className="flex flex-col gap-1">
              {bays.map((m) => (
                <li key={m.key}>
                  <button
                    type="button"
                    onClick={() => selectBay(m.key)}
                    aria-pressed={m.key === selectedBay}
                    className={cn(
                      'flex w-full flex-col items-start rounded-md border px-2.5 py-1.5 text-left',
                      m.key === selectedBay
                        ? 'border-primary/60 bg-primary/10'
                        : 'border-border/50 hover:bg-accent/40',
                    )}
                  >
                    <span className="text-sm">{m.name ?? m.key}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {describe(m)} ·{' '}
                      {placed.get(m.key) ? (
                        `×${placed.get(m.key)} on this test`
                      ) : (
                        <span className="text-amber-400">no room on this test</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="outline" className="text-xs" onClick={addBay}>
              <Plus className="size-3.5" /> Add bay
            </Button>
          </PanelSection>

          {bay && (
            <FacadeBayControls
              key={bay.key}
              bay={bay}
              onChange={replace}
              canMoveUp={index > 0}
              canMoveDown={index < bays.length - 1}
              onMove={(direction) => {
                const next = [...bays]
                const [moved] = next.splice(index, 1)
                next.splice(index + direction, 0, moved!)
                update({ bays: next })
              }}
              onRemove={() => {
                update({ bays: bays.filter((m) => m.key !== bay.key) })
                selectBay(bays[index + 1]?.key ?? bays[index - 1]?.key ?? null)
              }}
            />
          )}
        </div>

        <div className="flex flex-col gap-2 border-border/50 border-t p-3">
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1 text-xs" onClick={() => closeStudio(false)}>
              Cancel
            </Button>
            <Button className="flex-1 text-xs" onClick={done}>
              Use this unit
            </Button>
          </div>
        </div>
      </aside>
    </div>
  )
}

/** The unit at several run widths, one above the other, so its breakpoints show at a glance. */
function FacadeWidths({
  unit,
  height,
  selectedBay,
  onSelectBay,
  className,
}: {
  unit: FacadeUnit
  height: number
  selectedBay: string | null
  onSelectBay: (key: string) => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {SCENARIO_WIDTHS.map((width) => {
        const { placements, error } = resolveElevation(unit, width, height)
        const bays = placements.length
        return (
          <div key={width} className="flex min-h-0 flex-1 items-center gap-3">
            <div className="w-20 shrink-0 text-right text-xs">
              <div className="font-mono">{width.toFixed(1)} m</div>
              <div className="text-muted-foreground">
                {error ? 'invalid' : bays ? `${bays} ${bays === 1 ? 'bay' : 'bays'}` : 'nothing fits'}
              </div>
            </div>
            <FacadeElevation
              compact
              className="h-full min-w-0 flex-1"
              unit={unit}
              width={width}
              height={height}
              selectedBay={selectedBay}
              onSelectBay={onSelectBay}
            />
          </div>
        )
      })}
    </div>
  )
}
