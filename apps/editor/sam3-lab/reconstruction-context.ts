import { BlockNode, createBoxBlockTopology, ZoneNode, type AnyNode } from '@pascal-app/core'
import type { ComparisonCandidate, ComparisonVariant, NativePreviewOptions } from './comparison-types'
import type { SourceLabel } from './source-labels'
import type { PlanPoint } from '../../../packages/editor/src/lib/floorplan-import/schema'

function inside(x: number, y: number, polygon: PlanPoint[]): boolean {
  let result = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) result = !result
  }
  return result
}
function area(polygon: PlanPoint[]) {
  return Math.abs(polygon.reduce((sum, a, i) => { const b = polygon[(i + 1) % polygon.length]!; return sum + a[0] * b[1] - b[0] * a[1] }, 0)) / 2
}
function simplify(points: PlanPoint[], tolerance: number): PlanPoint[] {
  if (points.length <= 3) return points
  const a = points[0]!, b = points[points.length - 1]!
  let maximum = tolerance, at = -1
  const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!, t = length2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0
    const distance = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
    if (distance > maximum) { maximum = distance; at = i }
  }
  return at < 0 ? [a, b] : [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)]
}
function hull(points: PlanPoint[]): PlanPoint[] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const turn = (a: PlanPoint, b: PlanPoint, c: PlanPoint) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const half = (list: PlanPoint[]) => { const result: PlanPoint[] = []; for (const point of list) { while (result.length >= 2 && turn(result[result.length - 2]!, result[result.length - 1]!, point) <= 0) result.pop(); result.push(point) }; return result }
  return [...half(sorted).slice(0, -1), ...half(sorted.reverse()).slice(0, -1)]
}
function roomName(text: string): string | null {
  const clean = text.replace(/[:;]+$/g, '').trim()
  if (!/\b(bed\s*room|kitchen|dining|living|bath|toilet|porch|office|garage|hall|balcony|laundry|storage|wc)\b|\bT\s*[&+]\s*B\b/i.test(clean)) return null
  return clean.replace(/\b\w+/g, word => word[0]!.toUpperCase() + word.slice(1).toLowerCase())
}

