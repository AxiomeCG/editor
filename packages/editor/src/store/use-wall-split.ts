'use client'

import {
  getWallCurveLength,
  planWallDivision,
  runAsSingleSceneHistoryStep,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { create } from 'zustand'
import { type WallSplitPreview, wallSplitPreview } from '../lib/wall-split-preview'
import useEditor from './use-editor'
import useInteractionScope from './use-interaction-scope'

type SplitDraft = {
  wallId: WallNode['id']
  input: 'pointer' | 'distance'
  preview: WallSplitPreview
}
const ownsSplit = () => {
  const scope = useInteractionScope.getState().scope
  return scope.kind === 'drafting' && scope.tool === 'wall-split'
}

/** Transient cut preview only; the existing topology planner owns the committed edit. */
export const useWallSplit = create<{
  draft: SplitDraft | null
  open: (wall: WallNode) => void
  update: (distance: number, input?: SplitDraft['input']) => void
  pick: () => void
  close: () => void
  commit: () => void
}>((set, get) => ({
  draft: null,
  open: (wall) => {
    if (useScene.getState().readOnly) return
    useEditor.getState().setMode('select')
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'wall-split' })
    set({
      draft: {
        wallId: wall.id,
        input: 'pointer',
        preview: wallSplitPreview(useScene.getState().nodes, wall, getWallCurveLength(wall) / 2),
      },
    })
  },
  update: (distance, input) => {
    const draft = get().draft
    if (!draft || !ownsSplit()) return
    const { nodes } = useScene.getState()
    const wall = nodes[draft.wallId]
    if (wall?.type !== 'wall') return get().close()
    set({
      draft: {
        ...draft,
        input: input ?? draft.input,
        preview: wallSplitPreview(nodes, wall, distance),
      },
    })
  },
  pick: () => {
    const draft = get().draft
    if (draft) set({ draft: { ...draft, input: 'pointer' } })
  },
  close: () => {
    set({ draft: null })
    useInteractionScope
      .getState()
      .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'wall-split')
  },
  commit: () => {
    const draft = get().draft
    const current = useScene.getState()
    if (!draft || current.readOnly || !ownsSplit()) return
    const wall = current.nodes[draft.wallId]
    if (wall?.type !== 'wall') return get().close()
    const preview = wallSplitPreview(current.nodes, wall, draft.preview.distance)
    if (!preview.valid) return set({ draft: { ...draft, preview } })
    const plan = planWallDivision(current.nodes, wall.id, preview.distance)
    runAsSingleSceneHistoryStep(useScene, () => current.applyNodeChanges(plan.changes))
    get().close()
  },
}))
