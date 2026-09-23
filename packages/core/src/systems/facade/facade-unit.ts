import { z } from 'zod'
import { DoorType } from '../../schema/nodes/door'
import { WindowType } from '../../schema/nodes/window'

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

/** A paint reference, as on any node slot: `library:<id>` or `scene:<id>`. */
const MaterialRef = z.string().regex(/^(library|scene):.+/)

/** What the unit paints on the walls and openings it fills; an absent entry keeps theirs. */
export const FacadePaintSchema = z.object({
  /** The filled face of the wall. */
  wall: MaterialRef.optional(),
  /** Window and door frames, and door leaves. */
  frame: MaterialRef.optional(),
})
export type FacadePaint = z.infer<typeof FacadePaintSchema>

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
  /** How a window opens. */
  windowType: WindowType.default('casement'),
  /** Pane grid of a window: equal columns (mullions) and rows (transoms). */
  columns: z.number().int().min(1).max(6).default(1),
  rows: z.number().int().min(1).max(4).default(1),
  /** How a door opens. French: glazed leaves, two when the opening is wide enough. */
  doorType: DoorType.default('french'),
})
export type FacadeBayOpening = z.infer<typeof FacadeBayOpeningSchema>
export type FacadeOpeningStyle = Pick<
  FacadeBayOpening,
  'windowType' | 'columns' | 'rows' | 'doorType'
>

export const FacadeBayBalconySchema = z.object({
  /** Absent means the bay's full width. */
  width: z.number().finite().min(MIN_BALCONY_WIDTH).max(12).optional(),
  depth: z.number().finite().min(0.5).max(3).default(1.4),
  railing: z.enum(['slat', 'rail', 'glass']).default('slat'),
  /**
   * One balcony per bay, or one continuous balcony (a *balcon filant*) from the
   * first repeat to the last.
   */
  span: z.enum(['bay', 'continuous']).default('bay'),
  deckMaterial: MaterialRef.optional(),
  /** Posts and rails; a glass railing keeps its glass. */
  railingMaterial: MaterialRef.optional(),
  /** Shift from the bay centre. */
  offsetX: z.number().finite().default(0),
})
export type FacadeBayBalcony = z.infer<typeof FacadeBayBalconySchema>

/** Cladding panels a bay lays out around its opening: their paint and how they sit on the face. */
export const FacadeCladdingSchema = z.object({
  material: MaterialRef,
  /** Panel depth. */
  thickness: z.number().finite().min(0.005).max(0.5).default(0.03),
  /** Gap between the wall face and the panel; positive stands it proud. */
  standoff: z.number().finite().min(0).max(1).default(0),
})
export type FacadeCladding = z.infer<typeof FacadeCladdingSchema>

export const FacadeInfillSchema = FacadeCladdingSchema.extend({
  /** Which sides of the opening are clad. */
  sides: z.enum(['both', 'left', 'right']).default('both'),
  /** Width of each side panel from the opening; absent fills to the bay's edge. */
  width: z.number().finite().min(0.05).max(6).optional(),
  /** Floor to ceiling, or only as tall as the opening beside it. */
  height: z.enum(['storey', 'opening']).default('storey'),
})
export type FacadeInfill = z.infer<typeof FacadeInfillSchema>

export const FacadeSpandrelSchema = FacadeCladdingSchema.extend({
  /** Below the opening, above it, or both. */
  parts: z.enum(['both', 'below', 'above']).default('both'),
})
export type FacadeSpandrel = z.infer<typeof FacadeSpandrelSchema>

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
  /**
   * `locked`: the bay is `width` wide and its infill fills beside the opening.
   * `content`: the bay hugs its children like CSS `fit-content` — infill, opening,
   * infill laid side by side — so a wider panel pushes the bay and the run re-flows.
   */
  fit: z.enum(['locked', 'content']).default('locked'),
  opening: FacadeBayOpeningSchema.optional(),
  balcony: FacadeBayBalconySchema.optional(),
  /** Beside the opening, floor to ceiling; the whole bay when it has no opening. */
  infill: FacadeInfillSchema.optional(),
  /** Below and above the opening, across its width. */
  spandrel: FacadeSpandrelSchema.optional(),
})
export type FacadeBay = z.infer<typeof FacadeBaySchema>

