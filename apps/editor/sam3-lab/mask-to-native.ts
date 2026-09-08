import { addReconstructionContext } from './reconstruction-context'
import type { SourceLabel } from './source-labels'
import {
  type FloorplanStructureOpening,
  type FloorplanStructureWall,
  prepareFloorplanStructurePreview,
} from '../../../packages/editor/src/lib/floorplan-import/native'
import type {
  ComparisonCandidate,
  ComparisonVariant,
  NativeMaskPreview,
  NativePreviewOptions,
  NativeSourceMapping,
  StructuralClass,
} from './comparison-types'
import type { PlanPoint } from '../../../packages/editor/src/lib/floorplan-import/schema'

const MAX_ANALYSIS_SIDE = 1600
const GEOMETRY_EPSILON = 1e-6
const COLLINEAR_COSINE = Math.cos((3 * Math.PI) / 180)
const OPENING_COSINE = Math.cos((10 * Math.PI) / 180)

type ResolvedCandidate = {
  candidate: ComparisonCandidate
  structuralClass: StructuralClass
}

type PixelWall = {
  start: PlanPoint
  end: PlanPoint
  thickness: number
  sourceIds: string[]
  derivation: 'retained-wall-mask-paired-face-axis' | 'opening-mask-jamb-bridge' | 'opening-implied-host'
}

type PixelOpening = {
  sourceId: string
  wall: PixelWall
  offset: number
  width: number
  method: 'supplied-centerline' | 'mask-wall-strip'
  kind: 'door' | 'window'
  hingesSide?: 'left' | 'right'
  swingDirection?: 'inward' | 'outward'
  orientationEvidence?: 'source-arc' | 'unresolved-default'
}

type Interval = [start: number, end: number]

type LineFrame = {
  ux: number
  uy: number
  nx: number
  ny: number
  length: number
}

type OpeningAxis = {
  start: PlanPoint
  end: PlanPoint
  thickness: number
  method: PixelOpening['method']
}

type JambAnchor = {
  point: PlanPoint
  sourceIds: string[]
}

type OpeningJambs = {
  start: JambAnchor
  end: JambAnchor
}

function assertFinitePoint(point: PlanPoint, label: string, width: number, height: number): void {
  if (
    !Array.isArray(point) ||
    point.length !== 2 ||
    !Number.isFinite(point[0]) ||
    !Number.isFinite(point[1]) ||
    point[0] < 0 ||
    point[0] > width ||
    point[1] < 0 ||
    point[1] > height
  )
    throw new Error(`${label} must contain finite source-pixel coordinates inside the image.`)
}

function signedArea(polygon: PlanPoint[]): number {
  let area = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const point = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    area += point[0] * next[1] - next[0] * point[1]
  }
  return area / 2
}

function orientation(a: PlanPoint, b: PlanPoint, c: PlanPoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function onSegment(a: PlanPoint, b: PlanPoint, point: PlanPoint): boolean {
  return (
    Math.abs(orientation(a, b, point)) <= GEOMETRY_EPSILON &&
    point[0] >= Math.min(a[0], b[0]) - GEOMETRY_EPSILON &&
    point[0] <= Math.max(a[0], b[0]) + GEOMETRY_EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - GEOMETRY_EPSILON &&
    point[1] <= Math.max(a[1], b[1]) + GEOMETRY_EPSILON
  )
}

function segmentsProperlyCross(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): boolean {
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  return (
    ((abC > GEOMETRY_EPSILON && abD < -GEOMETRY_EPSILON) ||
      (abC < -GEOMETRY_EPSILON && abD > GEOMETRY_EPSILON)) &&
    ((cdA > GEOMETRY_EPSILON && cdB < -GEOMETRY_EPSILON) ||
      (cdA < -GEOMETRY_EPSILON && cdB > GEOMETRY_EPSILON))
  )
}

function hasUsableRasterBoundary(polygon: PlanPoint[]): boolean {
  if (
    polygon.length < 3 ||
    new Set(polygon.map(([x, y]) => `${x}\u0000${y}`)).size < 3 ||
    Math.abs(signedArea(polygon)) <= GEOMETRY_EPSILON
  )
    return false
  // Pixel contours may close through a non-adjacent vertex or retrace an edge at a
  // one-pixel neck. Those contacts preserve an even-odd raster fill; a proper
  // crossing does not.
  for (let left = 0; left < polygon.length; left += 1) {
    const a = polygon[left]!
    const b = polygon[(left + 1) % polygon.length]!
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= GEOMETRY_EPSILON) continue
    for (let right = left + 1; right < polygon.length; right += 1) {
      if (right === left + 1 || (left === 0 && right === polygon.length - 1)) continue
      const c = polygon[right]!
      const d = polygon[(right + 1) % polygon.length]!
      if (Math.hypot(d[0] - c[0], d[1] - c[1]) <= GEOMETRY_EPSILON) continue
      if (segmentsProperlyCross(a, b, c, d)) return false
    }
  }
  return true
}

function pointInPolygon(point: PlanPoint, polygon: PlanPoint[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]!
    const previousPoint = polygon[previous]!
    if (onSegment(previousPoint, currentPoint, point)) return true
    if (
      currentPoint[1] > point[1] !== previousPoint[1] > point[1] &&
      point[0] <
        ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0]
    )
      inside = !inside
  }
  return inside
}

function pointInCandidate(point: PlanPoint, candidate: ComparisonCandidate): boolean {
  return (
    pointInPolygon(point, candidate.outer) &&
    !candidate.holes.some((hole) => pointInPolygon(point, hole))
  )
}

function validateCandidate(
  candidate: ComparisonCandidate,
  width: number,
  height: number,
): string | null {
  if (!candidate.id.trim()) throw new Error('Every comparison candidate needs a non-empty ID.')
  if (candidate.outer.length < 3)
    return `Candidate “${candidate.id}” has no polygonal mask boundary.`
  candidate.outer.forEach((point, index) =>
    assertFinitePoint(point, `Candidate “${candidate.id}” outer point ${index + 1}`, width, height),
  )
  candidate.holes.forEach((hole, holeIndex) => {
    if (hole.length < 3)
      throw new Error(
        `Candidate “${candidate.id}” hole ${holeIndex + 1} needs at least three points.`,
      )
    hole.forEach((point, pointIndex) =>
      assertFinitePoint(
        point,
        `Candidate “${candidate.id}” hole ${holeIndex + 1} point ${pointIndex + 1}`,
        width,
        height,
      ),
    )
  })
  candidate.centerline?.forEach((point, index) =>
    assertFinitePoint(
      point,
      `Candidate “${candidate.id}” centerline point ${index + 1}`,
      width,
      height,
    ),
  )
  if (!hasUsableRasterBoundary(candidate.outer))
    return `Candidate “${candidate.id}” has a degenerate or crossing outer mask.`
  if (candidate.holes.some((hole) => !hasUsableRasterBoundary(hole)))
    return `Candidate “${candidate.id}” has a degenerate or crossing mask hole.`
  if (candidate.holes.some((hole) => hole.some((point) => !pointInPolygon(point, candidate.outer))))
    return `Candidate “${candidate.id}” has a mask hole outside its outer boundary.`
  return null
}

function resolveCandidate(candidate: ComparisonCandidate): ResolvedCandidate | string {
  const decision = candidate.decision
  if (!decision) return { candidate, structuralClass: candidate.class }
  if (decision.action === 'reject')
    return `Candidate “${candidate.id}” was rejected by semantic review: ${decision.evidence}`
  if (decision.correctedClass === 'background')
    return `Candidate “${candidate.id}” was classified as background: ${decision.evidence}`
  return {
    candidate,
    structuralClass: decision.correctedClass === 'uncertain' ? candidate.class : decision.correctedClass,
  }
}

