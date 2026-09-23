import { describe, expect, test } from 'bun:test'
import { FacadeUnitSchema } from '@pascal-app/core'
import { resolveScenario } from './facade-elevation'
import { insertionSlots } from './facade-insertion'

const window = { width: 1.2, height: 1.4, sill: 0.9 }
const pinned = (key: string, horizontal: 'left' | 'right') => ({
  key,
  width: 1.2,
  widthMode: 'fixed',
  horizontal,
  offsetX: 0.4,
  opening: window,
})

function slotsOf(bays: object[], width = 12) {
  const unit = FacadeUnitSchema.parse({ name: 'Test', bays })
  const { runs, placements } = resolveScenario(unit, { width, height: 3, partitions: [] })
  return { unit, placements, slots: insertionSlots(unit, runs, placements) }
}

describe('insertion slots', () => {
  test('a repeating row offers a corner slot on each side, appended to the list', () => {
    const { slots, placements } = slotsOf([{ key: 'row', width: 1.4, pier: 1, opening: window }])
    expect(slots.map((s) => s.side)).toEqual(['left', 'right'])
    expect(slots.every((s) => s.index === 1)).toBe(true)
    expect(slots[0]!.x).toBeLessThan(placements.reduce((m, p) => Math.min(m, p.left), 99))
    expect(slots[1]!.x).toBeGreaterThan(placements.reduce((m, p) => Math.max(m, p.right), 0))
  })

  test('a left stack offers its corner, its gaps and its end, in stack order', () => {
    const { slots, placements } = slotsOf([
      pinned('a', 'left'),
      { key: 'row', width: 1.4, pier: 1, opening: window },
      pinned('b', 'left'),
    ])
    const left = slots.filter((s) => s.side === 'left')
    const at = (bay: string) => placements.find((p) => p.bay === bay)!
    // Before a (list index 0), between a and b (before b, index 2), after b (index 3).
    expect(left.map((s) => s.index)).toEqual([0, 2, 3])
    expect(left[0]!.x).toBeLessThan(at('a').left)
    expect(left[1]!.x).toBeGreaterThan(at('a').right)
    expect(left[1]!.x).toBeLessThan(at('b').left)
    expect(left[2]!.x).toBeGreaterThan(at('b').right)
  })

  test('a right stack is mirrored from its corner', () => {
    const { slots, placements } = slotsOf([pinned('r', 'right')])
    const right = slots.filter((s) => s.side === 'right')
    const r = placements.find((p) => p.bay === 'r')!
    expect(right.map((s) => s.index)).toEqual([0, 1])
    expect(right[0]!.x).toBeGreaterThan(r.right)
    expect(right[1]!.x).toBeLessThan(r.left)
  })
})
