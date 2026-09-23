import { describe, expect, test } from 'bun:test'
import { DEFAULT_FACADE_UNIT } from '../systems/facade/facade-unit'
import { planFacadeFill } from './facade'
import { nextPartition, PARTITION_THICKNESS, scenarioRuns, scenarioScene } from './facade-scenario'

const half = PARTITION_THICKNESS / 2

describe('studio scenarios', () => {
  test('a lone facade is one run, corner to corner', () => {
    expect(scenarioRuns({ width: 8, height: 3, partitions: [] })).toEqual([{ start: 0, end: 8 }])
  })

  test('each interior wall ends a run at its face', () => {
    const runs = scenarioRuns({ width: 10, height: 3, partitions: [4, 7] })
    expect(runs.map((r) => [r.start, r.end].map((x) => Number(x.toFixed(3))))).toEqual([
      [0, 4 - half],
      [4 + half, 7 - half],
      [7 + half, 10],
    ])
  })

  test('an interior wall too close to a corner is left out', () => {
    expect(scenarioScene({ width: 8, height: 3, partitions: [0.1, 7.95] }).partitions).toHaveLength(
      0,
    )
  })

  test('the real planner restarts the unit in every room', () => {
    const scenario = { width: 10, height: 3, partitions: [4] }
    const { wall, nodes } = scenarioScene(scenario)
    const plan = planFacadeFill({ walls: [wall], nodes, unit: DEFAULT_FACADE_UNIT })
    expect(plan.runs).toHaveLength(2)
    // No opening overlaps the partition.
    for (const opening of plan.walls[0]!.openings.values) {
      const left = opening.position[0] - opening.width / 2
      const right = opening.position[0] + opening.width / 2
      expect(right <= 4 - half || left >= 4 + half).toBe(true)
    }
  })

  test('a new interior wall splits the widest run', () => {
    expect(nextPartition({ width: 10, height: 3, partitions: [] })).toBe(5)
    expect(nextPartition({ width: 10, height: 3, partitions: [3] })).toBe(6.55)
    expect(nextPartition({ width: 0.6, height: 3, partitions: [] })).toBeNull()
  })
})