function lineFrame(wall: Pick<PixelWall, 'start' | 'end'>): LineFrame {
  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)
  return { ux: dx / length, uy: dy / length, nx: -dy / length, ny: dx / length, length }
}

function canonicalWall(wall: PixelWall): PixelWall {
  if (
    wall.start[0] < wall.end[0] ||
    (wall.start[0] === wall.end[0] && wall.start[1] <= wall.end[1])
  )
    return wall
  return { ...wall, start: wall.end, end: wall.start }
}

function project(
  point: PlanPoint,
  wall: Pick<PixelWall, 'start' | 'end'>,
): [along: number, across: number] {
  const frame = lineFrame(wall)
  const dx = point[0] - wall.start[0]
  const dy = point[1] - wall.start[1]
  return [dx * frame.ux + dy * frame.uy, dx * frame.nx + dy * frame.ny]
}

function wallPoint(wall: Pick<PixelWall, 'start' | 'end'>, along: number, across = 0): PlanPoint {
  const frame = lineFrame(wall)
  return [
    wall.start[0] + frame.ux * along + frame.nx * across,
    wall.start[1] + frame.uy * along + frame.ny * across,
  ]
}

function mergeSourceIds(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])].sort((a, b) => a.localeCompare(b))
}

function median(values: number[]): number {
  const sorted = values.sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function maskDirections(candidate: ComparisonCandidate): number[] {
  const edges = candidate.outer.flatMap((point, index) => {
    const next = candidate.outer[(index + 1) % candidate.outer.length]!
    const dx = next[0] - point[0], dy = next[1] - point[1]
    const length = Math.hypot(dx, dy)
    return length >= 4 ? [{ angle: Math.atan2(dy, dx), length }] : []
  }).sort((a, b) => b.length - a.length)
  const groups: { angle: number; x: number; y: number; weight: number }[] = []
  for (const edge of edges) {
    const group = groups.find(g => Math.abs(Math.sin(g.angle - edge.angle)) < 0.08)
    if (group) {
      group.x += Math.cos(2 * edge.angle) * edge.length
      group.y += Math.sin(2 * edge.angle) * edge.length
      group.weight += edge.length
      group.angle = Math.atan2(group.y, group.x) / 2
    } else groups.push({ angle: edge.angle, x: Math.cos(2 * edge.angle) * edge.length, y: Math.sin(2 * edge.angle) * edge.length, weight: edge.length })
  }
  return groups.sort((a, b) => b.weight - a.weight).slice(0, 6).map(g => g.angle)
}

/** Exact polygon cross-sections avoid Hough top-N truncation and preserve short returns. */
function maskStrips(candidate: ComparisonCandidate, angle: number, maxThickness: number, centerDrift = 0.35): PixelWall[] {
  const ux = Math.cos(angle), uy = Math.sin(angle)
  const reference = { start: [0, 0] as PlanPoint, end: [ux, uy] as PlanPoint }
  const rings = [candidate.outer, ...candidate.holes].map(ring => ring.map(point =>
    [point[0] * ux + point[1] * uy, -point[0] * uy + point[1] * ux] as PlanPoint))
  const lower = Math.min(...rings[0]!.map(p => p[0])), upper = Math.max(...rings[0]!.map(p => p[0]))
  const step = Math.max(0.5, (upper - lower) / MAX_ANALYSIS_SIDE)
  type Run = { start: number; end: number; centers: number[]; widths: number[] }
  const active: Run[] = [], finished: Run[] = []
  for (let along = lower + step / 2; along < upper; along += step) {
    const cuts: number[] = []
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!
      if ((a[0] > along) === (b[0] > along)) continue
      cuts.push(a[1] + (along - a[0]) * (b[1] - a[1]) / (b[0] - a[0]))
    }
    cuts.sort((a, b) => a - b)
    const used = new Set<Run>()
    for (let i = 0; i + 1 < cuts.length; i += 2) {
      const thickness = cuts[i + 1]! - cuts[i]!
      if (thickness < 1.5 || thickness > maxThickness) continue
      const center = (cuts[i + 1]! + cuts[i]!) / 2
      const run = active.find(r => !used.has(r) &&
        Math.abs(r.centers[0]! - center) <= Math.max(step * 1.5, Math.min(thickness, r.widths[0]!) * centerDrift) &&
        along - r.end <= Math.max(step * 2, thickness * 1.2))
      if (run) {
        run.end = along + step / 2
        run.centers.push(center)
        run.widths.push(thickness)
        used.add(run)
      } else {
        const next = { start: along - step / 2, end: along + step / 2, centers: [center], widths: [thickness] }
        active.push(next)
        used.add(next)
      }
    }
    for (let i = active.length - 1; i >= 0; i--) {
      const run = active[i]!
      if (along - run.end > Math.max(step * 2, run.widths[run.widths.length - 1]! * 1.2)) {
        finished.push(run)
        active.splice(i, 1)
      }
    }
  }
  finished.push(...active)
  return finished.flatMap(run => {
    const thickness = median(run.widths), length = run.end - run.start
    if (length < Math.max(2, thickness * 0.5) || run.centers.length * step / length < 0.6) return []
    const center = median(run.centers)
    let support = 0
    for (let sample = 0; sample < 9; sample++)
      if (pointInCandidate(wallPoint(reference, run.start + length * (sample + 0.5) / 9, center), candidate)) support++
    if (support < 7) return []
    return [canonicalWall({ start: wallPoint(reference, run.start, center), end: wallPoint(reference, run.end, center),
      thickness, sourceIds: [candidate.id], derivation: 'retained-wall-mask-paired-face-axis' })]
  })
}

function extractWalls(candidates: ResolvedCandidate[], width: number, height: number): PixelWall[] {
  const extracted = candidates.flatMap(({ candidate }) => maskDirections(candidate).flatMap(angle =>
    maskStrips(candidate, angle, Math.max(12, Math.min(width, height) * 0.08))))
  extracted.sort((a, b) => lineFrame(b).length - lineFrame(a).length)
  const primary = extracted[0] ? lineFrame(extracted[0]) : null
  const walls: PixelWall[] = []
  for (const wall of extracted) {
    const f = lineFrame(wall)
    // A bevel on a mask corner is not a separate diagonal wall. Genuine
    // oblique runs remain; short orthogonal returns are never length-filtered.
    if (primary && f.length < wall.thickness * 1.4 &&
      Math.abs((primary.ux * f.uy - primary.uy * f.ux) * (primary.ux * f.ux + primary.uy * f.uy)) > 0.1) continue
    const covered = walls.find(other => {
      const of = lineFrame(other)
      return [wall.start, wall.end, wallPoint(wall, f.length / 2)].every(point => {
        const [along, across] = project(point, other)
        return along >= -0.5 && along <= of.length + 0.5 && Math.abs(across) <= other.thickness / 2 + 0.5
      }) && wall.thickness <= Math.max(other.thickness, of.length) + 1
    })
    if (covered) covered.sourceIds = mergeSourceIds(covered.sourceIds, wall.sourceIds)
    else walls.push(wall)
  }
  return walls
}

