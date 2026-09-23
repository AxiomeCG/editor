import { describe, expect, test } from 'bun:test'
import { type AnyNode, LevelNode, WallNode } from '../schema'
import { type FacadeTargetWall, facadeFace, facadeRuns } from './facade-runs'
import { facadeScopeTargets } from './facade-scope'

const level = LevelNode.parse({ level: 0, height: 3 })
const scene = (...nodes: AnyNode[]) =>
  Object.fromEntries([level, ...nodes].map((n) => [n.id, n])) as Record<string, AnyNode>
const wall = (start: [number, number], end: [number, number]) =>
  WallNode.parse({ parentId: level.id, start, end, thickness: 0.1 })

/** An 8 × 6 m closed rectangle; walls[0] runs along x at z = 0. */
const rectangle = () => {
  const points: [number, number][] = [
    [0, 0],
    [8, 0],
    [8, 6],
    [0, 6],
  ]
  return points.map((start, i) => wall(start, points[(i + 1) % 4]!))
}

function loopTargets(
  nodes: Record<string, AnyNode>,
  picked: WallNode,
  scope: 'exterior' | 'interior',
) {
  const { walls, targets } = facadeScopeTargets(nodes, picked, scope)
  return walls.map((w): FacadeTargetWall => ({ wall: w, face: facadeFace(w, targets[w.id]!) }))
}
const widths = (runs: ReturnType<typeof facadeRuns>, wallId: string) =>
  runs
    .filter((run) => run.walls.some((w) => w.wall.id === wallId))
    .map((run) => run.end - run.start)

describe('facadeRuns', () => {
  test('an outside corner extends the run to the real corner of the face', () => {
    const walls = rectangle()
    const nodes = scene(...walls)
    const runs = facadeRuns(nodes, loopTargets(nodes, walls[0]!, 'exterior'))

    expect(runs).toHaveLength(4)
    // 8 m between centrelines plus half of each 0.1 m corner wall.
    expect(widths(runs, walls[0]!.id)).toEqual([expect.closeTo(8.1, 6)])
    expect(widths(runs, walls[1]!.id)).toEqual([expect.closeTo(6.1, 6)])
  })

  test('an inside corner shortens it', () => {
    const walls = rectangle()
    const nodes = scene(...walls)
    const runs = facadeRuns(nodes, loopTargets(nodes, walls[0]!, 'interior'))
    expect(widths(runs, walls[0]!.id)).toEqual([expect.closeTo(7.9, 6)])
  })

  test('a partition meeting the facade splits it into runs either side of the partition', () => {
    const walls = rectangle()
    const partition = wall([4, 0], [4, 6])
    const nodes = scene(...walls, partition)
    const runs = facadeRuns(nodes, loopTargets(nodes, walls[0]!, 'exterior'))
    const bottom = runs.filter((run) => run.walls.some((w) => w.wall.id === walls[0]!.id))

    // In plan x: the runs sit either side of the partition's 0.1 m thickness.
    const planX = (run: (typeof bottom)[number], along: number) =>
      run.origin[0] + run.direction[0] * along
    const extents = bottom
      .map((run) => [planX(run, run.start), planX(run, run.end)].sort((a, b) => a - b))
      .sort((a, b) => a[0]! - b[0]!)
    expect(extents).toEqual([
      [expect.closeTo(-0.05, 6), expect.closeTo(3.95, 6)],
      [expect.closeTo(4.05, 6), expect.closeTo(8.05, 6)],
    ])
    // The sides have no T, so they stay whole.
    expect(widths(runs, walls[1]!.id)).toEqual([expect.closeTo(6.1, 6)])
  })

  test('collinear walls with nothing meeting between them form one run', () => {
    const [, ...rest] = rectangle()
    const left = wall([0, 0], [3, 0])
    const right = wall([8, 0], [3, 0])
    const nodes = scene(left, right, ...rest)
    // Drawn in opposite directions, so the outside (-z) is the back of one and the front of the other.
    const runs = facadeRuns(nodes, [
      { wall: left, face: 'back' },
      { wall: right, face: 'front' },
    ])

    expect(runs).toHaveLength(1)
    expect(runs[0]!.walls.map((w) => w.wall.id).sort()).toEqual([left.id, right.id].sort())
    expect(runs[0]!.end - runs[0]!.start).toBeCloseTo(8.1, 6)
  })
})
