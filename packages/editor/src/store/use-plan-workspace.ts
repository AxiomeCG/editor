'use client'

import { constrainReferenceHeight, outlineBatchPrimitiveNodes } from '@pascal-app/core/building'

import {
  type AnyNodeId,
  type GuideNode,
  getStoredLevelHeight,
  type LevelNode,
  runAsSingleSceneHistoryStep,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'
import { balconyElevation, DEFAULT_BALCONY } from '@pascal-app/core/building'
import {
  measuredPlanScale,
  type PlanPoint,
  type PlanSegment,
  type PlanTransform,
} from '../lib/plan-reference/calibration'
import {
  buildReferenceGuide,
  prepareReferenceGuides,
  type ReferenceImage,
} from '../lib/plan-reference/guides'
import { getPlanMatchAnchors, guideReferenceDraft } from '../lib/plan-reference/matching'
import { type ReferenceOutline, sampleReferenceOutline } from '../lib/plan-reference/outlines'
import {
  type PlanSelectionMode,
  planSelectionGeometry,
} from '../lib/plan-reference/selection-geometry'
import {
  activeReferencePoints,
  alignReferenceDraft,
  guideReference,
  type PlanWorkspaceDraft,
  type ReferenceStage,
  referenceDraftInputs,
  transformAboutAnchor,
  workspaceShapeCandidates,
} from '../lib/plan-reference/workspace'
import useEditor from './use-editor'
import useInteractionScope from './use-interaction-scope'
import { useRepeatTools } from './use-repeat-tools'

export const PLAN_WORKSPACE_TOOL = 'plan-workspace'
export function ownsPlanWorkspace() {
  const scope = useInteractionScope.getState().scope
  return (
    (scope.kind === 'drafting' && scope.tool === PLAN_WORKSPACE_TOOL) ||
    (scope.kind === 'handle-drag' && scope.handle.startsWith('plan-workspace:'))
  )
}
export function resumePlanWorkspace() {
  useInteractionScope.getState().begin({ kind: 'drafting', tool: PLAN_WORKSPACE_TOOL })
}
const initialTransform = (image: ReferenceImage, width: number): PlanTransform => ({
  metersPerPixel: width / image.width,
  rotation: 0,
  position: [0, 0],
})
const segment = (value: unknown): value is PlanSegment =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))

type WorkspaceState = {
  draft: PlanWorkspaceDraft | null
  hover: PlanPoint | null
  error: string
  message: string
  focusRevision: number
  previousGuides: boolean
  openGuide: (level: LevelNode, target: GuideNode, anchor?: GuideNode) => void
  openReferences: (
    level: LevelNode,
    plans: ReferenceImage[],
    maps: ReferenceImage[],
    mapId?: string,
    planId?: string,
  ) => void
  openShapes: (
    level: LevelNode,
    guide: GuideNode,
    outlines: ReferenceOutline[],
    selectionMode?: PlanSelectionMode,
  ) => void
  setSelectionMode: (mode: PlanSelectionMode) => void
  openVectorize: (level: LevelNode, guide: GuideNode) => void
  keepVectors: () => void
  change: (fn: (draft: PlanWorkspaceDraft) => PlanWorkspaceDraft) => void
  chooseImage: (role: 'floorplan' | 'sitemap', image: ReferenceImage) => void
  setStage: (stage: ReferenceStage) => void
  pick: (point: PlanPoint) => void
  correct: (value: { scale?: number; rotation?: number }) => void
  focus: () => void
  close: (saved?: boolean) => void
  commit: () => void
}