function maskMoments(candidate: ComparisonCandidate) {
  let area2 = 0
  let xMoment = 0
  let yMoment = 0
  let xxMoment = 0
  let xyMoment = 0
  let yyMoment = 0
  for (let ringIndex = -1; ringIndex < candidate.holes.length; ringIndex++) {
    const ring = ringIndex < 0 ? candidate.outer : candidate.holes[ringIndex]!
    const sign = Math.sign(signedArea(ring)) * (ringIndex < 0 ? 1 : -1)
    for (let index = 0; index < ring.length; index++) {
      const [x0, y0] = ring[index]!
      const [x1, y1] = ring[(index + 1) % ring.length]!
      const cross = (x0 * y1 - x1 * y0) * sign
      area2 += cross
      xMoment += (x0 + x1) * cross
      yMoment += (y0 + y1) * cross
      xxMoment += (x0 * x0 + x0 * x1 + x1 * x1) * cross
      yyMoment += (y0 * y0 + y0 * y1 + y1 * y1) * cross
      xyMoment += (2 * x0 * y0 + x0 * y1 + x1 * y0 + 2 * x1 * y1) * cross
    }
  }
  if (area2 <= GEOMETRY_EPSILON) return null
  const mean: PlanPoint = [xMoment / (3 * area2), yMoment / (3 * area2)]
  return {
    mean,
    xx: xxMoment / (6 * area2) - mean[0] ** 2,
    yy: yyMoment / (6 * area2) - mean[1] ** 2,
    xy: xyMoment / (12 * area2) - mean[0] * mean[1],
  }
}

function fitNarrowOpeningAxis(candidate: ComparisonCandidate, walls: PixelWall[]): OpeningAxis | null {
  const moments = maskMoments(candidate)
  if (!moments) return null
  const angle = Math.atan2(2 * moments.xy, moments.xx - moments.yy) / 2
  const directions = maskDirections(candidate)
  const nearest = walls.filter(w => {
    const [along, across] = project(moments.mean, w)
    return along > -40 && along < lineFrame(w).length + 40 && Math.abs(across) < Math.max(20, w.thickness * 3)
  })
  for (const wall of nearest) {
    const f = lineFrame(wall), direction = Math.atan2(f.uy, f.ux)
    if (!directions.some(a => Math.abs(Math.sin(a - direction)) < 0.03)) directions.unshift(direction)
  }
  if (!directions.some(a => Math.abs(Math.sin(a - angle)) < 0.05)) directions.push(angle)
  let best: PixelWall | undefined, bestScore = 0
  for (const direction of directions) {
    const strips = maskStrips(candidate, direction, 60, 0.8)
    regularizeWalls(strips)
    for (const strip of strips) {
    const length = lineFrame(strip).length
    if (length < 3 || length / strip.thickness < 2) continue
    const aligned = nearest.some(wall => { const f = lineFrame(wall); return Math.abs(f.ux * Math.cos(direction) + f.uy * Math.sin(direction)) > 0.995 })
    const score = length * length * Math.min(strip.thickness, length / 4) * (aligned ? 3 : 1)
    if (score > bestScore) { best = strip; bestScore = score }
  }
  }
  if (best) {
    // A stepped frame is one aperture, not only its thickest fragment.
    // Keep the dominant rail direction and span the entire observed frame.
    const projections = candidate.outer.map(point => project(point, best!)[0])
    const start = wallPoint(best, Math.min(...projections))
    const end = wallPoint(best, Math.max(...projections))
    best.start = start
    best.end = end
  }
  return best ? { start: best.start, end: best.end, thickness: best.thickness, method: 'mask-wall-strip' } : null
}

function openingInterval(
  axis: OpeningAxis,
  wall: PixelWall,
): { interval: Interval; method: PixelOpening['method'] } | null {
  const wallFrame = lineFrame(wall)
  const axisFrame = lineFrame(axis)
  if (Math.abs(wallFrame.ux * axisFrame.ux + wallFrame.uy * axisFrame.uy) < OPENING_COSINE)
    return null
  const start = project(axis.start, wall)
  const end = project(axis.end, wall)
  if (
    Math.max(Math.abs(start[1]), Math.abs(end[1])) >
    Math.max(3, (axis.thickness + wall.thickness) / 2)
  )
    return null
  const interval: Interval = [Math.min(start[0], end[0]), Math.max(start[0], end[0])]
  return interval[1] - interval[0] >= 2 ? { interval, method: axis.method } : null
}

function sourcePixelIsInk(
  source: { width: number; height: number; rgba: Uint8Array },
  x: number,
  y: number,
): boolean {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || px >= source.width || py < 0 || py >= source.height) return false
  const offset = (py * source.width + px) * 4
  const alpha = source.rgba[offset + 3]! / 255
  const luminance =
    (0.2126 * source.rgba[offset]! +
      0.7152 * source.rgba[offset + 1]! +
      0.0722 * source.rgba[offset + 2]!) *
      alpha +
    255 * (1 - alpha)
  return luminance <= 200
}

function recoverWindowFromSource(region: [number, number, number, number], walls: PixelWall[],
  source: { width: number; height: number; rgba: Uint8Array }): OpeningAxis | null {
  const [x0, y0, x1, y1] = region
  const center: PlanPoint = [(x0 + x1) / 2, (y0 + y1) / 2]
  let best: OpeningAxis | null = null, bestScore = 0
  for (const wall of walls) {
    const [alongCenter, acrossCenter] = project(center, wall), frame = lineFrame(wall)
    if (Math.abs(acrossCenter) > Math.max(x1 - x0, y1 - y0) / 2 + wall.thickness ||
      alongCenter < -30 || alongCenter > frame.length + 30) continue
    const corners: PlanPoint[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    const projections = corners.map(p => project(p, wall)[0])
    const lower = Math.min(...projections), upper = Math.max(...projections)
    if (upper - lower < wall.thickness * 1.5) continue
    for (const shift of [-.5, 0, .5]) {
      let start = -1, last = -1, hits = 0
      const finish = () => {
        const length = last - start + 1
        if (start < 0 || length < 12 || hits / length < .55) return
        const score = hits * length
        if (score > bestScore) {
          bestScore = score
          best = { start: wallPoint(wall, start, shift * wall.thickness),
            end: wallPoint(wall, last + 1, shift * wall.thickness), thickness: wall.thickness, method: 'mask-wall-strip' }
        }
      }
      for (let along = Math.ceil(lower); along <= upper + 4; along++) {
        let signal = false
        if (along <= upper) {
          const samples = Array.from({ length: 11 }, (_, i) => {
            const p = wallPoint(wall, along, (shift + (i - 5) / 5) * wall.thickness)
            return sourcePixelIsInk(source, p[0], p[1])
          })
          const first = samples.indexOf(true), lastInk = samples.lastIndexOf(true)
          signal = first >= 0 && lastInk - first >= 4 && samples.slice(first, lastInk + 1).filter(v => !v).length >= 2
        }
        if (signal) { if (start < 0) start = along; last = along; hits++ }
        else if (start >= 0 && along - last > 3) { finish(); start = -1; hits = 0 }
      }
      finish()
    }
  }
  return best
}

function recoverPierFromSource(id: string, region: [number, number, number, number],
  source: { width: number; height: number; rgba: Uint8Array }): ComparisonCandidate | null {
  const [left, top, right, bottom] = region
  const width = Math.ceil(right) - Math.floor(left) + 1, height = Math.ceil(bottom) - Math.floor(top) + 1
  if (width * height > 100_000) return null
  const seen = new Uint8Array(width * height)
  let best: { x0: number; y0: number; x1: number; y1: number; count: number } | null = null
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const start = y * width + x
    if (seen[start] || !sourcePixelIsInk(source, Math.floor(left) + x, Math.floor(top) + y)) continue
    const queue = [start], component = { x0: x, y0: y, x1: x, y1: y, count: 0 }
    seen[start] = 1
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const at = queue[cursor]!, px = at % width, py = Math.floor(at / width)
      component.x0 = Math.min(component.x0, px); component.x1 = Math.max(component.x1, px)
      component.y0 = Math.min(component.y0, py); component.y1 = Math.max(component.y1, py); component.count++
      for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
        if (nx! < 0 || ny! < 0 || nx! >= width || ny! >= height) continue
        const next = ny! * width + nx!
        if (!seen[next] && sourcePixelIsInk(source, Math.floor(left) + nx!, Math.floor(top) + ny!)) { seen[next] = 1; queue.push(next) }
      }
    }
    const w = component.x1 - component.x0 + 1, h = component.y1 - component.y0 + 1
    if (w >= 4 && h >= 4 && w / h > .5 && w / h < 2 && component.count / (w * h) > .75 &&
      (!best || component.count > best.count)) best = component
  }
  if (!best) return null
  const x0 = Math.floor(left) + best.x0, x1 = Math.floor(left) + best.x1 + 1
  const y0 = Math.floor(top) + best.y0, y1 = Math.floor(top) + best.y1 + 1
  return { id, class: 'wall', holes: [], outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
    decision: { id, action: 'needs_repair', correctedClass: 'wall', confidence: 'medium',
      evidence: 'Solid compact pier recovered from connected source ink inside the reviewer region; height remains assumed.' } }
}

