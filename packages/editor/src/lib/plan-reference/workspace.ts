import type { GuideNode, LevelNode } from '@pascal-app/core'
import type {
  BalconyOptions,
  SymbolGrouping,
  OutlinePrimitiveKind,
} from '@pascal-app/core/building'
import { imagePointToLevel, strokeFootprint } from '@pascal-app/core/building'
import {
  alignPlanReferences,
  measuredPlanScale,
  type PlanImage,
  type PlanPoint,
  type PlanSegment,
  type PlanTransform,
} from './calibration'
import type { CalibratedReference, ReferenceImage } from './guides'
import type { ReferenceOutline } from './outlines'
import {
  type PlanSelectionMode,
  type PlanShape,
  planSelectionGeometry,
  pointInPlanPolygon,
} from './selection-geometry'
import { pointSegmentDistance } from './strokes'
import type { TraceOptions } from './vectorize'
import { signedContourArea } from './vectorize'

export type ReferenceStage = 'measure' | 'unit-span' | 'map-span' | 'adjust'
export type WorkspaceBase = { id: string; levelId: LevelNode['id']; originals: GuideNode[] }
export type ReferenceDraft = WorkspaceBase & {
  mode: 'references'
  singleGuideId?: GuideNode['id']
  guidePair?: { targetId: GuideNode['id']; anchorId: GuideNode['id'] }
  stage: ReferenceStage
  plans: ReferenceImage[]
  maps: ReferenceImage[]
  plan: ReferenceImage
  map: ReferenceImage
  dimension: PlanPoint[]
  planEdge: PlanPoint[]
  mapEdge: PlanPoint[]
  meters: number
  planTransform: PlanTransform
  mapTransform: PlanTransform
  baseline: PlanTransform | null
  anchor: PlanPoint
  pickingAnchor: boolean
  opacity: number
}
export type ShapeDraft = WorkspaceBase & {
  mode: 'shapes'
  guide: GuideNode
  image: ReferenceImage
  transform: PlanTransform
  shapes: PlanShape[]
  selectionMode?: PlanSelectionMode
  selected: string[]
  kind: WorkspaceKind
  height: number
  thickness: number
  floorHeight: number
  includeHoles: boolean
  fillAsWall: boolean
  /** Endpoints closer than this (plan metres) close as if they touched. */
  gapTolerance: number
  /**
   * Whitespace regions flood-filled from the plan raster. Kept apart from
   * `shapes`: Areas mode rebuilds faces from shape edges under new ids, so a
   * fill mixed in there would lose its id and bleed its outline into the faces.
   */
  fills?: PlanShape[]
  /** Door/window/prop: one element per cluster of touching shapes (default) or per shape. */
  symbolGrouping?: SymbolGrouping
  /** Prop: the catalog item standing in for each selected symbol. */
  propItemId?: string
  /** Prop: extra quarter turns on top of the long-side alignment (the front is ambiguous). */
  propTurns?: number
  balcony?: BalconyOptions
  traceOptions?: TraceOptions
  vectors?: { svg: string; outlines: ReferenceOutline[]; method: string; options?: TraceOptions }
}
export type PlanWorkspaceDraft = ReferenceDraft | ShapeDraft
/** Catalog props are placed from symbols but are not outline primitives, so core never sees them. */
export type WorkspaceKind = OutlinePrimitiveKind | 'prop'
export { pointInPlanPolygon } from './selection-geometry'

// Stable identity per (faces, fills) pair so memoised previews do not rebuild every render.
const areaCandidates = new WeakMap<PlanShape[], WeakMap<PlanShape[], PlanShape[]>>()
const NO_FILLS: PlanShape[] = []
/**
 * Areas mode offers, next to the faces built from the plan's edges, the plan's
 * stroked paths as they are (walls are usually drawn as one line with a stroke
 * width, which only Source used to expose) and any flood-filled rooms.
 */
export function workspaceShapeCandidates(draft: ShapeDraft) {
  const geometry = planSelectionGeometry(
    draft.shapes,
    draft.selectionMode ?? 'source',
    draft.transform.metersPerPixel,
    draft.gapTolerance ? draft.gapTolerance / draft.transform.metersPerPixel : 0,
  )
  if (draft.selectionMode !== 'areas') return geometry
  const fills = draft.fills ?? NO_FILLS
  let byFills = areaCandidates.get(geometry)
  if (!byFills) areaCandidates.set(geometry, (byFills = new WeakMap()))
  let merged = byFills.get(fills)
  if (!merged) {
    const strokes = draft.shapes.filter((s) => s.stroke && s.boundary !== false)
    merged = strokes.length || fills.length ? [...geometry, ...strokes, ...fills] : geometry
    byFills.set(fills, merged)
  }
  return merged
}
/**
 * Re-anchors an open shapes session on its live guide after the guide moved,
 * rescaled or rotated. Traced shapes are image pixels, so they only still fit
 * when the image keeps its dimensions; otherwise the session must close.
 */
