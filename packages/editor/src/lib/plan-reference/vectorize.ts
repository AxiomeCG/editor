import type { PlanPoint } from './calibration'

export type VectorContour = {
  id: string
  points: PlanPoint[]
  holes: PlanPoint[][]
  area: number
  stroke?: boolean
  strokeWidth?: number
}
export type TraceOptions = { threshold: number; minArea: number; mode: 'ink' | 'spaces' }

export function signedContourArea(points: PlanPoint[]) {
  return (
    points.reduce((area, p, i) => {
      const q = points[(i + 1) % points.length]!
      return area + p[0] * q[1] - q[0] * p[1]
    }, 0) / 2
  )
}

export function simplifyContour(points: PlanPoint[], tolerance: number): PlanPoint[] {
  const reduce = (ps: PlanPoint[]): PlanPoint[] => {
    if (ps.length <= 2) return ps
    const a = ps[0]!,
      b = ps.at(-1)!,
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      length2 = dx * dx + dy * dy
    let distance = tolerance,
      split = -1
    for (let i = 1; i < ps.length - 1; i++) {
      const p = ps[i]!,
        t = length2
          ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2))
          : 0
      const d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
      if (d > distance) {
        distance = d
        split = i
      }
    }
    return split < 0
      ? [a, b]
      : [...reduce(ps.slice(0, split + 1)).slice(0, -1), ...reduce(ps.slice(split))]
  }
  if (points.length < 3) return points
  return reduce([...points, points[0]!]).slice(0, -1)
}

/** Traces connected ink or enclosed white regions. Coordinates retain the original image frame. */
export function tracePlanRaster(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: TraceOptions,
): VectorContour[] {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 2_500_000 ||
    rgba.length !== width * height * 4
  )
    throw Error('Invalid raster dimensions.')
  if (
    !Number.isFinite(options.threshold) ||
    !Number.isFinite(options.minArea) ||
    options.minArea < 1 ||
    options.threshold < 0 ||
    options.threshold > 255
  )
    throw Error('Invalid trace settings.')
  const mask = new Uint8Array(width * height),
    labels = new Int32Array(mask.length),
    queue = new Int32Array(mask.length)
  for (let i = 0; i < mask.length; i++) {
    const alpha = rgba[i * 4 + 3]! / 255
    const brightness =
      (rgba[i * 4]! * 0.2126 + rgba[i * 4 + 1]! * 0.7152 + rgba[i * 4 + 2]! * 0.0722) * alpha +
      255 * (1 - alpha)
    mask[i] = brightness < options.threshold === (options.mode === 'ink') ? 1 : 0
  }
  const contours: VectorContour[] = []
  let label = 0
  const stride = width + 1
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || labels[seed]) continue
    label++
    let head = 0,
      tail = 1,
      border = false
    queue[0] = seed
    labels[seed] = label
    while (head < tail) {
      const index = queue[head++]!,
        x = index % width,
        y = Math.floor(index / width)
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border = true
      for (const next of [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ]) {
        if (next >= 0 && mask[next] && !labels[next]) {
          labels[next] = label
          queue[tail++] = next
        }
      }
    }
    if (tail < options.minArea || tail > mask.length * 0.8 || (border && options.mode === 'spaces'))
      continue
    const edges = boundaryEdges(
      queue,
      tail,
      (index) => labels[index] === label,
      width,
      height,
      stride,
    )
    const loops = walkBoundaryLoops(edges, stride, 4 * tail + 4)
    const outer = loops
      .filter((p) => signedContourArea(p) > 0)
      .sort((a, b) => signedContourArea(b) - signedContourArea(a))[0]
    if (!outer) continue
    contours.push({
      id: `trace-${options.mode}-${seed}`,
      points: outer,
      holes: loops.filter((p) => signedContourArea(p) < 0),
      area: tail,
    })
  }
  return contours.sort((a, b) => b.area - a.area).slice(0, 256)
}

function boundaryEdges(
  pixels: Int32Array,
  count: number,
  inside: (index: number) => boolean,
  width: number,
  height: number,
  stride: number,
) {
  const edges = new Map<number, number[]>()
  const add = (a: number, b: number) => {
    const list = edges.get(a)
    if (list) list.push(b)
    else edges.set(a, [b])
  }
  for (let i = 0; i < count; i++) {
    const index = pixels[i]!,
      x = index % width,
      y = Math.floor(index / width),
      a = y * stride + x
    if (y === 0 || !inside(index - width)) add(a, a + 1)
    if (x === width - 1 || !inside(index + 1)) add(a + 1, a + 1 + stride)
    if (y === height - 1 || !inside(index + width)) add(a + 1 + stride, a + stride)
    if (x === 0 || !inside(index - 1)) add(a + stride, a)
  }
  return edges
}