function findJambAnchor(
  endpoint: PlanPoint,
  outward: PlanPoint,
  normal: PlanPoint,
  thickness: number,
  wallCandidates: ComparisonCandidate[],
  source: { width: number; height: number; rgba: Uint8Array },
): JambAnchor | null {
  const searchDistance = Math.max(4, Math.min(16, thickness * 2))
  const span = Math.max(2, thickness * 0.75)
  let sourceOnly: JambAnchor | null = null
  for (let distance = 0.5; distance <= searchDistance; distance += 0.5) {
    const center: PlanPoint = [
      endpoint[0] + outward[0] * distance,
      endpoint[1] + outward[1] * distance,
    ]
    const sourceIds = new Set<string>()
    const ink: boolean[] = []
    for (let sample = 0; sample < 9; sample += 1) {
      const across = -span + (span * 2 * sample) / 8
      const point: PlanPoint = [center[0] + normal[0] * across, center[1] + normal[1] * across]
      ink.push(sourcePixelIsInk(source, point[0], point[1]))
      for (const wallCandidate of wallCandidates) {
        if (pointInCandidate(point, wallCandidate)) sourceIds.add(wallCandidate.id)
      }
    }
    const inkCount = ink.filter(Boolean).length
    const crossesAxis =
      inkCount >= 4 && ink.slice(0, 3).some(Boolean) && ink.slice(-3).some(Boolean)
    if (sourceIds.size > 0 && (crossesAxis || inkCount >= 2))
      return { point: center, sourceIds: [...sourceIds] }
    if (!sourceOnly && crossesAxis) sourceOnly = { point: center, sourceIds: [] }
  }
  return sourceOnly
}

function findOpeningJambs(
  axis: OpeningAxis,
  wallCandidates: ComparisonCandidate[],
  source: { width: number; height: number; rgba: Uint8Array },
): OpeningJambs | null {
  const frame = lineFrame(axis)
  const start = findJambAnchor(
    axis.start,
    [-frame.ux, -frame.uy],
    [frame.nx, frame.ny],
    axis.thickness,
    wallCandidates,
    source,
  )
  const end = findJambAnchor(
    axis.end,
    [frame.ux, frame.uy],
    [frame.nx, frame.ny],
    axis.thickness,
    wallCandidates,
    source,
  )
  if (!start || !end) return null
  return { start, end }
}

function buildJambAnchoredWall(axis: OpeningAxis, jambs: OpeningJambs): PixelWall {
  return canonicalWall({
    start: jambs.start.point,
    end: jambs.end.point,
    thickness: axis.thickness,
    sourceIds: mergeSourceIds(jambs.start.sourceIds, jambs.end.sourceIds),
    derivation: 'opening-mask-jamb-bridge',
  })
}

function bridgeWallGap(axis: OpeningAxis, walls: PixelWall[]): boolean {
  for (let leftIndex = 0; leftIndex < walls.length; leftIndex += 1) {
    const left = walls[leftIndex]!
    const leftFrame = lineFrame(left)
    for (let rightIndex = leftIndex + 1; rightIndex < walls.length; rightIndex += 1) {
      const right = walls[rightIndex]!
      const rightFrame = lineFrame(right)
      if (Math.abs(leftFrame.ux * rightFrame.ux + leftFrame.uy * rightFrame.uy) < COLLINEAR_COSINE)
        continue
      const rightStart = project(right.start, left)
      const rightEnd = project(right.end, left)
      if (
        Math.max(Math.abs(rightStart[1]), Math.abs(rightEnd[1])) >
        Math.max(2, (left.thickness + right.thickness) / 2)
      )
        continue
      const rightLower = Math.min(rightStart[0], rightEnd[0])
      const rightUpper = Math.max(rightStart[0], rightEnd[0])
      let gap: Interval | null = null
      if (rightLower > leftFrame.length) gap = [leftFrame.length, rightLower]
      else if (rightUpper < 0) gap = [rightUpper, 0]
      if (!gap || gap[1] - gap[0] <= GEOMETRY_EPSILON) continue
      if (
        leftFrame.length < Math.max(5, left.thickness * 2) ||
        rightFrame.length < Math.max(5, right.thickness * 2)
      )
        continue
      const evidence = openingInterval(axis, left)
      if (!evidence) continue
      const openingWidth = evidence.interval[1] - evidence.interval[0]
      const gapWidth = gap[1] - gap[0]
      const overlap =
        Math.min(gap[1], evidence.interval[1]) - Math.max(gap[0], evidence.interval[0])
      const clearance = Math.max(left.thickness, right.thickness) * 2
      if (
        overlap < gapWidth * 0.55 ||
        gapWidth < openingWidth * 0.35 ||
        gapWidth > openingWidth + clearance
      )
        continue

      const values = [0, leftFrame.length, rightLower, rightUpper]
      const start = wallPoint(left, Math.min(...values))
      const end = wallPoint(left, Math.max(...values))
      const merged = canonicalWall({
        start,
        end,
        thickness:
          (left.thickness * leftFrame.length + right.thickness * rightFrame.length) /
          (leftFrame.length + rightFrame.length),
        sourceIds: mergeSourceIds(left.sourceIds, right.sourceIds),
        derivation:
          left.derivation === right.derivation ? left.derivation : 'opening-mask-jamb-bridge',
      })
      walls[leftIndex] = merged
      walls.splice(rightIndex, 1)
      return true
    }
  }
  return false
}

