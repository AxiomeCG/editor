import { DEFAULT_FACADE_UNIT, type FacadeUnit } from '@pascal-app/core'
import type { FacadeScope } from '@pascal-app/core/building'
import { create } from 'zustand'

export type FacadeStudioView = '3d' | '2d' | 'split'
/** What the studio tests the unit against: one run, interior walls meeting it, or several widths. */
export type FacadeStudioScenario = 'run' | 'partitions' | 'widths'

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
  scenario: FacadeStudioScenario
  setScenario: (scenario: FacadeStudioScenario) => void
  /** Interior walls meeting the test run, in metres from its left corner. */
  partitions: number[]
  setPartitions: (partitions: number[]) => void
  /** The apply button is hovered or focused: the viewers ghost what it would do. */
  previewing: boolean
  setPreviewing: (previewing: boolean) => void
  /** The bay under the pointer in any studio view, highlighted in all of them. */
  hoveredBay: string | null
  setHoveredBay: (key: string | null) => void
  /** Keep every bay's extent drawn on the 3D facade, not only the hovered one. */
  showBays: boolean
  setShowBays: (show: boolean) => void
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
  scenario: 'run',
  setScenario: (scenario) => set({ scenario }),
  partitions: [],
  setPartitions: (partitions) => set({ partitions }),
  previewing: false,
  setPreviewing: (previewing) => set({ previewing }),
  hoveredBay: null,
  setHoveredBay: (hoveredBay) => set({ hoveredBay }),
  showBays: false,
  setShowBays: (showBays) => set({ showBays }),
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
