import { useWallSplit } from '../store/use-wall-split'

/** Both viewports feed a wall distance; neither writes scene nodes while hovering. */
export function bindWallSplitPointer(
  surface: Element,
  distanceAt: (event: PointerEvent) => number | null,
) {
  let pressed: number | null = null
  const move = (event: PointerEvent) => {
    if (useWallSplit.getState().draft?.input !== 'pointer') return
    if (event.buttons && pressed !== event.pointerId) return
    const distance = distanceAt(event)
    if (distance !== null) useWallSplit.getState().update(distance)
  }
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || useWallSplit.getState().draft?.input !== 'pointer') return
    const distance = distanceAt(event)
    if (distance === null) return
    pressed = event.pointerId
    event.preventDefault()
    event.stopImmediatePropagation()
    useWallSplit.getState().update(distance)
  }
  const up = (event: PointerEvent) => {
    if (pressed !== event.pointerId) return
    pressed = null
    event.preventDefault()
    event.stopImmediatePropagation()
    const distance = distanceAt(event)
    if (distance === null) return
    useWallSplit.getState().update(distance)
    // Retain ownership through the click dispatched after pointerup, so normal
    // selection cannot consume that same click after the cut closes its session.
    const swallow = (click: Event) => {
      click.preventDefault()
      click.stopImmediatePropagation()
    }
    surface.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => surface.removeEventListener('click', swallow, true), 0)
    useWallSplit.getState().commit()
  }
  const cancel = () => {
    pressed = null
  }
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', cancel, true)
  return () => {
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerdown', down, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', cancel, true)
  }
}
