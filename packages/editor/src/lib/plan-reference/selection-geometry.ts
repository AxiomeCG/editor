import type { PlanPoint } from './calibration'
import { signedContourArea, simplifyContour } from './vectorize'

export type PlanShape = {
  id: string
  points: PlanPoint[]
  holes: PlanPoint[][]
  stroke?: boolean
  strokeWidth?: number
  boundary?: boolean
}
export type PlanSelectionMode = 'areas' | 'edges' | 'source'

const cross = (a: PlanPoint, b: PlanPoint) => a[0] * b[1] - a[1] * b[0]
const subtract = (a: PlanPoint, b: PlanPoint): PlanPoint => [a[0] - b[0], a[1] - b[1]]
const distance = (a: PlanPoint, b: PlanPoint) => Math.hypot(a[0] - b[0], a[1] - b[1])

export function pointInPlanPolygon(point: PlanPoint, polygon: PlanPoint[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!,
      b = polygon[j]!
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside
  }
  return inside
}

type Segment = { a: PlanPoint; b: PlanPoint; cuts: number[]; width?: number }
type Vertex = { point: PlanPoint; outgoing: number[] }
type Edge = { from: number; to: number; reverse: number; angle: number }
const cache = new WeakMap<
  PlanShape[],
  Map<string, Partial<Record<'areas' | 'edges', PlanShape[]>>>
>()

/** A sitemap's unit outline can include a terrace. Visible dividers define smaller pickable faces. */
export function planSelectionGeometry(
  shapes: PlanShape[],
  mode: PlanSelectionMode,
  metersPerPixel = 1,
  gapTolerancePixels = 0,
): PlanShape[] {
  if (mode === 'source') return shapes
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0)
    throw Error('Calibrate this reference first.')
  const key = `${metersPerPixel}:${gapTolerancePixels}`
  let scales = cache.get(shapes)
  if (!scales) {
    scales = new Map()
    cache.set(shapes, scales)
  }
  let geometry = scales.get(key)
  if (!geometry) {
    geometry = {}
    scales.set(key, geometry)
  }
  if (!geometry[mode])
    geometry[mode] = buildSelectionGeometry(shapes, mode, metersPerPixel, gapTolerancePixels)
  return geometry[mode]!
}