/** Infill beside each side of the opening, in metres, when the bay hugs its content. */
function hugSides(bay: FacadeBay): { left: number; right: number } | null {
  if (bay.fit !== 'content' || bay.widthMode === 'stretch') return null
  if (bay.opening && bay.opening.widthMode !== 'fixed') return null
  const { infill } = bay
  const side = (which: 'left' | 'right') =>
    infill && infill.sides !== (which === 'left' ? 'right' : 'left') ? (infill.width ?? 0) : 0
  return { left: side('left'), right: side('right') }
}

/**
 * The width a bay takes in its run: its own `width` when locked, or the sum of
 * its children when it hugs them.
 */
export function bayWidth(bay: FacadeBay): number {
  const sides = hugSides(bay)
  if (!sides) return bay.width
  const content = sides.left + (bay.opening?.width ?? 0) + sides.right
  return content > 0 ? content : bay.width
}
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
    paint: FacadePaintSchema.default({}),
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
  style: FacadeOpeningStyle
  x: number
  y: number
}
export type FacadeBalconyPlacement = {
  left: number
  right: number
} & Pick<FacadeBayBalcony, 'depth' | 'railing' | 'deckMaterial' | 'railingMaterial'>
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

  const balconyCollides = (balcony: { left: number; right: number }) =>
    balconies.some((b) => balcony.left < b.right + clearance && balcony.right > b.left - clearance)
  const tryPlace = (
    bay: FacadeBay,
    vertical: { bottom: number; height: number } | null,
    span: Span,
    bounds: { left: number; right: number },
    index: number,
  ): FacadeBayPlacement | null => {
    const { opening } = bay
    const placedOpening =
      opening && vertical ? openingIn(span, opening, vertical, hugSides(bay)?.left) : undefined
    if (opening && !placedOpening) return null
    // A continuous balcony is laid once every bay has its place (below).
    const balcony =
      bay.balcony && bay.balcony.span !== 'continuous'
        ? balconyIn(span, bay.balcony, bounds)
        : undefined
    if (
      (placedOpening &&
        (overlaps(placedOpening, obstacles, clearance) ||
          overlaps(placedOpening, openings, clearance))) ||
      (balcony && balconyCollides(balcony))
    ) {
      skipped++
      return null
    }
    const placement: FacadeBayPlacement = {
      key: `${bay.key}:${index}`,
      bay: bay.key,
      left: span.left,
      right: span.left + span.width,
      ...(placedOpening ? { opening: placedOpening } : {}),
      ...(balcony ? { balcony } : {}),
    }
    placements.push(placement)
    if (placedOpening) openings.push(placedOpening)
    if (balcony) balconies.push(balcony)
    return placement
  }

  const verticalOf = (bay: FacadeBay) => {
    const { opening } = bay
    if (
      opening &&
      (opening.height < FACADE_UNIT_MIN_OPENING ||
        (opening.widthMode === 'fixed' && opening.width < FACADE_UNIT_MIN_OPENING))
    )
      throw Error('Openings must be at least 0.3 m wide and tall.')
    return opening ? resolveVertical(opening, run.height) : null
  }

  // Pinned bays claim their span first, like fixed elements in a design tool;
  // repeating and stretching bays then fill the stretches left between them.
  // Bays pinned to the same side stack like flex items: each one's offset is
  // its gap from the previous bay pinned there, or from the corner if first.
  const whole = { left: 0, right: run.width }
  const taken: { left: number; right: number }[] = []
  let leftEdge = 0
  let rightEdge = run.width
  for (const bay of unit.bays.filter((b) => b.widthMode === 'fixed')) {
    const vertical = verticalOf(bay)
    // A bay whose opening cannot fit this storey contributes nothing.
    if (bay.opening && !vertical) continue
    const span =
      bay.horizontal === 'left'
        ? { left: leftEdge + bay.offsetX, width: bayWidth(bay) }
        : bay.horizontal === 'right'
          ? { left: rightEdge - bay.offsetX - bayWidth(bay), width: bayWidth(bay) }
          : resolveSpans(bay, run.width, maxRepeat)[0]
    if (!span || span.left < -1e-9 || span.left + span.width > run.width + 1e-9) {
      skipped++
      continue
    }
    if (!tryPlace(bay, vertical, span, whole, 0)) continue
    taken.push({ left: span.left, right: span.left + span.width })
    if (bay.horizontal === 'left') leftEdge = span.left + span.width
    if (bay.horizontal === 'right') rightEdge = span.left
  }
  const free = freeStretches(run.width, taken)
  for (const bay of unit.bays.filter((b) => b.widthMode !== 'fixed')) {
    const vertical = verticalOf(bay)
    if (bay.opening && !vertical) continue
    let index = 0
    for (const stretch of free)
      for (const span of resolveSpans(bay, stretch.right - stretch.left, maxRepeat))
        tryPlace(
          bay,
          vertical,
          { left: span.left + stretch.left, width: span.width },
          stretch,
          index++,
        )
  }

  // A continuous balcony (a *balcon filant*) runs along neighbouring placements
  // whose bays all want one — repeats of one bay, or a door bay and the window
  // bays beside it. Any other placement in between ends it.
  const bayOf = new Map(unit.bays.map((bay) => [bay.key, bay]))
  const inOrder = [...placements].sort((a, b) => a.left - b.left)
  let group: FacadeBayPlacement[] = []
  const layGroup = () => {
    const first = group[0]
    const look = first && bayOf.get(first.bay)?.balcony
    if (first && look) {
      const balcony = { left: first.left, right: group.at(-1)!.right, ...balconyLook(look) }
      if (balcony.right - balcony.left < MIN_BALCONY_WIDTH || balconyCollides(balcony)) skipped++
      else {
        first.balcony = balcony
        balconies.push(balcony)
      }
    }
    group = []
  }
  for (const placement of inOrder) {
    if (bayOf.get(placement.bay)?.balcony?.span === 'continuous') group.push(placement)
    else layGroup()
  }
  layGroup()

  return { placements, skipped }
}

