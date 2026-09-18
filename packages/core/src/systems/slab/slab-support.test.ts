import { describe, expect, it } from 'bun:test'
import { SlabNode, WallNode } from '../../schema'
import { MIN_WALL_HEIGHT } from '../wall/wall-top'
import {
  clampSlabElevationForWalls,
  computeWallSlabSupport,
  getSlabElevationUpperBound,
} from './slab-support'

// 4×3 room slab drawn on the wall centerlines, like an auto-slab.
const SQUARE: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

const STOREY_HEIGHT = 2.7
const BOUND = STOREY_HEIGHT - MIN_WALL_HEIGHT

function roomSlab(elevation: number) {
  return SlabNode.parse({ polygon: SQUARE, elevation, autoFromWalls: true })
}

function roomWalls(height?: number) {
  return [
    WallNode.parse({ start: [0, 0], end: [4, 0], height }),
    WallNode.parse({ start: [4, 0], end: [4, 3], height }),
    WallNode.parse({ start: [4, 3], end: [0, 3], height }),
    WallNode.parse({ start: [0, 3], end: [0, 0], height }),
  ]
}

describe('clampSlabElevationForWalls', () => {
  it('clamps a slab under plane-bound walls at the plane minus MIN_WALL_HEIGHT', () => {
    const slab = roomSlab(0.05)
    const result = clampSlabElevationForWalls(2.5, slab, roomWalls(), [slab], STOREY_HEIGHT)

    expect(result.clamped).toBe(true)
    expect(result.elevation).toBeCloseTo(BOUND)
  })

  it('leaves proposals at or below the bound untouched', () => {
    const slab = roomSlab(0.05)
    const result = clampSlabElevationForWalls(BOUND, slab, roomWalls(), [slab], STOREY_HEIGHT)

    expect(result.clamped).toBe(false)
    expect(result.elevation).toBeCloseTo(BOUND)
  })

  it('passes negative (recessed-committing) proposals through untouched', () => {
    const slab = roomSlab(0.05)
    const result = clampSlabElevationForWalls(-0.6, slab, roomWalls(), [slab], STOREY_HEIGHT)

    expect(result.clamped).toBe(false)
    expect(result.elevation).toBeCloseTo(-0.6)
  })

  it('does not clamp when the walls all carry explicit heights', () => {
    const slab = roomSlab(0.05)
    const result = clampSlabElevationForWalls(2.5, slab, roomWalls(2.5), [slab], STOREY_HEIGHT)

    expect(result.clamped).toBe(false)
    expect(result.elevation).toBeCloseTo(2.5)
  })

  it('does not clamp a slab covering no walls', () => {
    const island = SlabNode.parse({
      polygon: [
        [10, 10],
        [12, 10],
        [12, 12],
        [10, 12],
      ],
      elevation: 0.05,
    })
    const result = clampSlabElevationForWalls(2.5, island, roomWalls(), [island], STOREY_HEIGHT)

    expect(result.clamped).toBe(false)
    expect(result.elevation).toBeCloseTo(2.5)
  })
})

describe('getSlabElevationUpperBound', () => {
  it('bounds a slab electable by plane-bound walls', () => {
    const slab = roomSlab(0.05)
    expect(getSlabElevationUpperBound(slab, roomWalls(), [slab], STOREY_HEIGHT)).toBeCloseTo(BOUND)
  })

  it('is unbounded under explicit-height walls', () => {
    const slab = roomSlab(0.05)
    expect(getSlabElevationUpperBound(slab, roomWalls(2.5), [slab], STOREY_HEIGHT)).toBe(
      Number.POSITIVE_INFINITY,
    )
  })
})

describe('computeWallSlabSupport preferred host', () => {
  const wallLike = { start: [0, 1.5] as [number, number], end: [4, 1.5] as [number, number] }
  const low = SlabNode.parse({
    id: 'slab_low',
    polygon: SQUARE,
    elevation: 0.1,
    autoFromWalls: true,
  })
  const high = SlabNode.parse({
    id: 'slab_high',
    polygon: SQUARE,
    elevation: 0.6,
    autoFromWalls: true,
  })

  it('elects the highest supporting elevation without a preference', () => {
    const support = computeWallSlabSupport(wallLike, [low, high], [])
    expect(support.elevation).toBeCloseTo(0.6)
  })

  it('pins the elected elevation to a still-supporting preferred slab', () => {
    const support = computeWallSlabSupport(wallLike, [low, high], [], 'slab_low')
    expect(support.elevation).toBeCloseTo(0.1)
    // Fill-down machinery still derives from ALL supporting slabs.
    expect(support.baseSegments).toHaveLength(1)
    expect(support.baseSegments[0]!.elevation).toBeCloseTo(0.6)
  })

  it('ignores a preferred slab that no longer supports the wall', () => {
    const island = SlabNode.parse({
      id: 'slab_island',
      polygon: [
        [10, 10],
        [12, 10],
        [12, 12],
        [10, 12],
      ],
      elevation: 0.9,
    })
    const support = computeWallSlabSupport(wallLike, [low, high, island], [], 'slab_island')
    expect(support.elevation).toBeCloseTo(0.6)
  })
})

describe('computeWallSlabSupport balcony decks', () => {
  // Exterior wall on the room's y = 0 edge; the balcony deck projects outward
  // and overlaps the wall face, like balconies built from a wall or a plan.
  const wallLike = {
    start: [0, 0] as [number, number],
    end: [4, 0] as [number, number],
    thickness: 0.2,
  }
  const floor = SlabNode.parse({ id: 'slab_floor', polygon: SQUARE, elevation: 0.05 })
  const deck = (elevation: number) =>
    SlabNode.parse({
      id: 'slab_deck',
      polygon: [
        [0.5, -1.4],
        [3.5, -1.4],
        [3.5, 0.07],
        [0.5, 0.07],
      ],
      elevation,
      metadata: { balcony: { id: 'slab_deck', source: 'balcony-tool', role: 'deck' } },
    })
  const flat = (support: ReturnType<typeof computeWallSlabSupport>, elevation: number) =>
    support.baseSegments.every((segment) => Math.abs(segment.elevation - elevation) < 1e-9)

  it('does not step the wall base down to a deck level with the floor', () => {
    // Plan balconies default to a deck at 0: the wall used to drop to it along the balcony.
    const support = computeWallSlabSupport(wallLike, [floor, deck(0)], [])
    expect(support.electedSlabId).toBe('slab_floor')
    expect(flat(support, 0.05)).toBe(true)
  })

  it('does not lift a wall with no floor slab onto a raised deck', () => {
    const support = computeWallSlabSupport(wallLike, [deck(0.3)], [])
    expect(support.electedSlabId).toBeNull()
    expect(flat(support, 0)).toBe(true)
  })

  it('still carries a node that names the deck as its support', () => {
    const railing = { start: [0.5, -1.4] as [number, number], end: [3.5, -1.4] as [number, number] }
    expect(
      computeWallSlabSupport(railing, [floor, deck(0.3)], [], 'slab_deck').elevation,
    ).toBeCloseTo(0.3)
  })
})
