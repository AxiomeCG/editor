
import { imagePointToLevel, constrainReferenceHeight } from '@pascal-app/core/building'
import useInteractionScope from '../../store/use-interaction-scope'
import {
  ownsPlanWorkspace,
  resumePlanWorkspace,
  usePlanWorkspace,
} from '../../store/use-plan-workspace'
import { balconyElevation, DEFAULT_BALCONY } from '@pascal-app/core/building'
import { type PlanPoint } from './calibration'
import { snapPlanPoint } from './interaction'

import {
  activeReferencePoints,
  levelPointToImage,
  type PlanHandle,
  type PlanWorkspaceDraft,
  planShapeHits,
  transformAboutAnchor,
  workspaceHandles,
  workspaceReferences,
} from './workspace'

export type WorkspacePointerAdapter = {
  surface: Element
  point: (event: PointerEvent) => PlanPoint | null
  project: (point: PlanPoint, height: number) => PlanPoint | null
  heightProject?: (handle: PlanHandle, draft: PlanWorkspaceDraft) => PlanPoint | null
  lockNavigation?: () => () => void
}

/** Viewports only supply coordinate conversion. Gesture semantics and cancellation are shared. */
export function bindPlanWorkspacePointer(adapter: WorkspacePointerAdapter) {
  const { surface } = adapter
  let pan = false
  let drag: {
    pointerId: number
    draft: PlanWorkspaceDraft
    point: PlanPoint
    screen: PlanPoint
    maxDistance: number
    action: PlanHandle['id'] | 'move' | 'pick'
    release?: () => void
  } | null = null
  const consume = (e: Event) => {
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  const imagePoint = (draft: PlanWorkspaceDraft, point: PlanPoint, shift: boolean) => {
    const view = workspaceReferences(draft).at(-1)!
    let p = levelPointToImage(point, view.image, view.transform)
    if (draft.mode === 'references' && draft.stage !== 'adjust') {
      const points = activeReferencePoints(draft)
      p = snapPlanPoint(p, points.length === 1 ? points[0] : undefined, shift)
    }
    return p[0] >= 0 && p[1] >= 0 && p[0] <= view.image.width && p[1] <= view.image.height
      ? p
      : null
  }
  const atHandle = (h: PlanHandle, draft: PlanWorkspaceDraft) =>
    h.id === 'height' && adapter.heightProject
      ? adapter.heightProject(h, draft)
      : adapter.project(h.point, h.height)
  const finish = (cancel: boolean) => {
    const active = drag
    if (!active) return
    drag = null
    const current = usePlanWorkspace.getState().draft
    if (cancel && current?.id === active.draft.id)
      usePlanWorkspace.getState().change(() => active.draft)
    if (surface.hasPointerCapture(active.pointerId)) surface.releasePointerCapture(active.pointerId)
    active.release?.()
    if (current?.id === active.draft.id && ownsPlanWorkspace()) resumePlanWorkspace()
  }
  const down = (event: PointerEvent) => {
    const draft = usePlanWorkspace.getState().draft
    if (
      !draft ||
      !ownsPlanWorkspace() ||
      drag ||
      pan ||
      event.button !== 0 ||
      !surface.contains(event.target as Node)
    )
      return
    const point = adapter.point(event)
    if (!point) return
    const screen: PlanPoint = [event.clientX, event.clientY]
    const handle = workspaceHandles(draft).find((h) => {
      if (draft.mode === 'shapes' && event.shiftKey) return false
      const p = atHandle(h, draft)
      return p && Math.hypot(p[0] - screen[0], p[1] - screen[1]) <= 16
    })
    const pixel = imagePoint(draft, point, event.shiftKey)
    if (!handle && !pixel) return
    const action =
      handle?.id ??
      (draft.mode === 'references' && draft.stage === 'adjust' && !draft.pickingAnchor
        ? 'move'
        : 'pick')
    consume(event)
    drag = {
      pointerId: event.pointerId,
      draft,
      point,
      screen,
      maxDistance: 0,
      action,
      release: adapter.lockNavigation?.(),
    }
    surface.setPointerCapture(event.pointerId)
    useInteractionScope
      .getState()
      .begin({ kind: 'handle-drag', nodeId: draft.id, handle: `plan-workspace:${action}` })
  }
  const move = (event: PointerEvent) => {
    const current = usePlanWorkspace.getState().draft
    if (!current || !ownsPlanWorkspace()) return
    if (!drag) {
      if (event.buttons || pan || !surface.contains(event.target as Node)) return
      const point = adapter.point(event)
      usePlanWorkspace.setState({
        hover: point ? imagePoint(current, point, event.shiftKey) : null,
      })
      return
    }
    if (drag.pointerId !== event.pointerId) return
    consume(event)
    drag.maxDistance = Math.max(
      drag.maxDistance,
      Math.hypot(event.clientX - drag.screen[0], event.clientY - drag.screen[1]),
    )
    const original = drag.draft
    if (current.id !== original.id) return finish(true)
    const point = adapter.point(event)
    if (drag.action === 'height' && original.mode === 'shapes') {
      if (drag.maxDistance < 5) return
      const h = workspaceHandles(original)[0]!
      const base = atHandle({ ...h, height: 0 }, original),
        top = atHandle({ ...h, height: original.floorHeight }, original)
      let delta = (-(event.clientY - drag.screen[1]) * original.floorHeight) / 120
      if (base && top) {
        const dx = top[0] - base[0],
          dy = top[1] - base[1],
          length2 = dx * dx + dy * dy
        if (length2 > 100)
          delta =
            (((event.clientX - drag.screen[0]) * dx + (event.clientY - drag.screen[1]) * dy) /
              length2) *
            original.floorHeight
      }
      const height =
        original.kind === 'balcony'
          ? balconyElevation(
              original.height + delta,
              original.floorHeight,
              original.balcony ?? DEFAULT_BALCONY,
            )
          : constrainReferenceHeight(original.height + delta, original.floorHeight, true)
      usePlanWorkspace.getState().change((d) => (d.mode === 'shapes' ? { ...d, height } : d))
    } else if (point && original.mode === 'references' && original.stage === 'adjust') {
      const anchor = imagePointToLevel(original.anchor, original.plan, original.planTransform)
      let transform = original.planTransform
      if (drag.action === 'move') {
        let delta: PlanPoint = [point[0] - drag.point[0], point[1] - drag.point[1]]
        delta = snapPlanPoint(delta, [0, 0], event.shiftKey)
        transform = {
          ...transform,
          position: [transform.position[0] + delta[0], transform.position[1] + delta[1]],
        }
      } else if (drag.action === 'scale') {
        const before = Math.hypot(drag.point[0] - anchor[0], drag.point[1] - anchor[1])
        if (before < 0.001 || !original.baseline) return
        const ratio = Math.hypot(point[0] - anchor[0], point[1] - anchor[1]) / before
        const mpp = Math.max(
          original.baseline.metersPerPixel * 0.25,
          Math.min(original.baseline.metersPerPixel * 4, transform.metersPerPixel * ratio),
        )
        transform = transformAboutAnchor(original.plan, transform, original.anchor, {
          metersPerPixel: mpp,
        })
      } else if (drag.action === 'rotate') {
        let rotation =
          transform.rotation -
          (Math.atan2(point[1] - anchor[1], point[0] - anchor[0]) -
            Math.atan2(drag.point[1] - anchor[1], drag.point[0] - anchor[0]))
        if (event.shiftKey) rotation = Math.round(rotation / (Math.PI / 12)) * (Math.PI / 12)
        transform = transformAboutAnchor(original.plan, transform, original.anchor, { rotation })
      } else if (drag.action === 'anchor') {
        const pixel = imagePoint(current, point, false)
        if (pixel)
          usePlanWorkspace
            .getState()
            .change((d) => (d.mode === 'references' ? { ...d, anchor: pixel } : d))
        return
      }
      if (drag.action !== 'pick')
        usePlanWorkspace
          .getState()
          .change((d) => (d.mode === 'references' ? { ...d, planTransform: transform } : d))
    }
  }
  const up = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    consume(event)
    const active = drag,
      draft = usePlanWorkspace.getState().draft
    if (
      draft?.id === active.draft.id &&
      (active.action === 'pick' ||
        (active.action === 'height' &&
          draft.mode === 'shapes' &&
          active.draft.mode === 'shapes' &&
          active.draft.height === 0)) &&
      active.maxDistance < 5 &&
      Math.hypot(event.clientX - active.screen[0], event.clientY - active.screen[1]) < 5
    ) {
      const point = adapter.point(event),
        pixel = point ? imagePoint(draft, point, event.shiftKey) : null
      if (pixel) {
        if (draft.mode === 'references') usePlanWorkspace.getState().pick(pixel)
        else {
          const hits = planShapeHits(draft, pixel, [event.clientX, event.clientY], adapter.project)
          const previous = hits.findIndex((s) => draft.selected.includes(s.id))
          const hit = event.altKey ? hits[(previous + 1) % hits.length] : hits[0]
          if (hit)
            usePlanWorkspace.getState().change((d) =>
              d.mode === 'shapes'
                ? {
                    ...d,
                    selected: event.altKey
                      ? [...d.selected.filter((id) => !hits.some((s) => s.id === id)), hit.id]
                      : d.selected.includes(hit.id)
                        ? d.selected.filter((id) => id !== hit.id)
                        : d.selected.length < 512
                          ? [...d.selected, hit.id]
                          : d.selected,
                  }
                : d,
            )
          else if (draft.mode === 'shapes' && draft.selectionMode === 'areas')
            void usePlanWorkspace.getState().pickWhitespace(pixel)
        }
      }
    }
    finish(false)
    // Consume the corresponding click as well, without intercepting future toolbar clicks.
    const swallow = (e: Event) => consume(e)
    surface.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => surface.removeEventListener('click', swallow, true), 0)
  }
  const cancel = (event?: PointerEvent) => {
    if (!event || drag?.pointerId === event.pointerId) finish(true)
  }
  const key = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true]'))
      return
    if (event.code === 'Space') pan = event.type === 'keydown'
    if (event.type === 'keydown' && event.key === 'Escape' && drag) {
      consume(event)
      finish(true)
    }
  }
  const blur = () => {
    pan = false
    finish(true)
  }
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', cancel, true)
  surface.addEventListener('lostpointercapture', cancel as EventListener)
  window.addEventListener('keydown', key, true)
  window.addEventListener('keyup', key, true)
  window.addEventListener('blur', blur)
  return () => {
    finish(true)
    window.removeEventListener('pointerdown', down, true)
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', cancel, true)
    surface.removeEventListener('lostpointercapture', cancel as EventListener)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('keyup', key, true)
    window.removeEventListener('blur', blur)
  }
}
