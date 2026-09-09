import { FLOORPLAN_MAX_IMAGE_SIDE, type FloorplanFeatures, type PlanPoint } from './schema'

type Segment = { start: PlanPoint; end: PlanPoint; width: number; axis: boolean }
type Region = {
  polygon: PlanPoint[]
  center: PlanPoint
  width: number
  depth: number
  angle: number
  area: number
  space: boolean
}
const MAX_LINES = 160
const MAX_REGIONS = 80
const MAX_POINTS = 1800

function cross(a: PlanPoint, b: PlanPoint, c: PlanPoint) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function simplify(points: PlanPoint[], tolerance: number): PlanPoint[] {
  if (points.length < 4) return points
  const retained = new Uint8Array(points.length)
  retained[0] = 1
  retained[points.length - 1] = 1
  const stack: number[] = [0, points.length - 1]
  while (stack.length) {
    const end = stack.pop()!
    const start = stack.pop()!
    const a = points[start]!
    const b = points[end]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const lengthSquared = dx * dx + dy * dy
    let largest = tolerance * tolerance
    let selected = -1
    for (let i = start + 1; i < end; i++) {
      const p = points[i]!
      const t = lengthSquared
        ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared))
        : 0
      const distance = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2
      if (distance > largest) {
        largest = distance
        selected = i
      }
    }
    if (selected >= 0) {
      retained[selected] = 1
      stack.push(start, selected, selected, end)
    }
  }
  return points.filter((_, index) => retained[index])
}

function thresholdImage(rgba: Uint8Array | Uint8ClampedArray, pixels: number) {
  const gray = new Uint8Array(pixels)
  const histogram = new Uint32Array(256)
  let sum = 0
  for (let p = 0; p < pixels; p++) {
    const i = p * 4
    const alpha = rgba[i + 3]! / 255
    const luminance = Math.round(
      (0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!) * alpha +
        255 * (1 - alpha),
    )
    gray[p] = luminance
    histogram[luminance] = histogram[luminance]! + 1
    sum += luminance
  }
  let count = 0
  let partial = 0
  let best = -1
  let threshold = 127
  for (let value = 0; value < 255; value++) {
    count += histogram[value]!
    partial += histogram[value]! * value
    if (!count || count === pixels) continue
    const difference = partial / count - (sum - partial) / (pixels - count)
    const variance = count * (pixels - count) * difference * difference
    if (variance > best) {
      best = variance
      threshold = value
    }
  }
  if (best < 0) {
    gray.fill(0)
    return gray
  }
  threshold = Math.min(220, Math.max(40, threshold))
  let dark = 0
  for (let p = 0; p < pixels; p++) {
    gray[p] = gray[p]! <= threshold ? 1 : 0
    dark += gray[p]!
  }
  // Ink can be light on a dark drawing, but a blank image is not a shape.
  if (dark > pixels * 0.65 && dark < pixels * 0.995) {
    for (let p = 0; p < pixels; p++) gray[p] = 1 - gray[p]!
  }
  return gray
}

function inkAt(mask: Uint8Array, width: number, height: number, x: number, y: number): number {
  const px = Math.round(x)
  const py = Math.round(y)
  return px >= 0 && px < width && py >= 0 && py < height ? mask[py * width + px]! : 0
}

function faceStrokeWidth(
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  nx: number,
  ny: number,
  limit: number,
): number {
  // Hough faces can sit one pixel off the raster stroke.
  let seed = 0
  if (!inkAt(mask, width, height, x, y)) {
    if (inkAt(mask, width, height, x + nx, y + ny)) seed = 1
    else if (inkAt(mask, width, height, x - nx, y - ny)) seed = -1
    else return 0
  }
  let count = 1
  for (let direction = -1; direction <= 1; direction += 2) {
    for (let step = 1; step <= limit; step++) {
      const offset = seed + direction * step
      if (!inkAt(mask, width, height, x + nx * offset, y + ny * offset)) break
      count++
    }
  }
  return count
}

