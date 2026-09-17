import { type AnyNode, type GuideNode, type LevelNode, SlabNode, UnitNode, WallNode, ZoneNode } from '../schema'
import { getStoredLevelHeight } from '../services/storey'
import { planSharedWallSegments } from '../systems/wall/wall-coverage'
import { type BalconyOptions, balconyFromEdge, createBalconyParts, DEFAULT_BALCONY } from './balcony'
import { cleanReferencePoints, imagePointToLevel, type ReferencePoint as PlanPoint } from './reference-transform'
import { strokeFootprint } from './reference-strokes'

export type OutlinePrimitiveKind = 'zone' | 'unit' | 'slab' | 'walls' | 'balcony'

/** Dragging snaps to the storey; exact numeric input only clamps to its bounds. */
export function constrainReferenceHeight(value: number, floorHeight: number, snap = false) {
  if (!Number.isFinite(value) || !Number.isFinite(floorHeight) || floorHeight < 0.02)
    throw Error('Set a valid floor height before extruding.')
  const height = Math.max(0.02, Math.min(floorHeight, value))
  return snap && floorHeight - height <= Math.min(0.06, floorHeight * 0.04) ? floorHeight : height
}

function validatePolygon(points: PlanPoint[], minArea = 0.01) {
  if (
    points.length < 3 ||
    points.length > 1024 ||
    points.some((p) => p.some((v) => !Number.isFinite(v)))
  )
    throw Error('Choose a simple closed outline with 3–1024 corners.')
  const cross = (a: PlanPoint, b: PlanPoint, c: PlanPoint) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const edges = points.map((a, i) => [a, points[(i + 1) % points.length]!] as const)
  if (edges.some(([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.001))
    throw Error('The outline contains a collapsed edge.')
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 2; j < edges.length; j++) {
      if (i === 0 && j === edges.length - 1) continue
      const [a, b] = edges[i]!,
        [c, d] = edges[j]!
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
        throw Error('Self-intersecting outlines cannot become building elements.')
    }
  const area = Math.abs(edges.reduce((sum, [a, b]) => sum + a[0] * b[1] - a[1] * b[0], 0)) / 2
  if (area < minArea) throw Error('The selected outline has no usable area.')
}

export function outlinePrimitiveNodes({
  guide,
  level,
  points,
  holes = [],
  stroke = false,
  outlineId,
  kind,
  name,
  thickness = 0.18,
  height,
  balcony = DEFAULT_BALCONY,
  existingWalls = [],
  contextNodes = {},
}: {
  guide: GuideNode
  level: LevelNode
  points: PlanPoint[]
  holes?: PlanPoint[][]
  stroke?: boolean
  outlineId: string
  kind: OutlinePrimitiveKind
  name: string
  thickness?: number
  height?: number
  balcony?: BalconyOptions
  existingWalls?: readonly WallNode[]
  contextNodes?: Record<string, AnyNode>
}): AnyNode[] {
  const ref = guide.metadata.planReference as
    | { width: number; height: number; assetId?: string; sourceUrl?: string }
    | undefined
  if (
    !ref ||
    !Number.isFinite(ref.width) ||
    !Number.isFinite(ref.height) ||
    !(ref.width > 0 && ref.height > 0) ||
    guide.parentId !== level.id ||
    level.metadata.placeholderSource
  )
    throw Error('Select a reference with image dimensions on an editable floor.')
  if (guide.metadata.requireHumanCalibration === true && !guide.scaleReference)
    throw Error('Human calibration required: pick two points and enter a known length before creating elements.')
  if (!Number.isFinite(guide.scale) || guide.scale <= 0)
    throw Error('Set a positive reference scale.')
  if (kind === 'unit' && (stroke || contextNodes[level.parentId ?? '']?.type !== 'building'))
    throw Error('Choose a closed apartment area on a floor inside a building.')
  const image = { width: Number(ref.width), height: Number(ref.height) }
  const transform = {
    metersPerPixel: (guide.scale * 10) / image.width,
    rotation: guide.rotation[1],
    position: [guide.position[0], guide.position[2]] as PlanPoint,
  }
  let polygon = cleanReferencePoints(points, transform.metersPerPixel, !stroke).map((p) => imagePointToLevel(p, image, transform))
  if (
    !stroke &&
    polygon.length > 1 &&
    Math.hypot(polygon[0]![0] - polygon.at(-1)![0], polygon[0]![1] - polygon.at(-1)![1]) < 0.001
  )
    polygon = polygon.slice(0, -1)
  const centreline = polygon
  if (stroke) {
    if (
      polygon.length < 2 ||
      polygon.length > 1024 ||
      polygon.some((p) => !p.every(Number.isFinite))
    )
      throw Error('Choose a line with 2–1024 points.')
    if (!Number.isFinite(thickness) || thickness < 0.02 || thickness > 1)
      throw Error('Use a thickness between 0.02 and 1 m.')
    if (kind !== 'walls' && kind !== 'balcony') polygon = strokeFootprint(polygon, thickness)
  }
  if (!stroke || (kind !== 'walls' && kind !== 'balcony')) validatePolygon(polygon, 0.000001)
  const cutouts = holes.map((hole) => cleanReferencePoints(hole, transform.metersPerPixel, true).map((p) => imagePointToLevel(p, image, transform)))
  for (const hole of cutouts) validatePolygon(hole, 0.000001)
  if ((kind === 'zone' || kind === 'unit') && cutouts.length)
    throw Error(
      'This contour has cutouts. Use a slab to preserve them; zones do not support holes.',
    )
  const metadata = {
    referenceOutline: {
      guideId: guide.id,
      linked: true,
      assetId: ref.assetId,
      outlineId,
      sourceUrl: ref.sourceUrl,
      conversion: stroke ? 'svg-stroke' : 'polygon-approximation',
      reviewRequired: true,
    },
  }
  if (kind === 'balcony') {
    const footprint = stroke
      ? balconyFromEdge(centreline, balcony.depth, balcony.reverse)
      : { polygon }
    return createBalconyParts({
      level,
      ...footprint,
      holes: cutouts,
      options: balcony,
      walls: existingWalls,
      nodes: contextNodes,
      elevation: height ?? 0,
      metadata,
      name,
    })
  }
  if (kind === 'zone' || kind === 'unit') {
    const zone = ZoneNode.parse({
      parentId: level.id,
      name,
      polygon,
      spaceRole: 'generic',
      autoFromWalls: false,
      metadata,
    })
    return kind === 'zone'
      ? [zone]
      : [zone, UnitNode.parse({ parentId: level.parentId, name, members: [zone.id], metadata })]
  }
  if (!Number.isFinite(thickness) || thickness < 0.02 || thickness > 1)
    throw Error('Use a thickness between 0.02 and 1 m.')
  const floorHeight = getStoredLevelHeight(level)
  const extrusion = constrainReferenceHeight(
    height ?? (kind === 'slab' ? thickness : floorHeight),
    floorHeight,
  )
  if (kind === 'slab')
    return [
      SlabNode.parse({
        parentId: level.id,
        name,
        polygon,
        holes: cutouts,
        elevation: extrusion,
        thickness: extrusion,
        autoFromWalls: false,
        metadata,
      }),
    ]
  if (polygon.length + cutouts.reduce((sum, hole) => sum + hole.length, 0) > 1024)
    throw Error(
      'This outline needs too many wall segments. Start with a zone or slab, then trace the facade panels.',
    )
  return [stroke ? centreline : polygon, ...cutouts].flatMap((loop) =>
    (stroke ? loop.slice(0, -1) : loop).map((a, i) =>
      WallNode.parse({
        parentId: level.id,
        name: `${name} · wall ${i + 1}`,
        start: a,
        end: loop[(i + 1) % loop.length],
        thickness,
        ...(extrusion < floorHeight ? { height: extrusion } : {}),
        supportSlabId: 'ground',
        metadata,
      }),
    ),
  )
}

/** Existing hosts are reused without touching their openings or finishes. */
export function reconcileOutlineWalls(
  walls: WallNode[],
  existing: readonly WallNode[],
  floorHeight: number,
  height?: number,
) {
  const planned = planSharedWallSegments(
    height === undefined ? walls : walls.map((w) => ({ ...w, height })),
    existing,
    floorHeight,
  )
  if (planned.segments.length > 2048) throw Error('Select fewer shapes for this wall batch.')
  return {
    nodes: planned.segments.map(({ wall, start, end, contributors }) => {
      const ref = wall.metadata.referenceOutline as { outlineId: string; outlineIds?: string[] }
      const outlineIds = [
        ...new Set(
          contributors.flatMap((w) => {
            const source = w.metadata.referenceOutline as {
              outlineId: string
              outlineIds?: string[]
            }
            return source.outlineIds ?? [source.outlineId]
          }),
        ),
      ]
      return WallNode.parse({
        ...wall,
        id: undefined,
        start,
        end,
        metadata: { ...wall.metadata, referenceOutline: { ...ref, outlineIds } },
      })
    }),
    reusedWallIds: planned.reusedWallIds,
  }
}

/** Pure preview data. The caller owns the single scene transaction on confirmation. */
function balconyShapeChains<T extends { id: string; points: PlanPoint[]; stroke?: boolean }>(
  shapes: T[],
  tolerance: number,
): T[] {
  const result = shapes.filter((s) => !s.stroke)
  const pending = shapes.filter((s) => s.stroke).map((s) => ({ ...s, points: [...s.points] }))
  const close = (a: PlanPoint, b: PlanPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tolerance
  if (pending.some((s) => s.points.length < 2))
    throw Error('Select edges with at least two points.')
  while (pending.length) {
    const chain = pending.shift()!
    let joined = true
    while (joined) {
      joined = false
      const matches = pending.flatMap((s, i) => {
        const atStart =
          close(chain.points[0]!, s.points[0]!) || close(chain.points[0]!, s.points.at(-1)!)
        const atEnd =
          close(chain.points.at(-1)!, s.points[0]!) || close(chain.points.at(-1)!, s.points.at(-1)!)
        return atStart || atEnd ? [{ s, i, atStart, atEnd }] : []
      })
      if (matches.filter((m) => m.atStart).length > 1 || matches.filter((m) => m.atEnd).length > 1)
        throw Error('These balcony edges branch. Select a single continuous run or an area.')
      const match = matches[0]
      if (match) {
        const other = match.s.points
        if (match.atEnd)
          chain.points.push(
            ...(close(chain.points.at(-1)!, other[0]!) ? other : [...other].reverse()).slice(1),
          )
        else
          chain.points.unshift(
            ...(close(chain.points[0]!, other.at(-1)!) ? other : [...other].reverse()).slice(0, -1),
          )
        chain.id += `+${match.s.id}`
        pending.splice(match.i, 1)
        joined = true
      }
      if (close(chain.points[0]!, chain.points.at(-1)!))
        throw Error(
          'A closed edge loop has no attachment side. Select its area, or leave a run open.',
        )
    }
    result.push(chain)
  }
  return result
}

export function outlineBatchPrimitiveNodes({
  shapes,
  existingWalls = [],
  ...options
}: Omit<Parameters<typeof outlinePrimitiveNodes>[0], 'points' | 'outlineId'> & {
  shapes: { id: string; points: PlanPoint[]; holes?: PlanPoint[][]; stroke?: boolean }[]
  existingWalls?: readonly WallNode[]
}): AnyNode[] {
  if (!shapes.length || shapes.length > 512) throw Error('Select between 1 and 512 shapes.')
  if (new Set(shapes.map((s) => s.id)).size !== shapes.length)
    throw Error('Each shape may only be selected once.')
  const ref = options.guide.metadata.planReference as { width?: number } | undefined
  const metersPerPixel = (options.guide.scale * 10) / Number(ref?.width)
  if (options.kind === 'balcony' && (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0))
    throw Error('Set a positive reference scale.')
  const plannedShapes =
    options.kind === 'balcony' ? balconyShapeChains(shapes, 0.001 / metersPerPixel) : shapes
  const nodes = plannedShapes.flatMap((shape, i) =>
    outlinePrimitiveNodes({
      ...options,
      existingWalls,
      points: shape.points,
      holes: shape.holes,
      stroke: shape.stroke,
      outlineId: shape.id,
      name: shapes.length === 1 ? options.name : `${options.name} ${i + 1}`,
    }),
  )
  if (nodes.length > 2048) throw Error('Select fewer shapes for this wall batch.')
  let result =
    options.kind === 'walls'
      ? reconcileOutlineWalls(nodes as WallNode[], [], getStoredLevelHeight(options.level)).nodes
      : nodes
  if (options.kind === 'walls' && existingWalls.length)
    result = reconcileOutlineWalls(
      result as WallNode[],
      existingWalls,
      getStoredLevelHeight(options.level),
    ).nodes
  if (result.length > 2048) throw Error('Select fewer shapes for this wall batch.')
  return result
}
