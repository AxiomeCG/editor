import type { Transition } from 'motion/react'

/**
 * The studio's motion, in one place (after the node-canvas-polish tokens):
 * quiet at rest, chrome emerging on intent, one short ease-out for anything
 * that moves the drawing. Curves are data so CSS, Motion and GL can share them.
 */
export const EASE_HOVER_CHROME = [0.42, 0, 0.58, 1] as const
export const EASE_OUT_QUINT = [0.23, 1, 0.32, 1] as const
export const EASE_OUT_CUBIC = [0.33, 1, 0.68, 1] as const

/** Handles, links and the "+" emerging when their target is selected or near: fade, 4 px rise. */
export const HOVER_CHROME: Transition = { duration: 0.15, ease: EASE_HOVER_CHROME }
/** The drawing moving to a previewed state and back. */
export const MORPH: Transition = { duration: 0.32, ease: EASE_OUT_QUINT }
/** The "+" leaning toward the cursor: a retargetable ease-out, attracted rather than bouncy. */
export const MAGNET: Transition = { duration: 0.5, ease: EASE_OUT_CUBIC }
export const INSTANT: Transition = { duration: 0 }

/** Appear only if the intent is still there after this long, so passing through never flickers. */
export const ANTI_FLICKER_MS = 75
/** How long a hovered choice must rest before its preview replaces the drawing. */
export const PREVIEW_DELAY_MS = 200
/** Screen pixels a handle must travel before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3
/** Press feedback for anything pressable in the drawing. */
export const PRESS_SCALE = 0.96
