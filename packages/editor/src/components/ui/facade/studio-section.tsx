'use client'
import { ChevronDown } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { cn } from '../../../lib/utils'

/** Header height, in px: the step between pinned headers. */
const HEADER = 40

/**
 * A studio side-panel section whose header stays pinned while scrolling:
 * headers above the view stack at the top, headers below it at the bottom, so
 * every section is one click away. Clicking a pinned header scrolls to its
 * section (opening it); clicking one already in place folds it. Sections must
 * be direct children of a `data-studio-sections` scroll container, which is
 * what lets their headers stick across the whole panel.
 */
export function StudioSection({
  title,
  index,
  count,
  children,
  defaultExpanded = true,
}: {
  title: string
  /** Position among the panel's sections, and how many there are. */
  index: number
  count: number
  children: ReactNode
  defaultExpanded?: boolean
}) {
  const [open, setOpen] = useState(defaultExpanded)
  const anchor = useRef<HTMLDivElement>(null)
  const header = useRef<HTMLButtonElement>(null)

  const onClick = () => {
    const home = anchor.current
    const button = header.current
    const scroller = home?.closest<HTMLElement>('[data-studio-sections]')
    if (!home || !button || !scroller) return setOpen(!open)
    // In place when not pinned away from where it sits in the flow.
    const inPlace =
      Math.abs(button.getBoundingClientRect().top - home.getBoundingClientRect().top) < 1
    if (open && inPlace) return setOpen(false)
    setOpen(true)
    requestAnimationFrame(() =>
      scroller.scrollTo({ top: home.offsetTop - index * HEADER, behavior: 'smooth' }),
    )
  }

  return (
    <>
      <div ref={anchor} aria-hidden />
      <button
        ref={header}
        type="button"
        aria-expanded={open}
        onClick={onClick}
        style={{ top: index * HEADER, bottom: (count - 1 - index) * HEADER }}
        className={cn(
          // Opaque and above the content's own stacking layers (segmented pills, sliders).
          'group/section sticky z-30 flex h-10 shrink-0 items-center justify-between border-border border-b bg-muted px-3',
          open ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <span className="truncate font-semibold text-[11px] uppercase tracking-wider">{title}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 transition-transform duration-200',
            open ? 'rotate-180' : 'opacity-0 group-hover/section:opacity-100',
          )}
        />
      </button>
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
