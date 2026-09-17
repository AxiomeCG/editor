import { type TraceOptions, tracePlanRaster } from './vectorize'

self.onmessage = (
  event: MessageEvent<{
    rgba: Uint8ClampedArray
    width: number
    height: number
    options: TraceOptions
  }>,
) => {
  try {
    const { rgba, width, height, options } = event.data
    self.postMessage({ contours: tracePlanRaster(rgba, width, height, options) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Vectorization failed.' })
  }
}