function hasBandSupport(
  mask: Uint8Array,
  width: number,
  height: number,
  a: Segment,
  tx: number,
  ty: number,
  from: number,
  to: number,
  separationFrom: number,
  separationTo: number,
): boolean {
  const samples = Math.min(48, Math.max(8, Math.ceil((to - from) / 8)))
  let supported = 0
  for (let sample = 0; sample < samples; sample++) {
    const fraction = (sample + 0.5) / samples
    const along = from + (to - from) * fraction
    const separation = separationFrom + (separationTo - separationFrom) * fraction
    const x = a.start[0] + tx * along
    const y = a.start[1] + ty * along
    let interiorInk = 0
    for (let across = 1; across <= 5; across++) {
      const offset = separation * (across / 6)
      interiorInk += inkAt(mask, width, height, x - ty * offset, y + tx * offset)
    }
    if (interiorInk >= 4) {
      supported++
      continue
    }
    if (interiorInk > 2) continue
    // Preserve hollow/windowed bands with thin faces, not a hairline beside solid ink.
    const maxStroke = Math.max(2, Math.abs(separation) * 0.2)
    const limit = Math.ceil(maxStroke)
    const first = faceStrokeWidth(mask, width, height, x, y, -ty, tx, limit)
    const second = faceStrokeWidth(
      mask,
      width,
      height,
      x - ty * separation,
      y + tx * separation,
      -ty,
      tx,
      limit,
    )
    if (
      first > 0 &&
      second > 0 &&
      Math.max(first, second) <= maxStroke &&
      Math.max(first, second) <= Math.min(first, second) * 2
    )
      supported++
  }
  return supported >= samples * 0.75
}

function findSegments(mask: Uint8Array, width: number, height: number): Segment[] {
  const edgePoints: PlanPoint[] = []
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x
      if (mask[p] && (!mask[p - 1] || !mask[p + 1] || !mask[p - width] || !mask[p + width]))
        edgePoints.push([x, y])
    }
  }
  if (!edgePoints.length) return []
  const stride = Math.max(1, Math.ceil(edgePoints.length / 40000))
  const diagonal = Math.ceil(Math.hypot(width, height))
  const bins = diagonal * 2 + 1
  const angles = 180
  const votes = new Uint32Array(angles * bins)
  const sine = new Float64Array(angles)
  const cosine = new Float64Array(angles)
  for (let angle = 0; angle < angles; angle++) {
    sine[angle] = Math.sin((angle * Math.PI) / angles)
    cosine[angle] = Math.cos((angle * Math.PI) / angles)
    const offset = angle * bins
    for (let i = 0; i < edgePoints.length; i += stride) {
      const point = edgePoints[i]!
      const rho = Math.round(point[0] * cosine[angle]! + point[1] * sine[angle]!) + diagonal
      votes[offset + rho] = votes[offset + rho]! + 1
    }
  }
  const minimumLength = Math.max(10, Math.min(width, height) * 0.012)
  const peaks: { angle: number; rho: number; score: number }[] = []
  const minimumVotes = Math.max(7, minimumLength / stride)
  for (let angle = 0; angle < angles; angle++) {
    for (let rho = 1; rho < bins - 1; rho++) {
      const score = votes[angle * bins + rho]!
      if (
        score < minimumVotes ||
        score < votes[angle * bins + rho - 1]! ||
        score <= votes[angle * bins + rho + 1]!
      )
        continue
      peaks.push({ angle, rho: rho - diagonal, score })
    }
  }
  peaks.sort((a, b) => b.score - a.score || a.angle - b.angle || a.rho - b.rho)
  const selected: typeof peaks = []
  for (const peak of peaks) {
    if (
      selected.some(
        (other) => Math.abs(other.angle - peak.angle) <= 1 && Math.abs(other.rho - peak.rho) <= 2,
      )
    )
      continue
    selected.push(peak)
    if (selected.length === 220) break
  }
  const segments: Segment[] = []
  const support = new Uint8Array(diagonal * 2 + 1)
  for (const peak of selected) {
    support.fill(0)
    const nx = cosine[peak.angle]!
    const ny = sine[peak.angle]!
    const tx = -ny
    const ty = nx
    let lower = support.length
    let upper = 0
    for (const point of edgePoints) {
      if (Math.abs(point[0] * nx + point[1] * ny - peak.rho) > 1.1) continue
      const t = Math.round(point[0] * tx + point[1] * ty) + diagonal
      support[t] = 1
      lower = Math.min(lower, t)
      upper = Math.max(upper, t)
    }
    let start = -1
    let last = -1
    const finish = () => {
      if (start < 0 || last - start < minimumLength) return
      const a = start - diagonal
      const b = last - diagonal
      const segment: Segment = {
        start: [nx * peak.rho + tx * a, ny * peak.rho + ty * a],
        end: [nx * peak.rho + tx * b, ny * peak.rho + ty * b],
        width: 1,
        axis: false,
      }
      if (
        segments.some(
          (other) =>
            Math.hypot(other.start[0] - segment.start[0], other.start[1] - segment.start[1]) < 4 &&
            Math.hypot(other.end[0] - segment.end[0], other.end[1] - segment.end[1]) < 4,
        )
      )
        return
      segments.push(segment)
    }
    for (let t = lower; t <= upper + 4; t++) {
      if (support[t]) {
        if (start < 0) start = t
        last = t
      } else if (start >= 0 && t - last > 3) {
        finish()
        start = -1
      }
    }
  }
  segments.sort(
    (a, b) =>
      Math.hypot(b.end[0] - b.start[0], b.end[1] - b.start[1]) -
      Math.hypot(a.end[0] - a.start[0], a.end[1] - a.start[1]),
  )
  const edges = segments.slice(0, MAX_LINES)
  const axes: Segment[] = []
  // Only raster-supported bands become thickness candidates; semantics remain the model's job.
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i]!
    const length = Math.hypot(a.end[0] - a.start[0], a.end[1] - a.start[1])
    const tx = (a.end[0] - a.start[0]) / length
    const ty = (a.end[1] - a.start[1]) / length
    for (let j = i + 1; j < edges.length; j++) {
      const b = edges[j]!
      const bLength = Math.hypot(b.end[0] - b.start[0], b.end[1] - b.start[1])
      if (Math.abs(tx * (b.end[1] - b.start[1]) - ty * (b.end[0] - b.start[0])) / bLength > 0.025)
        continue
      const separation = tx * (b.start[1] - a.start[1]) - ty * (b.start[0] - a.start[0])
      const bStart = tx * (b.start[0] - a.start[0]) + ty * (b.start[1] - a.start[1])
      const bEnd = tx * (b.end[0] - a.start[0]) + ty * (b.end[1] - a.start[1])
      const from = Math.max(0, Math.min(bStart, bEnd))
      const to = Math.min(length, Math.max(bStart, bEnd))
      if (to - from < Math.max(minimumLength, Math.min(length, bLength) * 0.6)) continue
      const slope = (tx * (b.end[1] - b.start[1]) - ty * (b.end[0] - b.start[0])) / (bEnd - bStart)
      const separationFrom = separation + (from - bStart) * slope
      const separationTo = separation + (to - bStart) * slope
      const distance = Math.abs((separationFrom + separationTo) / 2)
      if (
        distance < 2 ||
        distance > Math.min(length, bLength) * 0.25 ||
        separationFrom * separationTo <= 0 ||
        Math.abs(separationTo - separationFrom) > Math.max(2, distance * 0.2) ||
        !hasBandSupport(mask, width, height, a, tx, ty, from, to, separationFrom, separationTo)
      )
        continue
      axes.push({
        start: [
          a.start[0] + tx * from - (ty * separationFrom) / 2,
          a.start[1] + ty * from + (tx * separationFrom) / 2,
        ],
        end: [
          a.start[0] + tx * to - (ty * separationTo) / 2,
          a.start[1] + ty * to + (tx * separationTo) / 2,
        ],
        width: distance,
        axis: true,
      })
    }
  }
  axes.sort(
    (a, b) =>
      Math.hypot(b.end[0] - b.start[0], b.end[1] - b.start[1]) -
        Math.hypot(a.end[0] - a.start[0], a.end[1] - a.start[1]) || a.width - b.width,
  )
  return [...axes.slice(0, 80), ...edges.slice(0, 80)]
}

