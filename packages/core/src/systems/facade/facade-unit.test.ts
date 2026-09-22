import { describe, expect, test } from 'bun:test'
import {
  bayCladdingRects,
  DEFAULT_FACADE_UNIT,
  type FacadeBay,
  type FacadeBayOpening,
  FacadeUnitSchema,
  resolveFacadeUnit,
} from './facade-unit'

/** A one-bay unit: layout on the bay, sizing of the opening inside it. */
const unit = (
  bay: Partial<Omit<FacadeBay, 'opening' | 'balcony'>> = {},
  opening: Partial<FacadeBayOpening> = {},
) =>
  FacadeUnitSchema.parse({
    name: 'Test unit',
    bays: [
      {
        key: 'window',
        width: 1.4,
        ...bay,
        opening: { width: 1.4, height: 1.6, sill: 0.8, ...opening },
      },
    ],
  })

const run = (width: number, height = 3.2) => ({ width, height })

/** The authored facade tool's centred row, kept as the parity oracle for the default unit. */
function legacyRows(width: number) {
  const columns = Math.max(0, Math.floor((width - 0.4 + 1) / 2.4))
  const start = (width - (columns * 1.4 + (columns - 1) * 1)) / 2
  return Array.from({ length: columns }, (_, index) => start + index * 2.4)
}

