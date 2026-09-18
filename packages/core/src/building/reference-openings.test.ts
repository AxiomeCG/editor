import { describe, expect, test } from 'bun:test'
import { WallNode } from '../schema'
import { planOpeningPlacement } from './reference-openings'

const LEVEL_ID = 'level_openings' as never

function wall(id: string, start: [number, number], end: [number, number], thickness = 0.18) {
  return WallNode.parse({ id, parentId: LEVEL_ID, start, end, thickness })
}

const box = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]

/** A 1 m door opened 90°: leaf along +x from the hinge, arc back to the far jamb at +z. */
function doorSymbol(hinge: [number, number]): [number, number][] {
  const arc = Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 15) * (Math.PI / 2)
    return [hinge[0] + Math.cos(angle), hinge[1] + Math.sin(angle)] as [number, number]
  })
  return [...box(hinge[0], hinge[1], hinge[0] + 1, hinge[1] + 0.04), ...arc]
}

// A symbol drawn over the middle of a 6 m wall on the x axis.
const onWall = box(2.6, -0.1, 3.4, 0.1)

describe('planOpeningPlacement', () => {
  test('hosts a window symbol on the wall it sits on', () => {
    const placement = planOpeningPlacement({
      points: onWall,
      kind: 'window',
      walls: [wall('wall_a', [0, 0], [6, 0])],
    })

    expect(placement.hostWall?.id).toBe('wall_a')
    expect(placement.bridge).toBeNull()
    expect(placement.along).toBeCloseTo(3, 5)
    expect(placement.width).toBeCloseTo(0.8, 5)
  })

  test('hosts a door on a continuous wall when there is no gap to bridge', () => {
    const placement = planOpeningPlacement({
      points: onWall,
      kind: 'door',
      walls: [wall('wall_a', [0, 0], [6, 0])],
    })

    expect(placement.hostWall?.id).toBe('wall_a')
    expect(placement.width).toBeCloseTo(0.8, 5)
  })

  test('measures a window along a rotated wall, not the plan axes', () => {
    const angle = Math.PI / 6
    const direction: [number, number] = [Math.cos(angle), Math.sin(angle)]
    const normal: [number, number] = [-direction[1], direction[0]]
    const at = (along: number, offset: number): [number, number] => [
      direction[0] * along + normal[0] * offset,
      direction[1] * along + normal[1] * offset,
    ]
    const placement = planOpeningPlacement({
      points: [at(2.6, -0.05), at(3.4, -0.05), at(3.4, 0.05), at(2.6, 0.05)],
      kind: 'window',
      walls: [wall('wall_a', [0, 0], at(6, 0))],
    })

    expect(placement.hostWall?.id).toBe('wall_a')
    expect(placement.along).toBeCloseTo(3, 5)
    expect(placement.width).toBeCloseTo(0.8, 5)
  })

  test('bridges a gap between two wall ends for a door symbol', () => {
    const placement = planOpeningPlacement({
      points: box(1.7, -0.15, 3.3, 0.15),
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

  test('bridges a square door symbol in a wall running along z', () => {
    // The leaf + arc bounding box is square, so its axes cannot tell the wall direction.
    const placement = planOpeningPlacement({
      points: doorSymbol([0.09, 2]),
      kind: 'door',
      walls: [wall('wall_c', [0, 0], [0, 2]), wall('wall_d', [0, 3], [0, 6])],
    })

    expect(placement.hostWall).toBeNull()
    expect(placement.bridge?.start).toEqual([0, 2])
    expect(placement.bridge?.end).toEqual([0, 3])
    expect(placement.along).toBeCloseTo(0.5, 5)
    expect(placement.width).toBeCloseTo(0.9, 5)
  })

  test('never bridges back along one of the flanking walls', () => {
    // Centred on the 0→3 m span between both wall starts, which would overlap wall_a.
    const placement = planOpeningPlacement({
      points: box(0.7, -0.1, 2.3, 0.1),
      kind: 'door',
      walls: [wall('wall_a', [0, 0], [2, 0]), wall('wall_b', [3, 0], [6, 0])],
    })

    expect(placement.bridge).toBeNull()
    expect(placement.hostWall?.id).toBe('wall_a')
  })

  test('bridges a wall gap for a window when no wall covers the symbol', () => {
    const placement = planOpeningPlacement({
      points: box(1.7, -0.15, 3.3, 0.15),
      kind: 'window',
      walls: [wall('wall_a', [0, 0], [2, 0]), wall('wall_b', [3, 0], [6, 0])],
    })

    expect(placement.bridge).not.toBeNull()
    expect(placement.hostWall).toBeNull()
  })

  test('refuses when no wall or bridge pair fits the symbol', () => {
    expect(() =>
      planOpeningPlacement({
        points: box(10, 10, 11, 11),
        kind: 'door',
        walls: [wall('wall_a', [0, 0], [6, 0])],
      }),
    ).toThrow(/on a wall/)
  })

  test('throws a dedicated message when no walls exist yet', () => {
    expect(() => planOpeningPlacement({ points: onWall, kind: 'door', walls: [] })).toThrow(/first/)
  })

  test('clamps the opening inside a short wall', () => {
    const placement = planOpeningPlacement({
      points: box(0.6, -0.1, 1.4, 0.1),
      kind: 'window',
      walls: [wall('wall_a', [0, 0], [1.2, 0])],
    })

    expect(placement.width).toBeLessThanOrEqual(1.2 - 0.1)
    expect(placement.along).toBeGreaterThanOrEqual(placement.width / 2)
  })
})
