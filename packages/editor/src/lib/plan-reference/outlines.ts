import { cleanReferencePoints } from '@pascal-app/core/building'
import type { PlanPoint } from './calibration'
import { sampleSvgContour } from './svg-contour'

export type ReferenceOutline = {
  id: string
  type: 'Path' | 'Polygon' | 'Stroke'
  strokeWidth?: number
  boundary?: boolean
  d?: string
  points?: string
  holes?: string[]
}
function distanceToSegment(p: PlanPoint, a: PlanPoint, b: PlanPoint) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = dx * dx + dy * dy
  const t = length
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
    : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
export function simplifyOutline(points: PlanPoint[], tolerance: number): PlanPoint[] {
  if (points.length <= 2) return points
  let max = 0,
    pivot = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i]!, points[0]!, points.at(-1)!)
    if (d > max) {
      max = d
      pivot = i
    }
  }
  if (max <= tolerance) return [points[0]!, points.at(-1)!]
  return [
    ...simplifyOutline(points.slice(0, pivot + 1), tolerance).slice(0, -1),
    ...simplifyOutline(points.slice(pivot), tolerance),
  ]
}

/** Sampling is bounded in level metres; the SVG stays unchanged as the authoritative reference. */
export function sampleReferenceOutline(
  outline: ReferenceOutline,
  metersPerPixel: number,
): PlanPoint[] {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0)
    throw Error('Set a positive reference scale.')
  const clean = (points: PlanPoint[]) => cleanReferencePoints(points, metersPerPixel, outline.type !== 'Stroke')
  if (outline.type === 'Polygon' || outline.type === 'Stroke') {
    const values = (outline.points ?? '')
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (values.length % 2 || values.some((n) => !Number.isFinite(n)))
      throw Error('Invalid polygon.')
    return clean(
      Array.from(
        { length: values.length / 2 },
        (_, i) => [values[2 * i]!, values[2 * i + 1]!] as PlanPoint,
      ),
    )
  }
  if (!outline.d || !/[zZ]\s*$/.test(outline.d) || (outline.d.match(/[mM]/g)?.length ?? 0) !== 1)
    throw Error('Choose one closed outline without holes.')
  const contour = sampleSvgContour(outline.d, 0.015 / metersPerPixel)
  if (contour) return clean(contour)
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', outline.d)
  const length = path.getTotalLength()
  const count = Math.ceil((length * metersPerPixel) / 0.025)
  if (!Number.isFinite(length) || length <= 0 || count > 20000)
    throw Error('Outline too large. Check the reference scale.')
  const points: PlanPoint[] = Array.from({ length: Math.max(4, count) + 1 }, (_, i) => {
    const p = path.getPointAtLength((length * i) / Math.max(4, count))
    return [p.x, p.y]
  })
  return clean(simplifyOutline(points, 0.015 / metersPerPixel).slice(0, -1))
}

