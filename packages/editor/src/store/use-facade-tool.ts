import { DEFAULT_FACADE_UNIT, type FacadeUnit } from '@pascal-app/core'
import type { FacadeScope } from '@pascal-app/core/building'
import { create } from 'zustand'

export type FacadeStudioView = '3d' | '2d' | 'split'

type FacadeToolState = {
  /** The unit the tool applies. */
  unit: FacadeUnit
  scope: FacadeScope
  /** The studio edits a copy, so Cancel leaves `unit` untouched. */
  draft: FacadeUnit | null
  selectedBay: string | null
  /** Studio-only test run; never saved with the unit. */
  testWidth: number
  testHeight: number
  studioView: FacadeStudioView
  setStudioView: (view: FacadeStudioView) => void
  setUnit: (unit: FacadeUnit) => void
  setScope: (scope: FacadeScope) => void
  openStudio: () => void
  setDraft: (draft: FacadeUnit) => void
  selectBay: (key: string | null) => void
  setTestSize: (size: { width?: number; height?: number }) => void
  closeStudio: (commit: boolean) => void
}

export const useFacadeTool = create<FacadeToolState>((set, get) => ({
  unit: DEFAULT_FACADE_UNIT,
  scope: 'exterior',
  draft: null,
  selectedBay: null,
  testWidth: 8,
  testHeight: 3,
  studioView: 'split',
  setStudioView: (studioView) => set({ studioView }),
  setUnit: (unit) => set({ unit }),
  setScope: (scope) => set({ scope }),
  openStudio: () => {
    const { unit } = get()
    set({ draft: unit, selectedBay: unit.bays[0]?.key ?? null })
  },
  setDraft: (draft) => set({ draft }),
  selectBay: (selectedBay) => set({ selectedBay }),
  setTestSize: ({ width, height }) =>
    set((state) => ({
      testWidth: width ?? state.testWidth,
      testHeight: height ?? state.testHeight,
    })),
  closeStudio: (commit) => {
    const { draft } = get()
    set({ draft: null, ...(commit && draft ? { unit: draft } : {}) })
  },
}))
