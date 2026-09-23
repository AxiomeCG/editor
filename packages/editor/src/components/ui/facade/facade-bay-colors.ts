import type { FacadeUnit } from '@pascal-app/core'

/** One colour per bay, in list order, shared by the elevation, the bay list and the 3D view. */
export const BAY_COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb923c'] as const

export const bayColor = (unit: FacadeUnit, key: string) =>
  BAY_COLORS[Math.max(0, unit.bays.findIndex((bay) => bay.key === key)) % BAY_COLORS.length]!
