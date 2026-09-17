import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  LevelNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../../schema'
import { planWallDivision, planWallRectangle, wallRectangleCorners } from './wall-operations'
import { resolveWallLoop } from './wall-loop'
import { getWallCurveFrameAt, getWallCurveLength } from './wall-curve'

const level = LevelNode.parse({ id: 'level_creation', children: [] })
const map = (nodes: AnyNode[]) =>
  Object.fromEntries([level, ...nodes].map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
const rectangle = (offset = 0) => {
  const points = wallRectangleCorners([offset, 0], [offset + 8, 6])
  return points.map((start, i) =>
    WallNode.parse({ parentId: level.id, start, end: points[(i + 1) % 4] }),
  )
}
describe('wall creation operations', () => {
  test('rectangle is closed in every drag direction and the planning graph is untouched', () => {
    const nodes = map([]),
      before = JSON.stringify(nodes)
    for (const [a, b] of [
      [
        [0, 0],
        [8, 6],
      ],
      [
        [8, 0],
        [0, 6],
      ],
      [
        [8, 6],
        [0, 0],
      ],
    ]) {
      const plan = planWallRectangle(nodes, {
        levelId: level.id,
        start: a as [number, number],
        end: b as [number, number],
        wallDefaults: { thickness: 0.22 },
      })
      expect(plan.walls).toHaveLength(4)
      plan.walls.forEach((w, i) => {
        expect(w.end).toEqual(plan.walls[(i + 1) % 4]!.start)
        expect(w.thickness).toBe(0.22)
      })
    }
    expect(JSON.stringify(nodes)).toBe(before)
  })
  test('adjacent rectangles reuse their shared wall', () => {
    const existing = rectangle()
    const plan = planWallRectangle(map(existing), {
      levelId: level.id,
      start: [8, 0],
      end: [12, 6],
    })
    expect(plan.changes.create).toHaveLength(3)
    expect(plan.changes.delete).toHaveLength(0)
  })
  test('invalid rectangle has no partial result', () => {
    for (const end of [
      [0, 5],
      [5, 0.01],
      [NaN, 5],
    ])
      expect(() =>
        planWallRectangle(map([]), {
          levelId: level.id,
          start: [0, 0],
          end: end as [number, number],
        }),
      ).toThrow()
  })
  test('split preserves original id and remaps openings without changing their world placement', () => {
    const wall = WallNode.parse({
      parentId: level.id,
      start: [2, 3],
      end: [8, 11],
      thickness: 0.3,
      slots: { exterior: 'preset:brick' },
    })
    const opening = WindowNode.parse({
      parentId: wall.id,
      wallId: wall.id,
      position: [8, 1.5, 0],
      width: 1,
    })
    wall.children = [opening.id]
    const zone = ZoneNode.parse({
      name: 'Room',
      polygon: [
        [0, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ],
      parentId: level.id,
      boundaryWallIds: [wall.id],
      autoFromWalls: true,
    })
    const plan = planWallDivision(map([wall, opening, zone]), wall.id, 4)
    expect(plan.changes.delete).toEqual([])
    expect(plan.changes.create).toHaveLength(1)
    const first = plan.changes.update.find((op) => op.id === wall.id)!.data as WallNode
    const second = plan.changes.create[0]!.node as WallNode
    expect(first.end).toEqual(second.start)
    expect(second.slots).toEqual(wall.slots)
    const moved = plan.changes.update.find((op) => op.id === opening.id)!.data as WindowNode
    expect(moved.position).toEqual([4, 1.5, 0])
    expect(moved.parentId).toBe(second.id)
    expect(plan.changes.update.find((op) => op.id === zone.id)!.data).toMatchObject({
      boundaryWallIds: [wall.id, second.id],
    })
  })
  test('split refuses cuts through windows and near endpoints', () => {
    const wall = rectangle()[0]!,
      opening = WindowNode.parse({
        parentId: wall.id,
        wallId: wall.id,
        position: [4, 1.5, 0],
        width: 2,
      })
    wall.children = [opening.id]
    for (const distance of [0, 0.01, 4, 8, NaN])
      expect(() => planWallDivision(map([wall, opening]), wall.id, distance)).toThrow()
  })
  test('curved splits preserve total arc length and curve endpoint', () => {
    const wall = WallNode.parse({
      parentId: level.id,
      start: [0, 0],
      end: [8, 0],
      curveOffset: 1,
    })
    const length = getWallCurveLength(wall),
      expected = getWallCurveFrameAt(wall, 0.4).point
    const plan = planWallDivision(map([wall]), wall.id, length * 0.4)
    const first = plan.changes.update[0]!.data as WallNode,
      second = plan.changes.create[0]!.node as WallNode
    expect(first.end[0]).toBeCloseTo(expected.x)
    expect(first.end[1]).toBeCloseTo(expected.y)
    expect(getWallCurveLength(first) + getWallCurveLength(second)).toBeCloseTo(length)
  })
})
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
    inner.boundary.forEach((b, i) => expect(b.face).not.toBe(outer.boundary[i]!.face))
    expect(() => resolveWallLoop(nodes, partition.id, 'interior')).toThrow('perimeter')
    expect(() => resolveWallLoop(nodes, partition.id, 'exterior')).toThrow('perimeter')
  })
  test('open chains are rejected instead of spilling into neighbors', () => {
    const walls = rectangle().slice(0, 3)
    expect(() => resolveWallLoop(map(walls), walls[0]!.id, 'exterior')).toThrow()
    expect(() => resolveWallLoop(map(walls), walls[0]!.id, 'interior')).toThrow()
  })
})
