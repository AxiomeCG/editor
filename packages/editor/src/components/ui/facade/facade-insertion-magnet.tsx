'use client'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { Plus } from 'lucide-react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import type { InsertionSlot } from './facade-insertion'

/** Within this many pixels of a slot, its "+" wakes up… */
const REACH = 60
/** …and once awake it stays until this far, so it does not flicker at the edge. */
const RELEASE = 85
/** How much weight vertical distance has: the whole height of the wall counts as near. */
const VERTICAL_WEIGHT = 0.3
/** The "+" leans toward the cursor — a hint of attraction, never a chase. */
const PULL = 0.35
const MAX_LEAN = 14

const SPRING = { stiffness: 420, damping: 32, mass: 0.6 }

/**
 * A "+" that wakes near the nearest place a bay can go, drawn toward the cursor
 * on a spring and growing as it gets closer — the node-canvas way of adding
 * things. A guide line marks exactly where the bay lands. Pointer tracking
 * writes motion values directly, so following the cursor never re-renders the
 * elevation; React only hears when the nearest slot changes.
 */
export function InsertionMagnet({
  container,
  svg,
  slots,
  quiet,
  height,
  onInsert,
}: {
  container: RefObject<HTMLDivElement | null>
  svg: RefObject<SVGSVGElement | null>
  slots: readonly InsertionSlot[]
  /** Openings, in wall metres: the magnet stays quiet over them. */
  quiet: readonly { left: number; right: number; bottom: number; top: number }[]
  /** Storey height, in the elevation's metres: the magnets sit at mid-height. */
  height: number
  onInsert: (slot: InsertionSlot) => void
}) {
  const [active, setActive] = useState<InsertionSlot | null>(null)
  // Read by the pointer listener without re-subscribing it on every change.
  const activeKey = useRef<string | null>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const proximity = useMotionValue(0)
  const lineX = useMotionValue(0)
  const lineTop = useMotionValue(0)
  const lineHeight = useMotionValue(0)
  const sx = useSpring(x, SPRING)
  const sy = useSpring(y, SPRING)
  const presence = useSpring(proximity, { stiffness: 300, damping: 26 })
  const scale = useTransform(presence, [0, 1], [0.45, 1])
  // Fully there as soon as it is in reach; only its size and pull follow distance.
  const opacity = useTransform(presence, [0, 0.2], [0, 1])
  const lineOpacity = useTransform(presence, [0, 0.2], [0, 0.9])

  // Once the slots change (a bay was added, the unit edited), the old target is gone.
  useEffect(() => {
    void slots
    activeKey.current = null
    proximity.set(0)
    setActive(null)
  }, [slots, proximity])

  useEffect(() => {
    const element = container.current
    if (!element) return
    const sleep = () => {
      activeKey.current = null
      proximity.set(0)
      setActive(null)
    }
    const onMove = (event: PointerEvent) => {
      const drawing = svg.current
      const matrix = drawing?.getScreenCTM()
      // Hands off while a handle is being dragged or hovered, or an opening is under
      // the pointer: selecting and resizing stay undisturbed.
      if (
        !drawing ||
        !matrix ||
        event.buttons ||
        (event.target as Element | null)?.closest?.('.cursor-ew-resize')
      )
        return sleep()
      const cursor = drawing.createSVGPoint()
      cursor.x = event.clientX
      cursor.y = event.clientY
      const at = cursor.matrixTransform(matrix.inverse())
      const up = height - at.y
      if (quiet.some((o) => at.x >= o.left && at.x <= o.right && up >= o.bottom && up <= o.top))
        return sleep()
      const box = element.getBoundingClientRect()
      const toScreen = (mx: number, my: number) => {
        const point = drawing.createSVGPoint()
        point.x = mx
        point.y = my
        const screen = point.matrixTransform(matrix)
        return [screen.x - box.left, screen.y - box.top] as const
      }
      const cx = event.clientX - box.left
      const cy = event.clientY - box.top
      let nearest: { slot: InsertionSlot; ax: number; ay: number; distance: number } | null = null
      for (const slot of slots) {
        const [ax, ay] = toScreen(slot.x, height / 2)
        const distance = Math.hypot(cx - ax, (cy - ay) * VERTICAL_WEIGHT)
        if (!nearest || distance < nearest.distance) nearest = { slot, ax, ay, distance }
      }
      const awake = activeKey.current !== null && activeKey.current === nearest?.slot.key
      if (!nearest || nearest.distance > (awake ? RELEASE : REACH)) return sleep()
      const closeness = Math.max(0, 1 - nearest.distance / RELEASE)
      // Lean toward the cursor, capped: it acknowledges the pointer without following it.
      const dx = (cx - nearest.ax) * PULL
      const dy = (cy - nearest.ay) * PULL
      const lean = Math.min(1, MAX_LEAN / (Math.hypot(dx, dy) || 1))
      x.set(nearest.ax + dx * lean)
      y.set(nearest.ay + dy * lean)
      proximity.set(0.5 + 0.5 * closeness)
      const [, top] = toScreen(nearest.slot.x, 0)
      const [, bottom] = toScreen(nearest.slot.x, height)
      lineX.set(nearest.ax)
      lineTop.set(top)
      lineHeight.set(bottom - top)
      const slot = nearest.slot
      activeKey.current = slot.key
      setActive((current) => (current?.key === slot.key ? current : slot))
    }
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerleave', sleep)
    return () => {
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerleave', sleep)
    }
  }, [container, svg, slots, quiet, height, x, y, proximity, lineX, lineTop, lineHeight])

  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 w-px border-foreground border-l border-dashed"
        style={{ x: lineX, y: lineTop, height: lineHeight, opacity: lineOpacity }}
      />
      <motion.button
        type="button"
        aria-label={active ? `Add a bay pinned ${active.side}` : 'Add a bay'}
        tabIndex={active ? 0 : -1}
        disabled={!active}
        onClick={() => active && onInsert(active)}
        className="absolute top-0 left-0 -mt-4 -ml-4 flex size-8 items-center justify-center rounded-full bg-foreground text-background shadow-black/40 shadow-lg ring-2 ring-background/60 disabled:pointer-events-none"
        style={{ x: sx, y: sy, scale, opacity }}
      >
        <Plus className="size-4" strokeWidth={2.5} />
      </motion.button>
    </>
  )
}
