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
  const url = await loadAssetUrl(image.url)
  if (!url) throw Error('The plan file is unavailable.')
  const response = await fetch(url, { signal })
  if (!response.ok) throw Error('The reference image could not be loaded.')
  const bitmap = await createImageBitmap(await response.blob())
  if (signal.aborted) {
    bitmap.close()
    throw new DOMException('Cancelled', 'AbortError')
  }
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale)),
    height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    bitmap.close()
    throw Error('Image processing is unavailable.')
  }
  context.fillStyle = 'white'
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const rgba = context.getImageData(0, 0, width, height).data
  const raw = await new Promise<VectorContour[]>((resolve, reject) => {
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
  const toSource = (p: [number, number]): [number, number] => [
    (p[0] * image.width) / width,
    (p[1] * image.height) / height,
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
    svg: contoursSvg(contours, image.width, image.height),
    method: 'local-raster-contours-v1',
    options,
  }
}