const NEIGHBORS: readonly PlanPoint[] = [
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
]

function traceBoundary(
  labels: Int32Array,
  label: number,
  first: number,
  width: number,
  height: number,
) {
  const firstX = first % width
  const firstY = Math.floor(first / width)
  let x = firstX
  let y = firstY
  let back = 0
  let secondX = -1
  let secondY = -1
  const points: PlanPoint[] = []
  for (let step = 0; step < (width + height) * 16; step++) {
    let found = -1
    for (let offset = 1; offset <= 8; offset++) {
      const direction = (back + offset) % 8
      const [dx, dy] = NEIGHBORS[direction]!
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && labels[ny * width + nx] === label) {
        found = direction
        break
      }
    }
    if (found < 0) break
    const [dx, dy] = NEIGHBORS[found]!
    const nx = x + dx
    const ny = y + dy
    if (step > 1 && x === firstX && y === firstY && nx === secondX && ny === secondY) break
    if (!step) {
      secondX = nx
      secondY = ny
    }
    points.push([x, y])
    const previous = NEIGHBORS[(found + 7) % 8]!
    const bx = x + previous[0] - nx
    const by = y + previous[1] - ny
    back = NEIGHBORS.findIndex((point) => point[0] === bx && point[1] === by)
    if (back < 0) back = (found + 4) % 8
    x = nx
    y = ny
  }
  if (points.length < 3) return []
  points.push(points[0]!)
  const reduced = simplify(points, 1.5)
  if (
    reduced.length > 1 &&
    reduced[0]![0] === reduced.at(-1)![0] &&
    reduced[0]![1] === reduced.at(-1)![1]
  )
    reduced.pop()
  return reduced.length <= 80 ? reduced : simplify([...reduced, reduced[0]!], 3).slice(0, -1)
}

