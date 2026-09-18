'use client'

import { type GuideNode, type LevelNode, loadAssetUrl, runAsSingleSceneHistoryStep, useScene } from '@pascal-app/core'
import { useEffect, useRef, useState } from 'react'
import type { ReferenceOutline } from '../../lib/plan-reference/outlines'
import { extractSvgPlanShapes } from '../../lib/plan-reference/svg-shapes'
import { contoursSvg } from '../../lib/plan-reference/vectorize'
import { guideReference } from '../../lib/plan-reference/workspace'
import useEditor from '../../store/use-editor'
import { usePlanWorkspace } from '../../store/use-plan-workspace'
import { Button } from './primitives/button'

export function ReferenceShapeActions({ guide, level }: { guide: GuideNode; level: LevelNode }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: Edits to this guide invalidate pending SVG reads.
  useEffect(() => () => request.current?.abort(), [guide])
  const svg =
    (guide.metadata.planReference as { mimeType?: string } | undefined)?.mimeType ===
      'image/svg+xml' ||
    /\.svg(?:$|\?)/i.test(guide.url) ||
    guide.url.startsWith('data:image/svg+xml')
  const cached = guide.metadata.planVectors as
    | { outlines?: ReferenceOutline[]; originalUrl?: string }
    | undefined
  const originalUrl = cached?.originalUrl
  const choose = async (file?: File) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      if (file && file.size > 6 * 1024 * 1024) throw Error('Choose an SVG under 6 MB.')
      const view = guideReference(guide)
      let outlines = !file ? cached?.outlines : undefined
      if (!outlines) {
        const source = file
          ? await file.text()
          : await loadAssetUrl(guide.url)
              .then((url) => {
                if (!url) throw Error('The plan file is unavailable.')
                return fetch(url, { signal: controller.signal })
              })
              .then((r) => {
                if (!r.ok) throw Error('The SVG could not be loaded.')
                return r.text()
              })
        outlines = extractSvgPlanShapes(source, view.image, view.transform.metersPerPixel)
      }
      if (controller.signal.aborted) return
      usePlanWorkspace.getState().openShapes(level, guide, outlines)
      usePlanWorkspace.getState().setSelectionMode('areas')
      if (usePlanWorkspace.getState().draft) useEditor.getState().setSelectedReferenceId(null)
      if (file) {
        const d = usePlanWorkspace.getState().draft
        if (d?.mode === 'shapes' && d.guide.id === guide.id && d.levelId === level.id) {
          const converted = contoursSvg(
            d.shapes.map((s) => ({ ...s, area: 0 })),
            view.image.width,
            view.image.height,
            // Imported SVGs mix wall lines with furniture polygons; the light
            // area look keeps the overlay readable either way.
            undefined,
          )
          usePlanWorkspace
            .getState()
            .change((current) =>
              current.mode === 'shapes'
                ? { ...current, vectors: { svg: converted, outlines, method: 'imported-svg' } }
                : current,
            )
        }
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Unable to select these shapes.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {svg || cached?.outlines ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 flex-1 px-1 text-[11px]"
            disabled={busy}
            onClick={() => void choose()}
          >
            {busy ? 'Reading contours…' : 'Select SVG shapes'}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 flex-1 px-1 text-[11px]"
            onClick={() => usePlanWorkspace.getState().openVectorize(level, guide)}
          >
            Vectorize & select
          </Button>
        )}
        <label
          className="relative flex h-7 cursor-pointer items-center rounded-md px-2 text-[11px] hover:bg-accent"
          title="Use an SVG vectorization in this reference’s image frame"
        >
          Use SVG
          <input
            type="file"
            aria-label={`Use SVG for ${guide.name}`}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
            accept="image/svg+xml,.svg"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void choose(file)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {originalUrl && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-full px-1 text-[11px]"
          onClick={() => {
            if (useScene.getState().readOnly) return
            runAsSingleSceneHistoryStep(useScene, () =>
              useScene.getState().updateNode(guide.id, {
                url: originalUrl,
                metadata: { ...guide.metadata, planVectors: undefined },
              } as Partial<GuideNode>),
            )
          }}
        >
          Restore original image
        </Button>
      )}
      {!guide.scaleReference && (
        <p className="text-[11px] leading-4 text-muted-foreground">
          Uses the current plan scale. Calibration is optional.
        </p>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
