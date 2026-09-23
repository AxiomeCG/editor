'use client'
import { Link2, Plus, Unlink2 } from 'lucide-react'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { cn } from '../../../lib/utils'
import { ANTI_FLICKER_MS, HOVER_CHROME, INSTANT, MAGNET, PRESS_SCALE } from './facade-motion'

/**
 * Something the elevation offers where the pointer goes: add a bay at a slot,
 * join or split the balconies across a gap. `x` and `up` place it in wall
 * metres (up from the floor).
 */
export type ProximityTarget = {
  key: string
  x: number
  up: number
  icon: 'plus' | 'link' | 'unlink'
  label: string
  /** Draw a dashed guide down the wall where the result lands. */
  guide?: boolean
  activate: () => void
  /** Hovering the button previews the result; false when the pointer leaves. */
  preview?: (on: boolean) => void
}

/** Within this many pixels of a target, it wakes up… */
const REACH = 60
/** …and once awake it stays until this far, so it does not flicker at the edge. */
const RELEASE = 85
/** Vertical distance counts for less: a target reads as near across much of the wall's height. */
const VERTICAL_WEIGHT = 0.3
/** It leans toward the cursor: a fraction of its offset, capped — a hint, never a chase. */
const PULL = 0.35
const MAX_LEAN = 14
/** It rises this far as it emerges. */
const RISE = 4

type Near = { target: ProximityTarget; ax: number; ay: number; distance: number; cx: number; cy: number }

const ICONS = { plus: Plus, link: Link2, unlink: Unlink2 }

/**
 * The elevation's contextual affordances, revealed by proximity the node-canvas
 * way: only the nearest target wakes, once the pointer has stayed near for a
 * beat; it emerges (fade, 4 px rise), leans toward the cursor on a retargetable
 * ease-out, and presses to .96. Pointer tracking writes motion values
 * directly, so it never re-renders the elevation.
 */
