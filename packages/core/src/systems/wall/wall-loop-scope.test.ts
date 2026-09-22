import { describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, LevelNode, WallNode } from '../../schema'
import { resolveWallLoop } from './wall-loop'

const level = LevelNode.parse({ id: 'level_creation', children: [] })
const map = (nodes: AnyNode[]) =>
  Object.fromEntries([level, ...nodes].map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
/** An 8 × 6 m closed rectangle of walls starting at x = offset. */
const rectangle = (offset = 0) => {
  const points: [number, number][] = [
    [offset, 0],
    [offset + 8, 0],
    [offset + 8, 6],
    [offset, 6],
  ]
  return points.map((start, i) =>
    WallNode.parse({ parentId: level.id, start, end: points[(i + 1) % 4] }),
  )
}

describe('wall loop scope', () => {
  test('exterior loop stays in the clicked building footprint and current floor', () => {
    const first = rectangle(),
      other = rectangle(20),
      differentLevel = rectangle().map((w) => ({ ...w, parentId: 'level_other' as const }))
    const loop = resolveWallLoop(
      map([...first, ...other, ...differentLevel]),
      first[0]!.id,
      'exterior',
    )
    expect(new Set(loop.walls.map((w) => w.id))).toEqual(new Set(first.map((w) => w.id)))
  })
  test('both scopes follow the same perimeter, reverse faces, and exclude partitions', () => {
    const walls = rectangle(),
      partition = WallNode.parse({ parentId: level.id, start: [4, 0], end: [4, 6] }),
      nodes = map([...walls, partition])
    const outer = resolveWallLoop(nodes, walls[0]!.id, 'exterior')
    const inner = resolveWallLoop(nodes, walls[0]!.id, 'interior')
    expect(outer.walls).toHaveLength(4)
    expect(inner.walls.map((w) => w.id)).toEqual(outer.walls.map((w) => w.id))
    for (const [i, b] of inner.boundary.entries()) expect(b.face).not.toBe(outer.boundary[i]!.face)
    expect(() => resolveWallLoop(nodes, partition.id, 'interior')).toThrow('perimeter')
    expect(() => resolveWallLoop(nodes, partition.id, 'exterior')).toThrow('perimeter')
  })
  test('open chains are rejected instead of spilling into neighbors', () => {
    const walls = rectangle().slice(0, 3)
    expect(() => resolveWallLoop(map(walls), walls[0]!.id, 'exterior')).toThrow()
    expect(() => resolveWallLoop(map(walls), walls[0]!.id, 'interior')).toThrow()
  })
})