export function followGuide(draft: ShapeDraft, live: GuideNode): ShapeDraft | null {
  let view: ReferenceView
  try {
    view = guideReference(live)
  } catch {
    return null
  }
  if (view.image.width !== draft.image.width || view.image.height !== draft.image.height)
    return null
  // The commit guard compares the scene against `originals`; accepting the
  // live guide here is what lets Create run after the follow.
  return { ...draft, guide: live, image: view.image, transform: view.transform, originals: [live] }
}
export type ReferenceView = {
  image: ReferenceImage
  transform: PlanTransform
  opacity: number
  role: 'floorplan' | 'sitemap'
}
export type PlanHandle = {
  id: 'scale' | 'rotate' | 'anchor' | 'height'
  point: PlanPoint
  height: number
  label: string
}

export function levelPointToImage(
  point: PlanPoint,
  image: PlanImage,
  transform: PlanTransform,
): PlanPoint {
  const x = point[0] - transform.position[0],
    z = point[1] - transform.position[1]
  const c = Math.cos(transform.rotation),
    s = Math.sin(transform.rotation)
  return [
    (x * c - z * s) / transform.metersPerPixel + image.width / 2,
    (x * s + z * c) / transform.metersPerPixel + image.height / 2,
  ]
}

/** The pivot stays in level coordinates while scale or rotation changes. */
export function transformAboutAnchor(
  image: PlanImage,
  transform: PlanTransform,
  anchor: PlanPoint,
  changes: { metersPerPixel?: number; rotation?: number },
): PlanTransform {
  const next = { ...transform, ...changes }
  if (
    !Number.isFinite(next.metersPerPixel) ||
    next.metersPerPixel <= 0 ||
    !Number.isFinite(next.rotation)
  )
    throw Error('Use a positive scale and a finite angle.')
  const before = imagePointToLevel(anchor, image, transform),
    after = imagePointToLevel(anchor, image, next)
  return {
    ...next,
    position: [next.position[0] + before[0] - after[0], next.position[1] + before[1] - after[1]],
  }
}

export function guideReference(guide: GuideNode): ReferenceView {
  const ref = guide.metadata.planReference as Record<string, unknown> | undefined
  if (
    !ref ||
    typeof ref.width !== 'number' ||
    typeof ref.height !== 'number' ||
    !Number.isFinite(ref.width) ||
    !Number.isFinite(ref.height) ||
    !(ref.width > 0 && ref.height > 0)
  )
    throw Error('This reference has no image dimensions.')
  if (!Number.isFinite(guide.scale) || guide.scale <= 0)
    throw Error('Set a positive reference scale.')
  return {
    image: {
      id: String(ref.assetId ?? guide.id),
      name: guide.name ?? 'Plan',
      url: guide.url,
      width: ref.width,
      height: ref.height,
      sourceUrl: typeof ref.sourceUrl === 'string' ? ref.sourceUrl : undefined,
      sharedFrame: typeof ref.sharedFrame === 'string' ? ref.sharedFrame : undefined,
    },
    transform: {
      metersPerPixel: (guide.scale * 10) / ref.width,
      position: [guide.position[0], guide.position[2]],
      rotation: guide.rotation[1],
    },
    opacity: guide.opacity,
    role: ref.role === 'sitemap' ? 'sitemap' : 'floorplan',
  }
}

