import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  getWallCurveFrameAt,
  getWallCurveLength,
  LevelNode,
  planWallDivision,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { wallSplitDistance, wallSplitPreview } from './wall-split-preview'

const level = LevelNode.parse({ children: [] })
const graph = (...nodes: AnyNode[]) =>
  Object.fromEntries([level, ...nodes].map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>

describe('Kaizen split marker in Pascal', () => {
  test('a mouse projection and numeric distance identify the same angled cut', () => {
    const wall = WallNode.parse({ parentId: level.id, start: [2, 3], end: [8, 11] })
    const nodes = graph(wall)
    const distance = wallSplitDistance(wall, [4, 7.75])
    expect(distance).toBeCloseTo(5)
    const preview = wallSplitPreview(nodes, wall, distance)
    const plan = planWallDivision(nodes, wall.id, distance)
    expect(preview.valid).toBe(true)
    expect([preview.frame.point.x, preview.frame.point.y]).toEqual(plan.point)
    expect(preview.frame).toEqual(wallSplitPreview(nodes, wall, 5).frame)
  })
  test.each([
    1, -1,
  ])('curved wall mouse target agrees with arc-length widget, offset %p', (offset) => {
    const wall = WallNode.parse({
      parentId: level.id,
      start: [2, 3],
      end: [10, 5],
      curveOffset: offset,
    })
    for (const t of [0.1, 0.37, 0.9]) {
      const frame = getWallCurveFrameAt(wall, t)
      const distance = wallSplitDistance(wall, [
        frame.point.x + frame.normal.x * 0.15,
        frame.point.y + frame.normal.y * 0.15,
      ])
      expect(distance).toBeCloseTo(t * getWallCurveLength(wall), 7)
      const preview = wallSplitPreview(graph(wall), wall, distance)
      expect(preview.valid).toBe(true)
      expect(preview.frame.point.x).toBeCloseTo(frame.point.x)
      expect(preview.frame.point.y).toBeCloseTo(frame.point.y)
    }
  })
  test('invalid cut stays where the pointer is and does not silently snap past an opening', () => {
    const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [8, 0] })
    const window = WindowNode.parse({
      parentId: wall.id,
      wallId: wall.id,
      width: 2,
      position: [4, 1.5, 0],
    })
    wall.children = [window.id]
    const nodes = graph(wall, window)
    const before = JSON.stringify(nodes)
    for (const distance of [0, 0.02, 4, 7.99, 8]) {
      const preview = wallSplitPreview(nodes, wall, distance)
      expect(preview.valid).toBe(false)
      expect(preview.frame.point.x).toBeCloseTo(distance)
      expect(preview.message.length).toBeGreaterThan(0)
    }
    expect(wallSplitPreview(nodes, wall, 2).valid).toBe(true)
    expect(JSON.stringify(nodes)).toBe(before)
  })
  test('linked copies cannot bypass make-real via direct mouse input', () => {
    const wall = WallNode.parse({
      parentId: level.id,
      start: [0, 0],
      end: [8, 0],
      metadata: { linkedArray: { sourceId: 'wall_original' } },
    })
    expect(wallSplitPreview(graph(wall), wall, 3).message).toContain('Make the linked array real')
  })
})
