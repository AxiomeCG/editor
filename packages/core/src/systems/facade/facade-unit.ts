import { z } from 'zod'

/**
 * A facade unit is the minimal facade: one run from a corner or T-junction to
 * the next. It is a list of modules pinned to the run's two corners, and it
 * carries its own finish, so a saved unit reproduces the whole look.
 *
 * The constraint vocabulary mirrors a design tool's component panel: an anchor
 * across the run, a fixed or stretching size, and — the one addition those
 * tools do not have — a fixed-size repeat that keeps real dimensions and puts
 * the leftover space where the unit says. A repeating module multiplies as one
 * piece, so an opening and its balcony never drift apart. A unit is plain data:
 * it survives a catalog round trip and resolves the same way in every viewer.
 */

/** Smallest opening or module the resolver will place. */
export const FACADE_UNIT_MIN_OPENING = 0.3
/** Gap kept around an existing opening, and between balconies, before a module is skipped. */
export const FACADE_UNIT_CLEARANCE = 0.15
/** Upper bound on one module's repetition, so a bad margin cannot stall the editor. */
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

export const FacadeModuleOpeningSchema = z.object({
  kind: z.enum(['window', 'door']).default('window'),
  /** Used unless the opening stretches across its module. */
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  /** Floor-to-opening distance when anchored to the bottom, mirrored when to the top. */
  sill: z.number().finite().nonnegative().default(0),
  vertical: z.enum(['bottom', 'center', 'top']).default('bottom'),
  widthMode: z.enum(['fixed', 'stretch']).default('fixed'),
  heightMode: z.enum(['fixed', 'stretch']).default('fixed'),
  /** Shift from the module centre, or the inset from both module sides when stretching. */
  offsetX: z.number().finite().default(0),
  /** Shift from the vertical anchor, or the head clearance when stretching. */
  offsetY: z.number().finite().default(0),
})
export type FacadeModuleOpening = z.infer<typeof FacadeModuleOpeningSchema>

export const FacadeModuleBalconySchema = z.object({
  /** Absent means the module's full width. */
  width: z.number().finite().min(MIN_BALCONY_WIDTH).max(12).optional(),
  depth: z.number().finite().min(0.5).max(3).default(1.4),
  railing: z.enum(['slat', 'rail', 'glass']).default('slat'),
  /** Shift from the module centre. */
  offsetX: z.number().finite().default(0),
})
export type FacadeModuleBalcony = z.infer<typeof FacadeModuleBalconySchema>

export const FacadeModuleSchema = z.object({
  /** Stable identity inside the unit; also seeds the keys of what it generates. */
  key: z.string().min(1),
  name: z.string().optional(),
  width: z.number().finite().positive(),
  horizontal: z.enum(['left', 'center', 'right']).default('center'),
  widthMode: z.enum(['fixed', 'stretch', 'repeat']).default('repeat'),
  /** Inset from the anchored corner (fixed), or from both corners (stretch). */
  offsetX: z.number().finite().default(0),
  /** Minimum distance to a corner before the first and last repeat. */
  margin: z.number().finite().nonnegative().default(0.2),
  gap: z.number().finite().nonnegative().default(1),
  /** Where a repeat puts the space its modules do not use. */
  remainder: z.enum(['center', 'gap-stretch', 'edge-align']).default('center'),
  opening: FacadeModuleOpeningSchema.optional(),
  balcony: FacadeModuleBalconySchema.optional(),
})
export type FacadeModule = z.infer<typeof FacadeModuleSchema>
export type FacadeUnitHorizontalAnchor = FacadeModule['horizontal']
export type FacadeUnitVerticalAnchor = FacadeModuleOpening['vertical']
export type FacadeUnitWidthMode = FacadeModule['widthMode']
export type FacadeUnitHeightMode = FacadeModuleOpening['heightMode']
export type FacadeUnitRemainder = FacadeModule['remainder']

export const FacadeUnitSchema = z
  .object({
    version: z.literal(1).default(1),
    name: z.string().min(1),
    /** In precedence order: a later module yields to the space an earlier one took. */
    modules: z.array(FacadeModuleSchema).default([]),
    /** Absent leaves the walls' own finishes in place. */
    appearance: FacadeAppearanceSchema.optional(),
  })
  .refine((unit) => new Set(unit.modules.map((m) => m.key)).size === unit.modules.length, {
    message: 'Each module in a unit needs its own key.',
  })
export type FacadeUnit = z.infer<typeof FacadeUnitSchema>

/** A centred row of 1.4 × 1.6 m windows on a 0.8 m sill, 1 m apart, 0.2 m clear of each corner. */
export const DEFAULT_FACADE_UNIT: FacadeUnit = FacadeUnitSchema.parse({
  name: 'Window bay',
  modules: [
    {
      key: 'window',
      width: 1.4,
      widthMode: 'repeat',
      margin: 0.2,
      gap: 1,
      remainder: 'center',
      opening: { width: 1.4, height: 1.6, sill: 0.8 },
    },
  ],
})

