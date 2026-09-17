import type { AnyNode, AnyNodeId, GuideNode } from '../schema'
import { areSemanticValuesEqual as equal } from '../utils/semantic-equal'
import type { ReferencePoint } from './reference-transform'

type Nodes = Record<string, AnyNode>
type Frame = { scale: number; rotation: number; position: ReferencePoint }
type Outline = Record<string, unknown> & { guideId: string; linked?: boolean }

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function outline(node: AnyNode): Outline | undefined {
  const value = record(node.metadata.referenceOutline)
  return typeof value?.guideId === 'string' ? (value as Outline) : undefined
}

function reference(node: GuideNode) {
  return record(node.metadata.planReference) ?? {}
}

function anchorId(node: GuideNode): string | undefined {
  const ref = reference(node)
  const id = record(ref.alignment)?.anchorGuideId ?? ref.anchorGuideId
  return typeof id === 'string' ? id : undefined
}

function buildingId(node: GuideNode, nodes: Nodes): string | undefined {
  const level = nodes[node.parentId ?? '']
  const building = level?.type === 'level' ? nodes[level.parentId ?? ''] : undefined
  return building?.type === 'building' ? building.id : undefined
}

function frame(guide: GuideNode): Frame {
  const value = {
    scale: guide.scale,
    rotation: guide.rotation[1],
    position: [guide.position[0], guide.position[2]] as ReferencePoint,
  }
  if (
    !(value.scale > 0) ||
    ![value.scale, value.rotation, ...value.position].every(Number.isFinite)
  )
    throw Error('Linked references require a finite, positive scale and position.')
  return value
}

function transformPoint(point: ReferencePoint, from: Frame, to: Frame): ReferencePoint {
  const angle = to.rotation - from.rotation
  const ratio = to.scale / from.scale
  const x = (point[0] - from.position[0]) * ratio
  const z = (point[1] - from.position[1]) * ratio
  return [
    to.position[0] + x * Math.cos(angle) + z * Math.sin(angle),
    to.position[1] - x * Math.sin(angle) + z * Math.cos(angle),
  ]
}

function transformGuide(guide: GuideNode, from: Frame, to: Frame): GuideNode {
  const position = transformPoint([guide.position[0], guide.position[2]], from, to)
  return {
    ...guide,
    scale: (guide.scale * to.scale) / from.scale,
    position: [position[0], guide.position[1], position[1]],
    rotation: [
      guide.rotation[0],
      guide.rotation[1] + to.rotation - from.rotation,
      guide.rotation[2],
    ],
  }
}

function guideMeasurement(previous: GuideNode, guide: GuideNode, sourceId: string): GuideNode {
  const from = frame(previous),
    to = frame(guide),
    ratio = to.scale / from.scale
  const oldRef = reference(previous),
    ref = reference(guide)
  const baseline = record(ref.baselineTransform)
  const dimension = record(ref.knownDimension)
  const oldScale = previous.scaleReference
  return {
    ...guide,
    scaleReference:
      equal(oldScale, guide.scaleReference) && oldScale
        ? {
            ...oldScale,
            start: transformPoint(oldScale.start, from, to),
            end: transformPoint(oldScale.end, from, to),
            realLengthMeters: oldScale.realLengthMeters * ratio,
            measuredLengthUnits: oldScale.measuredLengthUnits * ratio,
          }
        : guide.scaleReference,
    metadata: {
      ...guide.metadata,
      planReference: {
        ...ref,
        ...(typeof ref.width === 'number' && ref.width > 0
          ? { metersPerPixel: (guide.scale * 10) / ref.width }
          : {}),
        ...(dimension &&
        equal(dimension, oldRef.knownDimension) &&
        typeof dimension.meters === 'number'
          ? { knownDimension: { ...dimension, meters: dimension.meters * ratio } }
          : {}),
        ...(baseline &&
        equal(baseline, oldRef.baselineTransform) &&
        Array.isArray(baseline.position) &&
        typeof baseline.metersPerPixel === 'number' &&
        typeof baseline.rotation === 'number'
          ? {
              baselineTransform: {
                ...baseline,
                metersPerPixel: baseline.metersPerPixel * ratio,
                rotation: baseline.rotation + to.rotation - from.rotation,
                position: transformPoint(baseline.position as ReferencePoint, from, to),
              },
            }
          : {}),
        calibrationSourceGuideId: sourceId,
      },
    },
  }
}

