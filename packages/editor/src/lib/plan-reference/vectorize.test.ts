import { describe, expect, test } from 'bun:test'
import { contoursSvg, tracePlanRaster, type VectorContour } from './vectorize'

const WHITE = [255, 255, 255, 255] as const
const BLACK = [0, 0, 0, 255] as const

function raster(width: number, height: number, paint: (x: number, y: number) => readonly number[]) {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rgba.set(paint(x, y), (y * width + x) * 4)
  return rgba
}

describe('tracePlanRaster', () => {
  test('keeps thin wall strokes when traced at a resolution where they clear the minimum area', () => {
    // 1000×1000 with a 4 px × 200 px wall line: ~800 ink px, well past minArea 80.
    // At the old intrinsic 80 px trace size this line was 11 px² and vanished.
    const rgba = raster(1000, 1000, (x, y) =>
      x >= 500 && x < 504 && y >= 400 && y < 600 ? BLACK : WHITE,
    )

    const contours = tracePlanRaster(rgba, 1000, 1000, {
      threshold: 145,
      minArea: 80,
      mode: 'ink',
    })

    expect(contours).toHaveLength(1)
    expect(contours[0]!.area).toBe(800)
  })

  test('drops ink below the minimum area', () => {
    const rgba = raster(1000, 1000, (x, y) =>
      x >= 500 && x < 502 && y >= 500 && y < 502 ? BLACK : WHITE,
    )

    expect(
      tracePlanRaster(rgba, 1000, 1000, { threshold: 145, minArea: 80, mode: 'ink' }),
    ).toHaveLength(0)
  })

  test('traces enclosed spaces but not regions reaching the canvas border', () => {
    const rgba = raster(200, 200, (x, y) => {
      const inRing = x < 2 || y < 2 || x > 197 || y > 197
      const inBox = x >= 50 && x < 80 && y >= 50 && y < 80
      return inRing || (inBox && (x === 50 || x === 79 || y === 50 || y === 79)) ? BLACK : WHITE
    })

    const contours = tracePlanRaster(rgba, 200, 200, {
      threshold: 145,
      minArea: 80,
      mode: 'spaces',
    })

    expect(contours).toHaveLength(1)
    expect(contours[0]!.area).toBeLessThan(30 * 30)
  })
})

describe('contoursSvg', () => {
  const line: VectorContour = {
    id: 'a',
    points: [
      [0, 0],
      [10, 0],
    ],
    holes: [],
    area: 0,
    stroke: true,
    strokeWidth: 2,
  }
  const room: VectorContour = {
    id: 'b',
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    holes: [],
    area: 50,
  }

  test('renders room fills light with a thin outline outside ink mode', () => {
    const svg = contoursSvg([room], 10, 10)

    expect(svg).toContain('fill="#E4E4E7"')
    expect(svg).toContain('stroke="#52525B"')
    expect(svg).not.toContain('fill="#171717"')
  })

  test('keeps ink contours dark so traced linework stays visible', () => {
    const svg = contoursSvg([room], 10, 10, 'ink')

    expect(svg).toContain('fill="#171717"')
    expect(svg).not.toContain('fill="#E4E4E7"')
  })

  test('renders stroke contours as unfilled lines in both modes', () => {
    for (const mode of [undefined, 'ink', 'spaces'] as const) {
      const svg = contoursSvg([line], 10, 10, mode)
      expect(svg).toContain('fill="none"')
      expect(svg).toContain('stroke-width="2"')
    }
  })
})
