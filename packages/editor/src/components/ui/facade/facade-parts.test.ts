import { describe, expect, test } from 'bun:test'
import { FacadeUnitSchema, resolveFacadeUnit } from '@pascal-app/core'
import { partAt } from './facade-parts'

describe('parts of a placed bay', () => {
  const unit = FacadeUnitSchema.parse({
    name: 'Test',
    bays: [
      {
        key: 'bay',
        width: 3,
        widthMode: 'fixed',
        opening: { kind: 'door', width: 1.2, height: 2.1 },
        infill: { material: 'library:preset-charcoal' },
        spandrel: { material: 'library:preset-charcoal', parts: 'above' },
        balcony: { depth: 1 },
      },
    ],
  })
  const bay = unit.bays[0]!
  const [placement] = resolveFacadeUnit(unit, { width: 3, height: 3 }).placements
  const at = (x: number, up: number) => partAt(bay, placement!, 3, x, up)

  test('finds the opening, the panels, the spandrel and the balcony in front', () => {
    expect(at(1.5, 1.6)).toBe('opening')
    expect(at(0.4, 2)).toBe('panels')
    expect(at(1.5, 2.6)).toBe('spandrel')
    // Low down the balcony is in front of everything.
    expect(at(1.5, 0.5)).toBe('balcony')
  })
})
