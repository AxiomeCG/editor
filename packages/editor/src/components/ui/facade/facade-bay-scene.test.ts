import { describe, expect, test } from 'bun:test'
import { wallFaceBoxes } from './facade-bay-scene'

const area = (boxes: ReturnType<typeof wallFaceBoxes>) =>
  boxes.reduce((sum, b) => sum + (b.x1 - b.x0) * (b.y1 - b.y0), 0)

describe('wallFaceBoxes', () => {
  test('a wall without openings is one box', () => {
    expect(wallFaceBoxes(8, 3, [])).toEqual([{ x0: 0, x1: 8, y0: 0, y1: 3 }])
  })

  test('a window leaves the face around it, with its hole exactly open', () => {
    const boxes = wallFaceBoxes(8, 3, [{ left: 3, right: 4.5, bottom: 0.9, top: 2.4 }])
    expect(area(boxes)).toBeCloseTo(8 * 3 - 1.5 * 1.5, 9)
    expect(boxes).toContainEqual({ x0: 3, x1: 4.5, y0: 0, y1: 0.9 })
    expect(boxes).toContainEqual({ x0: 3, x1: 4.5, y0: 2.4, y1: 3 })
  })

  test('a door reaching the floor needs no special case', () => {
    const boxes = wallFaceBoxes(6, 3, [{ left: 1, right: 2, bottom: 0, top: 2.1 }])
    expect(area(boxes)).toBeCloseTo(18 - 2.1, 9)
    expect(boxes.some((b) => b.x0 === 1 && b.y0 === 0)).toBe(false)
  })

  test('openings past the wall ends are clipped to the face', () => {
    const boxes = wallFaceBoxes(4, 3, [{ left: -1, right: 1, bottom: 1, top: 2 }])
    expect(Math.min(...boxes.map((b) => b.x0))).toBe(0)
    expect(area(boxes)).toBeCloseTo(12 - 1, 9)
  })
})