export function ProximityAffordances({
  container,
  svg,
  targets,
  quiet,
  height,
}: {
  container: RefObject<HTMLDivElement | null>
  svg: RefObject<SVGSVGElement | null>
  targets: readonly ProximityTarget[]
  /** Openings, in wall metres: nothing wakes over them. */
  quiet: readonly { left: number; right: number; bottom: number; top: number }[]
  /** Storey height, in the elevation's metres. */
  height: number
}) {
  const reduced = useReducedMotion()
  const [active, setActive] = useState<ProximityTarget | null>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const opacity = useMotionValue(0)
  const guideOpacity = useMotionValue(0)
  const lineX = useMotionValue(0)
  const lineTop = useMotionValue(0)
  const lineHeight = useMotionValue(0)
  // Read by the pointer listener without re-subscribing it on every change.
  const activeKey = useRef<string | null>(null)
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Targets are rebuilt when the facade changes; follow the awake one by key, or let it go.
  useEffect(() => {
    if (activeKey.current === null) return
    const same = targets.find((t) => t.key === activeKey.current)
    if (same) return setActive(same)
    clearTimeout(pending.current)
    activeKey.current = null
    opacity.set(0)
    guideOpacity.set(0)
    setActive(null)
  }, [targets, opacity, guideOpacity])

  useEffect(() => {
    const element = container.current
    if (!element) return
    const tween = (value: typeof x, to: number, transition = MAGNET) => {
      if (reduced) value.set(to)
      else animate(value, to, transition)
    }
    const chrome = reduced ? INSTANT : HOVER_CHROME

    const sleep = () => {
      clearTimeout(pending.current)
      pending.current = undefined
      if (activeKey.current === null) return
      activeKey.current = null
      tween(opacity, 0, chrome)
      tween(guideOpacity, 0, chrome)
      setActive(null)
    }
    const leanOf = (near: Near) => {
      const dx = (near.cx - near.ax) * PULL
      const dy = (near.cy - near.ay) * PULL
      const cap = Math.min(1, MAX_LEAN / (Math.hypot(dx, dy) || 1))
      return [near.ax + dx * cap, near.ay + dy * cap] as const
    }
    const toScreen = (drawing: SVGSVGElement, matrix: DOMMatrix, mx: number, up: number) => {
      const point = drawing.createSVGPoint()
      point.x = mx
      point.y = height - up
      const screen = point.matrixTransform(matrix)
      const box = element.getBoundingClientRect()
      return [screen.x - box.left, screen.y - box.top] as const
    }
    const wake = (near: Near) => {
      const drawing = svg.current
      const matrix = drawing?.getScreenCTM()
      if (!drawing || !matrix) return
      const [lx, ly] = leanOf(near)
      activeKey.current = near.target.key
      // Emerge: appear just below where it rests, then rise into place as it fades in.
      x.set(lx)
      y.set(ly + RISE)
      tween(y, ly, chrome)
      tween(opacity, 1, chrome)
      if (near.target.guide) {
        const [, top] = toScreen(drawing, matrix, near.target.x, height)
        const [, bottom] = toScreen(drawing, matrix, near.target.x, 0)
        lineX.set(near.ax)
        lineTop.set(top)
        lineHeight.set(bottom - top)
        tween(guideOpacity, 0.9, chrome)
      } else guideOpacity.set(0)
      setActive(near.target)
    }

    const nearest = (event: PointerEvent): Near | null => {
      const drawing = svg.current
      const matrix = drawing?.getScreenCTM()
      // Hands off while a handle is dragged or hovered, or over an opening:
      // selecting and resizing stay undisturbed.
      if (
        !drawing ||
        !matrix ||
        event.buttons ||
        (event.target as Element | null)?.closest?.('.cursor-ew-resize')
      )
        return null
      const cursor = drawing.createSVGPoint()
      cursor.x = event.clientX
      cursor.y = event.clientY
      const at = cursor.matrixTransform(matrix.inverse())
      const up = height - at.y
      if (quiet.some((o) => at.x >= o.left && at.x <= o.right && up >= o.bottom && up <= o.top))
        return null
      const box = element.getBoundingClientRect()
      const cx = event.clientX - box.left
      const cy = event.clientY - box.top
      let best: Near | null = null
      for (const target of targets) {
        const [ax, ay] = toScreen(drawing, matrix, target.x, target.up)
        const distance = Math.hypot(cx - ax, (cy - ay) * VERTICAL_WEIGHT)
        if (!best || distance < best.distance) best = { target, ax, ay, distance, cx, cy }
      }
      return best
    }

    const onMove = (event: PointerEvent) => {
      const near = nearest(event)
      const awake = activeKey.current !== null && activeKey.current === near?.target.key
      if (!near || near.distance > (awake ? RELEASE : REACH)) return sleep()
      if (awake) {
        const [lx, ly] = leanOf(near)
        tween(x, lx)
        tween(y, ly)
        return
      }
      // Arrived, or moved to another target: wake only if the pointer is still near after a beat.
      if (activeKey.current !== null) sleep()
      clearTimeout(pending.current)
      pending.current = setTimeout(() => wake(near), ANTI_FLICKER_MS)
    }
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerleave', sleep)
    return () => {
      clearTimeout(pending.current)
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerleave', sleep)
    }
  }, [container, svg, targets, quiet, height, reduced, x, y, opacity, guideOpacity, lineX, lineTop, lineHeight])

  // Whatever the awake target previews ends when another wakes or it goes to sleep. Keyed
  // by `key`: targets are rebuilt on every render, and a preview itself causes one.
  const current = useRef(active)
  current.current = active
  const activeTargetKey = active?.key
  useEffect(() => {
    if (!activeTargetKey) return
    const target = current.current
    return () => target?.preview?.(false)
  }, [activeTargetKey])

  const Icon = ICONS[active?.icon ?? 'plus']
  const filled = active?.icon !== 'link'
  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 w-px border-foreground border-l border-dashed"
        style={{ x: lineX, y: lineTop, height: lineHeight, opacity: guideOpacity }}
      />
      <motion.button
        type="button"
        aria-label={active?.label ?? 'Nothing here'}
        title={active?.label}
        tabIndex={active ? 0 : -1}
        disabled={!active}
        onClick={() => active?.activate()}
        onPointerEnter={() => active?.preview?.(true)}
        onPointerLeave={() => active?.preview?.(false)}
        whileTap={{ scale: PRESS_SCALE }}
        className={cn(
          'absolute top-0 left-0 -mt-4 -ml-4 flex size-8 items-center justify-center rounded-full shadow-black/40 shadow-lg ring-2 disabled:pointer-events-none',
          filled
            ? 'bg-foreground text-background ring-background/60'
            : 'bg-background text-foreground ring-foreground/70',
        )}
        style={{ x, y, opacity }}
      >
        <Icon className="size-4" strokeWidth={2.5} />
      </motion.button>
    </>
  )
}
