'use client'

import { loadAssetUrl } from '@pascal-app/core'
import type { ReferenceImage } from './guides'
import { contoursSvg, type TraceOptions, type VectorContour } from './vectorize'

/** Worker tracing leaves native viewport navigation responsive. No image is uploaded. */
export async function vectorizePlanImage(
  image: ReferenceImage,
  options: TraceOptions,
  signal: AbortSignal,
) {
  const raster = await rasterizePlanImage(image.url, signal)
  const raw = await traceInWorker({
    rgba: raster.rgba,
    width: raster.width,
    height: raster.height,
    options,
    signal,
  })
  const toSource = (p: [number, number]): [number, number] => [
    (p[0] * image.width) / raster.width,
    (p[1] * image.height) / raster.height,
  ]
  const contours = raw.map((c) => ({
    ...c,
    points: c.points.map(toSource),
    holes: c.holes.map((h) => h.map(toSource)),
  }))
  if (!contours.length)
    throw Error('No usable contours found. Try a higher threshold or trace spaces instead.')
  return {
    contours,
    svg: contoursSvg(contours, image.width, image.height, options.mode),
    method: 'local-raster-contours-v1',
    options,
  }
}

export type PlanRaster = {
  rgba: Uint8ClampedArray
  width: number
  height: number
  /** Raster pixels per source-image pixel. */
  scale: number
}

/** Decode + rasterize a plan at a trace-friendly resolution (sharp for SVGs). */
export async function rasterizePlanImage(
  url: string,
  signal?: AbortSignal,
): Promise<PlanRaster> {
  const resolved = await loadAssetUrl(url)
  if (!resolved) throw Error('The plan file is unavailable.')
  const response = await fetch(resolved, { signal })
  if (!response.ok) throw Error('The reference image could not be loaded.')
  const blob = await response.blob()
  // Decoding through an <img> (not createImageBitmap) lets SVG plans rasterize
  // sharply at the trace resolution instead of their intrinsic pixel size.
  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = objectUrl
    await img.decode()
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const sourceWidth = img.naturalWidth || 1,
      sourceHeight = img.naturalHeight || 1
    const longest = Math.max(sourceWidth, sourceHeight)
    // Small plans (e.g. 80-unit SVGs) must be traced large enough that wall
    // strokes survive the minimum-area filter; large ones are capped.
    const scale = longest > 1400 ? 1400 / longest : longest < 1000 ? 1000 / longest : 1
    const width = Math.max(1, Math.round(sourceWidth * scale)),
      height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw Error('Image processing is unavailable.')
    context.fillStyle = 'white'
    context.fillRect(0, 0, width, height)
    context.drawImage(img, 0, 0, width, height)
    return { rgba: context.getImageData(0, 0, width, height).data, width, height, scale }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function traceInWorker({
  rgba,
  width,
  height,
  options,
  signal,
}: {
  rgba: Uint8ClampedArray
  width: number
  height: number
  options: TraceOptions
  signal: AbortSignal
}) {
  return await new Promise<VectorContour[]>((resolve, reject) => {
    const worker = new Worker(new URL('./vectorize.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => {
      clearTimeout(timeout)
      worker.terminate()
      signal.removeEventListener('abort', cancel)
    }
    const cancel = () => {
      cleanup()
      reject(new DOMException('Cancelled', 'AbortError'))
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(Error('Tracing took too long. Try a smaller image.'))
    }, 30000)
    signal.addEventListener('abort', cancel, { once: true })
    worker.onmessage = (event: MessageEvent<{ contours?: VectorContour[]; error?: string }>) => {
      cleanup()
      if (event.data.error) reject(Error(event.data.error))
      else resolve(event.data.contours ?? [])
    }
    worker.onerror = () => {
      cleanup()
      reject(Error('The vectorization worker could not run.'))
    }
    if (signal.aborted) return cancel()
    worker.postMessage({ rgba, width, height, options }, [rgba.buffer])
  })
}
