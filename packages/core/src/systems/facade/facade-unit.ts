import { z } from 'zod'

/**
 * A facade unit is one authored wall bay's worth of openings plus the
 * constraints that decide where they land when that bay is a different size.
 *
 * The constraint vocabulary mirrors a design tool's component panel: an anchor
 * per axis, a fixed or stretching size, and — the one addition those tools do
 * not have — a fixed-size repeat that keeps real opening dimensions and absorbs
 * the leftover space in the gaps. A unit is plain data, so it survives a
 * catalog round trip and resolves the same way in every viewer.
 */

/** Smallest opening the resolver will place, matching the authored facade tool. */
export const FACADE_UNIT_MIN_OPENING = 0.3
/** Gap left around an existing opening before a generated one is skipped. */
export const FACADE_UNIT_CLEARANCE = 0.15
/** Upper bound on one opening's repetition, so a bad margin cannot stall the editor. */
export const FACADE_UNIT_MAX_REPEAT = 96

export const FacadeUnitOpeningSchema = z.object({
  /** Stable identity of the opening inside the unit; also seeds placement keys. */
  key: z.string().min(1),
  kind: z.enum(['window', 'door']).default('window'),
  /** Real dimension used unless the matching axis is set to stretch. */
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  /** Floor-to-opening distance when the vertical anchor is `bottom`, mirrored when `top`. */
  sill: z.number().finite().nonnegative().default(0),
  horizontal: z.enum(['left', 'center', 'right']).default('center'),
  vertical: z.enum(['bottom', 'center', 'top']).default('bottom'),
  widthMode: z.enum(['fixed', 'stretch', 'repeat']).default('repeat'),
  heightMode: z.enum(['fixed', 'stretch']).default('fixed'),
  /** Inset from the horizontal anchor (fixed), or from both bay ends (stretch). */
  offsetX: z.number().finite().default(0),
  /** Inset from the vertical anchor, or the head clearance when stretching. */
  offsetY: z.number().finite().default(0),
  /** Minimum distance to a bay boundary before the first and last repeat. */
  margin: z.number().finite().nonnegative().default(0.2),
  gap: z.number().finite().nonnegative().default(1),
  /** Where the repeat puts the space the openings do not use. */
  remainder: z.enum(['center', 'gap-stretch', 'edge-align']).default('center'),
})

export type FacadeUnitOpening = z.infer<typeof FacadeUnitOpeningSchema>
export type FacadeUnitHorizontalAnchor = FacadeUnitOpening['horizontal']
export type FacadeUnitVerticalAnchor = FacadeUnitOpening['vertical']
export type FacadeUnitWidthMode = FacadeUnitOpening['widthMode']
export type FacadeUnitHeightMode = FacadeUnitOpening['heightMode']
export type FacadeUnitRemainder = FacadeUnitOpening['remainder']

export const FacadeUnitSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().min(1),
  openings: z.array(FacadeUnitOpeningSchema).default([]),
})

export type FacadeUnit = z.infer<typeof FacadeUnitSchema>

/**
 * The recipe the authored facade tool uses today, expressed as a unit: a
 * centered row of fixed 1.4 x 1.6 windows, 0.8 m sill, 1 m gap and 0.2 m to
 * each bay boundary.
 */
export const DEFAULT_FACADE_UNIT: FacadeUnit = FacadeUnitSchema.parse({
  name: 'Window bay',
  openings: [
    {
      key: 'window',
      width: 1.4,
      height: 1.6,
      sill: 0.8,
      horizontal: 'center',
      vertical: 'bottom',
      widthMode: 'repeat',
      margin: 0.2,
      gap: 1,
      remainder: 'center',
    },
  ],
})

export type FacadeUnitBay = { width: number; height: number }
export type FacadeUnitObstacle = { left: number; right: number; bottom: number; top: number }
export type FacadeUnitPlacement = {
  key: string
  kind: FacadeUnitOpening['kind']
  left: number
  right: number
  bottom: number
  top: number
  x: number
  y: number
}
export type FacadeUnitResolution = {
  placements: FacadeUnitPlacement[]
  /**
   * Openings dropped because another opening already occupies that space — an
   * existing wall opening, or an earlier opening in the same unit.
   */
  skipped: number
}
export type FacadeUnitResolutionOptions = { clearance?: number; maxRepeat?: number }

