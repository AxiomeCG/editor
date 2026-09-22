import { DEFAULT_FACADE_UNIT, type FacadeUnit } from '@pascal-app/core'
import type { FacadeScope } from '@pascal-app/core/building'
import { create } from 'zustand'

type FacadeToolState = {
  /** The unit the tool applies. */
  unit: FacadeUnit
  scope: FacadeScope
  /** The studio edits a copy, so Cancel leaves `unit` untouched. */
  draft: FacadeUnit | null
  selectedModule: string | null
  /** Studio-only test run; never saved with the unit. */
  testWidth: number
  testHeight: number
  setUnit: (unit: FacadeUnit) => void
  setScope: (scope: FacadeScope) => void
  openStudio: () => void
  setDraft: (draft: FacadeUnit) => void
  selectModule: (key: string | null) => void
  setTestSize: (size: { width?: number; height?: number }) => void
  closeStudio: (commit: boolean) => void
}

export const useFacadeTool = create<FacadeToolState>((set, get) => ({
  unit: DEFAULT_FACADE_UNIT,
  scope: 'exterior',
  draft: null,
  selectedModule: null,
  testWidth: 8,
  testHeight: 3,
  setUnit: (unit) => set({ unit }),
  setScope: (scope) => set({ scope }),
  openStudio: () => {
    const { unit } = get()
    set({ draft: unit, selectedModule: unit.modules[0]?.key ?? null })
  },
  setDraft: (draft) => set({ draft }),
  selectModule: (selectedModule) => set({ selectedModule }),
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
