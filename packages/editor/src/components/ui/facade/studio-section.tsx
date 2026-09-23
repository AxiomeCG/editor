'use client'
import { ChevronDown, X } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { cn } from '../../../lib/utils'

/** Header height, in px: the step between pinned headers. */
const HEADER = 40

/** Scroll a section of the panel into its place under the pinned headers above it. */
export function revealSection(scroller: HTMLElement | null, key: string) {
  const home = scroller?.querySelector<HTMLElement>(`[data-section-anchor="${key}"]`)
  if (!scroller || !home) return
  const index = Number(home.dataset.sectionIndex ?? 0)
  scroller.scrollTo({ top: home.offsetTop - index * HEADER, behavior: 'smooth' })
}

/**
 * A studio side-panel section whose header stays pinned while scrolling:
 * headers above the view stack at the top, headers below it at the bottom, so
 * every section is one click away. A closed header still says what is inside
 * (`summary`). Clicking a pinned header scrolls to its section (opening it);
 * clicking one already in place folds it. Sections must be direct children of
 * a `data-studio-sections` scroll container, which is what lets their headers
 * stick across the whole panel. Pass `open` / `onOpenChange` to control it.
 */
export function StudioSection({
  sectionKey,
  title,
  summary,
  index,
  count,
  children,
  defaultExpanded = true,
  open: controlledOpen,
  onOpenChange,
  onRemove,
  removeLabel,
  onRemoveHover,
}: {
  /** Names the section for `revealSection`. */
  sectionKey?: string
  title: string
  /** What the section holds, in a few words, readable while it is folded. */
  summary?: ReactNode
  /** Position among the panel's sections, and how many there are. */
  index: number
  count: number
  children: ReactNode
  defaultExpanded?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Offers a remove button in the header, for a part the bay can do without. */
  onRemove?: () => void
  removeLabel?: string
  onRemoveHover?: (hovering: boolean) => void
}) {
  const [ownOpen, setOwnOpen] = useState(defaultExpanded)
  const open = controlledOpen ?? ownOpen
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setOwnOpen(next)
    onOpenChange?.(next)
  }
  const anchor = useRef<HTMLDivElement>(null)
  const header = useRef<HTMLDivElement>(null)

  const onClick = () => {
    const home = anchor.current
    const bar = header.current
    const scroller = home?.closest<HTMLElement>('[data-studio-sections]')
    if (!home || !bar || !scroller) return setOpen(!open)
    // In place when not pinned away from where it sits in the flow.
    const inPlace = Math.abs(bar.getBoundingClientRect().top - home.getBoundingClientRect().top) < 1
    if (open && inPlace) return setOpen(false)
    setOpen(true)
    requestAnimationFrame(() =>
      scroller.scrollTo({ top: home.offsetTop - index * HEADER, behavior: 'smooth' }),
    )
  }

  return (
    <>
      <div ref={anchor} aria-hidden data-section-anchor={sectionKey} data-section-index={index} />
      <div
        ref={header}
        style={{ top: index * HEADER, bottom: (count - 1 - index) * HEADER }}
        className={cn(
          // Opaque and above the content's own stacking layers (segmented pills, sliders).
          'group/section sticky z-30 flex h-10 shrink-0 items-center border-border border-b bg-muted',
          open ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={onClick}
          className="flex h-full min-w-0 flex-1 items-center gap-2 pl-3 text-left"
        >
          <span className="shrink-0 font-semibold text-[11px] uppercase tracking-wider">{title}</span>
          {summary && (
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground normal-case">
              {summary}
            </span>
          )}
          <ChevronDown
            className={cn(
              'ml-auto h-4 w-4 shrink-0 transition-transform duration-200',
              open ? 'rotate-180' : 'opacity-0 group-hover/section:opacity-100',
            )}
          />
        </button>
        {onRemove && (
          <button
            type="button"
            aria-label={removeLabel ?? `Remove ${title.toLowerCase()}`}
            title={removeLabel ?? `Remove ${title.toLowerCase()}`}
            onClick={onRemove}
            onPointerEnter={onRemoveHover && (() => onRemoveHover(true))}
            onPointerLeave={onRemoveHover && (() => onRemoveHover(false))}
            className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-accent/60 hover:text-foreground focus-visible:opacity-100 group-hover/section:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        )}
        {!onRemove && <span className="w-3 shrink-0" />}
      </div>
      {open && (
        // `isolate` keeps the content's z-indexed controls under the pinned headers; the rule
        // on the left ties the content to its header.
        <div className="isolate flex shrink-0 flex-col gap-1.5 border-border/50 border-b py-3 pr-3 pl-3">
          <div className="flex flex-col gap-1.5 border-border border-l-2 pl-3">{children}</div>
        </div>
      )}
    </>
  )
}

/** Advanced options of a section, folded until asked for. */
export function MoreOptions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 self-start rounded-full px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      >
        {open ? 'Fewer options' : 'More options'}
        <ChevronDown className={cn('size-3 transition-transform duration-150', open && 'rotate-180')} />
      </button>
      {open && children}
    </>
  )
}