export function alignReferenceDraft(draft: ReferenceDraft): ReferenceDraft {
  if (draft.singleGuideId) {
    const scale = measuredPlanScale(draft.dimension, draft.meters)
    if (!scale) throw Error('Measure a known length first.')
    const planTransform = transformAboutAnchor(
      draft.plan,
      draft.planTransform,
      draft.dimension[0]!,
      { metersPerPixel: scale },
    )
    return {
      ...draft,
      stage: 'adjust',
      planTransform,
      baseline: planTransform,
      anchor: draft.dimension[0]!,
      pickingAnchor: false,
    }
  }
  const scale =
    draft.guidePair && draft.mapEdge.length === 2 && draft.planEdge.length === 2
      ? measuredPlanScale(
          draft.planEdge,
          Math.hypot(
            draft.mapEdge[1]![0] - draft.mapEdge[0]![0],
            draft.mapEdge[1]![1] - draft.mapEdge[0]![1],
          ) * draft.mapTransform.metersPerPixel,
        )
      : measuredPlanScale(draft.dimension, draft.meters)
  if (!scale || draft.planEdge.length !== 2 || draft.mapEdge.length !== 2)
    throw Error('Pick two endpoints for each reference.')
  const result = alignPlanReferences({
    floorplan: draft.plan,
    sitemap: draft.map,
    metersPerPixel: scale,
    floorplanEdge: draft.planEdge as PlanSegment,
    sitemapEdge: draft.mapEdge as PlanSegment,
  })
  const frame = draft.mapTransform,
    c = Math.cos(frame.rotation),
    s = Math.sin(frame.rotation)
  const [x, z] = result.floorplan.position
  const planTransform: PlanTransform = {
    ...result.floorplan,
    rotation: result.floorplan.rotation + frame.rotation,
    position: [frame.position[0] + x * c + z * s, frame.position[1] - x * s + z * c],
  }
  return {
    ...draft,
    stage: 'adjust',
    planTransform,
    baseline: planTransform,
    mapTransform: { ...frame, metersPerPixel: result.sitemap.metersPerPixel },
    anchor: draft.planEdge[0]!,
    pickingAnchor: false,
  }
}

export function workspaceReferences(draft: PlanWorkspaceDraft): ReferenceView[] {
  if (draft.mode === 'shapes')
    return [{ image: draft.image, transform: draft.transform, role: 'sitemap', opacity: 80 }]
  const plan: ReferenceView = {
    image: draft.plan,
    transform: draft.planTransform,
    role: 'floorplan',
    opacity: draft.stage === 'adjust' ? draft.opacity : 95,
  }
  const map: ReferenceView = {
    image: draft.map,
    transform: draft.mapTransform,
    role: 'sitemap',
    opacity: draft.stage === 'adjust' ? 55 : 95,
  }
  if (draft.singleGuideId) return [plan]
  return draft.stage === 'adjust' ? [map, plan] : draft.stage === 'map-span' ? [map] : [plan]
}

export function activeReferencePoints(draft: ReferenceDraft) {
  return draft.stage === 'measure'
    ? draft.dimension
    : draft.stage === 'map-span'
      ? draft.mapEdge
      : draft.planEdge
}

export function workspaceHandles(draft: PlanWorkspaceDraft): PlanHandle[] {
  if (draft.mode === 'shapes') {
    const points = workspaceShapeCandidates(draft)
      .filter((s) => draft.selected.includes(s.id))
      .flatMap((s) => s.points.map((p) => imagePointToLevel(p, draft.image, draft.transform)))
    if (
      !points.length ||
      draft.kind === 'zone' ||
      draft.kind === 'unit' ||
      draft.kind === 'door' ||
      draft.kind === 'window' ||
      draft.kind === 'prop'
    )
      return []
    const xs = points.map((p) => p[0]),
      zs = points.map((p) => p[1])
    return [
      {
        id: 'height',
        point: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2],
        height: draft.height,
        label: `${draft.kind === 'balcony' ? 'Deck elevation' : 'Height'} · ${draft.height.toFixed(2)} m${draft.height === draft.floorHeight ? ' · Floor' : ''}`,
      },
    ]
  }
  if (draft.stage !== 'adjust') return []
  const at = (p: PlanPoint) => imagePointToLevel(p, draft.plan, draft.planTransform)
  // Choose the corner furthest from the pivot so a corner pivot still has a usable scale handle.
  const corners: PlanPoint[] = [
    [0, 0],
    [draft.plan.width, 0],
    [draft.plan.width, draft.plan.height],
    [0, draft.plan.height],
  ]
  corners.sort(
    (a, b) =>
      Math.hypot(b[0] - draft.anchor[0], b[1] - draft.anchor[1]) -
      Math.hypot(a[0] - draft.anchor[0], a[1] - draft.anchor[1]),
  )
  return [
    { id: 'scale', point: at(corners[0]!), height: 0, label: 'Scale' },
    {
      id: 'rotate',
      point: at([draft.plan.width / 2, -draft.plan.height * 0.08]),
      height: 0,
      label: 'Rotate',
    },
    { id: 'anchor', point: at(draft.anchor), height: 0, label: 'Anchor' },
  ]
}

