import { expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, LevelNode, WallNode } from '../../schema'
import roundedBay from './__fixtures__/rounded-bay.json'
import { resolveWallLoop } from './wall-loop'

const level = LevelNode.parse({})
const polygonWalls = (points: [number, number][]) =>
  points.map((start, i) =>
    WallNode.parse({ parentId: level.id, start, end: points[(i + 1) % points.length] }),
  )
const rectangle = (x: number, y: number, width: number, height: number) =>
  polygonWalls([
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ])
const graph = (walls: WallNode[]) =>
  Object.fromEntries([level, ...walls].map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>

test('nested disconnected rooms are not exterior perimeters; separate buildings remain eligible', () => {
  const outer = rectangle(0, 0, 20, 20),
    room = rectangle(4, 4, 3, 3),
    other = rectangle(30, 0, 8, 8)
  const nodes = graph([...outer, ...room, ...other])
  expect(() => resolveWallLoop(nodes, room[0]!.id, 'exterior')).toThrow('perimeter')
  expect(new Set(resolveWallLoop(nodes, outer[0]!.id, 'exterior').walls.map((w) => w.id))).toEqual(
    new Set(outer.map((w) => w.id)),
  )
  expect(resolveWallLoop(nodes, other[0]!.id, 'exterior').walls).toHaveLength(4)
})

test('a narrow room below room-area thresholds does not turn its partition into an exterior wall', () => {
  const outer = rectangle(0, 0, 4, 2),
    partition = WallNode.parse({ parentId: level.id, start: [0.1, 0], end: [0.1, 2] })
  const nodes = graph([...outer, partition])
  expect(() => resolveWallLoop(nodes, partition.id, 'exterior')).toThrow('perimeter')
  expect(new Set(resolveWallLoop(nodes, outer[0]!.id, 'exterior').walls.map((w) => w.id))).toEqual(
    new Set(outer.map((w) => w.id)),
  )
})

test('large, concave and reversed perimeters keep the physical outward faces', () => {
  for (const walls of [
    rectangle(0, 0, 150, 150),
    polygonWalls([
      [0, 0],
      [8, 0],
      [8, 3],
      [4, 3],
      [4, 8],
      [0, 8],
    ]),
  ]) {
    const reversed = walls.map((w, i) => (i % 2 ? { ...w, start: w.end, end: w.start } : w))
    const loop = resolveWallLoop(graph(reversed), reversed[0]!.id, 'exterior')
    expect(loop.walls).toHaveLength(walls.length)
    loop.boundary.forEach((b) => {
      expect(b.face).toBe(reversed.findIndex((w) => w.id === b.wallId) % 2 ? 'front' : 'back')
    })
  }
})

test('curved exterior edges and a bridge to an enclosed room retain the outer footprint only', () => {
  const outer = rectangle(0, 0, 20, 20)
  outer[0] = { ...outer[0]!, curveOffset: -2 }
  const inner = rectangle(4, 4, 3, 3)
  const bridge = WallNode.parse({ parentId: level.id, start: [0, 4], end: [4, 4] })
  const nodes = graph([...outer, ...inner, bridge])
  const loop = resolveWallLoop(nodes, outer[0]!.id, 'exterior')
  expect(new Set(loop.walls.map((w) => w.id))).toEqual(new Set(outer.map((w) => w.id)))
  expect(loop.boundary.find((b) => b.wallId === outer[0]!.id)!.points.length).toBeGreaterThan(2)
  expect(() => resolveWallLoop(nodes, inner[0]!.id, 'exterior')).toThrow('perimeter')
  expect(() => resolveWallLoop(nodes, bridge.id, 'exterior')).toThrow('perimeter')
})

function importedBay() {
  const bay = roundedBay.map((wall) => WallNode.parse({ ...wall, parentId: level.id }))
  const top = bay[18]!.start
  const bottom = bay[23]!.end
  const body = [
    WallNode.parse({ parentId: level.id, start: top, end: [0, top[1]] }),
    WallNode.parse({ parentId: level.id, start: [0, top[1]], end: [0, bottom[1]] }),
    WallNode.parse({ parentId: level.id, start: [0, bottom[1]], end: bottom }),
  ]
  return {
    bay,
    body,
    outerIds: new Set([...bay.slice(0, 18), ...bay.slice(24), ...body].map((w) => w.id)),
  }
}

test('an imported curved bay stays on the perimeter when coincident endpoints straddle a rounding boundary', () => {
  const { bay, body, outerIds } = importedBay()
  expect(
    Math.hypot(bay[0]!.start[0] - bay[25]!.end[0], bay[0]!.start[1] - bay[25]!.end[1]),
  ).toBeLessThan(1e-12)
  for (const reverseOrder of [false, true]) {
    for (const reverseWalls of [false, true]) {
      const walls = [...bay, ...body].map((wall, index) =>
        reverseWalls && index % 2 ? { ...wall, start: wall.end, end: wall.start } : wall,
      )
      if (reverseOrder) walls.reverse()
      const nodes = graph(walls)
      const before = structuredClone(nodes)
      for (const seed of [bay[0]!.id, body[0]!.id]) {
        const loop = resolveWallLoop(nodes, seed, 'exterior')
        expect(new Set(loop.walls.map((w) => w.id))).toEqual(outerIds)
        const interior = resolveWallLoop(nodes, seed, 'interior')
        expect(interior.boundary.map((b) => b.wallId)).toEqual(loop.boundary.map((b) => b.wallId))
        expect(interior.boundary.map((b) => b.face)).toEqual(
          loop.boundary.map((b) => (b.face === 'front' ? 'back' : 'front')),
        )
      }
      for (const wall of bay.slice(18, 24))
        expect(() => resolveWallLoop(nodes, wall.id, 'exterior')).toThrow('perimeter')
      expect(nodes).toEqual(before)
    }
  }
})

test('topology is unchanged by moving the same bay across rounding boundaries', () => {
  const { bay, body, outerIds } = importedBay()
  for (const offset of [0.0001, 0.0005, 100.0005]) {
    for (const sign of [1, -1]) {
      const transform = ([x, y]: [number, number]): [number, number] => [
        sign * x + offset,
        sign * y + offset,
      ]
      const walls = [...bay, ...body].map((wall) => ({
        ...wall,
        start: transform(wall.start),
        end: transform(wall.end),
      }))
      const loop = resolveWallLoop(graph(walls), body[0]!.id, 'exterior')
      expect(new Set(loop.walls.map((w) => w.id))).toEqual(outerIds)
    }
  }
})

test('coincident native curved-wall endpoints close without mutating the wall geometry', () => {
  const walls = rectangle(0, -3.5315, 6, 5)
  walls[0] = { ...walls[0]!, curveOffset: -1 }
  walls[3] = { ...walls[3]!, end: [0, -3.5315000000000003] }
  const nodes = graph(walls),
    before = structuredClone(nodes)
  const loop = resolveWallLoop(nodes, walls[0]!.id, 'exterior')
  expect(new Set(loop.walls.map((w) => w.id))).toEqual(new Set(walls.map((w) => w.id)))
  expect(loop.boundary.find((b) => b.wallId === walls[0]!.id)!.points.length).toBeGreaterThan(2)
  expect(nodes).toEqual(before)
})

test('real openings do not become closed loops or absorb an unclosed outer bay', () => {
  for (const gap of [0.002, 0.02, 0.2]) {
    const open = rectangle(0, 0, 6, 5)
    open[3] = { ...open[3]!, end: [0, gap] }
    expect(() => resolveWallLoop(graph(open), open[0]!.id, 'exterior')).toThrow('perimeter')
    const { bay, body } = importedBay()
    const start = bay[25]!.start,
      end = bay[25]!.end
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    bay[25] = {
      ...bay[25]!,
      end: [
        end[0] + ((start[0] - end[0]) * gap) / length,
        end[1] + ((start[1] - end[1]) * gap) / length,
      ],
    }
    const nodes = graph([...bay, ...body])
    expect(() => resolveWallLoop(nodes, bay[0]!.id, 'exterior')).toThrow('perimeter')
    const loop = resolveWallLoop(nodes, body[0]!.id, 'exterior')
    expect(new Set(loop.walls.map((w) => w.id))).toEqual(
      new Set([...bay.slice(18, 24), ...body].map((w) => w.id)),
    )
  }
})