describe('facade unit resolution', () => {
  test('the default unit reproduces the authored facade row for many run widths', () => {
    for (const width of [3, 4.2, 6, 8.7, 10, 12.5, 20]) {
      const { placements } = resolveFacadeUnit(DEFAULT_FACADE_UNIT, run(width))
      expect(placements.map((p) => p.opening!.left)).toEqual(
        legacyRows(width).map((left) => expect.closeTo(left, 10)),
      )
      for (const { opening } of placements) {
        expect(opening!.right - opening!.left).toBeCloseTo(1.4, 10)
        expect(opening!.bottom).toBeCloseTo(0.8, 10)
        expect(opening!.top - opening!.bottom).toBeCloseTo(1.6, 10)
      }
    }
  })

  test('reports the same placements for the same input, so a resize or reload is stable', () => {
    const subject = unit({ remainder: 'widen-piers' })
    expect(resolveFacadeUnit(subject, run(9.4))).toEqual(resolveFacadeUnit(subject, run(9.4)))
  })

  test('anchors a fixed bay to the left corner, the right corner and the centre', () => {
    const left = resolveFacadeUnit(
      unit({ widthMode: 'fixed', horizontal: 'left', offsetX: 0.3 }),
      run(10),
    )
    const right = resolveFacadeUnit(
      unit({ widthMode: 'fixed', horizontal: 'right', offsetX: 0.3 }),
      run(10),
    )
    const centre = resolveFacadeUnit(
      unit({ widthMode: 'fixed', horizontal: 'center', offsetX: 0.5 }),
      run(10),
    )
    expect(left.placements[0]!.left).toBeCloseTo(0.3, 10)
    expect(right.placements[0]!.right).toBeCloseTo(9.7, 10)
    expect(centre.placements[0]!.opening!.x).toBeCloseTo(5.5, 10)
  })

  test('a stretching bay and opening span the run less their insets', () => {
    const { placements } = resolveFacadeUnit(
      unit(
        { widthMode: 'stretch', offsetX: 0.25 },
        { widthMode: 'stretch', heightMode: 'stretch', sill: 0.5, offsetY: 0.3 },
      ),
      run(10, 4),
    )
    expect(placements).toHaveLength(1)
    expect(placements[0]!.opening!.left).toBeCloseTo(0.25, 10)
    expect(placements[0]!.opening!.right).toBeCloseTo(9.75, 10)
    expect(placements[0]!.opening!.bottom).toBeCloseTo(0.5, 10)
    expect(placements[0]!.opening!.top).toBeCloseTo(3.7, 10)
  })

  test('keeps real dimensions when repeating, and puts the leftover where the unit says', () => {
    const gapStretch = resolveFacadeUnit(
      unit({ endPier: 0.2, pier: 1, remainder: 'widen-piers' }),
      run(10),
    )
    expect(gapStretch.placements).toHaveLength(4)
    expect(gapStretch.placements[0]!.left).toBeCloseTo(0.2, 10)
    expect(gapStretch.placements.at(-1)!.right).toBeCloseTo(9.8, 10)
    for (const placement of gapStretch.placements)
      expect(placement.right - placement.left).toBeCloseTo(1.4, 10)

    const edgeAlign = resolveFacadeUnit(
      unit({ endPier: 0.2, pier: 1, horizontal: 'right', remainder: 'align-to-anchor' }),
      run(12),
    )
    expect(edgeAlign.placements).toHaveLength(5)
    expect(edgeAlign.placements[0]!.left).toBeCloseTo(0.8, 10)
    expect(edgeAlign.placements.at(-1)!.right).toBeCloseTo(11.8, 10)

    const centred = resolveFacadeUnit(unit({ endPier: 0.2, pier: 1 }), run(11))
    expect(centred.placements[0]!.left).toBeCloseTo(1.2, 10)
    expect(centred.placements.at(-1)!.right).toBeCloseTo(9.8, 10)
  })

  test('places nothing when the run is narrower than the bay and its margins', () => {
    expect(resolveFacadeUnit(unit(), run(1)).placements).toEqual([])
    expect(resolveFacadeUnit(unit({ widthMode: 'fixed' }), run(1)).placements).toEqual([])
  })

  test('pins an opening to the vertical centre and to the top', () => {
    const centre = resolveFacadeUnit(unit({}, { vertical: 'center' }), run(10, 4))
    const top = resolveFacadeUnit(unit({}, { vertical: 'top', sill: 0.5 }), run(10, 4))
    expect(centre.placements[0]!.opening!.bottom).toBeCloseTo(1.2, 10)
    expect(top.placements[0]!.opening!.top).toBeCloseTo(3.5, 10)
  })

  test('drops a bay whose opening cannot fit the storey instead of clipping it', () => {
    const { placements, skipped } = resolveFacadeUnit(unit(), run(10, 2))
    expect(placements).toEqual([])
    expect(skipped).toBe(0)
  })

  test('allows a floor-level door, which the sill default would have blocked', () => {
    const { placements } = resolveFacadeUnit(
      FacadeUnitSchema.parse({
        name: 'Entry',
        bays: [
          {
            key: 'door',
            width: 1.1,
            widthMode: 'fixed',
            horizontal: 'right',
            opening: { kind: 'door', width: 1.1, height: 2.1 },
          },
        ],
      }),
      run(6, 3.2),
    )
    expect(placements).toHaveLength(1)
    expect(placements[0]!.opening!.kind).toBe('door')
    expect(placements[0]!.opening!.bottom).toBeCloseTo(0, 10)
    expect(placements[0]!.opening!.top).toBeCloseTo(2.1, 10)
  })

  test('never lets two openings in one unit share the same space', () => {
    const bay = (key: string) => ({
      key,
      width: 2,
      widthMode: 'fixed',
      horizontal: 'left',
      opening: { width: 2, height: 1, sill: 0.5 },
    })
    const { placements, skipped } = resolveFacadeUnit(
      FacadeUnitSchema.parse({ name: 'Colliding', bays: [bay('lower'), bay('upper')] }),
      run(6),
    )
    expect(placements.map((p) => p.key)).toEqual(['lower:0'])
    expect(skipped).toBe(1)
  })

  test('counts a bay skipped by an existing opening and keeps the rest', () => {
    const { placements, skipped } = resolveFacadeUnit(DEFAULT_FACADE_UNIT, run(10), [
      { left: 3, right: 4.6, bottom: 0.7, top: 2.5 },
    ])
    expect(skipped).toBe(1)
    expect(placements.map((p) => p.left)).toEqual([0.7, 5.5, 7.9].map((x) => expect.closeTo(x, 10)))
  })

  test('keys placements by bay so a multi-bay unit never collides', () => {
    const { placements } = resolveFacadeUnit(
      FacadeUnitSchema.parse({
        name: 'Punched bay',
        bays: [
          { key: 'upper', width: 1.2, pier: 1.2, opening: { width: 1.2, height: 0.8, sill: 2.4 } },
          {
            key: 'door',
            width: 1.1,
            widthMode: 'fixed',
            horizontal: 'right',
            opening: { kind: 'door', width: 1.1, height: 2.1 },
          },
        ],
      }),
      run(9, 3.4),
    )
    // The pinned door claims its column; the windows repeat in the 7.9 m left of it.
    expect(placements).toHaveLength(4)
    expect(new Set(placements.map((p) => p.key)).size).toBe(placements.length)
    expect(placements.find((p) => p.bay === 'door')!.opening!.kind).toBe('door')
  })

  test('a pinned bay takes its place first and the repeating bays fill the rest', () => {
    const unit = FacadeUnitSchema.parse({
      name: 'Entrance',
      bays: [
        {
          key: 'windows',
          width: 1.4,
          pier: 1,
          endPier: 0.3,
          opening: { width: 1.4, height: 1.6, sill: 0.8 },
        },
        {
          key: 'door',
          width: 1.2,
          widthMode: 'fixed',
          horizontal: 'left',
          offsetX: 0.4,
          opening: { kind: 'door', width: 1.2, height: 2.1 },
        },
      ],
    })
    const { placements, skipped } = resolveFacadeUnit(unit, run(10))
    const door = placements.find((p) => p.bay === 'door')!
    const windows = placements.filter((p) => p.bay === 'windows')

    // Listed second, the door still wins: it is pinned; the windows reflow after it.
    expect(door.left).toBeCloseTo(0.4, 10)
    expect(skipped).toBe(0)
    expect(windows.length).toBeGreaterThan(0)
    for (const window of windows)
      expect(window.left).toBeGreaterThanOrEqual(door.right + 0.3 - 1e-9)
  })

  test('rejects unusable input instead of returning a partial layout', () => {
    expect(() => resolveFacadeUnit(unit({}, { width: 0.2 }), run(10))).toThrow()
    expect(() => resolveFacadeUnit(unit(), run(0))).toThrow()
    const dense = unit({ width: 0.3, pier: 0, endPier: 0 }, { width: 0.3 })
    expect(() => resolveFacadeUnit(dense, run(1000))).toThrow(/more than 96 repeats/)
    expect(() =>
      FacadeUnitSchema.parse({
        name: 'Twins',
        bays: [
          { key: 'a', width: 1 },
          { key: 'a', width: 1 },
        ],
      }),
    ).toThrow('Each bay in a unit needs its own key.')
  })

  test('a unit survives a schema round trip, which is what a catalog save persists', () => {
    const parsed = FacadeUnitSchema.parse({
      name: 'The Victor bay',
      appearance: { finish: 'brick', wall: '#815449', trim: '#2b2b2b' },
      bays: [
        {
          key: 'living',
          width: 2.4,
          remainder: 'widen-piers',
          opening: { kind: 'door', width: 1.7, height: 2.5 },
          balcony: { depth: 1.2, railing: 'glass' },
        },
      ],
    })
    expect(FacadeUnitSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })
})

describe('bays', () => {
  const doorBay = FacadeUnitSchema.parse({
    name: 'Door bays',
    bays: [
      {
        key: 'bay',
        width: 2.4,
        pier: 0.6,
        endPier: 0.3,
        opening: { kind: 'door', width: 1.2, height: 2.2 },
        balcony: { depth: 1.2, railing: 'glass' },
      },
    ],
  })

  test('a repeating bay multiplies its door and balcony together', () => {
    const { placements } = resolveFacadeUnit(doorBay, run(10))
    expect(placements).toHaveLength(3)
    for (const placement of placements) {
      const doorCentre = placement.opening!.x
      const balconyCentre = (placement.balcony!.left + placement.balcony!.right) / 2
      expect(balconyCentre).toBeCloseTo(doorCentre, 10)
      expect(placement.balcony!.right - placement.balcony!.left).toBeCloseTo(2.4, 10)
      expect(placement.balcony!.depth).toBe(1.2)
    }
  })

  test('a balcony wider than its bay is clipped to the run, never past a corner', () => {
    const { placements } = resolveFacadeUnit(
      FacadeUnitSchema.parse({
        name: 'Corner balcony',
        bays: [
          {
            key: 'end',
            width: 1,
            widthMode: 'fixed',
            horizontal: 'left',
            balcony: { width: 3 },
          },
        ],
      }),
      run(6),
    )
    expect(placements[0]!.balcony!.left).toBe(0)
    expect(placements[0]!.balcony!.right).toBeCloseTo(2, 10)
  })

  test('a bay that is only a balcony makes a continuous terrace', () => {
    const { placements } = resolveFacadeUnit(
      FacadeUnitSchema.parse({
        name: 'Terrace',
        bays: [{ key: 'terrace', width: 1, widthMode: 'stretch', offsetX: 0.2, balcony: {} }],
      }),
      run(8),
    )
    expect(placements).toHaveLength(1)
    expect(placements[0]!.opening).toBeUndefined()
    expect(placements[0]!.balcony!.left).toBeCloseTo(0.2, 10)
    expect(placements[0]!.balcony!.right).toBeCloseTo(7.8, 10)
  })

  test('two balconies never overlap: the later bay yields', () => {
    const { placements, skipped } = resolveFacadeUnit(
      FacadeUnitSchema.parse({
        name: 'Clash',
        bays: [
          { key: 'terrace', width: 1, widthMode: 'stretch', balcony: {} },
          { key: 'bay', width: 2, balcony: {} },
        ],
      }),
      run(8),
    )
    expect(placements.map((p) => p.bay)).toEqual(['terrace'])
    expect(skipped).toBeGreaterThan(0)
  })

  test('a continuous balcony runs from the first repeat to the last', () => {
    const { placements } = resolveFacadeUnit(
      FacadeUnitSchema.parse({
        name: 'Balcon filant',
        bays: [
          {
            key: 'bay',
            width: 1.4,
            pier: 1,
            endPier: 0.3,
            opening: { kind: 'door', width: 1.2, height: 2.1 },
            balcony: { span: 'continuous', depth: 0.8 },
          },
        ],
      }),
      run(10),
    )
    const withBalcony = placements.filter((p) => p.balcony)
    expect(placements.length).toBeGreaterThan(1)
    expect(withBalcony).toHaveLength(1)
    expect(withBalcony[0]!.balcony!.left).toBeCloseTo(placements[0]!.left, 10)
    expect(withBalcony[0]!.balcony!.right).toBeCloseTo(placements.at(-1)!.right, 10)
  })
})

describe('bay cladding', () => {
  const finish = { finish: 'siding', color: '#2b2d2f' }
  /** A 3 m bay with a 1.2 m window centred in it, 0.9 m of wall either side. */
  const rects = (infill?: object, spandrel?: object) => {
    const placed = unit({ width: 3, widthMode: 'fixed', infill, spandrel }, { width: 1.2 })
    const [placement] = resolveFacadeUnit(placed, run(3)).placements
    return bayCladdingRects(placed.bays[0]!, placement!, 3.2).map((r) => ({
      part: r.part,
      left: Number(r.left.toFixed(3)),
      right: Number(r.right.toFixed(3)),
    }))
  }

  test('infill fills both sides of the opening to the bay edge by default', () => {
    expect(rects(finish)).toEqual([
      { part: 'infill-left', left: 0, right: 0.9 },
      { part: 'infill-right', left: 2.1, right: 3 },
    ])
  })

  test('infill can sit on one side only', () => {
    expect(rects({ ...finish, sides: 'left' }).map((r) => r.part)).toEqual(['infill-left'])
    expect(rects({ ...finish, sides: 'right' }).map((r) => r.part)).toEqual(['infill-right'])
  })

  test('a set infill width is measured from the opening and never passes the bay edge', () => {
    expect(rects({ ...finish, width: 0.4 })).toEqual([
      { part: 'infill-left', left: 0.5, right: 0.9 },
      { part: 'infill-right', left: 2.1, right: 2.5 },
    ])
    expect(rects({ ...finish, width: 5 })[0]).toEqual({ part: 'infill-left', left: 0, right: 0.9 })
  })

  test('a spandrel can sit below the opening, above it, or both', () => {
    expect(rects(undefined, finish).map((r) => r.part)).toEqual([
      'spandrel-below',
      'spandrel-above',
    ])
    expect(rects(undefined, { ...finish, parts: 'below' }).map((r) => r.part)).toEqual([
      'spandrel-below',
    ])
    expect(rects(undefined, { ...finish, parts: 'above' }).map((r) => r.part)).toEqual([
      'spandrel-above',
    ])
  })
})
