'use client'

import { create } from 'zustand'
import type {
  FloorplanPlacement,
  FloorplanReconstruction,
  FloorplanReconstructionSource,
} from '../lib/floorplan-import/curated'
import type { FloorplanTarget } from '../lib/floorplan-import/native'
import useInteractionScope from './use-interaction-scope'

interface FloorplanImportPlacementState {
  owner: string | null
  target: FloorplanTarget | null
  source: FloorplanReconstructionSource | null
  reconstruction: FloorplanReconstruction | null
  placement: FloorplanPlacement
  opacity: number
  revision: number
  animate: boolean
  committing: boolean
  claim(owner: string, source: FloorplanReconstructionSource, target: FloorplanTarget | null): void
  show(owner: string, reconstruction: FloorplanReconstruction, animate: boolean): void
  setScale(owner: string, metersPerPixel: number): void
  move(owner: string, placement: Partial<FloorplanPlacement>): void
  setOpacity(owner: string, opacity: number): void
  setCommitting(owner: string, committing: boolean): void
  release(owner: string): void
}

export const useFloorplanImportPlacement = create<FloorplanImportPlacementState>((set, get) => ({
  owner: null,
  target: null,
  source: null,
  reconstruction: null,
  placement: { x: 0, z: 0, rotation: 0 },
  opacity: 35,
  revision: 0,
  animate: false,
  committing: false,
  claim(owner, source, target) {
    const previous = get().owner
    if (previous)
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'handle-drag' && scope.nodeId === previous)
    set((state) => ({
      owner,
      source,
      target,
      reconstruction: null,
      placement: { x: 0, z: 0, rotation: 0 },
      opacity: 35,
      revision: state.revision + 1,
      animate: false,
      committing: false,
    }))
  },
  show(owner, reconstruction, animate) {
    if (get().owner !== owner) return
    set((state) => ({
      reconstruction,
      source: reconstruction.source,
      revision: state.revision + 1,
      animate,
    }))
  },
  setScale(owner, metersPerPixel) {
    const state = get()
    if (
      state.owner !== owner ||
      state.committing ||
      !state.source ||
      state.source.metersPerPixel === metersPerPixel
    )
      return
    set({
      source: { ...state.source, metersPerPixel },
      reconstruction: null,
      revision: state.revision + 1,
    })
  },
  move(owner, placement) {
    if (get().owner === owner && !get().committing)
      set((state) => ({ placement: { ...state.placement, ...placement } }))
  },
  setOpacity(owner, opacity) {
    if (get().owner === owner && !get().committing)
      set({ opacity: Math.max(0, Math.min(100, opacity)) })
  },
  setCommitting(owner, committing) {
    if (get().owner !== owner) return
    if (committing)
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'handle-drag' && scope.nodeId === owner)
    set({ committing })
  },
  release(owner) {
    if (get().owner !== owner) return
    useInteractionScope
      .getState()
      .endIf((scope) => scope.kind === 'handle-drag' && scope.nodeId === owner)
    set({ owner: null, target: null, source: null, reconstruction: null, committing: false })
  },
}))