export function referenceDraftInputs(draft: ReferenceDraft): CalibratedReference[] {
  if (draft.singleGuideId || draft.guidePair) {
    if (draft.stage !== 'adjust' || !draft.baseline)
      throw Error('Complete the plan measurements first.')
    const target = draft.originals.find(
      (g) => g.id === (draft.singleGuideId ?? draft.guidePair!.targetId),
    )!
    const previous = { ...(target.metadata.planReference as Record<string, unknown>) }
    const calibration = draft.guidePair
      ? {
          method: 'matched-span',
          alignment: {
            anchorGuideId: draft.guidePair.anchorId,
            targetGuideId: target.id,
            anchorEdge: draft.mapEdge,
            targetEdge: draft.planEdge,
            anchorTransform: draft.mapTransform,
          },
        }
      : {
          method: 'known-length',
          knownDimension: { points: draft.dimension, meters: draft.meters },
        }
    return [
      {
        image: draft.plan,
        levelId: draft.levelId,
        transform: draft.planTransform,
        segment: (draft.singleGuideId ? draft.dimension : draft.planEdge) as PlanSegment,
        role: guideReference(target).role,
        calibration: {
          ...previous,
          ...calibration,
          baselineTransform: draft.baseline,
          metersPerPixel: draft.planTransform.metersPerPixel,
          manualCorrection: {
            scaleFactor: draft.planTransform.metersPerPixel / draft.baseline.metersPerPixel,
            anchor: draft.anchor,
          },
        },
      },
    ]
  }
  const scale = measuredPlanScale(draft.dimension, draft.meters)
  if (
    draft.stage !== 'adjust' ||
    !scale ||
    !draft.baseline ||
    draft.planEdge.length !== 2 ||
    draft.mapEdge.length !== 2
  )
    throw Error('Complete the reference measurements first.')
  const calibration = {
    knownDimension: { points: draft.dimension, meters: draft.meters },
    measuredMetersPerPixel: scale,
    floorplanEdge: draft.planEdge,
    sitemapEdge: draft.mapEdge,
    matchedFloorplanId: draft.plan.id,
    matchedSitemapId: draft.map.id,
  }
  return [
    {
      image: draft.map,
      levelId: draft.levelId,
      transform: draft.mapTransform,
      segment: draft.mapEdge as PlanSegment,
      role: 'sitemap',
      calibration: { ...calibration, metersPerPixel: draft.mapTransform.metersPerPixel },
    },
    {
      image: draft.plan,
      levelId: draft.levelId,
      transform: draft.planTransform,
      segment: draft.planEdge as PlanSegment,
      role: 'floorplan',
      calibration: {
        ...calibration,
        metersPerPixel: draft.planTransform.metersPerPixel,
        baselineTransform: draft.baseline,
        manualCorrection: {
          scaleFactor: draft.planTransform.metersPerPixel / scale,
          anchor: draft.anchor,
        },
      },
    },
  ]
}

/** Screen-space tolerance keeps narrow strokes pickable at any zoom in either viewport. */
export function planShapeHits(
  draft: ShapeDraft,
  pixel: PlanPoint,
  screen: PlanPoint,
  project: (p: PlanPoint, height: number) => PlanPoint | null,
) {
  const at = (p: PlanPoint) => project(imagePointToLevel(p, draft.image, draft.transform), 0)
  const edgeDistance = (s: PlanShape) => {
    const a = at(s.points[0]!),
      b = at(s.points[1]!)
    return a && b ? pointSegmentDistance(screen, a, b) : Infinity
  }
  return workspaceShapeCandidates(draft)
    .filter((s) => {
      if (
        s.stroke &&
        pointInPlanPolygon(
          pixel,
          strokeFootprint(
            s.points,
            Math.max(s.strokeWidth ?? 1, draft.thickness / draft.transform.metersPerPixel),
          ),
        )
      )
        return true
      if (
        !s.stroke &&
        pointInPlanPolygon(pixel, s.points) &&
        (!draft.includeHoles || !s.holes.some((h) => pointInPlanPolygon(pixel, h)))
      )
        return true
      const loops = s.stroke ? [s.points] : [s.points, ...(draft.includeHoles ? s.holes : [])]
      return loops.some((points) =>
        points.some((p, i) => {
          if (s.stroke && i === points.length - 1) return false
          const a = at(p),
            b = at(points[(i + 1) % points.length]!)
          return a && b && pointSegmentDistance(screen, a, b) <= (s.stroke ? 6 : 3)
        }),
      )
    })
    .sort(
      (a, b) =>
        (draft.selectionMode === 'edges' ? edgeDistance(a) - edgeDistance(b) : 0) ||
        Number(!!b.stroke) - Number(!!a.stroke) ||
        Math.abs(signedContourArea(a.points)) - Math.abs(signedContourArea(b.points)),
    )
}