export const usePlanWorkspace = create<WorkspaceState>((set, get) => {
  const begin = (draft: PlanWorkspaceDraft) => {
    const scene = useScene.getState(),
      level = scene.nodes[draft.levelId]
    if (
      scene.readOnly ||
      level?.type !== 'level' ||
      level.metadata.placeholderSource ||
      useViewer.getState().selection.levelId !== draft.levelId ||
      useEditor.getState().captureMode.mode !== 'idle'
    )
      return
    if (draft.mode === 'shapes') workspaceShapeCandidates(draft)
    if (get().draft) get().close()
    useRepeatTools.getState().close()
    useEditor.getState().setMode('select')
    useViewer.getState().setSelection({ selectedIds: [] })
    const previousGuides = useViewer.getState().showGuides
    // Hide the saved guide presentation; the session renders transient planes in both viewports.
    useViewer.getState().setShowGuides(false)
    resumePlanWorkspace()
    set({
      draft,
      hover: null,
      error: '',
      message: '',
      previousGuides,
      focusRevision: get().focusRevision + 1,
    })
  }
  return {
    draft: null,
    hover: null,
    error: '',
    message: '',
    focusRevision: 0,
    previousGuides: true,
    openGuide: (level, target, anchor) => {
      try {
        begin(guideReferenceDraft(level, target, useScene.getState().nodes, anchor))
      } catch (e) {
        set({ error: e instanceof Error ? e.message : 'Unable to align these plans.' })
      }
    },
    openReferences: (level, plans, maps, mapId, planId) => {
      if (level.metadata.placeholderSource || !plans.length || !maps.length) return
      const originals = Object.values(useScene.getState().nodes).filter(
        (n): n is GuideNode => n.type === 'guide' && n.parentId === level.id,
      )
      const existingMap = originals.find(
        (g) => (g.metadata.planReference as { role?: string })?.role === 'sitemap',
      )
      const existingPlan = originals.find(
        (g) =>
          (g.metadata.planReference as { role?: string })?.role === 'floorplan' &&
          (!planId || (g.metadata.planReference as { assetId?: string })?.assetId === planId),
      )
      const planView = existingPlan ? guideReference(existingPlan) : null,
        mapView = existingMap ? guideReference(existingMap) : null
      const plan = planView?.image ?? plans.find((p) => p.id === planId) ?? plans[0]!
      const map =
        mapView && (!mapId || mapView.image.id === mapId)
          ? mapView.image
          : (maps.find((m) => m.id === mapId) ?? maps[0]!)
      const data = existingPlan?.metadata.planReference as Record<string, unknown> | undefined
      const known = data?.knownDimension as { points?: unknown; meters?: number } | undefined
      const canAdjust =
        !!existingPlan?.scaleReference &&
        !!existingMap?.scaleReference &&
        data?.matchedSitemapId === map.id &&
        segment(known?.points) &&
        Number.isFinite(known?.meters) &&
        segment(data?.floorplanEdge) &&
        segment(data?.sitemapEdge)
      const planTransform = planView?.transform ?? initialTransform(plan, 20)
      const correction = data?.manualCorrection as { anchor?: PlanPoint } | undefined
      begin({
        id: crypto.randomUUID(),
        levelId: level.id,
        originals,
        mode: 'references',
        plans,
        maps,
        plan,
        map,
        stage: canAdjust ? 'adjust' : 'measure',
        dimension: canAdjust ? (known!.points as PlanSegment) : [],
        planEdge: canAdjust ? (data!.floorplanEdge as PlanSegment) : [],
        mapEdge: canAdjust ? (data!.sitemapEdge as PlanSegment) : [],
        meters: canAdjust ? known!.meters! : 0,
        planTransform,
        mapTransform: mapView?.image.id === map.id ? mapView.transform : initialTransform(map, 80),
        baseline: canAdjust
          ? ((data?.baselineTransform as PlanTransform | undefined) ?? {
              ...planTransform,
              metersPerPixel: measuredPlanScale(known!.points as PlanSegment, known!.meters!)!,
            })
          : null,
        anchor: correction?.anchor ?? [plan.width / 2, plan.height / 2],
        pickingAnchor: false,
        opacity: existingPlan?.opacity ?? 65,
      })
    },
    openShapes: (level, guide, outlines, selectionMode = 'source') => {
      try {
        if (level.metadata.placeholderSource || guide.parentId !== level.id)
          throw Error('Select a reference on an editable floor.')
        const view = guideReference(guide)
        const floorHeight = getStoredLevelHeight(level)
        begin({
          id: crypto.randomUUID(),
          mode: 'shapes',
          levelId: level.id,
          originals: [guide],
          guide,
          image: view.image,
          transform: view.transform,
          selectionMode,
          shapes: outlines.map((o) => ({
            id: o.id,
            stroke: o.type === 'Stroke',
            strokeWidth: o.strokeWidth,
            boundary: o.boundary,
            points: sampleReferenceOutline(o, view.transform.metersPerPixel),
            holes: (o.holes ?? []).map((points) =>
              sampleReferenceOutline(
                { id: o.id, type: 'Polygon', points },
                view.transform.metersPerPixel,
              ),
            ),
          })),
          selected: [],
          includeHoles: true,
          fillAsWall: false,
          kind: 'walls',
          height: constrainReferenceHeight(floorHeight, floorHeight),
          thickness: 0.18,
          floorHeight,
        })
      } catch (e) {
        set({ error: e instanceof Error ? e.message : 'Unable to read these shapes.' })
      }
    },
    setSelectionMode: (selectionMode) => {
      const draft = get().draft
      if (draft?.mode !== 'shapes' || draft.selectionMode === selectionMode) return
      try {
        planSelectionGeometry(draft.shapes, selectionMode, draft.transform.metersPerPixel)
        get().change((d) => (d.mode === 'shapes' ? { ...d, selectionMode, selected: [] } : d))
      } catch (e) {
        set({ error: e instanceof Error ? e.message : 'Unable to read these boundaries.' })
      }
    },
    openVectorize: (level, guide) => {
      get().openShapes(level, guide, [])
      get().change((d) =>
        d.mode === 'shapes' && d.guide.id === guide.id && d.levelId === level.id
          ? {
              ...d,
              kind: 'slab',
              height: Math.min(0.18, d.floorHeight),
              traceOptions: { threshold: 145, minArea: 80, mode: 'ink' },
            }
          : d,
      )
    },
    keepVectors: () => {
      const draft = get().draft,
        scene = useScene.getState()
      if (draft?.mode !== 'shapes' || !draft.vectors || scene.readOnly || !ownsPlanWorkspace())
        return
      if (JSON.stringify(scene.nodes[draft.guide.id]) !== JSON.stringify(draft.guide))
        return set({ error: 'This reference changed. Cancel and reopen it before saving.' })
      const vectorGuide = vectorizedGuide(draft.guide, draft.vectors)
      runAsSingleSceneHistoryStep(useScene, () => scene.updateNode(draft.guide.id, vectorGuide))
      get().close(true)
    },
    change: (fn) => {
      const draft = get().draft
      if (!draft || !ownsPlanWorkspace()) return
      try {
        const next = fn(draft)
        if (next.mode === 'shapes') workspaceShapeCandidates(next)
        set({ draft: next, error: '' })
      } catch (e) {
        set({ error: e instanceof Error ? e.message : 'Unable to read these boundaries.' })
      }
    },
    chooseImage: (role, image) => {
      get().change((d) =>
        d.mode !== 'references'
          ? d
          : role === 'floorplan'
            ? {
                ...d,
                plan: image,
                dimension: [],
                planEdge: [],
                baseline: null,
                stage: 'measure',
                planTransform: initialTransform(image, 20),
                anchor: [image.width / 2, image.height / 2],
              }
            : {
                ...d,
                map: image,
                mapEdge: [],
                baseline: null,
                stage: d.stage === 'adjust' ? 'map-span' : d.stage,
                mapTransform: initialTransform(image, 80),
              },
      )
      set({ hover: null })
      get().focus()
    },
    setStage: (stage) => {
      const d = get().draft
      if (d?.mode !== 'references') return
      try {
        if (!d.guidePair && stage !== 'measure' && !measuredPlanScale(d.dimension, d.meters))
          throw Error('Pick a known length and enter its measurement.')
        if (!d.guidePair && stage === 'map-span' && d.planEdge.length !== 2)
          throw Error('Pick the matching span on the unit plan.')
        get().change(() =>
          stage === 'adjust' ? alignReferenceDraft(d) : { ...d, stage, pickingAnchor: false },
        )
        set({ hover: null })
        get().focus()
      } catch (e) {
        set({ error: e instanceof Error ? e.message : 'Unable to align these references.' })
      }
    },
    pick: (point) =>
      get().change((d) => {
        if (d.mode !== 'references') return d
        if (d.stage === 'adjust')
          return d.pickingAnchor ? { ...d, anchor: point, pickingAnchor: false } : d
        const current = activeReferencePoints(d),
          points = current.length === 1 ? [current[0]!, point] : [point]
        return {
          ...d,
          [d.stage === 'measure' ? 'dimension' : d.stage === 'map-span' ? 'mapEdge' : 'planEdge']:
            points,
        }
      }),
    correct: ({ scale, rotation }) =>
      get().change((d) => {
        if (d.mode !== 'references' || !d.baseline) return d
        return {
          ...d,
          planTransform: transformAboutAnchor(d.plan, d.planTransform, d.anchor, {
            ...(scale !== undefined
              ? { metersPerPixel: d.baseline.metersPerPixel * Math.max(0.25, Math.min(4, scale)) }
              : {}),
            ...(rotation !== undefined ? { rotation } : {}),
          }),
        }
      }),
    focus: () => set({ focusRevision: get().focusRevision + 1 }),
    close: (saved = false) => {
      if (!get().draft) return
      set({ draft: null, hover: null, error: '', message: '' })
      useViewer.getState().setShowGuides(saved || get().previousGuides)
      useInteractionScope
        .getState()
        .endIf(
          (s) =>
            (s.kind === 'drafting' && s.tool === PLAN_WORKSPACE_TOOL) ||
            (s.kind === 'handle-drag' && s.handle.startsWith('plan-workspace:')),
        )
    },
    commit: () => {
      const draft = get().draft,
        scene = useScene.getState()
      if (!draft || scene.readOnly || !ownsPlanWorkspace()) return
      try {
        const level = scene.nodes[draft.levelId]
        if (level?.type !== 'level' || level.metadata.placeholderSource)
          throw Error('Choose an editable floor.')
        for (const original of draft.originals)
          if (JSON.stringify(scene.nodes[original.id]) !== JSON.stringify(original))
            throw Error(
              'A reference changed while this tool was open. Cancel and reopen it to use the latest version.',
            )
        if (draft.mode === 'references' && (draft.singleGuideId || draft.guidePair)) {
          const targetId = draft.singleGuideId ?? draft.guidePair!.targetId
          const previous = scene.nodes[targetId] as GuideNode
          if (
            draft.guidePair &&
            !getPlanMatchAnchors(previous, scene.nodes).some(
              (anchor) => anchor.id === draft.guidePair!.anchorId,
            )
          )
            throw Error('The reference must still belong to the same building. Reopen Match.')
          const input = referenceDraftInputs(draft)[0]!
          const node = buildReferenceGuide(input, previous)
          node.position[1] = previous.position[1]
          node.opacity = draft.opacity
          runAsSingleSceneHistoryStep(useScene, () =>
            useScene.getState().updateNode(targetId, node),
          )
          useEditor.getState().setGuideLocked(targetId, true)
        } else if (draft.mode === 'references') {
          const batch = prepareReferenceGuides(referenceDraftInputs(draft), scene.nodes, {
            replaceSitemap: true,
          })
          runAsSingleSceneHistoryStep(useScene, () => {
            const updates = batch
              .filter((b) => b.exists)
              .map((b) => ({
                id: b.node.id,
                data: {
                  ...b.node,
                  visible: true,
                  ...(b.node.metadata.planReference &&
                  (b.node.metadata.planReference as { role: string }).role === 'floorplan'
                    ? { opacity: draft.opacity }
                    : {}),
                },
              }))
            if (updates.length) useScene.getState().updateNodes(updates)
            const creates = batch
              .filter((b) => !b.exists)
              .map((b) => ({
                node: {
                  ...b.node,
                  visible: true,
                  ...((b.node.metadata.planReference as { role: string }).role === 'floorplan'
                    ? { opacity: draft.opacity }
                    : {}),
                },
                parentId: draft.levelId as AnyNodeId,
              }))
            if (creates.length) useScene.getState().createNodes(creates)
          })
          for (const b of batch) useEditor.getState().setGuideLocked(b.node.id, true)
        } else {
          const created = outlineBatchPrimitiveNodes({
            guide: draft.guide,
            level,
            shapes: workspaceShapeCandidates(draft)
              .filter((s) => draft.selected.includes(s.id))
              .map((s) => ({
                ...s,
                // The fill-as-wall reading needs the inner contours: they are
                // what makes a band a band, not extra walls to outline.
                holes: draft.fillAsWall || draft.includeHoles ? s.holes : [],
              })),
            kind: draft.kind,
            fillAsWall: draft.fillAsWall,
            height:
              draft.kind === 'balcony'
                ? balconyElevation(
                    draft.height,
                    getStoredLevelHeight(level),
                    draft.balcony ?? DEFAULT_BALCONY,
                  )
                : constrainReferenceHeight(draft.height, getStoredLevelHeight(level)),
            balcony: draft.balcony,
            thickness: draft.thickness,
            contextNodes: scene.nodes,
            existingWalls: Object.values(scene.nodes).filter(
              (n): n is WallNode => n.type === 'wall' && n.parentId === level.id,
            ),
            name:
              draft.kind === 'walls'
                ? 'Plan outline'
                : draft.kind === 'slab'
                  ? 'Plan slab'
                  : draft.kind === 'balcony'
                    ? 'Plan balcony'
                    : draft.kind === 'unit'
                      ? 'Apartment'
                      : 'Plan zone',
          })
          if (!created.length)
            throw Error('These walls already exist. Select another outline or cancel.')
          runAsSingleSceneHistoryStep(useScene, () => {
            if (draft.vectors)
              useScene
                .getState()
                .updateNode(draft.guide.id, vectorizedGuide(draft.guide, draft.vectors))
            useScene
              .getState()
              .createNodes(
                created.map((node) => ({
                  node,
                  parentId: (node.parentId ?? level.id) as AnyNodeId,
                })),
              )
            const focusedId = useViewer.getState().focusedUnitId
            const unit = focusedId ? useScene.getState().nodes[focusedId] : undefined
            if (
              draft.kind === 'zone' &&
              unit?.type === 'unit' &&
              unit.parentId === level.parentId
            ) {
              useScene.getState().updateNode(unit.id, {
                members: [
                  ...unit.members,
                  ...created.filter((n) => n.type === 'zone').map((n) => n.id),
                ],
              })
            }
          })
          const savedGuide = useScene.getState().nodes[draft.guide.id] as GuideNode
          const count =
            draft.kind === 'balcony'
              ? created.filter((n) => n.type === 'slab').length
              : draft.kind === 'unit'
                ? created.filter((n) => n.type === 'unit').length
                : created.length
          set({
            draft: {
              ...draft,
              guide: savedGuide,
              originals: [savedGuide],
              selected: [],
              traceOptions: undefined,
              vectors: undefined,
            },
            hover: null,
            error: '',
            message: `${count} ${draft.kind === 'balcony' ? (count === 1 ? 'balcony' : 'balconies') : draft.kind === 'unit' ? (count === 1 ? 'unit' : 'units') : 'elements'} created. Select more shapes or choose Done.`,
          })
          return
        }
        get().close(true)
      } catch (e) {
        set({ error: e instanceof Error ? e.message : 'This edit could not be saved.' })
      }
    },
  }
})

function vectorizedGuide(
  guide: GuideNode,
  vectors: NonNullable<import('../lib/plan-reference/workspace').ShapeDraft['vectors']>,
): GuideNode {
  const previous = guide.metadata.planVectors as { originalUrl?: string } | undefined
  return {
    ...guide,
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(vectors.svg)}`,
    metadata: {
      ...guide.metadata,
      planVectors: { ...vectors, originalUrl: previous?.originalUrl ?? guide.url },
    },
  }
}
