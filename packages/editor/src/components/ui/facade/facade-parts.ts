import { bayCladdingRects, type FacadeBay, type FacadeBayPlacement } from '@pascal-app/core'

/** The parts of a bay the side panel has a section for. */
export type BayPart = 'layout' | 'opening' | 'panels' | 'spandrel' | 'balcony'

/** A balcony reads as clicked up to its railing. */
const BALCONY_HEIGHT = 1.1

/**
 * Which part of a placed bay a point falls on, in wall metres (`up` from the
 * floor): the opening, a side panel, a spandrel, the balcony in front, or the
 * bay itself. Clicking in the drawing opens the matching section.
 */
export function partAt(
  bay: FacadeBay,
  placement: FacadeBayPlacement,
  runHeight: number,
  x: number,
  up: number,
): BayPart {
  const { opening, balcony } = placement
  if (balcony && x >= balcony.left && x <= balcony.right && up <= BALCONY_HEIGHT) return 'balcony'
  if (opening && x >= opening.left && x <= opening.right && up >= opening.bottom && up <= opening.top)
    return 'opening'
  for (const rect of bayCladdingRects(bay, placement, runHeight))
    if (x >= rect.left && x <= rect.right && up >= rect.bottom && up <= rect.top)
      return rect.part.startsWith('infill') ? 'panels' : 'spandrel'
  return 'layout'
}

/** The sections a bay shows, in panel order: layout always, then the parts it has. */
export function bayParts(bay: FacadeBay): BayPart[] {
  return [
    'layout',
    ...(bay.opening ? (['opening'] as const) : []),
    ...(bay.infill ? (['panels'] as const) : []),
    ...(bay.opening && bay.spandrel ? (['spandrel'] as const) : []),
    ...(bay.balcony ? (['balcony'] as const) : []),
  ]
}