export type FacadeUnitBay = { width: number; height: number }
export type FacadeUnitObstacle = { left: number; right: number; bottom: number; top: number }
export type FacadeOpeningPlacement = FacadeUnitObstacle & {
  kind: FacadeModuleOpening['kind']
  x: number
  y: number
}
export type FacadeBalconyPlacement = {
  left: number
  right: number
  depth: number
  railing: FacadeModuleBalcony['railing']
}
export type FacadeModulePlacement = {
  /** `<module key>:<repeat index>`, stable while the module keeps its place in the rhythm. */
  key: string
  module: string
  left: number
  right: number
  opening?: FacadeOpeningPlacement
  balcony?: FacadeBalconyPlacement
}
export type FacadeUnitResolution = {
  placements: FacadeModulePlacement[]
  /**
   * Module placements dropped because their opening met an existing opening or
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
  bay: FacadeUnitBay,
  obstacles: readonly FacadeUnitObstacle[] = [],
  options: FacadeUnitResolutionOptions = {},
): FacadeUnitResolution {
  const clearance = options.clearance ?? FACADE_UNIT_CLEARANCE
  const maxRepeat = options.maxRepeat ?? FACADE_UNIT_MAX_REPEAT
  if (
    !Number.isFinite(bay.width) ||
    !Number.isFinite(bay.height) ||
    bay.width <= 0 ||
    bay.height <= 0
  )
    throw Error('Use a positive run width and height.')
  if (!Number.isFinite(clearance) || clearance < 0)
    throw Error('Use a non-negative opening clearance.')

  const placements: FacadeModulePlacement[] = []
  const openings: FacadeUnitObstacle[] = []
  const balconies: { left: number; right: number }[] = []
  let skipped = 0

  for (const module of unit.modules) {
    const opening = module.opening
    if (
      opening &&
      (opening.height < FACADE_UNIT_MIN_OPENING ||
        (opening.widthMode === 'fixed' && opening.width < FACADE_UNIT_MIN_OPENING))
    )
      throw Error('Openings must be at least 0.3 m wide and tall.')
    const vertical = opening ? resolveVertical(opening, bay.height) : null
    // A module whose opening cannot fit this storey contributes nothing.
    if (opening && !vertical) continue

    for (const [index, span] of resolveSpans(module, bay.width, maxRepeat).entries()) {
      const placedOpening = opening && vertical ? openingIn(span, opening, vertical) : undefined
      if (opening && !placedOpening) continue
      const balcony = module.balcony ? balconyIn(span, module.balcony, bay.width) : undefined
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
        key: `${module.key}:${index}`,
        module: module.key,
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

function resolveSpans(module: FacadeModule, bayWidth: number, maxRepeat: number): Span[] {
  if (module.widthMode === 'stretch') {
    const width = bayWidth - module.offsetX * 2
    return width < FACADE_UNIT_MIN_OPENING ? [] : [{ left: module.offsetX, width }]
  }
  if (module.widthMode === 'fixed') {
    if (module.width > bayWidth) return []
    const left =
      module.horizontal === 'left'
        ? module.offsetX
        : module.horizontal === 'right'
          ? bayWidth - module.width - module.offsetX
          : (bayWidth - module.width) / 2 + module.offsetX
    return [{ left, width: module.width }]
  }
  return repeatSpans(module, bayWidth, maxRepeat)
}

function repeatSpans(module: FacadeModule, bayWidth: number, maxRepeat: number): Span[] {
  const { margin, gap, width } = module
  const available = bayWidth - margin * 2
  const count = Math.floor((available + gap) / (width + gap))
  if (count < 1) return []
  if (count > maxRepeat)
    throw Error(
      `This run would need more than ${maxRepeat} repeats. Increase their width or spacing.`,
    )
  const total = count * width + (count - 1) * gap
  let step = width + gap
  let start = (bayWidth - total) / 2
  if (module.remainder === 'gap-stretch' && count > 1) {
    step = (available - width) / (count - 1)
    start = margin
  } else if (module.remainder === 'edge-align' && module.horizontal !== 'center') {
    start = module.horizontal === 'right' ? bayWidth - margin - total : margin
  }
  return Array.from({ length: count }, (_, index) => ({ left: start + index * step, width }))
}

function resolveVertical(
  opening: FacadeModuleOpening,
  bayHeight: number,
): { bottom: number; height: number } | null {
  if (opening.heightMode === 'stretch') {
    const height = bayHeight - opening.sill - opening.offsetY
    return height < FACADE_UNIT_MIN_OPENING ? null : { bottom: opening.sill, height }
  }
  const { height } = opening
  const bottom =
    opening.vertical === 'bottom'
      ? opening.sill + opening.offsetY
      : opening.vertical === 'top'
        ? bayHeight - opening.sill - height - opening.offsetY
        : (bayHeight - height) / 2 + opening.offsetY
  if (bottom < -1e-9 || bottom + height > bayHeight + 1e-9) return null
  return { bottom, height }
}

function openingIn(
  span: Span,
  opening: FacadeModuleOpening,
  vertical: { bottom: number; height: number },
): FacadeOpeningPlacement | undefined {
  let left: number
  let width: number
  if (opening.widthMode === 'stretch') {
    width = span.width - opening.offsetX * 2
    if (width < FACADE_UNIT_MIN_OPENING) return undefined
    left = span.left + opening.offsetX
  } else {
    // An opening wider than its module is a design error, not something to overflow.
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
  balcony: FacadeModuleBalcony,
  bayWidth: number,
): FacadeBalconyPlacement | undefined {
  const width = balcony.width ?? span.width
  const centre = span.left + span.width / 2 + balcony.offsetX
  const left = Math.max(0, centre - width / 2)
  const right = Math.min(bayWidth, centre + width / 2)
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
