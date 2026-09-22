import { z } from 'zod'

/**
 * A facade unit is the minimal facade: one run from a corner or T-junction to
 * the next. It is a list of bays pinned to the run's two corners, and it
 * carries its own finish, so a saved unit reproduces the whole look.
 *
 * The constraint vocabulary mirrors a design tool's component panel: an anchor
 * across the run, a fixed or stretching size, and — the one addition those
 * tools do not have — a fixed-size repeat that keeps real dimensions and puts
 * the leftover space where the unit says. A repeating bay multiplies as one
 * piece, so an opening and its balcony never drift apart. A unit is plain data:
 * it survives a catalog round trip and resolves the same way in every viewer.
 */

/** Smallest opening or bay the resolver will place. */
export const FACADE_UNIT_MIN_OPENING = 0.3
/** Gap kept around an existing opening, and between balconies, before a bay is skipped. */
export const FACADE_UNIT_CLEARANCE = 0.15
/** Upper bound on one bay's repetition, so a thin end pier cannot stall the editor. */
export const FACADE_UNIT_MAX_REPEAT = 96
const MIN_BALCONY_WIDTH = 0.6

export const FACADE_FINISHES = [
  'brick',
  'stone',
  'plaster',
  'siding',
  'timber',
  'glass',
  'metal',
] as const
export type FacadeFinish = (typeof FACADE_FINISHES)[number]