function walkBoundaryLoops(
  edges: Map<number, number[]>,
  stride: number,
  guard: number,
): PlanPoint[][] {
  const xy = (index: number): PlanPoint => [index % stride, Math.floor(index / stride)]
  const loops: PlanPoint[][] = []
  while (edges.size) {
    const start = edges.keys().next().value as number
    let current = start,
      direction = 0
    const points: PlanPoint[] = []
    for (let step = 0; step <= guard; step++) {
      points.push(xy(current))
      const choices = edges.get(current)
      if (!choices?.length) break
      const dir = (n: number) =>
        n === current + 1 ? 0 : n === current + stride ? 1 : n === current - 1 ? 2 : 3
      const rank = (n: number) => [1, 0, 3, 2][(dir(n) - direction + 4) % 4]!
      choices.sort((a, b) => rank(a) - rank(b))
      const next = choices.shift()!
      direction = dir(next)
      if (!choices.length) edges.delete(current)
      current = next
      if (current === start) break
    }
    if (current === start && points.length >= 3) {
      const simple = simplifyContour(points, 1)
      if (simple.length >= 3 && Math.abs(signedContourArea(simple)) >= 4) loops.push(simple)
    }
  }
  return loops
}

function dilateMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return mask
  const expand = (source: Uint8Array, target: Uint8Array, length: number, stride: number) => {
    let last = -1
    for (let i = 0; i < length; i++) {
      if (source[i * stride]) last = i
      target[i * stride] = last >= 0 && i - last <= radius ? 1 : 0
    }
    last = -1
    for (let i = length - 1; i >= 0; i--) {
      if (source[i * stride]) last = i
      if (last >= 0 && last - i <= radius) target[i * stride] = 1
    }
  }
  const horizontal = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) expand(mask.subarray(y * width, (y + 1) * width), horizontal.subarray(y * width, (y + 1) * width), width, 1)
  const dilated = new Uint8Array(mask.length)
  for (let x = 0; x < width; x++) expand(horizontal.subarray(x), dilated.subarray(x), height, width)
  return dilated
}

/** Flood-fills the whitespace containing the seed point and traces its boundary. */
export function traceRegionAtPoint(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  seed: [number, number],
  options: { threshold: number; minArea: number; dilatePixels?: number },
): { points: PlanPoint[]; holes: PlanPoint[][] } | null {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 2_500_000 ||
    rgba.length !== width * height * 4 ||
    !Number.isFinite(options.threshold) ||
    options.threshold < 0 ||
    options.threshold > 255
  )
    throw Error('Invalid raster dimensions or trace settings.')
  const barrier = new Uint8Array(width * height)
  for (let i = 0; i < barrier.length; i++) {
    const alpha = rgba[i * 4 + 3]! / 255
    const brightness =
      (rgba[i * 4]! * 0.2126 + rgba[i * 4 + 1]! * 0.7152 + rgba[i * 4 + 2]! * 0.0722) * alpha +
      255 * (1 - alpha)
    barrier[i] = brightness < options.threshold ? 1 : 0
  }
  const sealed = dilateMask(barrier, width, height, Math.round(options.dilatePixels ?? 0))
  const startX = Math.floor(seed[0]!),
    startY = Math.floor(seed[1]!)
  // Clicking a line is an explicit miss; nudging to a neighbour would fill a
  // region the user did not point at.
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return null
  const origin = startY * width + startX
  if (sealed[origin]) return null
  const region = new Uint8Array(width * height),
    queue = new Int32Array(width * height)
  let head = 0,
    tail = 0,
    border = false
  queue[tail++] = origin
  region[origin] = 1
  while (head < tail) {
    const index = queue[head++]!,
      x = index % width,
      y = Math.floor(index / width)
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border = true
    for (const next of [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y < height - 1 ? index + width : -1,
    ]) {
      if (next >= 0 && !sealed[next] && !region[next]) {
        region[next] = 1
        queue[tail++] = next
      }
    }
  }
  // A border-reaching region covering most of the canvas is the outside of
  // the plan, not a room interior.
  if (tail < options.minArea || (border && tail > width * height * 0.5)) return null
  const stride = width + 1
  const edges = boundaryEdges(
    queue,
    tail,
    (index) => region[index] === 1,
    width,
    height,
    stride,
  )
  const loops = walkBoundaryLoops(edges, stride, 4 * tail + 4)
  const outer = loops
    .filter((p) => signedContourArea(p) > 0)
    .sort((a, b) => signedContourArea(b) - signedContourArea(a))[0]
  if (!outer) return null
  return { points: outer, holes: loops.filter((p) => signedContourArea(p) < 0) }
}

export function contourSvgPath(contour: Pick<VectorContour, 'points' | 'holes' | 'stroke'>) {
  return [contour.points, ...contour.holes]
    .map(
      (ps) =>
        `M${ps.map((p) => `${Number(p[0].toFixed(3))},${Number(p[1].toFixed(3))}`).join('L')}${contour.stroke ? '' : 'Z'}`,
    )
    .join('')
}

export function contoursSvg(
  contours: VectorContour[],
  width: number,
  height: number,
  mode?: TraceOptions['mode'],
) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${contours
    .map((c, i) => {
      if (c.stroke)
        return `<path id="contour-${i}" fill="none" stroke="#171717" stroke-width="${c.strokeWidth ?? 1}" d="${contourSvgPath(c)}"/>`
      // Ink contours enclose the drawn linework itself, so filling them dark
      // reproduces the plan. Room contours are areas: filling them dark turned
      // the whole guide near-black — render them as light floorplan fills.
      return mode === 'ink'
        ? `<path id="contour-${i}" fill="#171717" fill-rule="evenodd" d="${contourSvgPath(c)}"/>`
        : `<path id="contour-${i}" fill="#E4E4E7" stroke="#52525B" stroke-width="0.4" fill-rule="evenodd" d="${contourSvgPath(c)}"/>`
    })
    .join('')}</svg>`
}
