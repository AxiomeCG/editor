'use client'

import { useEffect, useState } from 'react'
import { usePlanWorkspace } from '../../store/use-plan-workspace'
import { vectorizePlanImage } from './vectorize-image'
import type { PlanWorkspaceDraft } from './workspace'

export function useVectorizePlan(draft: PlanWorkspaceDraft | null) {
  const shape = draft?.mode === 'shapes' ? draft : null
  const id = shape?.id,
    options = shape?.traceOptions,
    image = shape?.image,
    guide = shape?.guide
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!id || !options || !image || !guide) {
      setBusy(false)
      return
    }
    const abort = new AbortController()
    setBusy(true)
    usePlanWorkspace
      .getState()
      .change((d) => (d.mode === 'shapes' ? { ...d, vectors: undefined, selected: [] } : d))
    const timer = setTimeout(async () => {
      try {
        const originalUrl = (guide.metadata.planVectors as { originalUrl?: string } | undefined)
          ?.originalUrl
        const result = await vectorizePlanImage(
          { ...image, url: originalUrl ?? image.url },
          options,
          abort.signal,
        )
        if (abort.signal.aborted || usePlanWorkspace.getState().draft?.id !== id) return
        const outlines = result.contours.map((c) => ({
          id: c.id,
          type: 'Polygon' as const,
          points: c.points.map((p) => p.join(',')).join(' '),
          holes: c.holes.map((h) => h.map((p) => p.join(',')).join(' ')),
        }))
        usePlanWorkspace.getState().change((d) =>
          d.mode === 'shapes'
            ? {
                ...d,
                shapes: result.contours,
                vectors: { svg: result.svg, method: result.method, options, outlines },
              }
            : d,
        )
      } catch (error) {
        if (!abort.signal.aborted)
          usePlanWorkspace.setState({
            error: error instanceof Error ? error.message : 'Vectorization failed.',
          })
      } finally {
        if (!abort.signal.aborted) setBusy(false)
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [id, options, image, guide])
  return busy
}