const HexColor = z.string().regex(/^#[0-9a-f]{6}$/i)

export const FacadeAppearanceSchema = z.object({
  finish: z.enum(FACADE_FINISHES),
  wall: HexColor,
  trim: HexColor,
})
export type FacadeAppearance = z.infer<typeof FacadeAppearanceSchema>

export const FacadeBayOpeningSchema = z.object({
  kind: z.enum(['window', 'door']).default('window'),
  /** Used unless the opening stretches across its bay. */
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  /** Floor-to-opening distance when anchored to the bottom, mirrored when to the top. */
  sill: z.number().finite().nonnegative().default(0),
  vertical: z.enum(['bottom', 'center', 'top']).default('bottom'),
  widthMode: z.enum(['fixed', 'stretch']).default('fixed'),
  heightMode: z.enum(['fixed', 'stretch']).default('fixed'),
  /** Shift from the bay centre, or the inset from both bay sides when stretching. */
  offsetX: z.number().finite().default(0),
  /** Shift from the vertical anchor, or the head clearance when stretching. */
  offsetY: z.number().finite().default(0),
})
export type FacadeBayOpening = z.infer<typeof FacadeBayOpeningSchema>

export const FacadeBayBalconySchema = z.object({
  /** Absent means the bay's full width. */
  width: z.number().finite().min(MIN_BALCONY_WIDTH).max(12).optional(),
  depth: z.number().finite().min(0.5).max(3).default(1.4),
  railing: z.enum(['slat', 'rail', 'glass']).default('slat'),
  /** Shift from the bay centre. */
  offsetX: z.number().finite().default(0),
})
export type FacadeBayBalcony = z.infer<typeof FacadeBayBalconySchema>

export const FacadeBaySchema = z.object({
  /** Stable identity inside the unit; also seeds the keys of what it generates. */
  key: z.string().min(1),
  name: z.string().optional(),
  width: z.number().finite().positive(),
  horizontal: z.enum(['left', 'center', 'right']).default('center'),
  widthMode: z.enum(['fixed', 'stretch', 'repeat']).default('repeat'),
  /** Inset from the anchored corner (fixed), or from both corners (stretch). */
  offsetX: z.number().finite().default(0),
  /** The pier kept at each end of the run, before the first and after the last repeat. */
  endPier: z.number().finite().nonnegative().default(0.2),
  pier: z.number().finite().nonnegative().default(1),
  /** Where a repeat puts the space its bays do not use. */
  remainder: z.enum(['center', 'widen-piers', 'align-to-anchor']).default('center'),
  opening: FacadeBayOpeningSchema.optional(),
  balcony: FacadeBayBalconySchema.optional(),
})
export type FacadeBay = z.infer<typeof FacadeBaySchema>
export type FacadeUnitHorizontalAnchor = FacadeBay['horizontal']
export type FacadeUnitVerticalAnchor = FacadeBayOpening['vertical']
export type FacadeUnitWidthMode = FacadeBay['widthMode']
export type FacadeUnitHeightMode = FacadeBayOpening['heightMode']
export type FacadeUnitRemainder = FacadeBay['remainder']

export const FacadeUnitSchema = z
  .object({
    version: z.literal(1).default(1),
    name: z.string().min(1),
    /** In precedence order: a later bay yields to the space an earlier one took. */
    bays: z.array(FacadeBaySchema).default([]),
    /** Absent leaves the walls' own finishes in place. */
    appearance: FacadeAppearanceSchema.optional(),
  })
  .refine((unit) => new Set(unit.bays.map((m) => m.key)).size === unit.bays.length, {
    message: 'Each bay in a unit needs its own key.',
  })
export type FacadeUnit = z.infer<typeof FacadeUnitSchema>

/** A centred row of 1.4 × 1.6 m windows on a 0.8 m sill, 1 m apart, 0.2 m clear of each corner. */
export const DEFAULT_FACADE_UNIT: FacadeUnit = FacadeUnitSchema.parse({
  name: 'Window bay',
  bays: [
    {
      key: 'window',
      width: 1.4,
      widthMode: 'repeat',
      endPier: 0.2,
      pier: 1,
      remainder: 'center',
      opening: { width: 1.4, height: 1.6, sill: 0.8 },
    },
  ],
})

export type FacadeUnitRun = { width: number; height: number }
export type FacadeUnitObstacle = { left: number; right: number; bottom: number; top: number }
export type FacadeOpeningPlacement = FacadeUnitObstacle & {
  kind: FacadeBayOpening['kind']
  x: number
  y: number
}
export type FacadeBalconyPlacement = {
  left: number
  right: number
  depth: number
  railing: FacadeBayBalcony['railing']
}
export type FacadeBayPlacement = {
  /** `<bay key>:<repeat index>`, stable while the bay keeps its place in the rhythm. */
  key: string
  bay: string
  left: number
  right: number
  opening?: FacadeOpeningPlacement
  balcony?: FacadeBalconyPlacement
}
export type FacadeUnitResolution = {
  placements: FacadeBayPlacement[]
  /**
   * Bay placements dropped because their opening met an existing opening or
   * an earlier one from this unit, or their balcony met an earlier balcony.
   */
  skipped: number
}
export type FacadeUnitResolutionOptions = { clearance?: number; maxRepeat?: number }

type Span = { left: number; width: number }

/**
 * Resolve a unit across one run. Pure and deterministic: the same unit, run
 * and obstacles always produce the same placements, so a facade re-resolves
 * identically after a resize, a floor change or a reload.
 */
export function resolveFacadeUnit(
  unit: FacadeUnit,
  run: FacadeUnitRun,
  obstacles: readonly FacadeUnitObstacle[] = [],
  options: FacadeUnitResolutionOptions = {},
): FacadeUnitResolution {
  const clearance = options.clearance ?? FACADE_UNIT_CLEARANCE
  const maxRepeat = options.maxRepeat ?? FACADE_UNIT_MAX_REPEAT
  if (
    !Number.isFinite(run.width) ||
    !Number.isFinite(run.height) ||
    run.width <= 0 ||
    run.height <= 0
  )
    throw Error('Use a positive run width and height.')
  if (!Number.isFinite(clearance) || clearance < 0)
    throw Error('Use a non-negative opening clearance.')

  const placements: FacadeBayPlacement[] = []
  const openings: FacadeUnitObstacle[] = []
  const balconies: { left: number; right: number }[] = []
  let skipped = 0

  for (const bay of unit.bays) {
    const opening = bay.opening
    if (
      opening &&
      (opening.height < FACADE_UNIT_MIN_OPENING ||
        (opening.widthMode === 'fixed' && opening.width < FACADE_UNIT_MIN_OPENING))
    )
      throw Error('Openings must be at least 0.3 m wide and tall.')
    const vertical = opening ? resolveVertical(opening, run.height) : null
    // A bay whose opening cannot fit this storey contributes nothing.
    if (opening && !vertical) continue

    for (const [index, span] of resolveSpans(bay, run.width, maxRepeat).entries()) {
      const placedOpening = opening && vertical ? openingIn(span, opening, vertical) : undefined
      if (opening && !placedOpening) continue
      const balcony = bay.balcony ? balconyIn(span, bay.balcony, run.width) : undefined
      if (
        (placedOpening &&
          (overlaps(placedOpening, obstacles, clearance) ||
            overlaps(placedOpening, openings, clearance))) ||
        (balcony &&
          balconies.some(
            (b) => balcony.left < b.right + clearance && balcony.right > b.left - clearance,
          ))
      ) {
        skipped++
        continue
      }
      placements.push({
        key: `${bay.key}:${index}`,
        bay: bay.key,
        left: span.left,
        right: span.left + span.width,
        ...(placedOpening ? { opening: placedOpening } : {}),
        ...(balcony ? { balcony } : {}),
      })
      if (placedOpening) openings.push(placedOpening)
      if (balcony) balconies.push(balcony)
    }
  }

  return { placements, skipped }
}

function resolveSpans(bay: FacadeBay, runWidth: number, maxRepeat: number): Span[] {
  if (bay.widthMode === 'stretch') {
    const width = runWidth - bay.offsetX * 2
    return width < FACADE_UNIT_MIN_OPENING ? [] : [{ left: bay.offsetX, width }]
  }
  if (bay.widthMode === 'fixed') {
    if (bay.width > runWidth) return []
    const left =
      bay.horizontal === 'left'
        ? bay.offsetX
        : bay.horizontal === 'right'
          ? runWidth - bay.width - bay.offsetX
          : (runWidth - bay.width) / 2 + bay.offsetX
    return [{ left, width: bay.width }]
  }
  return repeatSpans(bay, runWidth, maxRepeat)
}

function repeatSpans(bay: FacadeBay, runWidth: number, maxRepeat: number): Span[] {
  const { endPier, pier, width } = bay
  const available = runWidth - endPier * 2
  const count = Math.floor((available + pier) / (width + pier))
  if (count < 1) return []
  if (count > maxRepeat)
    throw Error(
      `This run would need more than ${maxRepeat} repeats. Increase their width or spacing.`,
    )
  const total = count * width + (count - 1) * pier
  let step = width + pier
  let start = (runWidth - total) / 2
  if (bay.remainder === 'widen-piers' && count > 1) {
    step = (available - width) / (count - 1)
    start = endPier
  } else if (bay.remainder === 'align-to-anchor' && bay.horizontal !== 'center') {
    start = bay.horizontal === 'right' ? runWidth - endPier - total : endPier
  }
  return Array.from({ length: count }, (_, index) => ({ left: start + index * step, width }))
}

function resolveVertical(
  opening: FacadeBayOpening,
  runHeight: number,
): { bottom: number; height: number } | null {
  if (opening.heightMode === 'stretch') {
    const height = runHeight - opening.sill - opening.offsetY
    return height < FACADE_UNIT_MIN_OPENING ? null : { bottom: opening.sill, height }
  }
  const { height } = opening
  const bottom =
    opening.vertical === 'bottom'
      ? opening.sill + opening.offsetY
      : opening.vertical === 'top'
        ? runHeight - opening.sill - height - opening.offsetY
        : (runHeight - height) / 2 + opening.offsetY
  if (bottom < -1e-9 || bottom + height > runHeight + 1e-9) return null
  return { bottom, height }
}

function openingIn(
  span: Span,
  opening: FacadeBayOpening,
  vertical: { bottom: number; height: number },
): FacadeOpeningPlacement | undefined {
  let left: number
  let width: number
  if (opening.widthMode === 'stretch') {
    width = span.width - opening.offsetX * 2
    if (width < FACADE_UNIT_MIN_OPENING) return undefined
    left = span.left + opening.offsetX
  } else {
    // An opening wider than its bay is a design error, not something to overflow.
    if (opening.width > span.width + 1e-9) return undefined
    width = opening.width
    left = span.left + (span.width - width) / 2 + opening.offsetX
  }
  return {
    kind: opening.kind,
    left,
    right: left + width,
    bottom: vertical.bottom,
    top: vertical.bottom + vertical.height,
    x: left + width / 2,
    y: vertical.bottom + vertical.height / 2,
  }
}

/** Balconies stay inside the run: a deck reaching past a corner would pierce the next wall. */
function balconyIn(
  span: Span,
  balcony: FacadeBayBalcony,
  runWidth: number,
): FacadeBalconyPlacement | undefined {
  const width = balcony.width ?? span.width
  const centre = span.left + span.width / 2 + balcony.offsetX
  const left = Math.max(0, centre - width / 2)
  const right = Math.min(runWidth, centre + width / 2)
  if (right - left < MIN_BALCONY_WIDTH) return undefined
  return { left, right, depth: balcony.depth, railing: balcony.railing }
}

function overlaps(
  rect: FacadeUnitObstacle,
  obstacles: readonly FacadeUnitObstacle[],
  clearance: number,
): boolean {
  return obstacles.some(
    (obstacle) =>
      rect.left < obstacle.right + clearance &&
      rect.right > obstacle.left - clearance &&
      rect.bottom < obstacle.top + clearance &&
      rect.top > obstacle.bottom - clearance,
  )
}
