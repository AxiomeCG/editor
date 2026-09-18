'use client'

import type { SymbolFrame } from '@pascal-app/core/building'
import { resolveCdnUrl } from '@pascal-app/viewer'
import { Check, RotateCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  propCatalogItem,
  propFootprint,
  rankPropCatalog,
} from '../../lib/plan-reference/prop-catalog'
import type { ShapeDraft } from '../../lib/plan-reference/workspace'
import { cn } from '../../lib/utils'
import { usePlanWorkspace } from '../../store/use-plan-workspace'

/** Long × short, so a symbol and an item compare at a glance whatever their orientation. */
const size = ([a, b]: [number, number]) =>
  `${Math.max(a, b).toFixed(2)} × ${Math.min(a, b).toFixed(2)} m`

/**
 * Picks the catalog item that stands in for each selected plan symbol. The
 * editor's ItemCatalog can't be reused: picking there arms the item tool,
 * which would end this workspace session.
 */
export function PropPicker({ draft, frames }: { draft: ShapeDraft; frames: SymbolFrame[] }) {
  const [query, setQuery] = useState('')
  const frame = frames[0] ?? null
  const items = useMemo(() => rankPropCatalog(frame, query).slice(0, 40), [frame, query])
  const chosen = propCatalogItem(draft.propItemId)
  const { change } = usePlanWorkspace.getState()
  const summary = !draft.selected.length
    ? 'Select a furniture symbol on the plan.'
    : !frame
      ? ''
      : chosen
        ? `${frames.length > 1 ? `${frames.length} × ` : ''}${chosen.name} ${size(propFootprint(chosen))} · symbol ${size(frame.size)}`
        : `Symbol ${size(frame.size)} · best fits first`
  return (
    <div className="space-y-1.5">
      <label className="flex h-7 items-center gap-1.5 rounded-lg border border-border/50 bg-[#2C2C2E] px-2 text-xs text-muted-foreground transition-colors duration-150 focus-within:border-border focus-within:text-foreground">
        <Search className="size-3.5 shrink-0" />
        <input
          type="search"
          aria-label="Search catalog props"
          placeholder="Search catalog"
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div
        role="group"
        aria-label="Catalog props"
        className="max-h-44 space-y-px overflow-y-auto overscroll-contain rounded-lg border border-border/50 bg-[#2C2C2E] p-[3px]"
      >
        {items.map((item) => {
          const selected = item.id === draft.propItemId
          const thumbnail = resolveCdnUrl(item.thumbnail)
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected}
              className={cn(
                'flex h-9 w-full items-center gap-2 rounded-md px-1.5 text-left outline-none transition-[background-color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.98]',
                selected ? 'bg-[#3e3e3e] ring-1 ring-amber-500/60' : 'hover:bg-white/5',
              )}
              onClick={() =>
                change((d) =>
                  d.mode === 'shapes' ? { ...d, propItemId: item.id, propTurns: 0 } : d,
                )
              }
            >
              {thumbnail ? (
                <img
                  src={thumbnail}
                  alt=""
                  loading="lazy"
                  className="size-7 shrink-0 rounded bg-white/5 object-contain"
                />
              ) : (
                <span className="size-7 shrink-0 rounded bg-white/5" />
              )}
              <span className="min-w-0 flex-1 truncate text-xs">{item.name}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {size(propFootprint(item))}
              </span>
              {selected && <Check className="size-3 shrink-0 text-amber-400" strokeWidth={2.5} />}
            </button>
          )
        })}
        {!items.length && (
          <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
            No catalog item matches “{query}”.
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <p
          aria-live="polite"
          className="min-w-0 flex-1 truncate px-0.5 text-[11px] leading-4 text-muted-foreground"
          title={summary}
        >
          {summary}
        </p>
        <button
          type="button"
          aria-label="Rotate 90°"
          title="Rotate 90° — a plan symbol doesn't tell which side is the front"
          disabled={!chosen || !frames.length}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-[color,background-color,transform] duration-150 ease-out hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.92] disabled:pointer-events-none disabled:opacity-40"
          onClick={() =>
            change((d) =>
              d.mode === 'shapes' ? { ...d, propTurns: ((d.propTurns ?? 0) + 1) % 4 } : d,
            )
          }
        >
          <RotateCw className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