const GEOMETRY_FIELDS: Record<string, readonly string[]> = {
  wall: [
    'parentId',
    'start',
    'end',
    'curveOffset',
    'thickness',
    'height',
    'supportOffset',
    'supportSlabId',
  ],
  slab: ['parentId', 'polygon', 'holes', 'thickness', 'elevation', 'slope'],
  zone: ['parentId', 'polygon'],
  fence: [
    'parentId',
    'start',
    'end',
    'path',
    'tangents',
    'curveOffset',
    'thickness',
    'height',
    'supportOffset',
    'supportSlabId',
  ],
  unit: ['parentId', 'members'],
}

function geometryChanged(before: AnyNode, after: AnyNode): boolean {
  const a = before as unknown as Record<string, unknown>,
    b = after as unknown as Record<string, unknown>
  return (
    before.type !== after.type ||
    (GEOMETRY_FIELDS[before.type] ?? []).some((key) => !equal(a[key], b[key]))
  )
}

function detach(node: AnyNode, source: Outline, reason: string): AnyNode {
  return {
    ...node,
    metadata: {
      ...node.metadata,
      referenceOutline: { ...source, linked: false, detachedReason: reason },
    },
  }
}

function transformElement(node: AnyNode, from: Frame, to: Frame): AnyNode {
  const point = (p: ReferencePoint) => transformPoint(p, from, to)
  const ratio = to.scale / from.scale
  if (node.type === 'wall' || node.type === 'fence') {
    const result = {
      ...node,
      start: point(node.start),
      end: point(node.end),
      ...(node.curveOffset !== undefined ? { curveOffset: node.curveOffset * ratio } : {}),
    }
    if (result.type === 'fence') {
      if (result.path) result.path = result.path.map(point)
      if (result.tangents) {
        const origin = point([0, 0])
        result.tangents = result.tangents.map((p) => {
          if (!p) return null
          const value = point(p)
          return [value[0] - origin[0], value[1] - origin[1]]
        })
      }
    }
    return result
  }
  if (node.type === 'slab')
    return {
      ...node,
      polygon: node.polygon.map(point),
      holes: node.holes?.map((hole) => hole.map(point)),
    }
  if (node.type === 'zone') return { ...node, polygon: node.polygon.map(point) }
  return node
}