function regularizeWalls(walls: PixelWall[]): void {
  if (!walls.length) return
  const groups: { x: number; y: number; angle: number }[] = []
  const groupOf = new Map<PixelWall, number>()
  const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(2 * (a - b)), Math.cos(2 * (a - b))) / 2
  for (const wall of [...walls].sort((a, b) => lineFrame(b).length - lineFrame(a).length)) {
    const f = lineFrame(wall)
    const angle = Math.atan2(f.uy, f.ux)
    let index = groups.findIndex(group => Math.abs(angleDelta(angle, group.angle)) < Math.PI / 30)
    if (index < 0) {
      index = groups.length
      groups.push({ x: 0, y: 0, angle })
    }
    const group = groups[index]!
    group.x += Math.cos(2 * angle) * f.length
    group.y += Math.sin(2 * angle) * f.length
    group.angle = Math.atan2(group.y, group.x) / 2
    groupOf.set(wall, index)
  }
  // Average nearly orthogonal families together without forcing genuinely angled walls.
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    const a = groups[i]!, b = groups[j]!
    if (Math.abs(Math.abs(angleDelta(a.angle, b.angle)) - Math.PI / 2) > Math.PI / 30) continue
    a.angle = Math.atan2(a.y - b.y, a.x - b.x) / 2
    b.angle = a.angle + Math.PI / 2
  }
  for (const wall of walls) {
    const angle = groups[groupOf.get(wall)!]!.angle
    const f = lineFrame(wall)
    const cx = (wall.start[0] + wall.end[0]) / 2
    const cy = (wall.start[1] + wall.end[1]) / 2
    const dx = Math.cos(angle) * f.length / 2, dy = Math.sin(angle) * f.length / 2
    wall.start = [cx - dx, cy - dy]
    wall.end = [cx + dx, cy + dy]
    Object.assign(wall, canonicalWall(wall))
  }
  // Merge the complete union, not just the longest duplicate's footprint.
  // One centreline for near-collinear runs, even across an opening. This aligns
  // fragments without inventing material in the gap between them.
  for (let index = 0; index < groups.length; index++) {
    const angle = groups[index]!.angle, nx = -Math.sin(angle), ny = Math.cos(angle)
    const offsets: { rho: number; weight: number; thickness: number; members: PixelWall[] }[] = []
    for (const wall of walls.filter(w => groupOf.get(w) === index).sort((a, b) => lineFrame(b).length - lineFrame(a).length)) {
      const rho = ((wall.start[0] + wall.end[0]) * nx + (wall.start[1] + wall.end[1]) * ny) / 2
      const weight = lineFrame(wall).length
      const group = offsets.find(g => Math.abs(g.rho - rho) <= Math.max(2, Math.min(g.thickness, wall.thickness) * 0.6))
      if (group) {
        group.rho = (group.rho * group.weight + rho * weight) / (group.weight + weight)
        group.weight += weight
        group.members.push(wall)
      } else offsets.push({ rho, weight, thickness: wall.thickness, members: [wall] })
    }
    for (const group of offsets) for (const wall of group.members) {
      const delta = group.rho - (wall.start[0] * nx + wall.start[1] * ny)
      wall.start = [wall.start[0] + nx * delta, wall.start[1] + ny * delta]
      wall.end = [wall.end[0] + nx * delta, wall.end[1] + ny * delta]
    }
  }
  for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const a = walls[i]!, b = walls[j]!, af = lineFrame(a), bf = lineFrame(b)
    if (Math.abs(af.ux * bf.ux + af.uy * bf.uy) < COLLINEAR_COSINE) continue
    const [bs, bo] = project(b.start, a), [be, eo] = project(b.end, a)
    const low = Math.min(bs, be), high = Math.max(bs, be)
    const tolerance = Math.max(1.5, Math.min(a.thickness, b.thickness) * 0.65)
    if (Math.max(Math.abs(bo), Math.abs(eo)) > tolerance ||
      low > af.length + tolerance || high < -tolerance) continue
    const offset = ((bo + eo) / 2) * bf.length / (af.length + bf.length)
    const start = wallPoint(a, Math.min(0, low), offset)
    const end = wallPoint(a, Math.max(af.length, high), offset)
    a.thickness = (a.thickness * af.length + b.thickness * bf.length) / (af.length + bf.length)
    a.start = start
    a.end = end
    a.sourceIds = mergeSourceIds(a.sourceIds, b.sourceIds)
    if (a.derivation !== b.derivation) a.derivation = 'opening-mask-jamb-bridge'
    walls.splice(j--, 1)
  }
  // Extend short corner/T-junction gaps to the actual intersection of fitted axes.
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const a = walls[i]!, b = walls[j]!, af = lineFrame(a), bf = lineFrame(b)
    const cross = af.ux * bf.uy - af.uy * bf.ux
    if (Math.abs(cross) < 0.2) continue
    const dx = b.start[0] - a.start[0], dy = b.start[1] - a.start[1]
    const t = (dx * bf.uy - dy * bf.ux) / cross
    const u = (dx * af.uy - dy * af.ux) / cross
    const tolerance = Math.max(3, (a.thickness + b.thickness) * 0.8)
    if (t < -tolerance || t > af.length + tolerance || u < -tolerance || u > bf.length + tolerance) continue
    const point = wallPoint(a, t)
    for (const [wall, along, length] of [[a, t, af.length], [b, u, bf.length]] as const) {
      const startDistance = Math.abs(along), endDistance = Math.abs(along - length)
      if (startDistance < endDistance && startDistance < tolerance &&
        Math.hypot(point[0] - wall.end[0], point[1] - wall.end[1]) >= Math.max(0.5, length * 0.35)) wall.start = point
      else if (endDistance <= startDistance && endDistance < tolerance &&
        Math.hypot(point[0] - wall.start[0], point[1] - wall.start[1]) >= Math.max(0.5, length * 0.35)) wall.end = point
    }
  }
}

function inferDoorOrientation(axis: OpeningAxis, source: { width: number; height: number; rgba: Uint8Array }) {
  const f = lineFrame(axis)
  const scores: { hingesSide: 'left' | 'right'; swingDirection: 'inward' | 'outward'; score: number }[] = []
  const inkNear = (point: PlanPoint) => {
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++)
      if (sourcePixelIsInk(source, point[0] + x, point[1] + y)) return 1
    return 0
  }
  for (const hinge of [0, 1]) for (const side of [-1, 1]) {
    let score = 0
    for (let i = 0; i < 24; i++) {
      const angle = (0.13 + 0.74 * (i + 0.5) / 24) * Math.PI / 2
      const along = hinge ? f.length * (1 - Math.cos(angle)) : f.length * Math.cos(angle)
      const across = side * f.length * Math.sin(angle)
      score += inkNear(wallPoint(axis, along, across))
    }
    scores.push({ hingesSide: hinge ? 'right' : 'left', swingDirection: side > 0 ? 'inward' : 'outward', score: score / 24 })
  }
  scores.sort((a, b) => b.score - a.score)
  const best = scores[0]!
  if (best.score < 0.45 || best.score - scores[1]!.score < 0.12)
    return { hingesSide: 'left' as const, swingDirection: 'inward' as const, orientationEvidence: 'unresolved-default' as const }
  return { hingesSide: best.hingesSide, swingDirection: best.swingDirection, orientationEvidence: 'source-arc' as const }
}

function chooseOpeningHost(
  axis: OpeningAxis,
  walls: PixelWall[],
): { wall: PixelWall; interval: Interval; method: PixelOpening['method'] } | null {
  const choices = walls.flatMap((wall) => {
    const evidence = openingInterval(axis, wall)
    if (!evidence) return []
    const frame = lineFrame(wall)
    const tolerance = Math.max(2, wall.thickness, axis.thickness)
    if (evidence.interval[0] < -tolerance || evidence.interval[1] > frame.length + tolerance) return []
    const interval: Interval = [Math.max(0, evidence.interval[0]), Math.min(frame.length, evidence.interval[1])]
    const width = interval[1] - interval[0]
    if (width < 2 || width < (evidence.interval[1] - evidence.interval[0]) * .7) return []
    const fitMargin = Math.min(interval[0], frame.length - interval[1])
    return [{ wall, interval, method: evidence.method, fitMargin }]
  })
  choices.sort(
    (left, right) =>
      right.fitMargin - left.fitMargin ||
      lineFrame(right.wall).length - lineFrame(left.wall).length,
  )
  return choices[0] ?? null
}

