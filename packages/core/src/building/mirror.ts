import { resolveAutoZonePolygon } from '../lib/space-detection'
import { collectSubtree } from '../registry/subtree'
import { AnyNode, type AnyNodeId, type LevelNode, type ZoneNode } from '../schema'
import { generateId } from '../schema/base'
import { remapRepeatedReferences } from '../utils/repetition'
import { buildLevelDuplicateCreateOps } from './level-duplication'

export type MirrorOptions = { axis: 'x' | 'z'; coordinate: number; copy: boolean }
type Nodes = Record<AnyNodeId, AnyNode>
type Point = [number, number]
const referenceKinds = new Set(['guide', 'scan', 'spawn'])

function inside(point: Point, polygon: Point[]): boolean {
  let contained = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!,
      b = polygon[i]!
    const dx = b[0] - a[0],
      dz = b[1] - a[1]
    const t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz)
    if (t >= 0 && t <= 1 && Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz) < 0.025)
      return true
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      contained = !contained
  }
  return contained
}

export function mirrorSelection(nodes: Nodes, ids: readonly AnyNodeId[]): AnyNode[] {
  const selected = new Map<AnyNodeId, AnyNode>()
  const add = (id: AnyNodeId) => {
    const tree = collectSubtree(nodes, id)
    if (!tree) throw Error('The selected object no longer exists.')
    for (const node of [tree.root, ...tree.descendants]) {
      if (!referenceKinds.has(node.type)) selected.set(node.id, node)
    }
  }
  for (const id of ids) {
    add(id)
    const unit = nodes[id]
    if (unit?.type !== 'unit') continue
    const zones = unit.members
      .map((id) => nodes[id])
      .filter((n): n is ZoneNode => n?.type === 'zone')
    if (!zones.length || zones.length !== unit.members.length)
      throw Error('This unit needs valid room boundaries before mirroring.')
    for (const zone of zones) add(zone.id)
    for (const zone of zones) for (const wallId of zone.boundaryWallIds) add(wallId)
    for (const node of Object.values(nodes)) {
      const polygons = zones
        .filter((z) => z.parentId === node.parentId)
        .map((z) => resolveAutoZonePolygon(z, (id) => nodes[id]))
      if (!polygons.length) continue
      if (node.type === 'wall' || node.type === 'fence') {
        const points = node.type === 'fence' && node.path ? node.path : [node.start, node.end]
        if (
          points.every((p) => polygons.some((poly) => inside(p, poly))) &&
          points
            .slice(1)
            .every((p, i) =>
              polygons.some((poly) =>
                inside([(p[0] + points[i]![0]) / 2, (p[1] + points[i]![1]) / 2], poly),
              ),
            )
        )
          add(node.id)
      } else if (
        'polygon' in node &&
        node.type !== 'zone' &&
        Array.isArray(node.polygon) &&
        node.polygon.length &&
        node.polygon.every((p) => polygons.some((poly) => inside(p, poly)))
      )
        add(node.id)
      else if (
        'position' in node &&
        Array.isArray(node.position) &&
        polygons.some((poly) => inside([node.position[0], node.position[2]], poly))
      )
        add(node.id)
    }
  }
  for (const node of Object.values(nodes)) {
    if (
      selected.has(node.metadata.facadeBalconyWall as AnyNodeId) ||
      selected.has(node.metadata.facadeOwner as AnyNodeId)
    )
      add(node.id)
    if (node.type === 'unit' && node.members.length && node.members.every((id) => selected.has(id)))
      selected.set(node.id, node)
  }
  const balconyDecks = new Set<AnyNodeId>()
  for (const node of selected.values()) {
    const balcony = node.metadata.balcony as { id?: AnyNodeId } | undefined
    const deck = balcony?.id ? nodes[balcony.id] : undefined
    if (
      deck?.type === 'slab' &&
      deck.parentId === node.parentId &&
      (deck.metadata.balcony as { id?: AnyNodeId } | undefined)?.id === deck.id &&
      (node.id === deck.id || (node.type === 'fence' && node.supportSlabId === deck.id))
    )
      balconyDecks.add(deck.id)
  }
  for (const id of balconyDecks) add(id)
  for (const node of Object.values(nodes)) {
    if (
      node.type === 'fence' &&
      node.supportSlabId &&
      balconyDecks.has(node.supportSlabId as AnyNodeId) &&
      node.parentId === nodes[node.supportSlabId as AnyNodeId]?.parentId &&
      (node.metadata.balcony as { id?: string } | undefined)?.id === node.supportSlabId
    )
      add(node.id)
  }
  if (!selected.size) throw Error('Select building elements, a unit, or a floor to mirror.')
  if (selected.size > 10000) throw Error('Mirror up to 10,000 elements at a time.')
  return [...selected.values()]
}

