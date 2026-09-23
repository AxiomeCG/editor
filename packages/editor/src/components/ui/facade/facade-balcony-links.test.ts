import { describe, expect, test } from 'bun:test'
import { FacadeUnitSchema, resolveFacadeUnit } from '@pascal-app/core'
import { balconyLinks } from './facade-balcony-links'
import { resolveScenario } from './facade-elevation'

const door = {
  key: 'door',
  width: 1.6,
  widthMode: 'fixed',
  horizontal: 'left',
  offsetX: 0.4,
  opening: { kind: 'door', width: 1.2, height: 2.1 },
  balcony: { depth: 1.2 },
}
const windows = {
  key: 'window',
  width: 1.4,
  pier: 0.6,
  endPier: 0.4,
  opening: { width: 1.2, height: 1.4, sill: 0.9 },
}

function linksOf(bays: object[], selected: string) {
  const unit = FacadeUnitSchema.parse({ name: 'Test', bays })
  const { placements } = resolveScenario(unit, { width: 10, height: 3, partitions: [] })
  return { unit, links: balconyLinks(unit, placements, selected) }
}

describe('balcony links', () => {
  test('a door balcony beside window bays offers to extend it across', () => {
    const { unit, links } = linksOf([door, windows], 'door')
    expect(links).toHaveLength(1)
    expect(links[0]!.joined).toBe(false)

    // Following the link gives the windows the door's balcony, both continuous: one balcony.
    const byKey = new Map(links[0]!.bays.map((bay) => [bay.key, bay]))
    const joined = FacadeUnitSchema.parse({
      ...unit,
      bays: unit.bays.map((bay) => byKey.get(bay.key) ?? bay),
    })
    expect(joined.bays.every((bay) => bay.balcony?.span === 'continuous')).toBe(true)
    const { placements } = resolveFacadeUnit(joined, { width: 10, height: 3 })
    expect(placements.filter((p) => p.balcony)).toHaveLength(1)

    // Once joined, the same link splits them.
    const again = balconyLinks(
      joined,
      resolveScenario(joined, { width: 10, height: 3, partitions: [] }).placements,
      'door',
    )
    expect(again[0]!.joined).toBe(true)
    expect(again[0]!.bays.every((bay) => bay.balcony?.span === 'bay')).toBe(true)
  })

  test('no link without a balcony on either side, and only around the bay asked for', () => {
    expect(linksOf([{ ...door, balcony: undefined }, windows], 'door').links).toHaveLength(0)
    expect(linksOf([door, windows], 'nothing').links).toHaveLength(0)
  })

  test('without a bay to focus on, every gap next to a balcony gets a link', () => {
    const unit = FacadeUnitSchema.parse({ name: 'Test', bays: [door, { ...windows, balcony: {} }] })
    const { placements } = resolveScenario(unit, { width: 10, height: 3, partitions: [] })
    expect(balconyLinks(unit, placements)).toHaveLength(placements.length - 1)
  })
})