type Span = { left: number; width: number }

/**
 * Resolve a unit inside one bay. Pure and deterministic: the same unit, bay and
 * obstacles always produce the same placements, so a facade re-resolves
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
  if (!Number.isFinite(bay.width) || !Number.isFinite(bay.height) || bay.width <= 0 || bay.height <= 0)
    throw Error('Use a positive bay width and height.')
  if (!Number.isFinite(clearance) || clearance < 0)
    throw Error('Use a non-negative opening clearance.')

  const placements: FacadeUnitPlacement[] = []
  const occupied: FacadeUnitObstacle[] = []
  let skipped = 0

  for (const opening of unit.openings) {
    if (opening.width < FACADE_UNIT_MIN_OPENING || opening.height < FACADE_UNIT_MIN_OPENING)
      throw Error('Use positive dimensions and leave at least 0.15 m around openings.')
    const spans = resolveSpans(opening, bay.width, maxRepeat)
    const vertical = resolveVertical(opening, bay.height)
    // An opening that cannot fit contributes nothing, matching the authored tool.
    if (!vertical) continue
    for (const [index, span] of spans.entries()) {
      const placement: FacadeUnitPlacement = {
        key: `u:${opening.key}:${index}`,
        kind: opening.kind,
        left: span.left,
        right: span.left + span.width,
        bottom: vertical.bottom,
        top: vertical.bottom + vertical.height,
        x: span.left + span.width / 2,
        y: vertical.bottom + vertical.height / 2,
      }
      if (overlapsObstacle(placement, obstacles, clearance) || overlapsObstacle(placement, occupied, clearance)) {
        skipped++
        continue
      }
      placements.push(placement)
      occupied.push(placement)
    }
  }

  return { placements, skipped }
}

function resolveSpans(opening: FacadeUnitOpening, bayWidth: number, maxRepeat: number): Span[] {
  if (opening.widthMode === 'stretch') {
    const width = bayWidth - opening.offsetX * 2
    if (width < FACADE_UNIT_MIN_OPENING) return []
    return [{ left: opening.offsetX, width }]
  }
  if (opening.widthMode === 'fixed') {
    if (opening.width > bayWidth) return []
    const left =
      opening.horizontal === 'left'
        ? opening.offsetX
        : opening.horizontal === 'right'
          ? bayWidth - opening.width - opening.offsetX
          : (bayWidth - opening.width) / 2 + opening.offsetX
    return [{ left, width: opening.width }]
  }
  return repeatSpans(opening, bayWidth, maxRepeat)
}

function repeatSpans(opening: FacadeUnitOpening, bayWidth: number, maxRepeat: number): Span[] {
  const { margin, gap, width } = opening
  const available = bayWidth - margin * 2
  const count = Math.floor((available + gap) / (width + gap))
  if (count < 1) return []
  if (count > maxRepeat)
    throw Error(`This wall would need more than ${maxRepeat} windows. Increase their width or spacing.`)
  const total = count * width + (count - 1) * gap
  let step = width + gap
  let start = (bayWidth - total) / 2
  if (opening.remainder === 'gap-stretch' && count > 1) {
    step = (available - width) / (count - 1)
    start = margin
  } else if (opening.remainder === 'edge-align' && opening.horizontal !== 'center') {
    start = opening.horizontal === 'right' ? bayWidth - margin - total : margin
  }
  return Array.from({ length: count }, (_, index) => ({ left: start + index * step, width }))
}

function resolveVertical(
  opening: FacadeUnitOpening,
  bayHeight: number,
): { bottom: number; height: number } | null {
  if (opening.heightMode === 'stretch') {
    const height = bayHeight - opening.sill - opening.offsetY
    if (height < FACADE_UNIT_MIN_OPENING) return null
    return { bottom: opening.sill, height }
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

function overlapsObstacle(
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
