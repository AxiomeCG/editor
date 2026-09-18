import { describe, expect, test } from 'bun:test'
import { WallNode } from '../schema'
import { openingFootprint, planOpeningPlacement } from './reference-openings'

const LEVEL_ID = 'level_openings' as never

function wall(id: string, start: [number, number], end: [number, number], thickness = 0.18) {
  return WallNode.parse({ id, parentId: LEVEL_ID, start, end, thickness })
}

// The footprint of a symbol drawn over the middle of a 6 m wall on the x axis.
const onWall = openingFootprint([
  [2.6, -0.1],
  [3.4, 0.1],
])

describe('planOpeningPlacement', () => {
  test('hosts a window symbol on the wall it sits on', () => {
    const placement = planOpeningPlacement({
      footprint: onWall,
      kind: 'window',
      walls: [wall('wall_a', [0, 0], [6, 0])],
    })

    expect(placement.hostWall?.id).toBe('wall_a')
    expect(placement.bridge).toBeNull()
    expect(placement.along).toBeCloseTo(3, 5)
    expect(placement.width).toBeCloseTo(0.8, 5)
  })

  test('centers a door at mid-height semantics via along-offset only', () => {
    const placement = planOpeningPlacement({
      footprint: onWall,
      kind: 'door',
      walls: [wall('wall_a', [0, 0], [6, 0])],
    })

    expect(placement.hostWall?.id).toBe('wall_a')
    expect(placement.width).toBeGreaterThan(0.4)
  })

  test('bridges a gap between two wall ends for a door symbol', () => {
    const placement = planOpeningPlacement({
      footprint: openingFootprint([
        [1.7, -0.15],
        [3.3, 0.15],
      ]),
      kind: 'door',
      walls: [wall('wall_a', [0, 0], [2, 0]), wall('wall_b', [3, 0], [6, 0])],
    })

    expect(placement.hostWall).toBeNull()
    expect(placement.bridge?.start).toEqual([2, 0])
    expect(placement.bridge?.end).toEqual([3, 0])
    expect(placement.bridge?.thickness).toBeCloseTo(0.18, 5)
    expect(placement.along).toBeCloseTo(0.5, 5)
    // A 1 m gap caps the opening width just inside the bridge length.
    expect(placement.width).toBeCloseTo(0.9, 5)
  })

  test('bridges a wall gap for a window when no wall covers the symbol', () => {
    const placement = planOpeningPlacement({
      footprint: openingFootprint([
        [1.7, -0.15],
        [3.3, 0.15],
      ]),
      kind: 'window',
      walls: [wall('wall_a', [0, 0], [2, 0]), wall('wall_b', [3, 0], [6, 0])],
    })

    expect(placement.bridge).not.toBeNull()
    expect(placement.hostWall).toBeNull()
  })

  test('refuses when no wall or bridge pair fits the footprint', () => {
    expect(() =>
      planOpeningPlacement({
        footprint: openingFootprint([
          [10, 10],
          [11, 11],
        ]),
        kind: 'door',
        walls: [wall('wall_a', [0, 0], [6, 0])],
      }),
    ).toThrow(/on a wall/)
  })

  test('throws a dedicated message when no walls exist yet', () => {
    expect(() =>
      planOpeningPlacement({ footprint: onWall, kind: 'door', walls: [] }),
    ).toThrow(/first/)
  })

  test('clamps the opening inside a short wall', () => {
    const placement = planOpeningPlacement({
      footprint: openingFootprint([
        [0.6, -0.1],
        [1.4, 0.1],
      ]),
      kind: 'window',
      walls: [wall('wall_a', [0, 0], [1.2, 0])],
    })

    expect(placement.width).toBeLessThanOrEqual(1.2 - 0.1)
    expect(placement.along).toBeGreaterThanOrEqual(placement.width / 2)
  })
})