function findRegions(mask: Uint8Array, width: number, height: number): Region[] {
  const labels = new Int32Array(mask.length)
  const queue = new Int32Array(mask.length)
  const components: {
    label: number
    first: number
    area: number
    space: boolean
    border: boolean
    minX: number
    maxX: number
    minY: number
    maxY: number
  }[] = []
  let label = 0
  for (let first = 0; first < mask.length; first++) {
    if (labels[first]) continue
    label++
    const value = mask[first]!
    let count = 1
    queue[0] = first
    labels[first] = label
    let minX = first % width
    let maxX = minX
    let minY = Math.floor(first / width)
    let maxY = minY
    let border = false
    for (let at = 0; at < count; at++) {
      const p = queue[at]!
      const x = p % width
      const y = Math.floor(p / width)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      if (!x || !y || x === width - 1 || y === height - 1) border = true
      if (x && !labels[p - 1] && mask[p - 1] === value) {
        labels[p - 1] = label
        queue[count++] = p - 1
      }
      if (x < width - 1 && !labels[p + 1] && mask[p + 1] === value) {
        labels[p + 1] = label
        queue[count++] = p + 1
      }
      if (y && !labels[p - width] && mask[p - width] === value) {
        labels[p - width] = label
        queue[count++] = p - width
      }
      if (y < height - 1 && !labels[p + width] && mask[p + width] === value) {
        labels[p + width] = label
        queue[count++] = p + width
      }
    }
    if (count >= 32 && maxX - minX >= 6 && maxY - minY >= 6 && !(border && !value))
      components.push({ label, first, area: count, space: !value, border, minX, maxX, minY, maxY })
  }
  components.sort((a, b) => b.area - a.area || a.first - b.first)
  const regions: Region[] = []
  for (const component of components.slice(0, MAX_REGIONS)) {
    const polygon = traceBoundary(labels, component.label, component.first, width, height)
    if (polygon.length < 3 || polygon.length > 80) continue
    let signedArea = 0
    for (let i = 0; i < polygon.length; i++)
      signedArea += cross([0, 0], polygon[i]!, polygon[(i + 1) % polygon.length]!)
    if (Math.abs(signedArea) < 20) continue
    // Fit the minimum-area rectangle to observed contour directions, not VLM coordinates.
    let bestArea = Number.POSITIVE_INFINITY
    let rectangle = {
      center: [
        (component.minX + component.maxX) / 2,
        (component.minY + component.maxY) / 2,
      ] as PlanPoint,
      width: component.maxX - component.minX,
      depth: component.maxY - component.minY,
      angle: 0,
    }
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!
      const b = polygon[(i + 1) % polygon.length]!
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
      const cosine = Math.cos(angle)
      const sine = Math.sin(angle)
      let minU = Number.POSITIVE_INFINITY
      let maxU = Number.NEGATIVE_INFINITY
      let minV = Number.POSITIVE_INFINITY
      let maxV = Number.NEGATIVE_INFINITY
      for (const point of polygon) {
        const u = cosine * point[0] + sine * point[1]
        const v = -sine * point[0] + cosine * point[1]
        minU = Math.min(minU, u)
        maxU = Math.max(maxU, u)
        minV = Math.min(minV, v)
        maxV = Math.max(maxV, v)
      }
      const area = (maxU - minU) * (maxV - minV)
      if (area < bestArea) {
        bestArea = area
        const u = (minU + maxU) / 2
        const v = (minV + maxV) / 2
        rectangle = {
          center: [cosine * u - sine * v, sine * u + cosine * v],
          width: maxU - minU,
          depth: maxV - minV,
          angle,
        }
      }
    }
    regions.push({ polygon, ...rectangle, area: component.area, space: component.space })
  }
  return regions
}

/** Classical candidate extraction. It does not label walls/rooms/props and is not SAM.
 * E = observed stroke, L = paired-face axis, R = ink component, S = bounded empty component.
 * Region angle is in image coordinates (+Y down), not Three.js yaw. */
