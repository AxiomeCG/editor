import { describe, expect, test } from 'bun:test'
import { detectSpacesForLevel } from '../../lib/space-detection'
import { type AnyNode, DoorNode, LevelNode, WallNode } from '../../schema'
import { planarizeWallBatch } from './wall-batch'

const level = LevelNode.parse({ level: 0, height: 3 })
const wall = (start: [number, number], end: [number, number], thickness = 0.18) =>
  WallNode.parse({ parentId: level.id, start, end, thickness })
const rooms = (walls: WallNode[]) => detectSpacesForLevel(level.id, walls).rooms.length
const ends = (walls: WallNode[]) =>
  walls.map((w) => [...w.start, ...w.end].map((v) => +v.toFixed(6)))
const noScene: Record<string, AnyNode> = {}

/** A closed 6 × 4 m rectangle drawn centreline to centreline. */
const rectangle = () => [wall([0, 0], [6, 0]), wall([6, 0], [6, 4]), wall([6, 4], [0, 4]), wall([0, 4], [0, 0])]

describe('planarizeWallBatch', () => {
  test('a wall stopping at the faces of two walls becomes a tee and splits the room', () => {
    // Plans draw the partition from face to face: 9 cm short of each centreline.
    const walls = [...rectangle(), wall([3, 0.09], [3, 3.91])]
    expect(rooms(walls)).toBe(1)

    const { walls: joined } = planarizeWallBatch(walls, noScene, level.id)

    expect(ends(joined)).toContainEqual([3, 0, 3, 4])
    expect(rooms(joined)).toBe(2)
  })

  test('corners drawn past or short of each other meet at the centreline crossing', () => {
    const walls = [
      wall([-0.09, 0], [6.09, 0]),
      wall([6, -0.09], [6, 3.95]),
      wall([6.05, 4], [-0.09, 4]),
      wall([0, 4.09], [0, -0.07]),
    ]
    expect(rooms(walls)).toBe(0)

    const { walls: joined } = planarizeWallBatch(walls, noScene, level.id)

    expect(ends(joined)).toEqual([
      [0, 0, 6, 0],
      [6, 0, 6, 4],
      [6, 4, 0, 4],
      [0, 4, 0, 0],
    ])
    expect(rooms(joined)).toBe(1)
  })

  test('crossing walls split each other, and overshooting ends join the walls they pass', () => {
    const walls = [...rectangle(), wall([-0.05, 2], [6.05, 2]), wall([3, 0], [3, 4])]

    const { walls: joined } = planarizeWallBatch(walls, noScene, level.id)

    expect(ends(joined)).toContainEqual([0, 2, 3, 2])
    expect(ends(joined)).toContainEqual([3, 2, 6, 2])
    expect(rooms(joined)).toBe(4)
  })

  test('an existing wall crossed by a new one is split and keeps its door', () => {
    const existing = wall([0, 0], [6, 0])
    const door = DoorNode.parse({
      parentId: existing.id,
      wallId: existing.id,
      position: [1, 1.05, 0],
      width: 0.9,
    })
    existing.children = [door.id]
    const nodes: Record<string, AnyNode> = {
      [level.id]: level,
      [existing.id]: existing,
      [door.id]: door,
    }

    const plan = planarizeWallBatch([wall([4, -2], [4, 2])], nodes, level.id)

    expect(ends(plan.walls)).toEqual([
      [4, -2, 4, 0],
      [4, 0, 4, 2],
    ])
    expect(plan.existingChanges.delete).toEqual([existing.id])
    const pieces = plan.existingChanges.create.map((c) => c.node as WallNode)
    expect(ends(pieces)).toEqual([
      [0, 0, 4, 0],
      [4, 0, 6, 0],
    ])
    const moved = plan.existingChanges.update.find((u) => u.id === door.id)!
    expect((moved.data as DoorNode).parentId).toBe(pieces[0]!.id)
    expect((moved.data as DoorNode).position[0]).toBeCloseTo(1, 6)
  })

  test('parallel walls near each other are left alone', () => {
    const walls = [wall([0, 0], [4, 0]), wall([0, 0.12], [4, 0.12])]
    expect(ends(planarizeWallBatch(walls, noScene, level.id).walls)).toEqual(ends(walls))
  })
})