/** Resolve source dependencies before the originating scene edit enters history or sync. */
export function reconcileReferenceLinks(
  before: Nodes,
  next: Nodes,
  changedIds: Iterable<string>,
): AnyNode[] {
  const edited = [...new Set(changedIds)]
  if (
    !edited.some(
      (id) =>
        before[id]?.type === 'guide' ||
        next[id]?.type === 'guide' ||
        (before[id] && outline(before[id]!)),
    )
  )
    return []
  const updates = new Map<AnyNodeId, AnyNode>()
  const guides = Object.values(before).filter(
    (node): node is GuideNode => node.type === 'guide' && next[node.id]?.type === 'guide',
  )
  const neighbors = new Map<string, Set<string>>()
  const children = new Map<string, Set<string>>()
  for (const guide of guides) {
    const anchor = before[anchorId(guide) ?? '']
    if (anchor?.type !== 'guide' || !next[anchor.id] || anchor.id === guide.id) continue
    const building = buildingId(next[guide.id] as GuideNode, next)
    if (!building || buildingId(next[anchor.id] as GuideNode, next) !== building) continue
    for (const [a, b] of [
      [guide.id, anchor.id],
      [anchor.id, guide.id],
    ] as const) {
      const links = neighbors.get(a) ?? new Set<string>()
      links.add(b)
      neighbors.set(a, links)
    }
    const linked = children.get(anchor.id) ?? new Set<string>()
    linked.add(guide.id)
    children.set(anchor.id, linked)
  }
  const moved = new Map<string, { from: Frame; to: Frame; sourceId: string }>()
  for (const id of edited) {
    const previous = before[id],
      current = next[id]
    if (
      previous?.type !== 'guide' ||
      current?.type !== 'guide' ||
      previous.parentId !== current.parentId
    )
      continue
    if (
      previous.scale === current.scale &&
      previous.rotation[1] === current.rotation[1] &&
      previous.position[0] === current.position[0] &&
      previous.position[2] === current.position[2]
    )
      continue
    const from = frame(previous),
      to = frame(current)
    if (equal(from, to)) continue
    // A new match moves its target subtree; its chosen anchor must remain fixed.
    const rematching =
      !equal(reference(previous).alignment, reference(current).alignment) ||
      anchorId(previous) !== anchorId(current)
    const graph = rematching ? children : neighbors
    const pending = [id],
      visited = new Set<string>()
    for (const linkedId of pending) {
      if (visited.has(linkedId) || (rematching && linkedId === anchorId(current))) continue
      visited.add(linkedId)
      const linked = before[linkedId]
      if (linked?.type !== 'guide' || next[linkedId]?.type !== 'guide') continue
      const desired = linkedId === id ? current : transformGuide(linked, from, to)
      const existing = moved.get(linkedId)
      if (existing) {
        const proposed = frame(desired)
        if (
          Math.abs(existing.to.scale - proposed.scale) > 1e-8 ||
          Math.abs(existing.to.rotation - proposed.rotation) > 1e-8 ||
          Math.hypot(
            existing.to.position[0] - proposed.position[0],
            existing.to.position[1] - proposed.position[1],
          ) > 1e-8
        )
          throw Error(
            'Matched plans received conflicting transformations. Adjust one plan at a time.',
          )
      } else {
        const resolved = guideMeasurement(
          linked,
          {
            ...(next[linkedId] as GuideNode),
            scale: desired.scale,
            position: desired.position,
            rotation: desired.rotation,
          },
          id,
        )
        frame(resolved)
        updates.set(resolved.id, resolved)
        moved.set(linkedId, { from: frame(linked), to: frame(resolved), sourceId: id })
      }
      pending.push(...(graph.get(linkedId) ?? []))
    }
  }
  for (const [id, node] of updates) {
    if (node.type !== 'guide') continue
    const anchor = updates.get(anchorId(node) as AnyNodeId) ?? next[anchorId(node) ?? '']
    const ref = reference(node),
      alignment = record(ref.alignment)
    if (anchor?.type === 'guide' && alignment) {
      const anchorRef = reference(anchor)
      if (typeof anchorRef.width !== 'number' || !(anchorRef.width > 0)) continue
      updates.set(id, {
        ...node,
        metadata: {
          ...node.metadata,
          planReference: {
            ...ref,
            alignment: {
              ...alignment,
              anchorTransform: {
                metersPerPixel: (anchor.scale * 10) / Number(anchorRef.width),
                position: [anchor.position[0], anchor.position[2]],
                rotation: anchor.rotation[1],
              },
            },
          },
        },
      })
    }
  }
  for (const node of Object.values(next)) {
    const source = outline(node),
      previous = before[node.id]
    if (!source || source.linked === false || !previous) continue
    const guide = next[source.guideId]
    if (guide?.type !== 'guide' || (node.type !== 'unit' && guide.parentId !== node.parentId)) {
      updates.set(node.id, detach(node, source, 'source-unavailable'))
      continue
    }
    if (geometryChanged(previous, node)) {
      updates.set(node.id, detach(node, source, 'geometry-edited'))
      continue
    }
    const change = moved.get(source.guideId)
    if (!change) continue
    const transformed = transformElement(node, change.from, change.to)
    if (transformed === node) continue
    updates.set(node.id, transformed)
    if (node.type === 'wall') {
      for (const childId of node.children) {
        const child = next[childId]
        if (child?.type !== 'door' && child?.type !== 'window' && child?.type !== 'item') continue
        if (child.parentId !== node.id || !equal(before[childId], child)) continue
        updates.set(child.id, {
          ...child,
          position: [
            (child.position[0] * change.to.scale) / change.from.scale,
            child.position[1],
            child.position[2],
          ],
        })
      }
    }
  }
  return [...updates.values()]
}
