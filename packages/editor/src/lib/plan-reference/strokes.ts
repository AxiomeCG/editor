import type { PlanPoint } from './calibration'

export function pointSegmentDistance(p: PlanPoint, a: PlanPoint, b: PlanPoint) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = dx * dx + dy * dy
  const t = length
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
    : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