export function mirrorPoint(
  [x, z]: Point,
  { axis, coordinate }: Pick<MirrorOptions, 'axis' | 'coordinate'>,
): Point {
  return axis === 'x' ? [2 * coordinate - x, z] : [x, 2 * coordinate - z]
}

export function mirrorFootprints(nodes: readonly AnyNode[]): Point[][] {
  return nodes.flatMap((node) => {
    if (node.type === 'wall' || node.type === 'fence')
      return [node.type === 'fence' && node.path ? node.path : [node.start, node.end]]
    if (node.type === 'slab' || node.type === 'ceiling')
      return [[...node.polygon, node.polygon[0]!], ...node.holes.map((p) => [...p, p[0]!])].filter(
        (p) => p[0],
      )
    if (node.type === 'zone')
      return node.polygon.length ? [[...node.polygon, node.polygon[0]!]] : []
    return []
  })
}

function mirrorNode(
  original: AnyNode,
  nodes: Nodes,
  included: Set<AnyNodeId>,
  options: MirrorOptions,
): AnyNode {
  const node = structuredClone(original)
  const point = (p: Point) => mirrorPoint(p, options)
  const opposite = (side: 'left' | 'right') =>
    side === 'left' ? ('right' as const) : ('left' as const)
  if (node.type === 'wall' || node.type === 'fence') {
    // Reverse the path as well as reflecting it: its interior and hosted local Z stay on the same side.
    const start = node.start
    node.start = point(node.end)
    node.end = point(start)
    if (node.type === 'fence') {
      if (node.path) node.path = node.path.map(point).reverse()
      if (node.tangents)
        node.tangents = node.tangents
          .map((p) =>
            p ? ((options.axis === 'x' ? [p[0], -p[1]] : [-p[0], p[1]]) as Point) : null,
          )
          .reverse()
    }
  } else if (node.type === 'zone' || node.type === 'slab' || node.type === 'ceiling') {
    node.polygon = (
      node.type === 'zone' ? resolveAutoZonePolygon(node, (id) => nodes[id]) : node.polygon
    )
      .map(point)
      .reverse()
    if ('holes' in node) node.holes = node.holes.map((ring) => ring.map(point).reverse())
    const balcony = node.metadata.balcony as
      | { options?: { openEdge?: number | null }; guardBoundaryIndices?: number[] }
      | undefined
    if (node.type === 'slab' && balcony) {
      // Reversing each ring changes edge indices used when railings are generated later.
      let offset = 0
      const reversedEdges = new Map<number, number>()
      for (const ring of [node.polygon, ...node.holes]) {
        for (let i = 0; i < ring.length; i++)
          reversedEdges.set(offset + i, offset + ((2 * ring.length - 2 - i) % ring.length))
        offset += ring.length
      }
      if (typeof balcony.options?.openEdge === 'number')
        balcony.options.openEdge =
          reversedEdges.get(balcony.options.openEdge) ?? balcony.options.openEdge
      if (balcony.guardBoundaryIndices)
        balcony.guardBoundaryIndices = balcony.guardBoundaryIndices.map(
          (i) => reversedEdges.get(i) ?? i,
        )
    }
    if (node.type === 'zone' && node.boundaryWallIds.some((id) => !included.has(id))) {
      node.autoFromWalls = false
      node.boundaryWallIds = []
    }
  } else if (node.type === 'door' || node.type === 'window') {
    const wall = nodes[node.parentId as AnyNodeId]
    if (wall?.type !== 'wall' || !included.has(wall.id))
      throw Error('Select the host wall together with its openings to mirror them.')
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    node.position[0] = length - node.position[0]
    node.rotation = [node.rotation[0], -node.rotation[1], -node.rotation[2]]
    node.hingesSide = opposite(node.hingesSide)
    if (node.type === 'door') {
      node.slideDirection = opposite(node.slideDirection)
      node.handleSide = opposite(node.handleSide)
      node.openingTopRadii.reverse()
      node.segments = node.segments.map((s) => ({
        ...s,
        columnRatios: [...s.columnRatios].reverse(),
      }))
    } else {
      node.columnRatios.reverse()
      const [tl, tr, br, bl] = node.openingCornerRadii
      node.openingCornerRadii = [tr, tl, bl, br]
    }
  } else if (node.type !== 'level' && node.type !== 'unit') {
    throw Error(
      `Mirror does not yet support ${node.type}. Remove it from the selection before applying.`,
    )
  }
  const reference = node.metadata.referenceOutline as Record<string, unknown> | undefined
  if (reference)
    node.metadata.referenceOutline = {
      ...reference,
      linked: false,
      detachedReason: 'geometry-edited',
    }
  const facade = node.metadata.proceduralFacade as Record<string, unknown> | undefined
  if (facade)
    node.metadata.proceduralFacade = {
      ...facade,
      detached: true,
      detachedReason: 'Mirrored geometry.',
    }
  for (const key of ['facadeOwner', 'facadeCell']) delete node.metadata[key]
  return node
}

