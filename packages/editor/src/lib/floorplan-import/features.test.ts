import { describe, expect, test } from 'bun:test'
import { extractFloorplanFeatures } from './features'
import type { PlanPoint } from './schema'

function drawing(width: number, height: number, ink: (x: number, y: number) => boolean) {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = ink(x, y) ? 0 : 255
      const p = (y * width + x) * 4
      rgba[p] = value
      rgba[p + 1] = value
      rgba[p + 2] = value
      rgba[p + 3] = 255
    }
  }
  return extractFloorplanFeatures(rgba, width, height)
}

describe('floorplan raster evidence', () => {
  test('a blank page supplies no invented floor, including uniform black input', () => {
    for (const ink of [false, true]) {
      const features = drawing(100, 100, () => ink)
      expect(features.lines).toEqual([])
      expect(features.regions).toEqual([])
    }
  })

  test('paired wall faces retain a measured centreline and thickness', () => {
    const features = drawing(140, 140, (x, y) => x >= 40 && x <= 47 && y >= 20 && y <= 120)
    const points = new Map(features.points.map((feature) => [feature.id, feature.point]))
    const verticalWall = features.lines.find((line) => {
      const start = points.get(line.startId)!
      const end = points.get(line.endId)!
      return (
        line.id.startsWith('L') &&
        Math.abs(start[0] - 43.5) <= 1 &&
        Math.abs(end[0] - 43.5) <= 1 &&
        Math.abs(end[1] - start[1]) >= 90 &&
        Math.abs(line.width - 7) <= 1
      )
    })
    expect(verticalWall).toBeDefined()
  })

  test('a dimension line beside a solid wall does not turn the paper gap into wall thickness', () => {
    const features = drawing(
      180,
      260,
      (x, y) =>
        (x >= 70 && x <= 79 && y >= 30 && y <= 230) ||
        (x === 28 && y >= 20 && y <= 240) ||
        ((y === 30 || y === 230) && x >= 22 && x <= 85),
    )
    const points = new Map(features.points.map((feature) => [feature.id, feature.point]))
    const axes = features.lines.filter((line) => line.id.startsWith('L'))
    expect(
      axes.some((line) => {
        const start = points.get(line.startId)!
        const end = points.get(line.endId)!
        return (
          start[0] > 30 &&
          start[0] < 65 &&
          end[0] > 30 &&
          end[0] < 65 &&
          Math.abs(end[1] - start[1]) > 150
        )
      }),
    ).toBe(false)
    expect(
      axes.some((line) => {
        const start = points.get(line.startId)!
        const end = points.get(line.endId)!
        return (
          Math.abs(start[0] - 74.5) <= 1 &&
          Math.abs(end[0] - 74.5) <= 1 &&
          Math.abs(end[1] - start[1]) > 150 &&
          Math.abs(line.width - 9) <= 1
        )
      }),
    ).toBe(true)
  })

  test('thin outlined wall faces remain candidates without filling their interior', () => {
    const features = drawing(
      160,
      200,
      (x, y) =>
        ((x === 60 || x === 72) && y >= 20 && y <= 180) ||
        ((y === 20 || y === 180) && x >= 60 && x <= 72),
    )
    const points = new Map(features.points.map((feature) => [feature.id, feature.point]))
    expect(
      features.lines.some((line) => {
        const start = points.get(line.startId)!
        const end = points.get(line.endId)!
        return (
          line.id.startsWith('L') &&
          Math.abs(start[0] - 66) <= 1 &&
          Math.abs(end[0] - 66) <= 1 &&
          Math.abs(end[1] - start[1]) >= 150 &&
          Math.abs(line.width - 12) <= 1
        )
      }),
    ).toBe(true)
  })

  test('window mullions do not erase the measured wall band around them', () => {
    const features = drawing(
      180,
      220,
      (x, y) =>
        x >= 70 &&
        x <= 81 &&
        y >= 20 &&
        y <= 200 &&
        (y < 50 || y > 170 || x === 70 || x >= 80 || x === 75),
    )
    const points = new Map(features.points.map((feature) => [feature.id, feature.point]))
    expect(
      features.lines.some((line) => {
        const start = points.get(line.startId)!
        const end = points.get(line.endId)!
        return (
          line.id.startsWith('L') &&
          Math.abs(start[0] - 75.5) <= 1 &&
          Math.abs(end[0] - 75.5) <= 1 &&
          Math.abs(end[1] - start[1]) >= 170 &&
          Math.abs(line.width - 11) <= 1
        )
      }),
    ).toBe(true)
  })

  test('thick diagonal filled walls are measured rather than capped to a thin wall preset', () => {
    const features = drawing(
      260,
      260,
      (x, y) => x + y >= 80 && x + y <= 440 && y - x >= 0 && y - x <= 42,
    )
    const points = new Map(features.points.map((feature) => [feature.id, feature.point]))
    expect(
      features.lines.some((line) => {
        const start = points.get(line.startId)!
        const end = points.get(line.endId)!
        return (
          line.id.startsWith('L') &&
          Math.abs(start[1] - start[0] - 21) <= 2 &&
          Math.abs(end[1] - end[0] - 21) <= 2 &&
          Math.hypot(end[0] - start[0], end[1] - start[1]) > 200 &&
          Math.abs(line.width - 42 / Math.SQRT2) <= 2
        )
      }),
    ).toBe(true)
  })

  test('bounded L-shaped space keeps its reentrant corner instead of a bounding box', () => {
    const features = drawing(140, 140, (x, y) => {
      const outer = x >= 20 && x < 120 && y >= 20 && y < 120
      const inside = x >= 25 && x < 115 && y >= 25 && y < 115 && !(x >= 70 && y >= 70)
      return outer && !inside
    })
    const points = new Map(features.points.map((feature) => [feature.id, feature.point]))
    const space = features.regions.find((region) => region.id.startsWith('S'))
    expect(space).toBeDefined()
    const polygon = space!.pointIds.map((id) => points.get(id) as PlanPoint)
    let twiceArea = 0
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!
      const b = polygon[(i + 1) % polygon.length]!
      twiceArea += a[0] * b[1] - a[1] * b[0]
    }
    const area = Math.abs(twiceArea) / 2
    expect(area).toBeGreaterThan(5800)
    expect(area).toBeLessThan(6200)
    expect(polygon.some((point) => Math.hypot(point[0] - 69, point[1] - 69) < 3)).toBe(true)
  })
})
