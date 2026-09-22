'use client'
import {
  FACADE_FINISHES,
  type FacadeFinish,
  type FacadeModule,
  type FacadeUnit,
  FacadeUnitSchema,
} from '@pascal-app/core'
import { Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '../../../lib/utils'
import { useFacadeTool } from '../../../store/use-facade-tool'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { ToggleControl } from '../controls/toggle-control'
import { Button } from '../primitives/button'
import { FacadeElevation } from './facade-elevation'
import { FacadeModuleControls, newOpening } from './facade-module-controls'

const FINISH_LABELS: Record<FacadeFinish, string> = {
  brick: 'Brick',
  stone: 'Stone',
  plaster: 'Plaster',
  siding: 'Siding',
  timber: 'Timber',
  glass: 'Glass',
  metal: 'Metal',
}
const DEFAULT_APPEARANCE = { finish: 'plaster', wall: '#cfc5b7', trim: '#2f3133' } as const

function describe(module: FacadeModule) {
  const size =
    module.widthMode === 'stretch'
      ? 'Stretches'
      : module.widthMode === 'fixed'
        ? `Fixed · ${module.horizontal === 'center' ? 'centre' : module.horizontal}`
        : 'Repeats'
  const parts = [
    module.opening?.kind === 'door' ? 'door' : module.opening ? 'window' : null,
    module.balcony ? 'balcony' : null,
  ].filter(Boolean)
  return `${size} · ${parts.length ? parts.join(' + ') : 'spacer'}`
}

function nextKey(modules: readonly FacadeModule[]) {
  const taken = new Set(modules.map((m) => m.key))
  let index = modules.length + 1
  while (taken.has(`module-${index}`)) index++
  return `module-${index}`
}

/**
 * The isolated surface where one facade unit is designed: a single run drawn
 * head-on at a test width, and the constraints tying each module to its corners.
 */
export function FacadeStudio() {
  const draft = useFacadeTool((s) => s.draft)
  const selectedModule = useFacadeTool((s) => s.selectedModule)
  const testWidth = useFacadeTool((s) => s.testWidth)
  const testHeight = useFacadeTool((s) => s.testHeight)
  const { setDraft, selectModule, setTestSize, closeStudio } = useFacadeTool.getState()
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
  const modules = draft.modules
  const index = modules.findIndex((m) => m.key === selectedModule)
  const module = index >= 0 ? modules[index] : undefined
  const replace = (next: FacadeModule) =>
    update({ modules: modules.map((m) => (m.key === next.key ? next : m)) })

  const addModule = () => {
    const base: FacadeModule = {
      key: nextKey(modules),
      width: 1.4,
      horizontal: 'center',
      widthMode: 'repeat',
      offsetX: 0,
      margin: 0.4,
      gap: 1,
      remainder: 'center',
    }
    const added = { ...base, opening: newOpening(base) }
    update({ modules: [...modules, added] })
    selectModule(added.key)
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
          <span className="text-xs text-muted-foreground">
            One run, corner to corner. Drag the right corner to test other lengths.
          </span>
          <div className="ml-auto flex w-[420px] gap-2">
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
        <FacadeElevation
          className="flex-1 p-8"
          unit={draft}
          width={testWidth}
          height={testHeight}
          selectedModule={selectedModule}
          onSelectModule={selectModule}
          onResize={(width) => setTestSize({ width })}
        />
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
          <PanelSection title="Finish">
            <ToggleControl
              label="The unit carries its finish"
              checked={!!draft.appearance}
              onChange={(on) => update({ appearance: on ? { ...DEFAULT_APPEARANCE } : undefined })}
            />
            {draft.appearance && (
              <>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="w-16 shrink-0">Material</span>
                  <select
                    aria-label="Facade finish"
                    value={draft.appearance.finish}
                    onChange={(event) =>
                      update({
                        appearance: { ...draft.appearance!, finish: event.target.value as FacadeFinish },
                      })
                    }
                    className="h-8 min-w-0 flex-1 rounded-md border border-border/50 bg-background px-2 text-foreground"
                  >
                    {FACADE_FINISHES.map((finish) => (
                      <option key={finish} value={finish}>
                        {FINISH_LABELS[finish]}
                      </option>
                    ))}
                  </select>
                </label>
                {(['wall', 'trim'] as const).map((key) => (
                  <label key={key} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="w-16 shrink-0">{key === 'wall' ? 'Wall' : 'Frames'}</span>
                    <input
                      type="color"
                      aria-label={key === 'wall' ? 'Wall colour' : 'Frame colour'}
                      value={draft.appearance![key]}
                      onChange={(event) =>
                        update({ appearance: { ...draft.appearance!, [key]: event.target.value } })
                      }
                      className="h-8 w-12 cursor-pointer rounded-md border border-border/50 bg-transparent"
                    />
                    <span className="font-mono">{draft.appearance![key]}</span>
                  </label>
                ))}
              </>
            )}
          </PanelSection>

          <PanelSection title="Modules">
            <p className="text-[11px] leading-4 text-muted-foreground">
              Earlier modules take their space first; a later one yields where they would overlap.
            </p>
            <ul className="flex flex-col gap-1">
              {modules.map((m) => (
                <li key={m.key}>
                  <button
                    type="button"
                    onClick={() => selectModule(m.key)}
                    aria-pressed={m.key === selectedModule}
                    className={cn(
                      'flex w-full flex-col items-start rounded-md border px-2.5 py-1.5 text-left',
                      m.key === selectedModule
                        ? 'border-primary/60 bg-primary/10'
                        : 'border-border/50 hover:bg-accent/40',
                    )}
                  >
                    <span className="text-sm">{m.name ?? m.key}</span>
                    <span className="text-[11px] text-muted-foreground">{describe(m)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="outline" className="text-xs" onClick={addModule}>
              <Plus className="size-3.5" /> Add module
            </Button>
          </PanelSection>

          {module && (
            <FacadeModuleControls
              key={module.key}
              module={module}
              onChange={replace}
              canMoveUp={index > 0}
              canMoveDown={index < modules.length - 1}
              onMove={(direction) => {
                const next = [...modules]
                const [moved] = next.splice(index, 1)
                next.splice(index + direction, 0, moved!)
                update({ modules: next })
              }}
              onRemove={() => {
                update({ modules: modules.filter((m) => m.key !== module.key) })
                selectModule(modules[index + 1]?.key ?? modules[index - 1]?.key ?? null)
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