function resolveSpans(bay: FacadeBay, runWidth: number, maxRepeat: number): Span[] {
  if (bay.widthMode === 'stretch') {
    const width = runWidth - bay.offsetX * 2
    return width < FACADE_UNIT_MIN_OPENING ? [] : [{ left: bay.offsetX, width }]
  }
  if (bay.widthMode === 'fixed') {
    const width = bayWidth(bay)
    if (width > runWidth) return []
    const left =
      bay.horizontal === 'left'
        ? bay.offsetX
        : bay.horizontal === 'right'
          ? runWidth - width - bay.offsetX
          : (runWidth - width) / 2 + bay.offsetX
    return [{ left, width }]
  }
  return repeatSpans(bay, runWidth, maxRepeat)
}

function repeatSpans(bay: FacadeBay, runWidth: number, maxRepeat: number): Span[] {
  const { endPier, pier } = bay
  const width = bayWidth(bay)
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
  /** In a bay that hugs its content, the infill before the opening: children sit side by side. */
  lead?: number,
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
    left =
      lead === undefined ? span.left + (span.width - width) / 2 + opening.offsetX : span.left + lead
  }
  return {
    kind: opening.kind,
    style: {
      windowType: opening.windowType,
      columns: opening.columns,
      rows: opening.rows,
      doorType: opening.doorType,
    },
    left,
    right: left + width,
    bottom: vertical.bottom,
    top: vertical.bottom + vertical.height,
    x: left + width / 2,
    y: vertical.bottom + vertical.height / 2,
  }
}

