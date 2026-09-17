import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  CabinetModuleNode,
  CabinetNode,
  ConstructionDimensionNode,
  DoorNode,
  GuideNode,
  ItemNode,
  LevelNode,
  pauseSpaceDetection,
  pointInPolygon2D,
  polygonsOverlap,
  resumeSpaceDetection,
  runAsSingleSceneHistoryStep,
  SlabNode,
  saveAsset,
  segmentsIntersect,
  useScene,
  WallNode,
  type WallNode as WallNodeType,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core'
import { cloneLevelSubtree } from '@pascal-app/core/clone-scene-graph'
import { CATALOG_ITEMS, type CatalogItem } from '../../components/ui/item-catalog/catalog-items'
import {
  type FloorplanPlacement,
  type FloorplanReconstruction,
  parseReconstructionNodes,
  placeFloorplanNode,
  placeFloorplanPoint,
} from './curated'
import {
  type FloorplanCatalogEntry,
  type FloorplanDraft,
  floorplanDraftSchema,
  type ImportIssue,
  type PlanPoint,
} from './schema'

const GUIDE_BASE_WIDTH_METERS = 10
const GEOMETRY_EPSILON = 1e-7
const OPENING_EDGE_CLEARANCE_METERS = 0.01
const ITEM_FIT_WARNING_RATIO = 0.08
const FLOOR_SURFACE_ELEVATION_METERS = 0.05
const FLOOR_SURFACE_THICKNESS_METERS = 0.05
const GUIDE_SURFACE_OFFSET_METERS = 0.001

export interface FloorplanTarget {
  levelId: string
  buildingId: string
  levelName: string
  levelHeight: number
  /** Canonical revision of the target building, level, and pre-existing guide children. */
  sceneRevision: string
}

export interface FloorplanImportCounts {
  walls: number
  openings: number
  zones: number
  items: number
  dimensions: number
  surfaces: number
}

export interface FloorplanImportResult {
  nodeIds: string[]
  guideId: string
  counts: FloorplanImportCounts
}

export interface ApplyFloorplanImportInput {
  draft: FloorplanDraft
  target: FloorplanTarget
  sourceFile: File
  acceptedWarnings: string[]
}

type Point3 = [number, number, number]
type NodeCreateOp = { node: AnyNode; parentId: AnyNodeId }
export type FloorplanSourceToNativeMap = Record<string, string[]>

type PreparedImport = {
  createOps: NodeCreateOp[]
  topLevelIds: AnyNodeId[]
  sourceToNative: FloorplanSourceToNativeMap
  counts: FloorplanImportCounts
}

export interface FloorplanPreparedPreview {
  /** Relation-complete adapter output, isolated from the scene store. */
  nodes: Record<string, AnyNode>
  topLevelIds: string[]
  sourceToNative: FloorplanSourceToNativeMap
  counts: FloorplanImportCounts
}

export interface FloorplanStructureWall {
  /** Logical host ID used by openings; it is not a native scene-node ID. */
  id: string
  /** Evidence IDs which map to this wall. One mask may support several straight walls. */
  sourceIds: string[]
  name?: string
  start: PlanPoint
  end: PlanPoint
  thickness: number
  height?: number
  metadata?: Record<string, unknown>
}

export interface FloorplanStructureOpening {
  sourceId: string
  wallId: string
  kind: 'door' | 'window' | 'opening'
  offset: number
  width: number
  height: number
  sillHeight: number
  side?: 'front' | 'back'
  doorType?: 'hinged' | 'sliding'
  hingesSide?: 'left' | 'right'
  swingDirection?: 'inward' | 'outward'
  metadata?: Record<string, unknown>
}

export interface FloorplanStructurePreviewInput {
  buildingName?: string
  levelName?: string
  levelHeight: number
  walls: FloorplanStructureWall[]
  openings: FloorplanStructureOpening[]
  metadata?: Record<string, unknown>
}

export interface FloorplanStructurePreview {
  nodes: Record<string, AnyNode>
  buildingId: string
  levelId: string
  sourceToNative: FloorplanSourceToNativeMap
  counts: { walls: number; openings: number }
}

function issue(
  id: string,
  message: string,
  severity: ImportIssue['severity'],
  relatedIds: string[] = [],
): ImportIssue {
  const normalizedId = id.length <= 100 ? id : `${id.slice(0, 72)}:${stableRevision(id)}`
  return {
    id: normalizedId,
    message: message.length <= 2000 ? message : `${message.slice(0, 1997)}…`,
    severity,
    relatedIds: [...new Set(relatedIds)].slice(0, 100),
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    )
  }
  return value
}