function pixelWallsToNative(
  walls: PixelWall[],
  variantId: string,
  options: NativePreviewOptions,
): FloorplanStructureWall[] {
  return walls.map(
    (wall, index): FloorplanStructureWall => ({
      id: `axis-${index + 1}`,
      sourceIds: wall.sourceIds,
      name: `Wall ${index + 1}`,
      start: [wall.start[0] * options.metersPerPixel, wall.start[1] * options.metersPerPixel],
      end: [wall.end[0] * options.metersPerPixel, wall.end[1] * options.metersPerPixel],
      thickness: wall.thickness * options.metersPerPixel,
      height: options.wallHeight,
      metadata: {
        nativeMaskPreview: {
          version: 1,
          variantId,
          sourceIds: wall.sourceIds,
          sourceAxes: 'pixel-x-right-y-down',
          nativeAxes: 'level-x-right-z-down',
          derivation: wall.derivation,
        },
      },
    }),
  )
}

function buildOpeningInput(
  opening: PixelOpening,
  wallId: string,
  variantId: string,
  options: NativePreviewOptions,
): FloorplanStructureOpening {
  const doorHeight = Math.min(2.1, options.wallHeight - 0.05)
  const windowSill = Math.min(0.9, options.wallHeight * 0.35)
  const windowHeight = Math.min(1.2, options.wallHeight - windowSill - 0.05)
  return {
    sourceId: opening.sourceId,
    wallId,
    kind: opening.kind,
    offset: opening.offset * options.metersPerPixel,
    width: opening.width * options.metersPerPixel,
    height: opening.kind === 'door' ? doorHeight : windowHeight,
    sillHeight: opening.kind === 'door' ? 0 : windowSill,
    side: 'front',
    doorType: 'hinged',
    hingesSide: opening.hingesSide ?? 'left',
    swingDirection: opening.swingDirection ?? 'inward',
    metadata: {
      nativeMaskPreview: {
        version: 1,
        variantId,
        sourceId: opening.sourceId,
        sourceAxes: 'pixel-x-right-y-down',
        nativeAxes: 'wall-local-u-up',
        derivation: opening.method,
        verticalDimensions: 'preview-assumption',
        orientationEvidence: opening.orientationEvidence ?? 'not-applicable',
      },
    },
  }
}

function addUnresolved(
  mappings: NativeSourceMapping[],
  issues: string[],
  sourceId: string,
  detail: string,
): void {
  mappings.push({ sourceId, nodeIds: [], status: 'unresolved', detail })
  issues.push(detail)
}

