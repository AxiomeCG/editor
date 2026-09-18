import { describe, expect, test } from 'bun:test'
import { BuildingNode, GuideNode, LevelNode } from '../schema'
import {
  propFitError,
  propPlacementNodes,
  propSymbolFrames,
  propYaw,
  symbolFrame,
} from './reference-props'

type Point = [number, number]
const ANGLE = Math.PI / 6

/** An item-convention frame: local (dx, dz) → level. */
const place =
  (center: Point, yaw: number) =>
  (dx: number, dz: number): Point => [
    center[0] + dx * Math.cos(yaw) + dz * Math.sin(yaw),
    center[1] - dx * Math.sin(yaw) + dz * Math.cos(yaw),
  ]
const rectangle = (center: Point, yaw: number, width: number, depth: number) => {
  const at = place(center, yaw)
  return [
    at(-width / 2, -depth / 2),
    at(width / 2, -depth / 2),
    at(width / 2, depth / 2),
    at(-width / 2, depth / 2),
  ]
}
const sameAxis = (a: number, b: number) =>
  Math.abs(Math.sin(2 * (a - b))) < 1e-6 && Math.abs(Math.cos(2 * (a - b)) - 1) < 1e-6

describe('symbolFrame', () => {
  test('finds a rotated symbol’s tightest box, centre and size', () => {
    const frame = symbolFrame(rectangle([3, -2], ANGLE, 2, 1), 0)

    expect(frame.center[0]).toBeCloseTo(3, 6)
    expect(frame.center[1]).toBeCloseTo(-2, 6)
    expect([...frame.size].sort()).toEqual([expect.closeTo(1, 6), expect.closeTo(2, 6)])
    expect(sameAxis(frame.yaw, ANGLE)).toBe(true)
  })

  test('keeps a round symbol square to the plan axes', () => {
    const circle = Array.from({ length: 48 }, (_, i): Point => {
      const angle = (i / 48) * Math.PI * 2
      return [Math.cos(angle) * 0.6, Math.sin(angle) * 0.6]
    })

    expect(symbolFrame(circle, ANGLE).yaw).toBeCloseTo(ANGLE, 9)
  })
})

describe('propYaw', () => {
  const frame = symbolFrame(rectangle([0, 0], ANGLE, 2.2, 0.95), ANGLE)

  test('lays the asset’s long side along the symbol’s long side', () => {
    // A sofa (2.06 × 1.01) placed in this frame: its local X must follow the 2.2 m side.
    const sofa = place(frame.center, propYaw(frame, [2.06, 1.01]))
    const along = sofa(1, 0)
    expect(sameAxis(Math.atan2(-along[1], along[0]), ANGLE)).toBe(true)
    // An asset modelled long along local Z turns a quarter to match.
    expect(sameAxis(propYaw(frame, [0.9, 2]), ANGLE + Math.PI / 2)).toBe(true)
  })

  test('each extra quarter turn rotates the result by 90°', () => {
    const base = propYaw(frame, [2.06, 1.01])
    const turned = propYaw(frame, [2.06, 1.01], 1)
    expect(Math.cos(turned - base)).toBeCloseTo(0, 9)
    expect(propYaw(frame, [2.06, 1.01], 4)).toBeCloseTo(base, 9)
  })
})

test('propFitError ranks a sofa above a chair for a sofa-sized symbol', () => {
  const frame = symbolFrame(rectangle([0, 0], 0, 2.2, 0.95), 0)
  expect(propFitError(frame, [2.06, 1.01])).toBeLessThan(propFitError(frame, [0.5, 0.55]))
  // Orientation does not matter for the score.
  expect(propFitError(frame, [1.01, 2.06])).toBeCloseTo(propFitError(frame, [2.06, 1.01]), 12)
})

describe('propPlacementNodes', () => {
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  // 1000 px at scale 10 → 0.1 m/px, image centre at level (1, 2), plan rotated 30°.
  const guide = GuideNode.parse({
    parentId: level.id,
    url: '/plan.svg',
    scale: 10,
    position: [1, 0, 2],
    rotation: [0, ANGLE, 0],
    metadata: { planReference: { width: 1000, height: 800, assetId: 'plan' } },
  })
  /** Plan image pixels for a point drawn at (x, y) metres from the image centre. */
  const px = ([x, y]: Point): Point => [x / 0.1 + 500, y / 0.1 + 400]
  const planRect = (x0: number, y0: number, x1: number, y1: number) =>
    (
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ] as Point[]
    ).map(px)
  const sofa = {
    id: 'sofa',
    category: 'furniture',
    name: 'Sofa',
    thumbnail: '/items/sofa/thumbnail.webp',
    src: '/items/sofa/model.glb',
    dimensions: [2.06, 0.74, 1.01] as [number, number, number],
  }

  test('places the item at real size on the symbol, square to the rotated plan', () => {
    const [item] = propPlacementNodes({
      guide,
      level,
      asset: sofa,
      name: 'Sofa',
      // Seat, back and two arms of one sofa drawn 2.2 × 0.95 m around (2, -1) on the plan.
      shapes: [
        { id: 'seat', points: planRect(1, -1.4, 3, -0.6) },
        { id: 'back', points: planRect(0.9, -1.475, 3.1, -1.3) },
        { id: 'arm-l', points: planRect(0.9, -1.3, 1.05, -0.525) },
        { id: 'arm-r', points: planRect(2.95, -1.3, 3.1, -0.525) },
      ],
    })

    const center = place([1, 2], ANGLE)(2, -1)
    expect(item!.position[0]).toBeCloseTo(center[0], 6)
    expect(item!.position[1]).toBe(0)
    expect(item!.position[2]).toBeCloseTo(center[1], 6)
    expect(sameAxis(item!.rotation[1], ANGLE)).toBe(true)
    expect(item!.scale).toEqual([1, 1, 1])
    expect(item!.parentId).toBe(level.id)
    expect(item!.asset.id).toBe('sofa')
  })

  test('two separate sofa symbols make two items', () => {
    const shapes = [
      { id: 'a', points: planRect(0, 0, 2.2, 0.95) },
      { id: 'b', points: planRect(4, 0, 6.2, 0.95) },
    ]
    expect(propSymbolFrames({ guide, level, shapes })).toHaveLength(2)
    expect(
      propPlacementNodes({ guide, level, shapes, asset: sofa, name: 'Sofa' }).map((n) => n.name),
    ).toEqual(['Sofa 1', 'Sofa 2'])
  })
})