export function planMirror(nodes: Nodes, ids: readonly AnyNodeId[], options: MirrorOptions) {
  if (!['x', 'z'].includes(options.axis) || !Number.isFinite(options.coordinate))
    throw Error('Choose a finite mirror axis position.')
  const source = mirrorSelection(nodes, ids)
  const included = new Set(source.map((n) => n.id))
  const buildings = new Set(
    source.map((node) => {
      let current: AnyNode | undefined = node
      const visited = new Set<string>()
      while (current && current.type !== 'building' && !visited.has(current.id)) {
        visited.add(current.id)
        current = nodes[current.parentId as AnyNodeId]
      }
      return current?.type === 'building' ? current.id : null
    }),
  )
  if (buildings.size !== 1 || buildings.has(null))
    throw Error('Mirror elements within one building at a time.')
  if (
    source.some(
      (n) =>
        n.metadata.linkedArray ||
        n.metadata.arrayModifier ||
        n.metadata.placeholderSource ||
        n.metadata.placeholderStack,
    )
  )
    throw Error('Make linked copies real before mirroring them.')
  const levels = source.filter((n): n is LevelNode => n.type === 'level')
  if (levels.length > 1 || (levels.length && ids.length > 1))
    throw Error('Mirror one complete floor at a time.')
  if (!options.copy && source.some((n) => n.type === 'unit')) {
    const shared = Object.values(nodes).some(
      (n) =>
        n.type === 'zone' &&
        !included.has(n.id) &&
        (n.boundaryWallIds.some((id) => included.has(id)) ||
          source.some(
            (wall) =>
              wall.type === 'wall' &&
              wall.parentId === n.parentId &&
              inside(wall.start, n.polygon) &&
              inside(wall.end, n.polygon),
          )),
    )
    if (shared)
      throw Error(
        'This unit shares walls with another room. Create a mirrored copy to preserve its neighbours.',
      )
  }
  const transformed = source.map((n) => mirrorNode(n, nodes, included, options))
  if (!mirrorFootprints(transformed).length)
    throw Error('This selection has no building geometry to mirror yet.')
  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
  let creates: AnyNode[] = []
  let resultIds = [...ids]
  if (!options.copy) updates.push(...transformed.map((node) => ({ id: node.id, data: node })))
  else if (levels[0]) {
    const level = levels[0]
    const mirroredNodes = { ...nodes, ...Object.fromEntries(transformed.map((n) => [n.id, n])) }
    const plan = buildLevelDuplicateCreateOps({
      nodes: mirroredNodes,
      level,
      levels: Object.values(nodes).filter(
        (n): n is LevelNode => n.type === 'level' && n.parentId === level.parentId,
      ),
      preset: 'everything',
    })
    creates = plan.createOps.map((op) => ({ ...op.node, parentId: op.parentId ?? null }) as AnyNode)
    updates.push(...plan.shiftedLevels.map((l) => ({ id: l.id, data: { level: l.level } })))
    resultIds = [plan.newLevelId]
  } else {
    const map = new Map(source.map((n) => [n.id, generateId(n.id.slice(0, n.id.indexOf('_')))]))
    creates = transformed.map((n) => AnyNode.parse(remapRepeatedReferences(n, map)))
    resultIds = ids.map((id) => map.get(id)! as AnyNodeId)
  }
  if (options.copy) {
    const createdIds = new Set(creates.map((n) => n.id))
    creates = creates.map((n) =>
      'children' in n
        ? ({
            ...n,
            children: n.children.filter((id) => createdIds.has(id as AnyNodeId)),
          } as AnyNode)
        : n,
    )
  }
  return { creates, updates, resultIds, sourceIds: source.map((n) => n.id) }
}