function buildSelectionGeometry(
  shapes: PlanShape[],
  mode: 'areas' | 'edges',
  metersPerPixel: number,
  gapTolerancePixels = 0,
) {
  const epsilon = Math.max(0.02, 0.00101 / metersPerPixel)
  // Hairline cracks between exported strokes must not leak one face into the
  // next: endpoints within the bridge tolerance close as if they touched.
  const bridge = Math.max(epsilon, gapTolerancePixels)
  const segments: Segment[] = []
  // Outlined text is filled geometry too. When the SVG supplies explicit strokes,
  // use those as room dividers; keep every filled path available in Source mode.
  const boundaries =
    mode === 'areas' && shapes.some((s) => s.boundary === true)
      ? shapes.filter((s) => s.boundary !== false)
      : shapes
  for (const shape of boundaries) {
    for (const loop of [shape.points, ...shape.holes]) {
      const length = shape.stroke ? loop.length - 1 : loop.length
      for (let i = 0; i < length; i++) {
        const a = loop[i]!,
          b = loop[(i + 1) % loop.length]!
        if (a.every(Number.isFinite) && b.every(Number.isFinite) && distance(a, b) > epsilon)
          segments.push({ a, b, cuts: [0, 1], width: shape.strokeWidth })
      }
    }
  }
  if (segments.length > 20000) throw Error('This plan has too many edges. Simplify the SVG first.')
  segments.sort((a, b) => Math.min(a.a[0], a.b[0]) - Math.min(b.a[0], b.b[0]))
  const project = (p: PlanPoint, s: Segment) => {
    const d = subtract(s.b, s.a),
      v = subtract(p, s.a),
      l2 = d[0] ** 2 + d[1] ** 2
    const t = (v[0] * d[0] + v[1] * d[1]) / l2
    if (t >= 0 && t <= 1 && Math.abs(cross(v, d)) / Math.sqrt(l2) <= bridge) s.cuts.push(t)
  }
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!,
      r = subtract(a.b, a.a)
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j]!
      if (Math.min(b.a[0], b.b[0]) > Math.max(a.a[0], a.b[0]) + bridge) break
      if (
        Math.min(b.a[1], b.b[1]) > Math.max(a.a[1], a.b[1]) + bridge ||
        Math.min(a.a[1], a.b[1]) > Math.max(b.a[1], b.b[1]) + bridge
      )
        continue
      const s = subtract(b.b, b.a),
        offset = subtract(b.a, a.a),
        denominator = cross(r, s)
      if (Math.abs(denominator) > 1e-10) {
        const t = cross(offset, s) / denominator,
          u = cross(offset, r) / denominator
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
          a.cuts.push(t)
          b.cuts.push(u)
        }
      }
      // SVG exports round adjoining endpoints independently; only join subpixel gaps.
      project(a.a, b)
      project(a.b, b)
      project(b.a, a)
      project(b.b, a)
    }
  }
  const vertices: Vertex[] = [],
    buckets = new Map<string, number[]>()
  const vertex = (p: PlanPoint) => {
    const x = Math.floor(p[0] / bridge),
      y = Math.floor(p[1] / bridge)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of buckets.get(`${x + dx},${y + dy}`) ?? [])
          if (distance(vertices[id]!.point, p) <= bridge) return id
      }
    const id = vertices.length,
      key = `${x},${y}`
    vertices.push({ point: p, outgoing: [] })
    buckets.set(key, [...(buckets.get(key) ?? []), id])
    return id
  }
  const directed: Edge[] = [],
    edges: PlanShape[] = [],
    seen = new Set<string>()
  for (const segment of segments) {
    const d = subtract(segment.b, segment.a)
    const ids = segment.cuts
      .sort((a, b) => a - b)
      .map((t) => vertex([segment.a[0] + d[0] * t, segment.a[1] + d[1] * t]))
    for (let i = 1; i < ids.length; i++) {
      const from = ids[i - 1]!,
        to = ids[i]!,
        key = from < to ? `${from}:${to}` : `${to}:${from}`
      if (from === to || seen.has(key)) continue
      seen.add(key)
      const a = vertices[from]!.point,
        b = vertices[to]!.point,
        index = directed.length
      directed.push(
        { from, to, reverse: index + 1, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) },
        { from: to, to: from, reverse: index, angle: Math.atan2(a[1] - b[1], a[0] - b[0]) },
      )
      vertices[from]!.outgoing.push(index)
      vertices[to]!.outgoing.push(index + 1)
      edges.push({
        id: `edge:${key}`,
        points: [a, b],
        holes: [],
        stroke: true,
        strokeWidth: segment.width,
      })
    }
  }
  for (const v of vertices) v.outgoing.sort((a, b) => directed[a]!.angle - directed[b]!.angle)
  if (mode === 'edges') return edges
  const visited = new Set<number>(),
    rings: { points: PlanPoint[]; area: number; key: string }[] = []
  const ringKey = (points: PlanPoint[]) =>
    points
      .map((p) => p.map((n) => n.toFixed(4)).join(','))
      .sort()
      .join(';')
  const usableRing = (points: PlanPoint[]) => {
    if (
      points.length < 3 ||
      points.length > 1024 ||
      Math.abs(signedContourArea(points)) * metersPerPixel ** 2 < 0.000001
    )
      return false
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!,
        b = points[(i + 1) % points.length]!
      if (distance(a, b) * metersPerPixel < 0.001) return false
      const ab = subtract(b, a)
      for (let j = i + 2; j < points.length; j++) {
        if (i === 0 && j === points.length - 1) continue
        const c = points[j]!,
          d = points[(j + 1) % points.length]!,
          cd = subtract(d, c)
        if (
          cross(ab, subtract(c, a)) * cross(ab, subtract(d, a)) < 0 &&
          cross(cd, subtract(a, c)) * cross(cd, subtract(b, c)) < 0
        )
          return false
      }
    }
    return true
  }
  for (let start = 0; start < directed.length; start++) {
    if (visited.has(start)) continue
    const walk: number[] = []
    let current = start
    do {
      visited.add(current)
      const edge = directed[current]!,
        outgoing = vertices[edge.to]!.outgoing
      walk.push(edge.from)
      current = outgoing[(outgoing.indexOf(edge.reverse) + outgoing.length - 1) % outgoing.length]!
    } while (current !== start && !visited.has(current))
    if (current !== start) continue
    // Bridges (e.g. a dangling wall or a stair tread) are not boundaries of an extra room.
    const path: number[] = [],
      indices = new Map<number, number>()
    for (const id of [...walk, walk[0]!]) {
      const at = indices.get(id)
      if (at === undefined) {
        indices.set(id, path.length)
        path.push(id)
        continue
      }
      const cycle = path.slice(at).map((v) => vertices[v]!.point)
      if (cycle.length >= 3) {
        const simplified = simplifyContour(cycle, epsilon)
        const points = usableRing(simplified) ? simplified : cycle,
          area = signedContourArea(points)
        // Near-coincident exported curves can enclose sub-millimetre slivers; never offer invalid extrusion faces.
        if (usableRing(points)) rings.push({ points, area, key: ringKey(points) })
      }
      for (const v of path.splice(at + 1)) indices.delete(v)
    }
  }
  const positive = rings.filter((r) => r.area > 0)
  const areas: PlanShape[] = positive.map((r, i) => ({
    id: `area:${i}`,
    points: r.points,
    holes: [],
  }))
  // Disconnected contours inside a face are holes, not a reason to fill over an inset stairwell.
  for (const hole of rings.filter((r) => r.area < 0)) {
    let container = -1,
      smallest = Infinity
    for (let i = 0; i < positive.length; i++) {
      const outer = positive[i]!
      if (
        outer.key === hole.key ||
        outer.area <= -hole.area + epsilon ** 2 ||
        outer.area >= smallest
      )
        continue
      if (hole.points.every((p) => pointInPlanPolygon(p, outer.points))) {
        container = i
        smallest = outer.area
      }
    }
    if (container >= 0) areas[container]!.holes.push(hole.points)
  }
  return areas
}
