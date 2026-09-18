import { describe, expect, test } from 'bun:test'
import { signedContourArea, traceRegionAtPoint } from './vectorize'

const WHITE: readonly number[] = [255, 255, 255, 255]
const BLACK: readonly number[] = [0, 0, 0, 255]

function raster(
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly number[],
) {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rgba.set(paint(x, y), (y * width + x) * 4)
  return rgba
}

describe('traceRegionAtPoint', () => {
  test('fills the room containing the seed, with ink islands as holes', () => {
    const rgba = raster(200, 200, (x, y) => {
      if (x < 3 || y < 3 || x > 196 || y > 196) return BLACK
      if (x >= 60 && x < 80 && y >= 60 && y < 80) return BLACK
      return WHITE
    })

    const region = traceRegionAtPoint(rgba, 200, 200, [100, 100], {
      threshold: 145,
      minArea: 64,
    })

    expect(region).not.toBeNull()
    expect(region!.holes).toHaveLength(1)
    const area = Math.abs(signedContourArea(region!.points))
    // The outer loop encloses the full 194×194 white interior; the island is a hole.
    expect(area).toBeGreaterThan(194 * 194 - 1)
    expect(area).toBeLessThanOrEqual(194 * 194)
  })

  test('gap tolerance seals a hairline slit so the fill does not leak next door', () => {
    const paint = (x: number, y: number) => {
      // Frame keeps the region off the canvas border (plan exterior guard).
      if (x < 3 || y < 3 || x > 196 || y > 56) return BLACK
      // Vertical wall at x=100..102 with a 3 px slit at y=29..31.
      if (x >= 100 && x < 103 && !(y >= 29 && y < 32)) return BLACK
      return WHITE
    }

    const open = traceRegionAtPoint(raster(200, 60, paint), 200, 60, [50, 30], {
      threshold: 145,
      minArea: 64,
    })
    const sealed = traceRegionAtPoint(raster(200, 60, paint), 200, 60, [50, 30], {
      threshold: 145,
      minArea: 64,
      dilatePixels: 2,
    })

    expect(open).not.toBeNull()
    expect(sealed).not.toBeNull()
    const openArea = Math.abs(signedContourArea(open!.points))
    const sealedArea = Math.abs(signedContourArea(sealed!.points))
    // Without sealing the fill leaks through the slit into the right room.
    expect(openArea).toBeGreaterThan(9000)
    expect(sealedArea).toBeLessThan(openArea * 0.7)
  })

  test('returns null when the seed lands on a line', () => {
    const rgba = raster(100, 100, (x) => (x === 50 ? BLACK : WHITE))

    expect(
      traceRegionAtPoint(rgba, 100, 100, [50, 50], { threshold: 145, minArea: 64 }),
    ).toBeNull()
  })

  test('returns null when the seed is in the whitespace outside the plan', () => {
    const rgba = raster(300, 300, () => WHITE)

    expect(
      traceRegionAtPoint(rgba, 300, 300, [2, 2], { threshold: 145, minArea: 64 }),
    ).toBeNull()
  })
})