export function extractFloorplanFeatures(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): FloorplanFeatures {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > FLOORPLAN_MAX_IMAGE_SIDE ||
    height > FLOORPLAN_MAX_IMAGE_SIDE ||
    rgba.length !== width * height * 4
  )
    throw new Error('Floorplan feature extraction requires a bounded decoded RGBA image.')
  const mask = thresholdImage(rgba, width * height)
  const segments = findSegments(mask, width, height)
  const regions = findRegions(mask, width, height)
  const features: FloorplanFeatures = { width, height, points: [], lines: [], regions: [] }
  const pointIds = new Map<string, string>()
  const addPoint = (point: PlanPoint) => {
    const x = Math.max(0, Math.min(width - 1, Math.round(point[0] * 2) / 2))
    const y = Math.max(0, Math.min(height - 1, Math.round(point[1] * 2) / 2))
    const key = `${x},${y}`
    const existing = pointIds.get(key)
    if (existing) return existing
    const id = `P${features.points.length + 1}`
    pointIds.set(key, id)
    features.points.push({ id, point: [x, y] })
    return id
  }
  segments.forEach((line, index) => {
    features.lines.push({
      id: `${line.axis ? 'L' : 'E'}${index + 1}`,
      startId: addPoint(line.start),
      endId: addPoint(line.end),
      width: Math.round(line.width * 100) / 100,
    })
  })
  // Intersections are references the model can select for connected wall corners.
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!
    const ax = a.end[0] - a.start[0]
    const ay = a.end[1] - a.start[1]
    for (let j = i + 1; j < segments.length; j++) {
      if (features.points.length >= MAX_POINTS - 400) break
      const b = segments[j]!
      const bx = b.end[0] - b.start[0]
      const by = b.end[1] - b.start[1]
      const denominator = ax * by - ay * bx
      if (Math.abs(denominator) < Math.hypot(ax, ay) * Math.hypot(bx, by) * 0.15) continue
      const dx = b.start[0] - a.start[0]
      const dy = b.start[1] - a.start[1]
      const t = (dx * by - dy * bx) / denominator
      const u = (dx * ay - dy * ax) / denominator
      const extensionA = 12 / Math.hypot(ax, ay)
      const extensionB = 12 / Math.hypot(bx, by)
      if (t < -extensionA || t > 1 + extensionA || u < -extensionB || u > 1 + extensionB) continue
      addPoint([a.start[0] + ax * t, a.start[1] + ay * t])
    }
  }
  for (let index = 0; index < regions.length; index++) {
    const region = regions[index]!
    if (features.points.length + region.polygon.length > MAX_POINTS) break
    features.regions.push({
      id: `${region.space ? 'S' : 'R'}${index + 1}`,
      pointIds: region.polygon.map(addPoint),
      center: region.center,
      width: region.width,
      depth: region.depth,
      angle: region.angle,
    })
  }
  return features
}

/** Neutral evidence overlay; labels are generated IDs, never source text or model HTML. */
export function renderFloorplanFeatureOverlay(features: FloorplanFeatures): string {
  const points = new Map(features.points.map((point) => [point.id, point.point]))
  const fragments = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${features.width}" height="${features.height}" viewBox="0 0 ${features.width} ${features.height}">`,
  ]
  const palette = ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00']
  const fontSize = Math.max(7, Math.min(features.width, features.height) / 90)
  for (let index = 0; index < features.regions.length; index++) {
    const region = features.regions[index]!
    const color = palette[index % palette.length]!
    const polygon = region.pointIds
      .map((id) => points.get(id))
      .filter((point): point is PlanPoint => !!point)
    fragments.push(
      `<polygon points="${polygon.map((point) => point.join(',')).join(' ')}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1"/>`,
    )
    fragments.push(
      `<text x="${region.center[0]}" y="${region.center[1]}" font-size="${fontSize + 2}" font-family="sans-serif" fill="${color}" stroke="white" stroke-width="2" paint-order="stroke">${region.id}</text>`,
    )
  }
  for (const line of features.lines) {
    const a = points.get(line.startId)
    const b = points.get(line.endId)
    if (!a || !b) continue
    fragments.push(
      `<path d="M${a.join(' ')} L${b.join(' ')}" fill="none" stroke="#0072b2" stroke-opacity="0.65" stroke-width="1"/>`,
    )
    fragments.push(
      `<text x="${(a[0] + b[0]) / 2}" y="${(a[1] + b[1]) / 2 - 2}" font-size="${fontSize}" font-family="sans-serif" fill="#0072b2" stroke="white" stroke-width="2" paint-order="stroke">${line.id}</text>`,
    )
  }
  // Point references are in the ledger; mark endpoints/contours without covering tiny symbols in text.
  for (const feature of features.points)
    fragments.push(
      `<circle cx="${feature.point[0]}" cy="${feature.point[1]}" r="1.3" fill="#d55e00"/>`,
    )
  fragments.push('</svg>')
  return fragments.join('')
}
