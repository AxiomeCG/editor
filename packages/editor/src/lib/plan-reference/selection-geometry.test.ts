import { describe, expect, test } from 'bun:test'
import { planSelectionGeometry, type PlanShape } from './selection-geometry'

const stroke = (id: string, points: [number, number][]): PlanShape => ({
  id,
  points,
  holes: [],
  stroke: true,
  strokeWidth: 1,
  boundary: true,
})

// Pixel-space shapes with metersPerPixel 0.1 — 1 px = 0.1 m.

describe('planSelectionGeometry gap bridging', () => {
  const roomWithGap = [
    stroke('a', [
      [0, 0],
      [100, 0],
      [100, 48],
    ]),
    // 6 px gap between (100, 48) and (100, 54).
    stroke('b', [
      [100, 54],
      [100, 100],
      [0, 100],
      [0, 0],
    ]),
  ]

  test('a room closes across a hairline gap within the tolerance', () => {
    expect(planSelectionGeometry(roomWithGap, 'areas', 0.1, 8)).toHaveLength(1)
  })

  test('stays open when the gap exceeds the tolerance', () => {
    expect(planSelectionGeometry(roomWithGap, 'areas', 0.1, 3)).toHaveLength(0)
    expect(planSelectionGeometry(roomWithGap, 'areas', 0.1, 0)).toHaveLength(0)
  })

  test('bridging a divider splits the merged face back into two rooms', () => {
    // Two rooms sharing a divider whose top end stops 6 px short of the top
    // wall — without bridging both leak into one face.
    const twoRooms = [
      stroke('top', [
        [0, 0],
        [200, 0],
      ]),
      stroke('right', [
        [200, 0],
        [200, 100],
      ]),
      stroke('bottom', [
        [200, 100],
        [0, 100],
      ]),
      stroke('left', [
        [0, 100],
        [0, 0],
      ]),
      stroke('divider', [
        [100, 6],
        [100, 100],
      ]),
    ]

    expect(planSelectionGeometry(twoRooms, 'areas', 0.1, 8)).toHaveLength(2)
    expect(planSelectionGeometry(twoRooms, 'areas', 0.1, 0)).toHaveLength(1)
  })

  test('tolerances cache independently', () => {
    const bridged = planSelectionGeometry(roomWithGap, 'areas', 0.1, 8)
    const open = planSelectionGeometry(roomWithGap, 'areas', 0.1, 0)
    const bridgedAgain = planSelectionGeometry(roomWithGap, 'areas', 0.1, 8)

    expect(bridged).toHaveLength(1)
    expect(open).toHaveLength(0)
    expect(bridgedAgain).toHaveLength(1)
  })
})