export async function buildNativeMaskPreview(
  variant: ComparisonVariant,
  source: { width: number; height: number; rgba: Uint8Array; labels?: SourceLabel[]; issues?: string[] },
  options: NativePreviewOptions,
): Promise<NativeMaskPreview> {
  if (!variant?.id?.trim()) throw new Error('Native mask preview requires a variant with an ID.')
  if (!Array.isArray(variant.candidates) || !Array.isArray(variant.missingFeatures))
    throw new Error('Native mask preview requires normalized candidate and missing-feature arrays.')
  if (
    !source ||
    !Number.isInteger(source.width) ||
    !Number.isInteger(source.height) ||
    source.width < 1 ||
    source.height < 1 ||
    !(source.rgba instanceof Uint8Array) ||
    source.rgba.length !== source.width * source.height * 4
  )
    throw new Error('Native mask preview requires a decoded source-sized RGBA image.')
  if (!Number.isFinite(options.metersPerPixel) || options.metersPerPixel <= 0)
    throw new Error('Native mask preview requires a positive finite metres-per-pixel calibration.')
  if (!Number.isFinite(options.wallHeight) || options.wallHeight < 0.5)
    throw new Error('Native mask preview requires a finite wall height of at least 0.5 metres.')
  if (
    source.width * options.metersPerPixel > 10_000 ||
    source.height * options.metersPerPixel > 10_000
  )
    throw new Error('Native mask preview calibration exceeds the 10,000 metre plan bound.')

  const candidateIds = new Set<string>()
  for (const candidate of variant.candidates) {
    if (candidateIds.has(candidate.id))
      throw new Error(`Comparison candidate ID “${candidate.id}” is duplicated.`)
    candidateIds.add(candidate.id)
  }

  const mappings: NativeSourceMapping[] = []
  const issues = [...variant.issues]
  const resolved: ResolvedCandidate[] = []
  for (const candidate of variant.candidates) {
    const geometryProblem = validateCandidate(candidate, source.width, source.height)
    if (geometryProblem) {
      addUnresolved(mappings, issues, candidate.id, geometryProblem)
      continue
    }
    const resolution = resolveCandidate(candidate)
    if (typeof resolution === 'string') {
      addUnresolved(mappings, issues, candidate.id, resolution)
      continue
    }
    resolved.push(resolution)
  }

  const wallCandidates = resolved.filter((entry) => entry.structuralClass === 'wall')
  const openingCandidates = resolved.filter(
    (entry) => entry.structuralClass === 'door' || entry.structuralClass === 'window',
  )
  const pixelWalls = extractWalls(wallCandidates, source.width, source.height).filter((wall) => {
    const thickness = wall.thickness * options.metersPerPixel
    const length = lineFrame(wall).length * options.metersPerPixel
    return thickness >= 0.02 && thickness <= 1 && length >= 0.05
  })
  regularizeWalls(pixelWalls)
  variant.missingFeatures.forEach((proposal, index) => {
    if (proposal.kind !== 'wall') return
    const candidate = recoverPierFromSource(`missing:${index + 1}:wall`, proposal.sourceRegion, source)
    if (!candidate) return
    const entry: ResolvedCandidate = { candidate, structuralClass: 'wall' }
    resolved.push(entry); wallCandidates.push(entry)
    pixelWalls.push(...extractWalls([entry], source.width, source.height))
  })
  variant.missingFeatures.forEach((proposal, index) => {
    if (proposal.kind !== 'window') return
    const [x0, y0, x1, y1] = proposal.sourceRegion
    if (openingCandidates.some(({ candidate, structuralClass }) => structuralClass === 'window' &&
      candidate.outer.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1))) return
    const axis = recoverWindowFromSource(proposal.sourceRegion, pixelWalls, source)
    if (!axis) return
    const length = lineFrame(axis).length
    const id = `missing:${index + 1}:window`
    const candidate: ComparisonCandidate = { id, class: 'window', holes: [],
      outer: [wallPoint(axis, 0, -axis.thickness / 2), wallPoint(axis, length, -axis.thickness / 2),
        wallPoint(axis, length, axis.thickness / 2), wallPoint(axis, 0, axis.thickness / 2)],
      decision: { id, action: 'needs_repair', correctedClass: 'window', confidence: 'medium',
        evidence: 'Recovered parallel frame strokes inside the review region on a reconstructed wall; aperture dimensions remain approximate.' } }
    const entry: ResolvedCandidate = { candidate, structuralClass: 'window' }
    openingCandidates.push(entry); resolved.push(entry)
  })
  const recoveredReturns: ResolvedCandidate[] = []
  const sourceParents = new Map<string, string>()
  const openingAxes = new Map<string, OpeningAxis>()
  for (const { candidate, structuralClass } of openingCandidates) {
    if (structuralClass !== 'window') continue
    const axis = fitNarrowOpeningAxis(candidate, pixelWalls)
    if (!axis) continue
    openingAxes.set(candidate.id, axis)
    const af = lineFrame(axis)
    for (const angle of maskDirections(candidate)) {
      if (Math.abs(Math.cos(angle) * af.ux + Math.sin(angle) * af.uy) > 0.25) continue
      for (const branch of maskStrips(candidate, angle, Math.max(12, Math.min(source.width, source.height) * 0.08))) {
        if (lineFrame(branch).length < Math.max(5, axis.thickness * 2)) continue
        const meetsEnd = [branch.start, branch.end].some(point =>
          [axis.start, axis.end].some(end => Math.hypot(point[0] - end[0], point[1] - end[1]) <= Math.max(3, axis.thickness * 1.5)))
        if (!meetsEnd) continue
        branch.derivation = 'opening-implied-host'
        pixelWalls.push(branch)
        const bf = lineFrame(branch)
        const corners = [wallPoint(branch, 0, -branch.thickness / 2), wallPoint(branch, bf.length, -branch.thickness / 2),
          wallPoint(branch, bf.length, branch.thickness / 2), wallPoint(branch, 0, branch.thickness / 2)]
        const region: [number, number, number, number] = [
          Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1])),
          Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1])),
        ]
        const frame = recoverWindowFromSource(region, [branch], source)
        if (!frame) continue
        const length = lineFrame(frame).length, id = `${candidate.id}:return:${recoveredReturns.length + 1}`
        sourceParents.set(id, candidate.id)
        openingAxes.set(id, frame)
        recoveredReturns.push({ structuralClass: 'window', candidate: {
          id, class: 'window', holes: [], outer: [
            wallPoint(frame, 0, -frame.thickness / 2), wallPoint(frame, length, -frame.thickness / 2),
            wallPoint(frame, length, frame.thickness / 2), wallPoint(frame, 0, frame.thickness / 2),
          ], decision: { id, action: 'needs_repair', correctedClass: 'window', confidence: 'medium',
            evidence: 'A second frame run is supported by parallel source strokes on the attached return of the original window mask.' },
        } })
      }
    }
  }
  openingCandidates.push(...recoveredReturns)
  resolved.push(...recoveredReturns)
  regularizeWalls(pixelWalls)

  const acceptedWallMasks = wallCandidates.map(({ candidate }) => candidate)
  const supportedOpenings = openingCandidates.flatMap((entry) => {
    const axis = openingAxes.get(entry.candidate.id) ?? fitNarrowOpeningAxis(entry.candidate, pixelWalls)
    if (!axis) return []
    const observedJambs = findOpeningJambs(axis, acceptedWallMasks, source)
    const jambs = observedJambs ?? {
      start: { point: wallPoint(axis, -axis.thickness / 2), sourceIds: [] },
      end: { point: wallPoint(axis, lineFrame(axis).length + axis.thickness / 2), sourceIds: [] },
    }
    const widthMeters = lineFrame(axis).length * options.metersPerPixel
    if (widthMeters < 0.1 || widthMeters > 10) return []
    const thicknessMeters = axis.thickness * options.metersPerPixel
    if (thicknessMeters < 0.02 || thicknessMeters > 1) return []
    while (bridgeWallGap(axis, pixelWalls)) {
      // One opening can bridge only adjacent fragments on the same observed wall run.
    }
    return [{ ...entry, axis, jambs }]
  })

  for (const { candidate, axis, jambs } of supportedOpenings) {
    if (!chooseOpeningHost(axis, pixelWalls)) {
      const jambWall = buildJambAnchoredWall(axis, jambs)
      if (jambWall.sourceIds.length === 0) {
        jambWall.sourceIds = [candidate.id]
        jambWall.derivation = 'opening-implied-host'
      }
      pixelWalls.push(jambWall)
    }
  }
  for (let i = 0; i < supportedOpenings.length; i++) for (let j = i + 1; j < supportedOpenings.length; j++) {
    const a = supportedOpenings[i]!, b = supportedOpenings[j]!, af = lineFrame(a.axis), bf = lineFrame(b.axis)
    if (Math.abs(af.ux * bf.ux + af.uy * bf.uy) < OPENING_COSINE) continue
    const [start, startOffset] = project(b.axis.start, a.axis), [end, endOffset] = project(b.axis.end, a.axis)
    const thickness = Math.max(a.axis.thickness, b.axis.thickness)
    if (Math.max(Math.abs(startOffset), Math.abs(endOffset)) > Math.max(2, thickness * .75)) continue
    const low = Math.min(start, end), high = Math.max(start, end)
    const gap: Interval | null = low > af.length ? [af.length, low] : high < 0 ? [high, 0] : null
    if (!gap || gap[1] - gap[0] > Math.max(6, Math.min(thickness * 4, Math.min(af.length, bf.length) * .65))) continue
    pixelWalls.push(canonicalWall({
      start: wallPoint(a.axis, gap[0] - thickness / 2), end: wallPoint(a.axis, gap[1] + thickness / 2),
      thickness, sourceIds: [a.candidate.id, b.candidate.id], derivation: 'opening-implied-host',
    }))
  }
  // Window-frame fragments mislabelled as small angled walls must not plug the aperture.
  for (let index = pixelWalls.length - 1; index >= 0; index--) {
    const wall = pixelWalls[index]!, wf = lineFrame(wall)
    if (supportedOpenings.some(({ structuralClass, axis }) => {
      if (structuralClass !== 'window') return false
      const af = lineFrame(axis)
      if (Math.abs(wf.ux * af.ux + wf.uy * af.uy) > OPENING_COSINE || wf.length > af.length) return false
      const middle = project(wallPoint(wall, wf.length / 2), axis)
      const margin = Math.min(axis.thickness, af.length * .2)
      return middle[0] > margin && middle[0] < af.length - margin &&
        [wall.start, wall.end].every(point => {
          const [along, across] = project(point, axis)
          return along >= -axis.thickness && along <= af.length + axis.thickness &&
            Math.abs(across) <= (axis.thickness + wall.thickness) / 2
        })
    })) pixelWalls.splice(index, 1)
  }
  regularizeWalls(pixelWalls)
  const pixelOpenings: PixelOpening[] = []
  for (const { candidate, structuralClass, axis } of supportedOpenings) {
    const host = chooseOpeningHost(axis, pixelWalls)
    if (!host) continue
    const widthMeters = (host.interval[1] - host.interval[0]) * options.metersPerPixel
    if (widthMeters < 0.1 || widthMeters > 10) continue
    const wallLength = lineFrame(host.wall).length
    const center = (host.interval[0] + host.interval[1]) / 2
    const duplicate = pixelOpenings.find(
      (opening) =>
        opening.wall === host.wall &&
        Math.min(
          opening.offset + opening.width / 2,
          center + (host.interval[1] - host.interval[0]) / 2,
        ) -
          Math.max(
            opening.offset - opening.width / 2,
            center - (host.interval[1] - host.interval[0]) / 2,
          ) >
          GEOMETRY_EPSILON,
    )
    if (duplicate) continue
    if (
      center - (host.interval[1] - host.interval[0]) / 2 < 0 ||
      center + (host.interval[1] - host.interval[0]) / 2 > wallLength
    )
      continue
    pixelOpenings.push({
      sourceId: candidate.id,
      wall: host.wall,
      offset: center,
      width: host.interval[1] - host.interval[0],
      method: host.method,
      kind: structuralClass === 'door' ? 'door' : 'window',
      ...(structuralClass === 'door' ? inferDoorOrientation({
        start: wallPoint(host.wall, host.interval[0]),
        end: wallPoint(host.wall, host.interval[1]),
        thickness: host.wall.thickness,
        method: host.method,
      }, source) : {}),
    })
  }

  const nativeWalls = pixelWallsToNative(pixelWalls, variant.id, options)
  const wallIdByPixelWall = new Map(pixelWalls.map((wall, index) => [wall, nativeWalls[index]!.id]))
  const nativeOpenings = pixelOpenings.map((opening) =>
    buildOpeningInput(opening, wallIdByPixelWall.get(opening.wall)!, variant.id, options),
  )
  const contextMetadata = {
    nativeMaskPreview: {
      version: 1,
      variantId: variant.id,
      extractor: variant.extractor,
      metersPerPixel: options.metersPerPixel,
      wallHeight: options.wallHeight,
      calibration: options.calibration ?? null,
      sourceSize: [source.width, source.height],
      transform: {
        sourceAxes: 'pixel-x-right-y-down',
        nativeAxes: 'level-x-right-z-down',
        translation: [0, 0],
        yawRadians: 0,
      },
    },
  }
  const prepared = prepareFloorplanStructurePreview({
    buildingName: `${variant.label} structural preview`,
    levelName: 'Mask evidence',
    levelHeight: options.wallHeight,
    walls: nativeWalls,
    openings: nativeOpenings,
    metadata: contextMetadata,
  })
  for (const [child, parent] of sourceParents) {
    const childNodes = prepared.sourceToNative[child]
    if (childNodes) prepared.sourceToNative[parent] = [...new Set([...(prepared.sourceToNative[parent] ?? []), ...childNodes])]
  }
  const context = addReconstructionContext(prepared.nodes, prepared.levelId,
    { ...variant, candidates: resolved.map(entry => entry.candidate) }, source, options)
  for (const [index, zone] of context.zones.entries()) mappings.push({
    sourceId: `zone:${index + 1}`, nodeIds: [zone.id], status: 'approximated',
    detail: 'Region from reconstructed wall boundaries; readable source labels name zones. Open-plan divisions are approximate, not added walls.',
  })
  for (const [index, prop] of context.props.entries()) mappings.push({
    sourceId: `prop:${index + 1}`, nodeIds: [prop.id], status: 'approximated',
    detail: 'Approximate native block from source-ink evidence. Classification is retained when reviewed, otherwise unclassified. Height is assumed; no catalog asset or exact furnishing geometry is claimed.',
  })
  issues.push(...(source.issues ?? []))

  const existingMappings = new Map(mappings.map((mapping) => [mapping.sourceId, mapping]))
  for (const { candidate, structuralClass } of resolved) {
    const nodeIds = prepared.sourceToNative[candidate.id] ?? []
    if (structuralClass !== 'wall' && !nodeIds.some(id => prepared.nodes[id]?.type === structuralClass)) {
      mappings.push({ sourceId: candidate.id, nodeIds, status: 'unresolved',
        detail: `Supporting wall geometry was retained, but this ${structuralClass} did not yield a distinct hosted opening.` })
      continue
    }
    if (nodeIds.length > 0) {
      mappings.push({
        sourceId: candidate.id,
        nodeIds,
        status: candidate.decision?.action === 'needs_repair' ||
          candidate.decision?.correctedClass === 'uncertain' ||
          pixelWalls.some(wall => wall.derivation === 'opening-implied-host' && wall.sourceIds.includes(candidate.id))
          ? 'approximated' : 'converted',
        detail: `${structuralClass === 'wall'
          ? `Fitted ${nodeIds.length} connected wall segment(s) from the retained mask.`
          : `Fitted a hosted ${structuralClass}; an opening itself can establish its local wall.`}${
          candidate.decision?.action === 'needs_repair'
            ? ` Best-effort approximation; review warning retained: ${candidate.decision.evidence}` : ''
        }`,
      })
      continue
    }
    if (existingMappings.has(candidate.id)) continue
    const detail =
      structuralClass === 'wall'
        ? `Wall candidate “${candidate.id}” did not contain a defensible straight paired-face band at this resolution and calibration.`
        : `${structuralClass === 'door' ? 'Door' : 'Window'} candidate “${candidate.id}” has no defensible narrow aperture anchored at both source-supported wall jambs.`
    addUnresolved(mappings, issues, candidate.id, detail)
  }

  variant.missingFeatures.forEach((proposal, index) => {
    const sourceId = `missing:${index + 1}:${proposal.kind}`
    if (mappings.some(mapping => mapping.sourceId === sourceId)) return
    addUnresolved(
      mappings,
      issues,
      sourceId,
      `Missing-feature proposal ${index + 1} (${proposal.kind}) remains unresolved; its box is evidence for review, not accepted geometry. ${proposal.evidence}`,
    )
  })
  const mappingOrder = new Map<string, number>()
  variant.candidates.forEach((candidate, index) => mappingOrder.set(candidate.id, index))
  variant.missingFeatures.forEach((proposal, index) =>
    mappingOrder.set(`missing:${index + 1}:${proposal.kind}`, variant.candidates.length + index),
  )
  mappings.sort(
    (left, right) =>
      (mappingOrder.get(left.sourceId) ?? Number.MAX_SAFE_INTEGER) -
      (mappingOrder.get(right.sourceId) ?? Number.MAX_SAFE_INTEGER),
  )

  const nodes = prepared.nodes
  const counts = Object.values(nodes).reduce(
    (result, node) => {
      if (node.type === 'wall') result.walls += 1
      else if (node.type === 'door') result.doors += 1
      else if (node.type === 'window') result.windows += 1
      else if (node.type === 'slab') result.slabs += 1
      else if (node.type === 'zone') result.zones += 1
      else if (node.type === 'block') result.props += 1
      return result
    },
    { walls: 0, doors: 0, windows: 0, slabs: 0, zones: 0, props: 0 },
  )

  return {
    nodes,
    levelId: prepared.levelId,
    counts,
    mappings,
    issues,
    assumptions: [
      `Calibration is ${options.metersPerPixel} metres per source pixel.`,
      'Source +X maps to native +X and source +Y maps to native +Z without flipping or rotation.',
      `All preview walls use the declared ${options.wallHeight} metre height; masks provide no vertical dimension.`,
      'Doors use a 2.10 metre maximum assumed height at floor level; windows use a 1.20 metre maximum assumed height and a 0.90 metre maximum assumed sill, each clamped below the wall top.',
      'Door hinge and swing are matched against source quarter-circle ink when distinguishable; otherwise explicit native defaults remain.',
      'Repair flags retain best-effort fitted structure. An observed opening implies a bounded local wall even without a wall mask. Nearby directions and junctions are regularized; unrelated gaps are not filled.',
      'Zones use reconstructed wall enclosures and offline source text. Shared open-plan spaces are divided approximately without inserting walls. Props use source-ink footprints and explicit assumed heights.',
    ],
    bounds: {
      x: 0,
      y: 0,
      width: source.width * options.metersPerPixel,
      height: source.height * options.metersPerPixel,
    },
  }
}
