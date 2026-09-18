import { describe, expect, test } from 'bun:test'
import { type AnyNode, type DoorNode, LevelNode, SlabNode, WallNode, WindowNode } from '../schema'
import { planBalconyOpening } from './balcony-access'

const level = LevelNode.parse({ level: 0, height: 3 })
const facade = WallNode.parse({ parentId: level.id, start: [0, 0], end: [8, 0], thickness: 0.2 })
/** A deck projecting 1.4 m out of the facade's outer face between x0 and x1. */
const deck = (x0: number, x1: number, metadata = {}) =>
  SlabNode.parse({
    parentId: level.id,
    polygon: [
      [x0, -0.08],
      [x1, -0.08],
      [x1, -1.48],
      [x0, -1.48],
    ],
    metadata: { balcony: { role: 'deck' }, ...metadata },
  })
const scene = (...nodes: AnyNode[]) =>
  Object.fromEntries([level, ...nodes].map((n) => [n.id, n])) as Record<string, AnyNode>

describe('planBalconyOpening', () => {
  test('centres a window on the wall the deck runs along', () => {
    const balcony = deck(1, 4)
    const window = planBalconyOpening(balcony, scene(facade, balcony), 'window')

    expect(window.type).toBe('window')
    expect(window.parentId).toBe(facade.id)
    expect(window.wallId).toBe(facade.id)
    expect(window.position[0]).toBeCloseTo(2.5, 6)
    expect(window.position[1]).toBeCloseTo(1.65, 6)
    expect(window.width).toBeCloseTo(1.2, 6)
  })

  test('a door is a two-leaf glazed French door standing at floor level', () => {
    const balcony = deck(1, 4)
    const door = planBalconyOpening(balcony, scene(facade, balcony), 'door') as DoorNode
    expect(door.type).toBe('door')
    expect(door.doorType).toBe('french')
    expect(door.leafCount).toBe(2)
    expect(door.segments[0]!.type).toBe('glass')
    expect(door.position[1]).toBeCloseTo(1.05, 6)
    expect(door.width).toBeCloseTo(1.5, 6)
  })

  test('a narrow balcony gets a single glazed leaf', () => {
    const balcony = deck(1, 2.1)
    const door = planBalconyOpening(balcony, scene(facade, balcony), 'door') as DoorNode
    expect(door.width).toBeCloseTo(0.9, 6)
    expect(door.leafCount).toBe(1)
    expect(door.segments[0]!.type).toBe('glass')
    expect(door.segments[0]!.columnRatios).toEqual([1])
  })

  test('moves clear of an opening already on that stretch of wall', () => {
    const balcony = deck(0.5, 5.5)
    const existing = WindowNode.parse({
      parentId: facade.id,
      wallId: facade.id,
      position: [3, 1.65, 0],
      width: 1.2,
    })
    const wall = { ...facade, children: [existing.id] }

    const added = planBalconyOpening(balcony, scene(wall, existing, balcony), 'window')

    expect(Math.abs(added.position[0] - 3)).toBeGreaterThanOrEqual(1.2 + 0.1 - 1e-9)
    expect(added.position[0] - added.width / 2).toBeGreaterThanOrEqual(0.5 - 1e-9)
    expect(added.position[0] + added.width / 2).toBeLessThanOrEqual(5.5 + 1e-9)
  })

  test('uses the wall the balcony was built from when it is recorded', () => {
    const other = WallNode.parse({ parentId: level.id, start: [0, -0.16], end: [8, -0.16], thickness: 0.1 })
    const balcony = deck(1, 4, { balconySourceWall: facade.id })
    expect(planBalconyOpening(balcony, scene(other, facade, balcony), 'window').parentId).toBe(
      facade.id,
    )
  })

  test('explains when there is no wall or no room', () => {
    const balcony = deck(1, 4)
    expect(() => planBalconyOpening(balcony, scene(balcony), 'window')).toThrow(/No wall/)
    const narrow = deck(1, 1.7)
    expect(() => planBalconyOpening(narrow, scene(facade, narrow), 'door')).toThrow(/too narrow/)
  })
})