/** Raster enclosure tolerates sub-pixel joins. Multi-source regions partition open-plan labels without inventing dividing walls. */
export function addReconstructionContext(nodes: Record<string, AnyNode>, levelId: string,
  variant: ComparisonVariant, source: { width: number; height: number; rgba: Uint8Array; labels?: SourceLabel[] }, options: NativePreviewOptions) {
  const level = nodes[levelId]
  if (!level || level.type !== 'level') throw new Error('Reconstruction context requires its isolated native level')
  const walls = Object.values(nodes).filter(n => n.type === 'wall')
  if (!walls.length) return { zones: [], props: [] }
  const scale = Math.min(1, 900 / Math.max(source.width, source.height)), mpp = options.metersPerPixel
  const width = Math.ceil(source.width * scale), height = Math.ceil(source.height * scale), size = width * height
  const footprint = hull(variant.candidates.filter(c => c.decision?.correctedClass !== 'background').flatMap(c => c.outer))
  const owner = new Int32Array(size).fill(-1), wallOwner = new Int32Array(size).fill(-1)
  const queue = new Int32Array(size)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (!inside((x + .5) / scale, (y + .5) / scale, footprint)) owner[y * width + x] = -2
  walls.forEach((wall, index) => {
    const a = wall.start.map(v => v / mpp * scale), b = wall.end.map(v => v / mpp * scale)
    const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, length2 = dx * dx + dy * dy
    const radius = Math.max(1, (wall.thickness ?? .1) / mpp * scale / 2)
    for (let y = Math.max(0, Math.floor(Math.min(a[1]!, b[1]!) - radius)); y <= Math.min(height - 1, Math.ceil(Math.max(a[1]!, b[1]!) + radius)); y++)
      for (let x = Math.max(0, Math.floor(Math.min(a[0]!, b[0]!) - radius)); x <= Math.min(width - 1, Math.ceil(Math.max(a[0]!, b[0]!) + radius)); x++) {
        const t = Math.max(0, Math.min(1, ((x + .5 - a[0]!) * dx + (y + .5 - a[1]!) * dy) / length2))
        if (Math.hypot(x + .5 - a[0]! - t * dx, y + .5 - a[1]! - t * dy) <= radius) { owner[y * width + x] = -2; wallOwner[y * width + x] = index }
      }
  })
  const names: { name: string; label?: SourceLabel; inferred: boolean }[] = []
  let front = 0, back = 0
  for (const label of source.labels ?? []) {
    const name = roomName(label.text)
    if (!name || label.confidence < .4) continue
    const cx = Math.floor((label.box[0] + label.box[2]) / 2 * scale), cy = Math.floor((label.box[1] + label.box[3]) / 2 * scale)
    let seed = -1
    for (let radius = 0; radius <= 10 && seed < 0; radius++) for (let dy = -radius; dy <= radius && seed < 0; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx, y = cy + dy
      if (x >= 0 && x < width && y >= 0 && y < height && owner[y * width + x] === -1) { seed = y * width + x; break }
    }
    if (seed < 0) continue
    owner[seed] = names.length
    names.push({ name, label, inferred: false })
    queue[back++] = seed
  }
  const flood = () => {
    while (front < back) {
      const index = queue[front++]!, x = index % width, y = Math.floor(index / width)
      for (const next of [x ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (next >= 0 && owner[next] === -1) { owner[next] = owner[index]!; queue[back++] = next }
      }
    }
  }
  flood()
  // Unlabelled bounded components are still rooms, not erased because OCR missed a name.
  for (let index = 0; index < size; index++) if (owner[index] === -1) {
    const id = names.length
    names.push({ name: `Zone ${id + 1}`, inferred: true })
    owner[index] = id; front = 0; back = 1; queue[0] = index; flood()
  }
  const boundaries = names.map(() => new Map<number, number>()), counts = new Uint32Array(names.length)
  const adjacentWalls = names.map(() => new Set<number>()), open = new Set<number>()
  const cornerWidth = width + 1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x, id = owner[index]!
    if (id < 0) continue
    counts[id] = counts[id]! + 1
    const corner = y * cornerWidth + x
    const neighbors = [y ? index - width : -1, x < width - 1 ? index + 1 : -1, y < height - 1 ? index + width : -1, x ? index - 1 : -1]
    const edges = [[corner, corner + 1], [corner + 1, corner + cornerWidth + 1], [corner + cornerWidth + 1, corner + cornerWidth], [corner + cornerWidth, corner]]
    neighbors.forEach((neighbor, side) => {
      if (neighbor >= 0 && owner[neighbor] === id) return
      boundaries[id]!.set(edges[side]![0]!, edges[side]![1]!)
      if (neighbor >= 0 && wallOwner[neighbor]! >= 0) adjacentWalls[id]!.add(wallOwner[neighbor]!)
      else open.add(id)
    })
  }
  const zoneByRegion = new Map<number, ZoneNode>()
  const zones: ZoneNode[] = []
  for (let id = 0; id < names.length; id++) {
    if (counts[id]! * (mpp / scale) ** 2 < .5 || (names[id]!.inferred && open.has(id))) continue
    let polygon: PlanPoint[] = []
    const edges = boundaries[id]!
    while (edges.size) {
      const start = edges.keys().next().value!, ring: PlanPoint[] = []
      let point: number | undefined = start
      while (point !== undefined && edges.has(point)) {
        ring.push([(point % cornerWidth) / scale * mpp, Math.floor(point / cornerWidth) / scale * mpp])
        const next: number | undefined = edges.get(point); edges.delete(point); point = next
        if (point === start) break
      }
      if (ring.length > 2 && area(ring) > area(polygon)) polygon = ring
    }
    if (polygon.length < 3) continue
    polygon = simplify([...polygon, polygon[0]!], Math.max(.02, mpp * 1.5)).slice(0, -1)
    if (polygon.length < 3) continue
    const evidence = names[id]!
    const zone = ZoneNode.parse({ name: evidence.name, parentId: levelId, polygon,
      autoFromWalls: false, boundaryWallIds: [...adjacentWalls[id]!].map(i => walls[i]!.id),
      spaceRole: 'room', enclosureStatus: open.has(id) ? 'open' : 'enclosed', ceilingHeight: options.wallHeight,
      color: ['#b7d6c1', '#c4d6e8', '#e5d3b0', '#d4c6df'][id % 4],
      metadata: { nativeMaskPreview: { role: 'zone', derivation: 'wall-bounded-source-label-region', approximation: true,
        nameSource: evidence.label ? 'offline-source-ocr' : 'unlabelled-enclosure', sourceLabel: evidence.label ?? null,
        boundaryPolicy: open.has(id) ? 'approximate-open-plan-division' : 'reconstructed-wall-enclosure' } },
    })
    nodes[zone.id] = zone; level.children.push(zone.id); zones.push(zone); zoneByRegion.set(id, zone)
  }

  // Interior source-ink components provide prop footprints. Semantic review supplies only the object class.
  const labels = new Int32Array(source.width * source.height).fill(-1), componentQueue = new Int32Array(labels.length)
  const components: { minX: number; minY: number; maxX: number; maxY: number; count: number }[] = []
  const textBoxes = source.labels ?? []
  const pixelRegion = (x: number, y: number) => owner[Math.min(height - 1, Math.floor(y * scale)) * width + Math.min(width - 1, Math.floor(x * scale))] ?? -2
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const index = y * source.width + x, offset = index * 4
    const alpha = source.rgba[offset + 3]! / 255
    const luminance = (.2126 * source.rgba[offset]! + .7152 * source.rgba[offset + 1]! + .0722 * source.rgba[offset + 2]!) * alpha + 255 * (1 - alpha)
    if (luminance > 190 || !zoneByRegion.has(pixelRegion(x, y)) || textBoxes.some(t => x >= t.box[0] - 2 && x <= t.box[2] + 2 && y >= t.box[1] - 2 && y <= t.box[3] + 2)) labels[index] = -2
  }
  for (let start = 0; start < labels.length; start++) if (labels[start] === -1) {
    const id = components.length, component = { minX: source.width, minY: source.height, maxX: 0, maxY: 0, count: 0 }
    front = 0; back = 1; componentQueue[0] = start; labels[start] = id
    while (front < back) {
      const index = componentQueue[front++]!, x = index % source.width, y = Math.floor(index / source.width)
      component.minX = Math.min(component.minX, x); component.maxX = Math.max(component.maxX, x)
      component.minY = Math.min(component.minY, y); component.maxY = Math.max(component.maxY, y); component.count++
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * source.width + nx
        if (nx >= 0 && nx < source.width && ny >= 0 && ny < source.height && labels[next] === -1) { labels[next] = id; componentQueue[back++] = next }
      }
    }
    components.push(component)
  }
  const props: BlockNode[] = [], usedComponents = new Set<number>()
  for (const candidate of [...variant.candidates, ...(variant.rejectedCandidates ?? [])]) {
    const evidence = candidate.decision?.evidence ?? ''
    const match = /\b(coffee[- ]table|sofa|sink|bed|table|appliance|counter)\b/i.exec(evidence)
    if (!match) continue
    const hits = new Map<number, number>()
    const minX = Math.max(0, Math.floor(Math.min(...candidate.outer.map(p => p[0])))), maxX = Math.min(source.width - 1, Math.ceil(Math.max(...candidate.outer.map(p => p[0]))))
    const minY = Math.max(0, Math.floor(Math.min(...candidate.outer.map(p => p[1])))), maxY = Math.min(source.height - 1, Math.ceil(Math.max(...candidate.outer.map(p => p[1]))))
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const id = labels[y * source.width + x]!
      if (id >= 0 && inside(x + .5, y + .5, candidate.outer)) hits.set(id, (hits.get(id) ?? 0) + 1)
    }
    const best = [...hits].sort((a, b) => b[1] - a[1]).find(([id, hit]) => {
      const c = components[id]!, w = c.maxX - c.minX + 1, d = c.maxY - c.minY + 1
      return hit >= 3 && c.count >= 12 && w >= 8 && d >= 8 && Math.max(w, d) * mpp <= 4 && Math.max(w / d, d / w) < 8 && !usedComponents.has(id)
    })
    if (!best) continue
    const component = components[best[0]]!, cx = (component.minX + component.maxX) / 2, cy = (component.minY + component.maxY) / 2
    const zone = zoneByRegion.get(pixelRegion(cx, cy))
    if (!zone) continue
    usedComponents.add(best[0])
    const name = match[1]!.replace('-', ' ').replace(/^\w/, c => c.toUpperCase())
    const height = /bed|sofa/i.test(name) ? .65 : /coffee/i.test(name) ? .45 : .85
    const prop = BlockNode.parse({ name: `Approximate ${name}`, parentId: levelId,
      position: [cx * mpp, 0, cy * mpp], topology: createBoxBlockTopology((component.maxX - component.minX + 1) * mpp, height, (component.maxY - component.minY + 1) * mpp),
      metadata: { nativeMaskPreview: { role: 'prop', approximation: true, sourceIds: [candidate.id], zoneId: zone.id,
        label: name, derivation: 'review-class-and-source-ink-component', heightSource: 'assumed', evidence } },
    })
    nodes[prop.id] = prop; level.children.push(prop.id); props.push(prop)
  }
  // Unclassified outlined symbols can still supply useful furniture footprints.
  // Require all four rectangle borders; a door swing or a text fragment is not a prop.
  for (let id = 0; id < components.length; id++) {
    if (usedComponents.has(id) || props.length >= 32) continue
    const component = components[id]!, w = component.maxX - component.minX + 1, d = component.maxY - component.minY + 1
    const ratio = component.count / (w * d)
    if (w * mpp < .4 || d * mpp < .4 || w * d * mpp * mpp < .3 ||
      Math.max(w, d) * mpp > 3 || ratio > .4 || ratio < .025) continue
    const coverage = (vertical: boolean, fixed: number, from: number, to: number) => {
      let hits = 0
      for (let at = from; at <= to; at++) {
        let hit = false
        for (let shift = -1; shift <= 1; shift++) {
          const x = vertical ? fixed + shift : at, y = vertical ? at : fixed + shift
          if (x >= 0 && y >= 0 && x < source.width && y < source.height && labels[y * source.width + x] === id) hit = true
        }
        if (hit) hits++
      }
      return hits / (to - from + 1)
    }
    if (Math.min(coverage(true, component.minX, component.minY, component.maxY),
      coverage(true, component.maxX, component.minY, component.maxY),
      coverage(false, component.minY, component.minX, component.maxX),
      coverage(false, component.maxY, component.minX, component.maxX)) < .55) continue
    const cx = (component.minX + component.maxX) / 2, cy = (component.minY + component.maxY) / 2
    const zone = zoneByRegion.get(pixelRegion(cx, cy))
    if (!zone) continue
    const prop = BlockNode.parse({ name: `Furniture footprint · ${zone.name}`, parentId: levelId,
      position: [cx * mpp, 0, cy * mpp], topology: createBoxBlockTopology(w * mpp, .65, d * mpp),
      metadata: { nativeMaskPreview: { role: 'prop', approximation: true, sourceIds: [`ink-component:${id}`], zoneId: zone.id,
        derivation: 'source-enclosed-rectangular-symbol', classification: 'unclassified-furniture', heightSource: 'assumed' } },
    })
    nodes[prop.id] = prop; level.children.push(prop.id); props.push(prop)
  }
  return { zones, props }
}
