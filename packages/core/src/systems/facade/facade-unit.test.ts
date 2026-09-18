import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_FACADE_UNIT,
  type FacadeUnit,
  FacadeUnitSchema,
  resolveFacadeUnit,
} from './facade-unit'

const unit = (opening: Partial<FacadeUnit['openings'][number]>, bay = { width: 10, height: 3.2 }) =>
  FacadeUnitSchema.parse({
    name: 'Test unit',
    openings: [{ key: 'window', width: 1.4, height: 1.6, sill: 0.8, ...opening }],
  })

const bay = (width: number, height = 3.2) => ({ width, height })

/** The authored facade tool's rule, kept here as the parity oracle for the default unit. */
function legacyRows(width: number, layout: { width: number; height: number; gap: number; sill: number }) {
  const columns = Math.max(
    0,
    Math.floor((width - 0.4 + layout.gap) / (layout.width + layout.gap)),
  )
  if (layout.sill + layout.height + 0.15 > 3.2) return []
  const start = (width - (columns * layout.width + (columns - 1) * layout.gap)) / 2
  return Array.from({ length: columns }, (_, index) => start + index * (layout.width + layout.gap))
}

describe('facade unit resolution', () => {
  test('the default unit reproduces the authored facade row for many bay widths', () => {
    const layout = { width: 1.4, height: 1.6, gap: 1, sill: 0.8 }
    for (const width of [3, 4.2, 6, 8.7, 10, 12.5, 20]) {
      const { placements } = resolveFacadeUnit(DEFAULT_FACADE_UNIT, bay(width))
      expect(placements.map((p) => p.left)).toEqual(legacyRows(width, layout))
      for (const placement of placements) {
        expect(placement.right - placement.left).toBeCloseTo(layout.width, 10)
        expect(placement.bottom).toBeCloseTo(layout.sill, 10)
        expect(placement.top - placement.bottom).toBeCloseTo(layout.height, 10)
      }
    }
  })

  test('reports the same placements for the same input, so a resize or reload is stable', () => {
    const subject = unit({ widthMode: 'repeat', remainder: 'gap-stretch' })
    expect(resolveFacadeUnit(subject, bay(9.4))).toEqual(resolveFacadeUnit(subject, bay(9.4)))
  })

  test('anchors a fixed opening to the left, right and center of the bay', () => {
    const left = resolveFacadeUnit(unit({ widthMode: 'fixed', horizontal: 'left', offsetX: 0.3 }), bay(10))
    const right = resolveFacadeUnit(unit({ widthMode: 'fixed', horizontal: 'right', offsetX: 0.3 }), bay(10))
    const center = resolveFacadeUnit(
      unit({ widthMode: 'fixed', horizontal: 'center', offsetX: 0.5 }),
      bay(10),
    )
    expect(left.placements[0]!.left).toBeCloseTo(0.3, 10)
    expect(right.placements[0]!.right).toBeCloseTo(9.7, 10)
    expect(center.placements[0]!.x).toBeCloseTo(5.5, 10)
    expect(left.placements[0]!.right - left.placements[0]!.left).toBeCloseTo(1.4, 10)
  })

  test('stretches an opening across the bay less its inset on both sides', () => {
    const { placements } = resolveFacadeUnit(
      unit({ widthMode: 'stretch', offsetX: 0.25, heightMode: 'stretch', sill: 0.5, offsetY: 0.3 }),
      bay(10, 4),
    )
    expect(placements).toHaveLength(1)
    expect(placements[0]!.left).toBeCloseTo(0.25, 10)
    expect(placements[0]!.right).toBeCloseTo(9.75, 10)
    expect(placements[0]!.bottom).toBeCloseTo(0.5, 10)
    expect(placements[0]!.top).toBeCloseTo(3.7, 10)
  })

  test('keeps real window dimensions when repeating, and absorbs the remainder per policy', () => {
    const gapStretch = resolveFacadeUnit(
      unit({ widthMode: 'repeat', margin: 0.2, gap: 1, remainder: 'gap-stretch' }),
      bay(10),
    )
    expect(gapStretch.placements).toHaveLength(4)
    expect(gapStretch.placements[0]!.left).toBeCloseTo(0.2, 10)
    expect(gapStretch.placements.at(-1)!.right).toBeCloseTo(9.8, 10)
    for (const placement of gapStretch.placements)
      expect(placement.right - placement.left).toBeCloseTo(1.4, 10)

    const edgeAlign = resolveFacadeUnit(
      unit({ widthMode: 'repeat', margin: 0.2, gap: 1, horizontal: 'right', remainder: 'edge-align' }),
      bay(12),
    )
    expect(edgeAlign.placements).toHaveLength(5)
    expect(edgeAlign.placements[0]!.left).toBeCloseTo(0.8, 10)
    expect(edgeAlign.placements.at(-1)!.right).toBeCloseTo(11.8, 10)

    const centered = resolveFacadeUnit(unit({ widthMode: 'repeat', margin: 0.2, gap: 1 }), bay(11))
    expect(centered.placements[0]!.left).toBeCloseTo(1.2, 10)
    expect(centered.placements.at(-1)!.right).toBeCloseTo(9.8, 10)
  })

  test('places nothing when the bay is narrower than the unit margins allow', () => {
    expect(resolveFacadeUnit(unit({ widthMode: 'repeat' }), bay(1)).placements).toEqual([])
    expect(resolveFacadeUnit(unit({ widthMode: 'fixed' }), bay(1)).placements).toEqual([])
  })

  test('pins an opening to the vertical center and to the top', () => {
    const center = resolveFacadeUnit(unit({ vertical: 'center' }), bay(10, 4))
    const top = resolveFacadeUnit(unit({ vertical: 'top', sill: 0.5 }), bay(10, 4))
    expect(center.placements[0]!.bottom).toBeCloseTo(1.2, 10)
    expect(top.placements[0]!.top).toBeCloseTo(3.5, 10)
  })

  test('drops an opening that cannot fit the bay height instead of clipping it', () => {
    const { placements, skipped } = resolveFacadeUnit(unit({}), bay(10, 2))
    expect(placements).toEqual([])
    expect(skipped).toBe(0)
  })

  test('allows a floor-level door, which the sill default would have blocked', () => {
    const { placements } = resolveFacadeUnit(
      FacadeUnitSchema.parse({
        name: 'Entry',
        openings: [
          { key: 'door', kind: 'door', width: 1.1, height: 2.1, widthMode: 'fixed', horizontal: 'right' },
        ],
      }),
      bay(6, 3.2),
    )
    expect(placements).toHaveLength(1)
    expect(placements[0]!.kind).toBe('door')
    expect(placements[0]!.bottom).toBeCloseTo(0, 10)
    expect(placements[0]!.top).toBeCloseTo(2.1, 10)
  })

  test('never lets two openings in one unit share the same space', () => {
    const { placements, skipped } = resolveFacadeUnit(
      FacadeUnitSchema.parse({
        name: 'Colliding bay',
        openings: [
          { key: 'lower', width: 2, height: 1, sill: 0.5, widthMode: 'fixed', horizontal: 'left' },
          { key: 'upper', width: 2, height: 1, sill: 0.5, widthMode: 'fixed', horizontal: 'left' },
        ],
      }),
      bay(6),
    )
    expect(placements).toHaveLength(1)
    expect(placements[0]!.key).toBe('u:lower:0')
    expect(skipped).toBe(1)
  })

  test('counts an opening skipped by an existing opening and keeps the rest', () => {
    const { placements, skipped } = resolveFacadeUnit(DEFAULT_FACADE_UNIT, bay(10), [
      { left: 3, right: 4.6, bottom: 0.7, top: 2.5 },
    ])
    expect(skipped).toBe(1)
    expect(placements).toHaveLength(3)
    for (const [index, left] of [0.7, 5.5, 7.9].entries())
      expect(placements[index]!.left).toBeCloseTo(left, 10)
  })

  test('namespaces placement keys per opening so a multi-opening unit never collides', () => {
    const { placements } = resolveFacadeUnit(
      FacadeUnitSchema.parse({
        name: 'Punched bay',
        openings: [
          { key: 'upper', width: 1.2, height: 0.8, sill: 2.4, widthMode: 'repeat', gap: 1.2 },
          { key: 'door', kind: 'door', width: 1.1, height: 2.1, widthMode: 'fixed', horizontal: 'right' },
        ],
      }),
      bay(9, 3.4),
    )
    expect(placements).toHaveLength(5)
    expect(new Set(placements.map((p) => p.key)).size).toBe(placements.length)
    expect(placements.every((p) => p.key.startsWith('u:'))).toBe(true)
    expect(placements.find((p) => p.key.startsWith('u:door:'))!.kind).toBe('door')
  })

  test('rejects unusable input instead of returning a partial layout', () => {
    expect(() => resolveFacadeUnit(unit({ width: 0.2 }), bay(10))).toThrow()
    expect(() => resolveFacadeUnit(unit({}), bay(0))).toThrow()
    const dense = unit({ width: 0.3, gap: 0, margin: 0, widthMode: 'repeat' })
    expect(() => resolveFacadeUnit(dense, bay(1000))).toThrow(/more than 96 windows/)
  })

  test('a unit survives a schema round trip, which is what a catalog save will persist', () => {
    const parsed = FacadeUnitSchema.parse({
      name: 'The Victor bay',
      openings: [{ key: 'living', width: 1.7, height: 2.5, widthMode: 'repeat', remainder: 'gap-stretch' }],
    })
    expect(FacadeUnitSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })
})
