import type { PlanPoint } from './calibration'

export function snapPlanPoint(
  point: PlanPoint,
  anchor: PlanPoint | undefined,
  straight: boolean,
): PlanPoint {
  if (!anchor || !straight) return point
  return Math.abs(point[0] - anchor[0]) >= Math.abs(point[1] - anchor[1])
    ? [point[0], anchor[1]]
    : [anchor[0], point[1]]
}

/** Keep the same image pixel under the cursor after CSS image scaling. */
export function planZoomScroll(
  scroll: PlanPoint,
  anchor: PlanPoint,
  previous: number,
  next: number,
): PlanPoint {
  return [
    ((scroll[0] + anchor[0]) * next) / previous - anchor[0],
    ((scroll[1] + anchor[1]) * next) / previous - anchor[1],
  ]
}