/** Balconies stay inside their stretch: past a corner a deck would pierce the next wall, past a pinned bay it would cover it. */
function balconyIn(
  span: Span,
  balcony: FacadeBayBalcony,
  bounds: { left: number; right: number },
): FacadeBalconyPlacement | undefined {
  const width = balcony.width ?? span.width
  const centre = span.left + span.width / 2 + balcony.offsetX
  const left = Math.max(bounds.left, centre - width / 2)
  const right = Math.min(bounds.right, centre + width / 2)
  if (right - left < MIN_BALCONY_WIDTH) return undefined
  return { left, right, ...balconyLook(balcony) }
}

const balconyLook = ({ depth, railing, deckMaterial, railingMaterial }: FacadeBayBalcony) => ({
  depth,
  railing,
  deckMaterial,
  railingMaterial,
})

export type FacadeCladdingPart =
  | 'infill'
  | 'infill-left'
  | 'infill-right'
  | 'spandrel-below'
  | 'spandrel-above'
export type FacadeCladdingRect = FacadeUnitObstacle & {
  part: FacadeCladdingPart
  cladding: FacadeCladding
}

/** Thinner strips than this are slivers, not panels. */
const MIN_CLADDING = 0.02

/**
 * The panels one bay placement lays out, in run coordinates: infill beside the
 * opening floor to ceiling, and spandrels below and above it.
 */
export function bayCladdingRects(
  bay: Pick<FacadeBay, 'infill' | 'spandrel'>,
  placement: Pick<FacadeBayPlacement, 'left' | 'right' | 'opening'>,
  runHeight: number,
): FacadeCladdingRect[] {
  const rects: FacadeCladdingRect[] = []
  const add = (
    part: FacadeCladdingPart,
    cladding: FacadeCladding,
    left: number,
    right: number,
    bottom: number,
    top: number,
  ) => {
    if (right - left >= MIN_CLADDING && top - bottom >= MIN_CLADDING)
      rects.push({ part, cladding, left, right, bottom, top })
  }
  const { opening } = placement
  // An opening shifted past its bay still leaves the bay's own edges intact.
  const openingLeft = opening
    ? Math.min(Math.max(opening.left, placement.left), placement.right)
    : 0
  const openingRight = opening
    ? Math.min(Math.max(opening.right, placement.left), placement.right)
    : 0
  const { infill, spandrel } = bay
  if (infill) {
    if (!opening) add('infill', infill, placement.left, placement.right, 0, runHeight)
    else {
      const reach = infill.width ?? Number.POSITIVE_INFINITY
      const [bottom, top] =
        infill.height === 'opening' ? [opening.bottom, opening.top] : [0, runHeight]
      if (infill.sides !== 'right')
        add(
          'infill-left',
          infill,
          Math.max(placement.left, openingLeft - reach),
          openingLeft,
          bottom,
          top,
        )
      if (infill.sides !== 'left')
        add(
          'infill-right',
          infill,
          openingRight,
          Math.min(placement.right, openingRight + reach),
          bottom,
          top,
        )
    }
  }
  if (spandrel && opening) {
    if (spandrel.parts !== 'above')
      add('spandrel-below', spandrel, openingLeft, openingRight, 0, opening.bottom)
    if (spandrel.parts !== 'below')
      add('spandrel-above', spandrel, openingLeft, openingRight, opening.top, runHeight)
  }
  return rects
}

/** The run minus the spans pinned bays took, in order. */
function freeStretches(
  runWidth: number,
  taken: readonly { left: number; right: number }[],
): { left: number; right: number }[] {
  const stretches: { left: number; right: number }[] = []
  let cursor = 0
  for (const span of [...taken].sort((a, b) => a.left - b.left)) {
    if (span.left > cursor) stretches.push({ left: cursor, right: Math.min(span.left, runWidth) })
    cursor = Math.max(cursor, span.right)
  }
  if (runWidth > cursor) stretches.push({ left: cursor, right: runWidth })
  return stretches.filter((stretch) => stretch.right - stretch.left > 1e-6)
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
