'use client'

import type { PlanPoint } from './calibration'
import type { PlanShape } from './selection-geometry'
import { simplifyContour, traceRegionAtPoint } from './vectorize'
import { rasterizePlanImage } from './vectorize-image'

/**
 * Flood-fills the plan whitespace containing `seedPixel` (image pixels) and
 * returns it as a selectable area shape. Wall strokes thicker than the gap
 * tolerance seal automatically, so hairline cracks do not leak the region.
 */
export async function pickWhitespaceRegion(args: {
  image: { url: string; width: number; height: number }
  seedPixel: PlanPoint
  metersPerPixel: number
  gapToleranceMeters: number
}): Promise<PlanShape | null> {
  const raster = await rasterizePlanImage(args.image.url)
  // Map through the reference's own pixel frame (as tracing does), not the
  // decoded image's natural size, which can differ for SVG plans.
  const scaleX = raster.width / args.image.width,
    scaleY = raster.height / args.image.height
  const seed: [number, number] = [args.seedPixel[0] * scaleX, args.seedPixel[1] * scaleY]
  // Each barrier side grows by half the tolerance, sealing gaps up to it.
  const dilate =
    args.gapToleranceMeters > 0 ? ((args.gapToleranceMeters / args.metersPerPixel) * scaleX) / 2 : 0
  const region = traceRegionAtPoint(raster.rgba, raster.width, raster.height, seed, {
    threshold: 145,
    minArea: 64,
    dilatePixels: Math.round(dilate),
  })
  if (!region) return null
  const metersPerRasterPx = args.metersPerPixel / scaleX
  let tolerance = Math.max(1, 0.015 / metersPerRasterPx)
  let points = simplifyContour(region.points, tolerance)
  let holes = region.holes.map((h) => simplifyContour(h, tolerance))
  // Outlines must fit the 1024-point polygon cap downstream.
  while (points.length > 900) {
    tolerance *= 1.6
    points = simplifyContour(region.points, tolerance)
    holes = region.holes.map((h) => simplifyContour(h, tolerance))
  }
  const toImage = (p: [number, number]): [number, number] => [p[0] / scaleX, p[1] / scaleY]
  return {
    id: `fill-${crypto.randomUUID()}`,
    points: points.map(toImage),
    holes: holes.map((h) => h.map(toImage)),
  }
}
