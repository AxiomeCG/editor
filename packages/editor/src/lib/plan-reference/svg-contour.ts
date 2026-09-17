import type { PlanPoint } from './calibration'

/** Preserve authored line endpoints while flattening cubic curves in published floor contours. */
export function sampleSvgContour(d: string, tolerance: number): PlanPoint[] | null {
  // Other SVG commands retain the browser sampling path in sampleReferenceOutline.
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) ?? []
  if (tokens.some((t) => /^[a-z]$/i.test(t) && !/^[mlhvcsz]$/i.test(t))) return null
  if (d.replace(/[\s,]+/g, '') !== tokens.join('') || !Number.isFinite(tolerance) || tolerance <= 0)
    return null
  let i = 0,
    command = '',
    point: PlanPoint = [0, 0],
    start: PlanPoint | null = null
  let control: PlanPoint | null = null
  const points: PlanPoint[] = []
  const add = (p: PlanPoint) => {
    if (points.length >= 20000) throw Error('Outline too large. Check the reference scale.')
    if (!points.length || Math.hypot(p[0] - points.at(-1)![0], p[1] - points.at(-1)![1]) > 1e-8)
      points.push(p)
  }
  const midpoint = (a: PlanPoint, b: PlanPoint): PlanPoint => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const cubic = (a: PlanPoint, b: PlanPoint, c: PlanPoint, end: PlanPoint, depth = 0) => {
    const dx = end[0] - a[0],
      dy = end[1] - a[1],
      length2 = dx * dx + dy * dy
    const distance = (p: PlanPoint) => {
      const t = length2
        ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2))
        : 0
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
    }
    if (Math.max(distance(b), distance(c)) <= tolerance) {
      add(end)
      return
    }
    if (depth >= 18) throw Error('Curve too complex. Check the reference scale.')
    const ab = midpoint(a, b),
      bc = midpoint(b, c),
      ce = midpoint(c, end)
    const abc = midpoint(ab, bc),
      bce = midpoint(bc, ce),
      middle = midpoint(abc, bce)
    cubic(a, ab, abc, middle, depth + 1)
    cubic(middle, bce, ce, end, depth + 1)
  }
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i]!)) command = tokens[i++]!
    const type = command.toUpperCase(),
      relative = command !== type
    if (type === 'Z') {
      if (!start || i !== tokens.length) return null
      if (
        points.length > 1 &&
        Math.hypot(points.at(-1)![0] - start[0], points.at(-1)![1] - start[1]) < 1e-8
      )
        points.pop()
      return points
    }
    const count = ({ M: 2, L: 2, H: 1, V: 1, C: 6, S: 4 } as Record<string, number>)[type]
    if (!count || i + count > tokens.length || (!start && type !== 'M')) return null
    const values = tokens.slice(i, i + count).map(Number)
    if (values.some((v) => !Number.isFinite(v))) return null
    i += count
    const at = (index: number): PlanPoint => [
      values[index]! + (relative ? point[0] : 0),
      values[index + 1]! + (relative ? point[1] : 0),
    ]
    if (type === 'M') {
      if (start) return null
      point = at(0)
      start = point
      add(point)
      command = relative ? 'l' : 'L'
    } else if (type === 'C' || type === 'S') {
      const first: PlanPoint =
        type === 'C'
          ? at(0)
          : control
            ? [2 * point[0] - control[0], 2 * point[1] - control[1]]
            : point
      const second = at(type === 'C' ? 2 : 0),
        end = at(type === 'C' ? 4 : 2)
      cubic(point, first, second, end)
      control = second
      point = end
      continue
    } else {
      point =
        type === 'H'
          ? [values[0]! + (relative ? point[0] : 0), point[1]]
          : type === 'V'
            ? [point[0], values[0]! + (relative ? point[1] : 0)]
            : at(0)
      add(point)
    }
    control = null
  }
  return null
}