function stableRevision(value: unknown): string {
  const text = JSON.stringify(canonicalize(value))
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}-${text.length.toString(36)}`
}

function directLevelChildren(levelId: string, nodes: Record<string, AnyNode>): AnyNode[] {
  return Object.values(nodes).filter((node) => node.parentId === levelId)
}

function relevantSceneRevision(levelId: string, buildingId: string): string {
  const { nodes } = useScene.getState()
  const level = nodes[levelId as AnyNodeId]
  const building = nodes[buildingId as AnyNodeId]
  const children = directLevelChildren(levelId, nodes as Record<string, AnyNode>)
  return stableRevision({
    building: building && {
      id: building.id,
      type: building.type,
      parentId: building.parentId,
    },
    level,
    children: children.sort((left, right) => left.id.localeCompare(right.id)),
  })
}

function importedDraftId(node: AnyNode): string | null {
  const metadata = node.metadata
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    !('floorplanImport' in metadata)
  ) {
    return null
  }
  const record = metadata.floorplanImport
  if (!record || typeof record !== 'object' || Array.isArray(record) || !('draftId' in record)) {
    return null
  }
  const draftId = record.draftId
  return typeof draftId === 'string' ? draftId : null
}

function targetStateIssues(target: FloorplanTarget, draftId?: string): ImportIssue[] {
  const state = useScene.getState()
  const level = state.nodes[target.levelId as AnyNodeId]
  const building = state.nodes[target.buildingId as AnyNodeId]
  const issues: ImportIssue[] = []

  if (level?.type !== 'level') {
    issues.push(
      issue(
        'native:target-missing',
        'The selected level no longer exists. Close this import and start again from an existing empty level.',
        'blocking',
        [target.levelId],
      ),
    )
    return issues
  }
  if (building?.type !== 'building' || level.parentId !== building.id) {
    issues.push(
      issue(
        'native:target-building-changed',
        'The selected level is no longer in the building captured for this import. Start the import again from the intended level.',
        'blocking',
        [target.levelId, target.buildingId],
      ),
    )
    return issues
  }
  if (state.readOnly) {
    issues.push(
      issue(
        'native:scene-read-only',
        'This scene is read-only. Enable editing before importing the floorplan.',
        'blocking',
        [target.levelId],
      ),
    )
  }

  const children = directLevelChildren(target.levelId, state.nodes as Record<string, AnyNode>)
  const duplicates = draftId ? children.filter((node) => importedDraftId(node) === draftId) : []
  if (duplicates.length > 0) {
    issues.push(
      issue(
        'native:duplicate-import',
        'This floorplan draft has already been applied to the selected level.',
        'blocking',
        duplicates.map((node) => node.id),
      ),
    )
  }

  const occupied = children.filter((node) => node.type !== 'guide')
  if (occupied.length > 0) {
    issues.push(
      issue(
        'native:target-not-empty',
        'Create an empty level to import this plan. Existing guide images are allowed, but construction, zones, annotations, and props are not.',
        'blocking',
        occupied.map((node) => node.id),
      ),
    )
  }

  if (relevantSceneRevision(target.levelId, target.buildingId) !== target.sceneRevision) {
    issues.push(
      issue(
        'native:target-stale',
        'The target level or building changed after this import started. Review the current empty level and generate again.',
        'blocking',
        [target.levelId, target.buildingId],
      ),
    )
  }
  if (level.height !== target.levelHeight) {
    issues.push(
      issue(
        'native:level-height-changed',
        'The level height changed after this import started. Generate again so openings and room metadata use the current height.',
        'blocking',
        [target.levelId],
      ),
    )
  }

  return issues
}

export function captureFloorplanTarget(levelId: string): FloorplanTarget {
  const state = useScene.getState()
  const level = state.nodes[levelId as AnyNodeId]
  if (level?.type !== 'level') {
    throw new Error('Import target must be an existing level.')
  }
  const buildingId = level.parentId
  const building = buildingId ? state.nodes[buildingId as AnyNodeId] : undefined
  if (building?.type !== 'building') {
    throw new Error('Import target must belong to an existing building.')
  }
  if (state.readOnly) {
    throw new Error('This scene is read-only. Enable editing before importing a floorplan.')
  }
  if (!(typeof level.height === 'number' && Number.isFinite(level.height) && level.height >= 0.5)) {
    throw new Error(
      'The target level must have a valid stored height before importing a floorplan.',
    )
  }
  const occupied = directLevelChildren(levelId, state.nodes as Record<string, AnyNode>).filter(
    (node) => node.type !== 'guide',
  )
  if (occupied.length > 0) {
    throw new Error('Create an empty level to import this plan. Existing guide images are allowed.')
  }

  return {
    levelId,
    buildingId: building.id,
    levelName: level.name?.trim() || `Level ${level.level}`,
    levelHeight: level.height,
    sceneRevision: relevantSceneRevision(levelId, building.id),
  }
}

function catalogFootprint(item: CatalogItem): [width: number, depth: number] | null {
  const [width, , depth] = item.dimensions ?? []
  return typeof width === 'number' &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof depth === 'number' &&
    Number.isFinite(depth) &&
    depth > 0
    ? [width, depth]
    : null
}

function isFloorCatalogItem(item: CatalogItem): boolean {
  return (item.tool === 'cabinet' || item.attachTo === undefined) && catalogFootprint(item) !== null
}

function catalogItemById(id: string): CatalogItem | undefined {
  return CATALOG_ITEMS.find((item) => item.id === id && isFloorCatalogItem(item))
}

export function getFloorplanImportCatalog(): FloorplanCatalogEntry[] {
  return CATALOG_ITEMS.flatMap((item) => {
    if (!isFloorCatalogItem(item)) return []
    const footprint = catalogFootprint(item)!
    return [
      {
        id: item.id,
        name: item.name,
        category: item.tool === 'cabinet' ? 'cabinet' : item.category,
        width: footprint[0],
        depth: footprint[1],
      },
    ]
  })
}

function pointEquals(a: PlanPoint, b: PlanPoint, epsilon = GEOMETRY_EPSILON): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= epsilon
}

function segmentWithinPolygon(start: PlanPoint, end: PlanPoint, polygon: PlanPoint[]): boolean {
  if (!pointInPolygon2D(start, polygon) || !pointInPolygon2D(end, polygon)) return false
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const cuts = [0, 1]
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!
    const b = polygon[(index + 1) % polygon.length]!
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    const denominator = dx * ey - dy * ex
    if (Math.abs(denominator) <= GEOMETRY_EPSILON) continue
    const ax = a[0] - start[0]
    const ay = a[1] - start[1]
    const t = (ax * ey - ay * ex) / denominator
    const u = (ax * dy - ay * dx) / denominator
    if (t > 0 && t < 1 && u >= -GEOMETRY_EPSILON && u <= 1 + GEOMETRY_EPSILON) cuts.push(t)
  }
  cuts.sort((left, right) => left - right)
  for (let index = 1; index < cuts.length; index += 1) {
    if (cuts[index]! - cuts[index - 1]! <= GEOMETRY_EPSILON) continue
    const t = (cuts[index]! + cuts[index - 1]!) / 2
    if (!pointInPolygon2D([start[0] + dx * t, start[1] + dy * t], polygon)) return false
  }
  return true
}

function polygonEdges(polygon: PlanPoint[]): Array<[PlanPoint, PlanPoint]> {
  return polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]!])
}

function polygonProblems(polygon: PlanPoint[]): string[] {
  const problems: string[] = []
  const edges = polygonEdges(polygon)
  for (let index = 0; index < edges.length; index += 1) {
    const [start, end] = edges[index]!
    if (pointEquals(start, end)) problems.push(`edge ${index + 1} has zero length`)
    for (let other = index + 1; other < edges.length; other += 1) {
      if (other === index + 1 || (index === 0 && other === edges.length - 1)) continue
      const [otherStart, otherEnd] = edges[other]!
      if (segmentsIntersect(start, end, otherStart, otherEnd)) {
        problems.push(`edges ${index + 1} and ${other + 1} intersect`)
      }
    }
  }
  return problems
}

function distanceToSegment(point: PlanPoint, start: PlanPoint, end: PlanPoint): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= GEOMETRY_EPSILON) return Math.hypot(point[0] - start[0], point[1] - start[1])
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
  )
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy))
}

function wallEndpointConnected(
  wallId: string,
  endpoint: PlanPoint,
  walls: FloorplanDraft['walls'],
  tolerance: number,
): boolean {
  return walls.some(
    (other) =>
      other.id !== wallId && distanceToSegment(endpoint, other.start, other.end) <= tolerance,
  )
}

function wallGraphEnclosesZone(
  zone: FloorplanDraft['zones'][number],
  wallsById: Map<string, FloorplanDraft['walls'][number]>,
): boolean {
  const walls = zone.boundaryWallIds
    .map((id) => wallsById.get(id))
    .filter((wall) => wall !== undefined)
  if (walls.length !== zone.boundaryWallIds.length || walls.length < 3) return false
  const tolerance = Math.max(2, ...walls.map((wall) => wall.thickness * 1.5))

  for (const wall of walls) {
    const startDegree = walls.filter(
      (candidate) =>
        candidate.id !== wall.id &&
        (pointEquals(wall.start, candidate.start, tolerance) ||
          pointEquals(wall.start, candidate.end, tolerance)),
    ).length
    const endDegree = walls.filter(
      (candidate) =>
        candidate.id !== wall.id &&
        (pointEquals(wall.end, candidate.start, tolerance) ||
          pointEquals(wall.end, candidate.end, tolerance)),
    ).length
    if (startDegree === 0 || endDegree === 0) return false
  }

  for (const vertex of zone.polygon) {
    if (!walls.some((wall) => distanceToSegment(vertex, wall.start, wall.end) <= tolerance))
      return false
  }
  for (const wall of walls) {
    const midpoint: PlanPoint = [
      (wall.start[0] + wall.end[0]) / 2,
      (wall.start[1] + wall.end[1]) / 2,
    ]
    if (
      !polygonEdges(zone.polygon).some(
        ([start, end]) => distanceToSegment(midpoint, start, end) <= tolerance,
      )
    ) {
      return false
    }
  }
  return true
}

function duplicateSourceIds(draft: FloorplanDraft): string[] {
  const ids = [
    ...draft.walls.map((entry) => entry.id),
    ...draft.openings.map((entry) => entry.id),
    ...draft.zones.map((entry) => entry.id),
    ...draft.items.map((entry) => entry.id),
    ...draft.dimensions.map((entry) => entry.id),
  ]
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return [...duplicates]
}

function validateDraftGeometry(draft: FloorplanDraft, target: FloorplanTarget): ImportIssue[] {
  const issues: ImportIssue[] = []
  const metersPerPixel = draft.source.metersPerPixel

  const duplicateIds = duplicateSourceIds(draft)
  if (duplicateIds.length > 0) {
    issues.push(
      issue(
        'native:duplicate-source-ids',
        'Source element IDs must be unique across walls, openings, zones, items, and dimensions.',
        'blocking',
        duplicateIds,
      ),
    )
  }

  const floorProblems = polygonProblems(draft.floor.polygon)
  if (floorProblems.length > 0) {
    issues.push(
      issue(
        'native:invalid-floor-boundary',
        `The floor boundary is not a simple polygon: ${floorProblems.join('; ')}.`,
        'blocking',
      ),
    )
  }
  draft.floor.holes.forEach((hole, index) => {
    const problems = polygonProblems(hole)
    if (problems.length > 0) {
      issues.push(
        issue(
          `native:invalid-floor-hole:${index}`,
          `Floor opening ${index + 1} is not a simple polygon: ${problems.join('; ')}.`,
          'blocking',
        ),
      )
    }
    if (!hole.every((point) => pointInPolygon2D(point, draft.floor.polygon))) {
      issues.push(
        issue(
          `native:floor-hole-outside:${index}`,
          `Floor opening ${index + 1} must lie completely inside the floor boundary.`,
          'blocking',
        ),
      )
    }
    if (
      polygonEdges(hole).some(([a, b]) =>
        polygonEdges(draft.floor.polygon).some(([c, d]) => segmentsIntersect(a, b, c, d)),
      )
    ) {
      issues.push(
        issue(
          `native:floor-hole-crosses-boundary:${index}`,
          `Floor opening ${index + 1} crosses the outer floor boundary.`,
          'blocking',
        ),
      )
    }
  })
  for (let left = 0; left < draft.floor.holes.length; left += 1) {
    for (let right = left + 1; right < draft.floor.holes.length; right += 1) {
      if (polygonsOverlap(draft.floor.holes[left]!, draft.floor.holes[right]!)) {
        issues.push(
          issue(
            `native:floor-holes-overlap:${left}:${right}`,
            `Floor openings ${left + 1} and ${right + 1} overlap. Merge or separate them before importing.`,
            'blocking',
          ),
        )
      }
    }
  }

  if (metersPerPixel === null) {
    issues.push(
      issue(
        'native:missing-scale',
        'Set one known distance before creating native geometry. A floorplan without metric scale cannot be imported.',
        'blocking',
      ),
    )
  } else {
    const xs = draft.floor.polygon.map((point) => point[0])
    const ys = draft.floor.polygon.map((point) => point[1])
    const width = (Math.max(...xs) - Math.min(...xs)) * metersPerPixel
    const depth = (Math.max(...ys) - Math.min(...ys)) * metersPerPixel
    if (!(width >= 0.5 && depth >= 0.5 && width <= 10_000 && depth <= 10_000)) {
      issues.push(
        issue(
          'native:implausible-scale',
          `The calibrated floor would be ${width.toFixed(2)} m by ${depth.toFixed(2)} m. Correct the known distance or crop before importing.`,
          'blocking',
        ),
      )
    }
  }

  const wallsById = new Map(draft.walls.map((wall) => [wall.id, wall]))
  for (const wall of draft.walls) {
    const lengthPixels = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    if (lengthPixels <= GEOMETRY_EPSILON) {
      issues.push(
        issue(
          `native:zero-wall:${wall.id}`,
          `Wall “${wall.id}” has identical start and end points.`,
          'blocking',
          [wall.id],
        ),
      )
      continue
    }
    if (!segmentWithinPolygon(wall.start, wall.end, draft.floor.polygon)) {
      issues.push(
        issue(
          `native:wall-outside-floor:${wall.id}`,
          `Wall “${wall.id}” extends outside the accepted floor footprint.`,
          'blocking',
          [wall.id],
        ),
      )
    }
    const connectionTolerance = Math.max(2, wall.thickness)
    if (
      draft.walls.length > 1 &&
      !wallEndpointConnected(wall.id, wall.start, draft.walls, connectionTolerance) &&
      !wallEndpointConnected(wall.id, wall.end, draft.walls, connectionTolerance)
    ) {
      issues.push(
        issue(
          `native:isolated-wall:${wall.id}`,
          `Wall “${wall.id}” is disconnected from every other wall. Confirm that it is a free-standing wall.`,
          'warning',
          [wall.id],
        ),
      )
    }
    if (metersPerPixel !== null) {
      const thickness = wall.thickness * metersPerPixel
      if (thickness < 0.02 || thickness > 1) {
        issues.push(
          issue(
            `native:wall-thickness:${wall.id}`,
            `Wall “${wall.id}” would be ${thickness.toFixed(3)} m thick; correct its source edges or scale.`,
            'blocking',
            [wall.id],
          ),
        )
      }
    }
  }

  const openingsByWall = new Map<string, FloorplanDraft['openings']>()
  for (const opening of draft.openings) {
    const wall = wallsById.get(opening.wallId)
    if (!wall) {
      issues.push(
        issue(
          `native:opening-host:${opening.id}`,
          `Opening “${opening.id}” references missing wall “${opening.wallId}”.`,
          'blocking',
          [opening.id, opening.wallId],
        ),
      )
      continue
    }
    const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    if (
      opening.offset - opening.width / 2 < -GEOMETRY_EPSILON ||
      opening.offset + opening.width / 2 > wallLength + GEOMETRY_EPSILON
    ) {
      issues.push(
        issue(
          `native:opening-bounds:${opening.id}`,
          `Opening “${opening.id}” must fit inside wall “${wall.id}”; its offset is measured to the opening centre from the wall start.`,
          'blocking',
          [opening.id, wall.id],
        ),
      )
    }
    if (opening.sillHeight + opening.height > target.levelHeight + GEOMETRY_EPSILON) {
      issues.push(
        issue(
          `native:opening-height:${opening.id}`,
          `Opening “${opening.id}” rises above the ${target.levelHeight.toFixed(2)} m level height.`,
          'blocking',
          [opening.id],
        ),
      )
    }
    if (opening.kind !== 'window' && opening.sillHeight > OPENING_EDGE_CLEARANCE_METERS) {
      issues.push(
        issue(
          `native:door-sill:${opening.id}`,
          `Door/opening “${opening.id}” has a non-zero sill. Confirm the source classification or set its sill to floor level.`,
          'blocking',
          [opening.id],
        ),
      )
    }
    const siblings = openingsByWall.get(wall.id) ?? []
    for (const sibling of siblings) {
      const horizontalOverlap =
        Math.min(opening.offset + opening.width / 2, sibling.offset + sibling.width / 2) -
        Math.max(opening.offset - opening.width / 2, sibling.offset - sibling.width / 2)
      const verticalOverlap =
        Math.min(opening.sillHeight + opening.height, sibling.sillHeight + sibling.height) -
        Math.max(opening.sillHeight, sibling.sillHeight)
      if (horizontalOverlap > GEOMETRY_EPSILON && verticalOverlap > GEOMETRY_EPSILON) {
        issues.push(
          issue(
            `native:opening-overlap:${sibling.id}:${opening.id}`,
            `Openings “${sibling.id}” and “${opening.id}” overlap on wall “${wall.id}”.`,
            'blocking',
            [sibling.id, opening.id, wall.id],
          ),
        )
      }
    }
    siblings.push(opening)
    openingsByWall.set(wall.id, siblings)
  }

  for (const zone of draft.zones) {
    const problems = polygonProblems(zone.polygon)
    if (problems.length > 0) {
      issues.push(
        issue(
          `native:zone-polygon:${zone.id}`,
          `Zone “${zone.name}” is not a simple polygon: ${problems.join('; ')}.`,
          'blocking',
          [zone.id],
        ),
      )
    }
    const overlapsFloorHole = draft.floor.holes.some((hole) => polygonsOverlap(zone.polygon, hole))
    if (
      !zone.polygon.every((point, index) =>
        segmentWithinPolygon(
          point,
          zone.polygon[(index + 1) % zone.polygon.length]!,
          draft.floor.polygon,
        ),
      ) ||
      overlapsFloorHole
    ) {
      issues.push(
        issue(
          `native:zone-outside-floor:${zone.id}`,
          `Zone “${zone.name}” must lie inside the accepted floor footprint without crossing a floor opening.`,
          'blocking',
          [zone.id],
        ),
      )
    }
    if (zone.enclosed && !wallGraphEnclosesZone(zone, wallsById)) {
      issues.push(
        issue(
          `native:zone-not-enclosed:${zone.id}`,
          `Zone “${zone.name}” is marked enclosed, but its boundary walls do not form and support the complete polygon.`,
          'blocking',
          [zone.id, ...zone.boundaryWallIds],
        ),
      )
    }
    if (!zone.enclosed && zone.boundaryWallIds.length > 0) {
      issues.push(
        issue(
          `native:open-zone-walls:${zone.id}`,
          `Open-plan zone “${zone.name}” must remain an explicit polygon without procedural boundary-wall references.`,
          'blocking',
          [zone.id, ...zone.boundaryWallIds],
        ),
      )
    }
  }

  for (const item of draft.items) {
    const halfWidth = item.width / 2
    const halfDepth = item.depth / 2
    const cosine = Math.cos(item.rotation)
    const sine = Math.sin(item.rotation)
    const footprint: PlanPoint[] = [
      [-halfWidth, -halfDepth],
      [halfWidth, -halfDepth],
      [halfWidth, halfDepth],
      [-halfWidth, halfDepth],
    ]
    for (const corner of footprint) {
      const [localX, localZ] = corner
      corner[0] = item.position[0] + localX * cosine + localZ * sine
      corner[1] = item.position[1] - localX * sine + localZ * cosine
    }
    const outsideFloor = !footprint.every((corner, index) =>
      segmentWithinPolygon(corner, footprint[(index + 1) % footprint.length]!, draft.floor.polygon),
    )
    const inFloorHole = draft.floor.holes.some((hole) => polygonsOverlap(footprint, hole))
    if (outsideFloor || inFloorHole) {
      issues.push(
        issue(
          `native:item-outside-floor:${item.id}`,
          `The footprint for “${item.label}” crosses outside the imported floor surface or into a floor opening. Move it or correct its source region.`,
          'blocking',
          [item.id],
        ),
      )
    }
    if (!item.assetId) {
      issues.push(
        issue(
          `native:unresolved-asset:${item.id}`,
          `Choose a real catalog match for “${item.label}” before importing. Pascal will not create a placeholder object.`,
          'blocking',
          [item.id],
        ),
      )
      continue
    }
    const catalogItem = catalogItemById(item.assetId)
    if (!catalogItem) {
      issues.push(
        issue(
          `native:invalid-asset:${item.id}`,
          `Catalog item “${item.assetId}” is unavailable or requires a host not represented by this floor item. Choose another match.`,
          'blocking',
          [item.id, item.assetId],
        ),
      )
      continue
    }
    if (catalogItem.tool === 'cabinet') {
      if (metersPerPixel !== null) {
        const width = item.width * metersPerPixel
        const depth = item.depth * metersPerPixel
        if (width < 0.05 || width > 30 || depth < 0.3 || depth > 1.2) {
          issues.push(
            issue(
              `native:cabinet-bounds:${item.id}`,
              `Cabinet “${item.label}” has a ${width.toFixed(2)} m × ${depth.toFixed(2)} m footprint outside the native cabinet range. Split or correct the source region.`,
              'blocking',
              [item.id],
            ),
          )
        }
      }
      continue
    }
    if (metersPerPixel !== null) {
      const sourceWidth = item.width * metersPerPixel
      const sourceDepth = item.depth * metersPerPixel
      const [assetWidth, , assetDepth] = catalogItem.dimensions!
      const uniformScale = Math.min(sourceWidth / assetWidth, sourceDepth / assetDepth)
      const fittedWidth = assetWidth * uniformScale
      const fittedDepth = assetDepth * uniformScale
      const residual = Math.max(
        Math.abs(fittedWidth - sourceWidth) / sourceWidth,
        Math.abs(fittedDepth - sourceDepth) / sourceDepth,
      )
      if (residual > ITEM_FIT_WARNING_RATIO) {
        issues.push(
          issue(
            `native:asset-fit:${item.id}`,
            `“${catalogItem.name}” keeps its proportions and is uniformly scaled to fit inside the ${sourceWidth.toFixed(2)} m × ${sourceDepth.toFixed(2)} m source footprint; unused space remains rather than stretching the asset.`,
            'warning',
            [item.id, catalogItem.id],
          ),
        )
      }
    }
  }

  for (const dimension of draft.dimensions) {
    const startWall = wallsById.get(dimension.start.wallId)
    const endWall = wallsById.get(dimension.end.wallId)
    if (!startWall || !endWall) {
      issues.push(
        issue(
          `native:dimension-host:${dimension.id}`,
          `Dimension “${dimension.sourceText}” references a missing wall endpoint.`,
          'blocking',
          [dimension.id, dimension.start.wallId, dimension.end.wallId],
        ),
      )
      continue
    }
    const baselineLength = Math.hypot(
      dimension.baseline[1][0] - dimension.baseline[0][0],
      dimension.baseline[1][1] - dimension.baseline[0][1],
    )
    if (baselineLength <= GEOMETRY_EPSILON) {
      issues.push(
        issue(
          `native:dimension-baseline:${dimension.id}`,
          `Dimension “${dimension.sourceText}” needs a non-zero baseline direction.`,
          'blocking',
          [dimension.id],
        ),
      )
    }
    if (metersPerPixel !== null) {
      const startPoint =
        dimension.start.featureId === 'wall:start' ? startWall.start : startWall.end
      const endPoint = dimension.end.featureId === 'wall:start' ? endWall.start : endWall.end
      const measured =
        Math.hypot(endPoint[0] - startPoint[0], endPoint[1] - startPoint[1]) * metersPerPixel
      const residual = Math.abs(measured - dimension.sourceMeters)
      if (residual > Math.max(0.02, dimension.sourceMeters * 0.01)) {
        issues.push(
          issue(
            `native:dimension-residual:${dimension.id}`,
            `Printed dimension “${dimension.sourceText}” is ${dimension.sourceMeters.toFixed(3)} m, but its associated endpoints resolve to ${measured.toFixed(3)} m. The native annotation will show live geometry and preserve the printed value only as provenance.`,
            'warning',
            [dimension.id, startWall.id, endWall.id],
          ),
        )
      }
    }
  }

  return issues
}

export function inspectFloorplanImport(
  draftInput: FloorplanDraft,
  target: FloorplanTarget,
): ImportIssue[] {
  const parsed = floorplanDraftSchema.safeParse(draftInput)
  if (!parsed.success) {
    return [
      issue(
        'native:invalid-draft',
        `The generated floor draft is invalid: ${parsed.error.issues
          .slice(0, 4)
          .map((entry) => `${entry.path.join('.') || 'draft'}: ${entry.message}`)
          .join('; ')}`,
        'blocking',
      ),
    ]
  }
  const draft = parsed.data
  return [
    ...draft.issues,
    ...targetStateIssues(target, draft.id),
    ...validateDraftGeometry(draft, target),
  ]
}

function sourcePointToWorld(point: PlanPoint, draft: FloorplanDraft): [number, number] {
  const metersPerPixel = draft.source.metersPerPixel
  if (metersPerPixel === null)
    throw new Error('Floorplan scale is required before native conversion.')
  return [
    (point[0] - draft.source.originPx[0]) * metersPerPixel,
    (point[1] - draft.source.originPx[1]) * metersPerPixel,
  ]
}

function sourceMetadata(draft: FloorplanDraft, sourceElementId: string, featureIds: string[] = []) {
  return {
    floorplanSource: {
      version: 1,
      draftId: draft.id,
      sourceElementId,
      featureIds,
    },
  }
}

function addMapping(map: FloorplanSourceToNativeMap, sourceId: string, nativeId: string): void {
  const nativeIds = map[sourceId]
  if (nativeIds) nativeIds.push(nativeId)
  else map[sourceId] = [nativeId]
}

type PreparedStructure = {
  createOps: NodeCreateOp[]
  topLevelIds: AnyNodeId[]
  sourceToNative: FloorplanSourceToNativeMap
  nativeWalls: Map<string, WallNodeType>
}

function materializeNodeGraph(
  createOps: NodeCreateOp[],
  roots: AnyNode[] = [],
): Record<string, AnyNode> {
  const nodes: Record<string, AnyNode> = Object.create(null)
  for (const node of roots) nodes[node.id] = { ...node }
  for (const { node, parentId } of createOps) {
    nodes[node.id] = { ...node, parentId } as AnyNode
  }
  for (const { node, parentId } of createOps) {
    const parent = nodes[parentId]
    if (!parent || !('children' in parent) || !Array.isArray(parent.children)) continue
    if (parent.children.some((childId) => childId === node.id)) continue
    nodes[parentId] = {
      ...parent,
      children: [...parent.children, node.id as AnyNodeId],
    } as AnyNode
  }
  return nodes
}

function buildPreparedStructure(
  input: Pick<FloorplanStructurePreviewInput, 'walls' | 'openings'>,
  levelId: AnyNodeId,
): PreparedStructure {
  const createOps: NodeCreateOp[] = []
  const topLevelIds: AnyNodeId[] = []
  const sourceToNative: FloorplanSourceToNativeMap = Object.create(null)
  const nativeWalls = new Map<string, WallNodeType>()

  for (const sourceWall of input.walls) {
    const wall = WallNode.parse({
      name: sourceWall.name ?? sourceWall.id,
      start: sourceWall.start,
      end: sourceWall.end,
      thickness: sourceWall.thickness,
      ...(sourceWall.height === undefined ? {} : { height: sourceWall.height }),
      metadata: sourceWall.metadata,
    })
    nativeWalls.set(sourceWall.id, wall)
    createOps.push({ node: wall, parentId: levelId })
    topLevelIds.push(wall.id)
    for (const sourceId of new Set(sourceWall.sourceIds))
      addMapping(sourceToNative, sourceId, wall.id)
  }

  for (const sourceOpening of input.openings) {
    const wall = nativeWalls.get(sourceOpening.wallId)
    if (!wall)
      throw new Error(
        `Structural opening “${sourceOpening.sourceId}” has no wall host “${sourceOpening.wallId}”.`,
      )
    const position: Point3 = [
      sourceOpening.offset,
      sourceOpening.sillHeight + sourceOpening.height / 2,
      0,
    ]
    const common = {
      name: sourceOpening.sourceId,
      wallId: wall.id,
      position,
      rotation: [0, 0, 0] as Point3,
      side: sourceOpening.side ?? 'front',
      width: sourceOpening.width,
      height: sourceOpening.height,
      metadata: sourceOpening.metadata,
    }
    const opening =
      sourceOpening.kind === 'window'
        ? WindowNode.parse({
            ...common,
            openingKind: 'window',
            windowType: 'fixed',
            hingesSide: sourceOpening.hingesSide ?? 'left',
          })
        : DoorNode.parse({
            ...common,
            openingKind: sourceOpening.kind === 'opening' ? 'opening' : 'door',
            doorType: sourceOpening.doorType ?? 'hinged',
            hingesSide: sourceOpening.hingesSide ?? 'left',
            swingDirection: sourceOpening.swingDirection ?? 'inward',
            slideDirection: sourceOpening.hingesSide ?? 'left',
            threshold: sourceOpening.kind === 'door',
            handle: sourceOpening.kind === 'door',
          })
    createOps.push({ node: opening, parentId: wall.id })
    addMapping(sourceToNative, sourceOpening.sourceId, opening.id)
  }

  return { createOps, topLevelIds, sourceToNative, nativeWalls }
}

function validateStructurePreviewInput(input: FloorplanStructurePreviewInput): void {
  if (!Number.isFinite(input.levelHeight) || input.levelHeight <= 0)
    throw new Error('A structure preview requires a positive finite level height.')
  const wallsById = new Map<string, FloorplanStructureWall>()
  for (const wall of input.walls) {
    if (!wall.id.trim()) throw new Error('A structural wall is missing its logical ID.')
    if (wallsById.has(wall.id)) throw new Error(`Structural wall ID “${wall.id}” is duplicated.`)
    wallsById.set(wall.id, wall)
    if (wall.sourceIds.length === 0 || wall.sourceIds.some((id) => !id.trim()))
      throw new Error(`Structural wall “${wall.id}” needs at least one source evidence ID.`)
    if (
      ![...wall.start, ...wall.end, wall.thickness].every(Number.isFinite) ||
      wall.thickness <= 0 ||
      Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) <= GEOMETRY_EPSILON
    )
      throw new Error(`Structural wall “${wall.id}” has invalid metric geometry.`)
    if (wall.height !== undefined && (!Number.isFinite(wall.height) || wall.height <= 0))
      throw new Error(`Structural wall “${wall.id}” has an invalid height.`)
  }

  const openingIds = new Set<string>()
  for (const opening of input.openings) {
    if (!opening.sourceId.trim())
      throw new Error('A structural opening is missing its source evidence ID.')
    if (openingIds.has(opening.sourceId))
      throw new Error(`Structural opening source ID “${opening.sourceId}” is duplicated.`)
    openingIds.add(opening.sourceId)
    const wall = wallsById.get(opening.wallId)
    if (!wall)
      throw new Error(
        `Structural opening “${opening.sourceId}” has no wall host “${opening.wallId}”.`,
      )
    if (
      ![opening.offset, opening.width, opening.height, opening.sillHeight].every(Number.isFinite) ||
      opening.width <= 0 ||
      opening.height <= 0 ||
      opening.sillHeight < 0
    )
      throw new Error(`Structural opening “${opening.sourceId}” has invalid metric geometry.`)
    const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    if (
      opening.offset - opening.width / 2 < -GEOMETRY_EPSILON ||
      opening.offset + opening.width / 2 > wallLength + GEOMETRY_EPSILON
    )
      throw new Error(
        `Structural opening “${opening.sourceId}” does not fit inside wall “${opening.wallId}”.`,
      )
    if (opening.sillHeight + opening.height > input.levelHeight + GEOMETRY_EPSILON)
      throw new Error(`Structural opening “${opening.sourceId}” rises above the preview level.`)
  }
}

/** Compiles evidence-backed walls and hosted openings into an isolated native graph. */
export function prepareFloorplanStructurePreview(
  input: FloorplanStructurePreviewInput,
): FloorplanStructurePreview {
  validateStructurePreviewInput(input)
  const building = BuildingNode.parse({
    name: input.buildingName ?? 'Structure preview',
    children: [],
    metadata: input.metadata,
  })
  const level = LevelNode.parse({
    name: input.levelName ?? 'Preview level',
    level: 0,
    height: input.levelHeight,
    parentId: building.id,
    children: [],
    metadata: input.metadata,
  })
  const prepared = buildPreparedStructure(input, level.id)
  const nodes = materializeNodeGraph(
    [{ node: level, parentId: building.id }, ...prepared.createOps],
    [building],
  )
  return {
    nodes,
    buildingId: building.id,
    levelId: level.id,
    sourceToNative: Object.fromEntries(
      Object.entries(prepared.sourceToNative).map(([sourceId, nativeIds]) => [
        sourceId,
        [...nativeIds],
      ]),
    ),
    counts: { walls: input.walls.length, openings: input.openings.length },
  }
}

function buildPreparedImport(draft: FloorplanDraft, target: FloorplanTarget): PreparedImport {
  const metersPerPixel = draft.source.metersPerPixel
  if (metersPerPixel === null)
    throw new Error('Floorplan scale is required before native conversion.')
  const levelId = target.levelId as AnyNodeId
  const createOps: NodeCreateOp[] = []
  const topLevelIds: AnyNodeId[] = []
  const sourceToNative: FloorplanSourceToNativeMap = Object.create(null)

  const floor = SlabNode.parse({
    name: `${draft.source.name || 'Imported floor'} surface`,
    polygon: draft.floor.polygon.map((point) => sourcePointToWorld(point, draft)),
    holes: draft.floor.holes.map((hole) => hole.map((point) => sourcePointToWorld(point, draft))),
    elevation: FLOOR_SURFACE_ELEVATION_METERS,
    thickness: FLOOR_SURFACE_THICKNESS_METERS,
    metadata: sourceMetadata(draft, 'floor'),
  })
  createOps.push({ node: floor, parentId: levelId })
  topLevelIds.push(floor.id)
  addMapping(sourceToNative, 'floor', floor.id)

  const structure = buildPreparedStructure(
    {
      walls: draft.walls.map((sourceWall) => ({
        id: sourceWall.id,
        sourceIds: [sourceWall.id],
        name: sourceWall.id,
        start: sourcePointToWorld(sourceWall.start, draft),
        end: sourcePointToWorld(sourceWall.end, draft),
        thickness: sourceWall.thickness * metersPerPixel,
        metadata: sourceMetadata(draft, sourceWall.id, sourceWall.featureIds),
      })),
      openings: draft.openings.map((sourceOpening) => ({
        sourceId: sourceOpening.id,
        wallId: sourceOpening.wallId,
        kind: sourceOpening.kind,
        offset: sourceOpening.offset * metersPerPixel,
        width: sourceOpening.width * metersPerPixel,
        height: sourceOpening.height,
        sillHeight: sourceOpening.sillHeight,
        side: sourceOpening.side,
        doorType: sourceOpening.doorType,
        hingesSide: sourceOpening.hingesSide,
        swingDirection: sourceOpening.swingDirection,
        metadata: sourceMetadata(draft, sourceOpening.id, sourceOpening.featureIds),
      })),
    },
    levelId,
  )
  createOps.push(...structure.createOps)
  topLevelIds.push(...structure.topLevelIds)
  for (const [sourceId, nativeIds] of Object.entries(structure.sourceToNative))
    sourceToNative[sourceId] = [...nativeIds]
  const nativeWalls = structure.nativeWalls

  for (const sourceZone of draft.zones) {
    const boundaryWallIds = sourceZone.enclosed
      ? sourceZone.boundaryWallIds.map((wallId) => nativeWalls.get(wallId)!.id)
      : []
    const zone = ZoneNode.parse({
      name: sourceZone.name,
      roomNumber: sourceZone.roomNumber,
      polygon: sourceZone.polygon.map((point) => sourcePointToWorld(point, draft)),
      autoFromWalls: sourceZone.enclosed,
      boundaryWallIds,
      spaceRole: 'room',
      enclosureStatus: sourceZone.enclosed ? 'enclosed' : 'open',
      ceilingHeight: target.levelHeight,
      metadata: {
        ...sourceMetadata(draft, sourceZone.id, sourceZone.featureIds),
        nameSource: sourceZone.nameSource,
      },
    })
    createOps.push({ node: zone, parentId: levelId })
    topLevelIds.push(zone.id)
    addMapping(sourceToNative, sourceZone.id, zone.id)
  }

  for (const sourceItem of draft.items) {
    const catalogItem = catalogItemById(sourceItem.assetId!)
    if (!catalogItem)
      throw new Error(`Catalog item ${sourceItem.assetId ?? '(missing)'} is unresolved.`)
    const [x, z] = sourcePointToWorld(sourceItem.position, draft)
    const sourceWidth = sourceItem.width * metersPerPixel
    const sourceDepth = sourceItem.depth * metersPerPixel

    if (catalogItem.tool === 'cabinet') {
      const run = CabinetNode.parse({
        name: sourceItem.label,
        position: [x, 0, z],
        rotation: sourceItem.rotation,
        width: Math.min(3, sourceWidth),
        depth: sourceDepth,
        metadata: {
          ...sourceMetadata(draft, sourceItem.id, sourceItem.featureIds),
          floorplanCatalogMatch: {
            assetId: catalogItem.id,
            name: catalogItem.name,
            sourceWidth,
            sourceDepth,
            policy: 'native-cabinet-modules-fit-source-run',
          },
        },
      })
      createOps.push({ node: run, parentId: levelId })
      topLevelIds.push(run.id)
      addMapping(sourceToNative, sourceItem.id, run.id)

      const moduleCount = Math.max(1, Math.ceil(sourceWidth / 3))
      const moduleWidth = sourceWidth / moduleCount
      for (let index = 0; index < moduleCount; index += 1) {
        const module = CabinetModuleNode.parse({
          name: moduleCount === 1 ? sourceItem.label : `${sourceItem.label} ${index + 1}`,
          position: [-sourceWidth / 2 + moduleWidth * (index + 0.5), 0.1, 0],
          width: moduleWidth,
          depth: sourceDepth,
          metadata: sourceMetadata(draft, sourceItem.id, sourceItem.featureIds),
        })
        createOps.push({ node: module, parentId: run.id })
        addMapping(sourceToNative, sourceItem.id, module.id)
      }
      continue
    }

    const [assetWidth, , assetDepth] = catalogItem.dimensions!
    const uniformScale = Math.min(sourceWidth / assetWidth, sourceDepth / assetDepth)
    const item = ItemNode.parse({
      name: sourceItem.label,
      position: [x, 0, z],
      rotation: [0, sourceItem.rotation, 0],
      scale: [uniformScale, uniformScale, uniformScale],
      asset: catalogItem,
      metadata: {
        ...sourceMetadata(draft, sourceItem.id, sourceItem.featureIds),
        floorplanFitPolicy: {
          kind: 'uniform-fit-within-source-footprint',
          sourceWidth,
          sourceDepth,
          fittedWidth: assetWidth * uniformScale,
          fittedDepth: assetDepth * uniformScale,
        },
      },
    })
    createOps.push({ node: item, parentId: levelId })
    topLevelIds.push(item.id)
    addMapping(sourceToNative, sourceItem.id, item.id)
  }

  for (const sourceDimension of draft.dimensions) {
    const sourceStartWall = draft.walls.find((wall) => wall.id === sourceDimension.start.wallId)!
    const sourceEndWall = draft.walls.find((wall) => wall.id === sourceDimension.end.wallId)!
    const startWall = nativeWalls.get(sourceDimension.start.wallId)!
    const endWall = nativeWalls.get(sourceDimension.end.wallId)!
    const sourceStartPoint =
      sourceDimension.start.featureId === 'wall:start' ? sourceStartWall.start : sourceStartWall.end
    const sourceEndPoint =
      sourceDimension.end.featureId === 'wall:start' ? sourceEndWall.start : sourceEndWall.end
    const [startX, startZ] = sourcePointToWorld(sourceStartPoint, draft)
    const [endX, endZ] = sourcePointToWorld(sourceEndPoint, draft)
    const baselineStart = sourcePointToWorld(sourceDimension.baseline[0], draft)
    const baselineEnd = sourcePointToWorld(sourceDimension.baseline[1], draft)
    const directionX = baselineEnd[0] - baselineStart[0]
    const directionZ = baselineEnd[1] - baselineStart[1]
    const directionLength = Math.hypot(directionX, directionZ)
    const dimension = ConstructionDimensionNode.parse({
      name: sourceDimension.sourceText,
      anchors: [
        {
          kind: 'feature',
          reference: { nodeId: startWall.id, featureId: sourceDimension.start.featureId },
          fallback: [startX, 0, startZ],
        },
        {
          kind: 'feature',
          reference: { nodeId: endWall.id, featureId: sourceDimension.end.featureId },
          fallback: [endX, 0, endZ],
        },
      ],
      baseline: {
        origin: baselineStart,
        direction: [directionX / directionLength, directionZ / directionLength],
      },
      chainMode: 'point-to-point',
      mode: 'linear',
      datumPolicy: 'centerline',
      metricNotation: 'meters',
      textOverride: null,
      metadata: {
        ...sourceMetadata(draft, sourceDimension.id),
        floorplanSourceDimension: {
          sourceMeters: sourceDimension.sourceMeters,
          sourceText: sourceDimension.sourceText,
          baselinePx: sourceDimension.baseline,
          start: sourceDimension.start,
          end: sourceDimension.end,
        },
      },
    })
    createOps.push({ node: dimension, parentId: levelId })
    topLevelIds.push(dimension.id)
    addMapping(sourceToNative, sourceDimension.id, dimension.id)
  }

  return {
    createOps,
    topLevelIds,
    sourceToNative,
    counts: {
      walls: draft.walls.length,
      openings: draft.openings.length,
      zones: draft.zones.length,
      items: draft.items.length,
      dimensions: draft.dimensions.length,
      surfaces: 1,
    },
  }
}

/**
 * Builds the exact native graph that Apply will submit, without saving the
 * source asset, touching scene/history state, or creating a document. Parent
 * IDs and child lists are materialized on isolated node copies so read-only
 * renderers observe the same hosted-opening and cabinet relationships as the
 * committed graph.
 */
export function prepareFloorplanPreview(
  draftInput: FloorplanDraft,
  target: FloorplanTarget,
): FloorplanPreparedPreview {
  const parsed = floorplanDraftSchema.safeParse(draftInput)
  if (!parsed.success) {
    throw new Error(
      `Cannot preview an invalid floorplan draft: ${parsed.error.issues[0]?.message ?? 'unknown schema error'}`,
    )
  }

  const prepared = buildPreparedImport(parsed.data, target)
  const nodes = materializeNodeGraph(prepared.createOps)

  return {
    nodes,
    topLevelIds: prepared.topLevelIds,
    sourceToNative: Object.fromEntries(
      Object.entries(prepared.sourceToNative).map(([sourceId, nativeIds]) => [
        sourceId,
        [...nativeIds],
      ]),
    ),
    counts: { ...prepared.counts },
  }
}

function buildGuide(
  draft: FloorplanDraft,
  target: FloorplanTarget,
  sourceFile: File,
  assetUrl: string,
  prepared: PreparedImport,
) {
  const metersPerPixel = draft.source.metersPerPixel!
  const centerPx: PlanPoint = [draft.source.width / 2, draft.source.height / 2]
  const [x, z] = sourcePointToWorld(centerPx, draft)
  return GuideNode.parse({
    name: `${draft.source.name || sourceFile.name} source`,
    url: assetUrl,
    position: [x, FLOOR_SURFACE_ELEVATION_METERS + GUIDE_SURFACE_OFFSET_METERS, z],
    rotation: [0, 0, 0],
    scale: (draft.source.width * metersPerPixel) / GUIDE_BASE_WIDTH_METERS,
    opacity: 35,
    scaleReference: {
      start: sourcePointToWorld([0, 0], draft),
      end: sourcePointToWorld([draft.source.width, 0], draft),
      realLengthMeters: draft.source.width * metersPerPixel,
      measuredLengthUnits: draft.source.width * metersPerPixel,
      metersPerUnit: 1,
      label:
        draft.source.scaleSource === 'unknown'
          ? 'Imported floorplan scale'
          : `Floorplan scale (${draft.source.scaleSource})`,
    },
    metadata: {
      floorplanImport: {
        version: 1,
        draftId: draft.id,
        target: {
          levelId: target.levelId,
          buildingId: target.buildingId,
          capturedSceneRevision: target.sceneRevision,
          levelHeight: target.levelHeight,
        },
        source: {
          name: draft.source.name || sourceFile.name,
          page: draft.source.page,
          width: draft.source.width,
          height: draft.source.height,
          metersPerPixel,
          originPx: draft.source.originPx,
          scaleSource: draft.source.scaleSource,
          assetUrl,
        },
        transform: {
          sourceAxes: 'pixel-x-right-y-down',
          nativeAxes: 'level-x-right-z-down',
          translation: [
            -draft.source.originPx[0] * metersPerPixel,
            -draft.source.originPx[1] * metersPerPixel,
          ],
          metersPerPixel,
          yawRadians: 0,
        },
        itemFitPolicy: 'uniform-fit-within-source-footprint',
        sourceToNative: prepared.sourceToNative,
        assumptions: draft.assumptions,
      },
    },
  })
}

function assertApplied(ids: AnyNodeId[], levelId: AnyNodeId): void {
  const nodes = useScene.getState().nodes
  for (const id of ids) {
    const node = nodes[id]
    if (!node) throw new Error(`Native import did not create node ${id}.`)
    if (node.parentId === levelId) continue
    if (!node.parentId || !nodes[node.parentId as AnyNodeId]) {
      throw new Error(`Native import created node ${id} without its expected parent.`)
    }
  }
}

function assertRolledBack(ids: AnyNodeId[]): void {
  const nodes = useScene.getState().nodes
  const survivor = ids.find((id) => nodes[id])
  if (survivor) throw new Error(`Native import rollback left node ${survivor} in the scene.`)
}

export async function applyFloorplanImport({
  draft: draftInput,
  target,
  sourceFile,
  acceptedWarnings,
}: ApplyFloorplanImportInput): Promise<FloorplanImportResult> {
  const parsed = floorplanDraftSchema.safeParse(draftInput)
  if (!parsed.success) {
    throw new Error(
      `Cannot import an invalid floorplan draft: ${parsed.error.issues[0]?.message ?? 'unknown schema error'}`,
    )
  }
  const draft = parsed.data
  const initialIssues = inspectFloorplanImport(draft, target)
  const initialBlocker = initialIssues.find((entry) => entry.severity === 'blocking')
  if (initialBlocker) throw new Error(initialBlocker.message)
  const accepted = new Set(acceptedWarnings)
  const unacceptedWarning = initialIssues.find(
    (entry) => entry.severity === 'warning' && !accepted.has(entry.id),
  )
  if (unacceptedWarning) {
    throw new Error(`Acknowledge this warning before importing: ${unacceptedWarning.message}`)
  }
  if (!sourceFile || sourceFile.size <= 0 || !sourceFile.type.startsWith('image/')) {
    throw new Error('The source guide must be a non-empty raster image file.')
  }

  // Parse and validate every native construction/content node before the only asynchronous side effect.
  const prepared = buildPreparedImport(draft, target)
  const assetUrl = await saveAsset(sourceFile)

  // Saving may outlive cancellation, navigation, or edits. Recheck the bound target after the await.
  const finalIssues = inspectFloorplanImport(draft, target)
  const finalBlocker = finalIssues.find((entry) => entry.severity === 'blocking')
  if (finalBlocker) throw new Error(finalBlocker.message)
  const finalUnacceptedWarning = finalIssues.find(
    (entry) => entry.severity === 'warning' && !accepted.has(entry.id),
  )
  if (finalUnacceptedWarning) {
    throw new Error(`Acknowledge this warning before importing: ${finalUnacceptedWarning.message}`)
  }

  const guide = buildGuide(draft, target, sourceFile, assetUrl, prepared)
  return commitNativeImport(prepared, target, guide)
}

function commitNativeImport(
  prepared: PreparedImport,
  target: FloorplanTarget,
  guide: GuideNode,
): FloorplanImportResult {
  const guideOp: NodeCreateOp = { node: guide, parentId: target.levelId as AnyNodeId }
  const createOps = [...prepared.createOps, guideOp]
  const allIds = createOps.map((entry) => entry.node.id as AnyNodeId)
  const generatedIdCollision = allIds.find((id) => useScene.getState().nodes[id])
  if (generatedIdCollision) {
    throw new Error(`Native import generated an existing scene node ID: ${generatedIdCollision}.`)
  }
  const rollbackRoots = [...prepared.topLevelIds, guide.id]
  const temporalBefore = useScene.temporal.getState()
  const pastStatesBefore = [...temporalBefore.pastStates]
  const futureStatesBefore = [...temporalBefore.futureStates]

  pauseSpaceDetection()
  let commitError: unknown = null
  try {
    runAsSingleSceneHistoryStep(useScene, () => {
      try {
        useScene.getState().applyNodeChanges({ create: createOps })
        assertApplied(allIds, target.levelId as AnyNodeId)
      } catch (error) {
        useScene.getState().applyNodeChanges({ delete: rollbackRoots })
        assertRolledBack(allIds)
        throw error
      }
    })
  } catch (error) {
    commitError = error
  } finally {
    resumeSpaceDetection()
  }

  if (commitError) {
    useScene.temporal.setState({ pastStates: pastStatesBefore, futureStates: futureStatesBefore })
    throw commitError
  }

  return {
    nodeIds: allIds,
    guideId: guide.id,
    counts: prepared.counts,
  }
}

export function prepareFloorplanReconstruction(
  reconstruction: FloorplanReconstruction,
  target: FloorplanTarget,
  placement: FloorplanPlacement,
): FloorplanPreparedPreview {
  const blocker = targetStateIssues(target).find((entry) => entry.severity === 'blocking')
  if (blocker) throw new Error(blocker.message)
  if (
    ![placement.x, placement.z, placement.rotation].every(Number.isFinite) ||
    Math.abs(placement.x) > 10_000 ||
    Math.abs(placement.z) > 10_000
  )
    throw new Error('Floorplan placement must have finite, bounded coordinates.')
  if (reconstruction.wallHeight > target.levelHeight + GEOMETRY_EPSILON)
    throw new Error('The reconstruction is taller than the selected floor.')
  const sourceNodes = parseReconstructionNodes(reconstruction.nodes)
  const { clonedNodes, newLevelId, idMap } = cloneLevelSubtree(
    sourceNodes as Record<AnyNodeId, AnyNode>,
    reconstruction.levelId as AnyNodeId,
  )
  const pivot: PlanPoint = [
    (reconstruction.source.width * reconstruction.source.metersPerPixel) / 2,
    (reconstruction.source.height * reconstruction.source.metersPerPixel) / 2,
  ]
  const nodes: Record<string, AnyNode> = {}
  const topLevelIds: string[] = []
  for (const sourceNode of clonedNodes) {
    if (sourceNode.id === newLevelId) continue
    const direct = sourceNode.parentId === newLevelId
    const node = direct ? placeFloorplanNode(sourceNode, placement, pivot) : sourceNode
    if (direct) {
      node.parentId = target.levelId as AnyNodeId
      topLevelIds.push(node.id)
    }
    if (node.type === 'zone')
      node.boundaryWallIds = node.boundaryWallIds.map((id) => (idMap.get(id) ?? id) as typeof id)
    for (const key of ['nativeMaskPreview', 'floorplanReconstruction']) {
      const metadata = node.metadata[key]
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue
      const data = metadata as Record<string, unknown>
      for (const field of ['zoneId', 'sourceZoneId'])
        if (typeof data[field] === 'string') data[field] = idMap.get(data[field]) ?? data[field]
    }
    node.metadata.floorplanImport = {
      sourceId: reconstruction.source.id,
      sourceSha256: reconstruction.source.sha256,
      placement: { ...placement },
      metersPerPixel: reconstruction.source.metersPerPixel,
      mode: 'prewarmed-replicate-astra',
    }
    nodes[node.id] = node
  }
  return {
    nodes,
    topLevelIds,
    sourceToNative: Object.fromEntries(
      [...idMap].filter(([id]) => id !== reconstruction.levelId).map(([id, next]) => [id, [next]]),
    ),
    counts: { ...reconstruction.counts },
  }
}

export async function applyFloorplanReconstruction(input: {
  reconstruction: FloorplanReconstruction
  target: FloorplanTarget
  placement: FloorplanPlacement
  opacity: number
  signal: AbortSignal
}): Promise<FloorplanImportResult> {
  const { reconstruction, target, placement, opacity, signal } = input
  signal.throwIfAborted()
  const preview = prepareFloorplanReconstruction(reconstruction, target, placement)
  const response = await fetch(reconstruction.source.imageUrl, { signal })
  if (!response.ok) throw new Error('The source image could not be retained with the import.')
  const blob = await response.blob()
  if (!blob.type.startsWith('image/') || !blob.size)
    throw new Error('The source reference must be a raster image.')
  signal.throwIfAborted()
  const assetUrl = await saveAsset(
    new File([blob], `${reconstruction.source.name}.png`, { type: blob.type }),
  )
  signal.throwIfAborted()
  const blocker = targetStateIssues(target).find((entry) => entry.severity === 'blocking')
  if (blocker) throw new Error(blocker.message)
  const width = reconstruction.source.width * reconstruction.source.metersPerPixel
  const depth = reconstruction.source.height * reconstruction.source.metersPerPixel
  const pivot: PlanPoint = [width / 2, depth / 2]
  const guide = GuideNode.parse({
    name: `${reconstruction.source.name} source`,
    url: assetUrl,
    position: [placement.x, 0.015, placement.z],
    rotation: [0, placement.rotation, 0],
    scale: width / GUIDE_BASE_WIDTH_METERS,
    opacity: Math.max(0, Math.min(100, opacity)),
    scaleReference: {
      start: placeFloorplanPoint([0, 0], placement, pivot),
      end: placeFloorplanPoint([width, 0], placement, pivot),
      realLengthMeters: width,
      measuredLengthUnits: width,
      metersPerUnit: 1,
      label: 'Imported floorplan calibration',
    },
    metadata: {
      floorplanImport: {
        sourceId: reconstruction.source.id,
        source: reconstruction.source,
        placement,
        target,
        sourceToNative: preview.sourceToNative,
        mode: 'prewarmed-replicate-astra',
      },
    },
  })
  const prepared: PreparedImport = {
    createOps: Object.values(preview.nodes).map((node) => ({
      node,
      parentId: node.parentId as AnyNodeId,
    })),
    topLevelIds: preview.topLevelIds as AnyNodeId[],
    sourceToNative: preview.sourceToNative,
    counts: preview.counts,
  }
  return commitNativeImport(prepared, target, guide)
}
