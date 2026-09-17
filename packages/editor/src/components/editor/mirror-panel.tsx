'use client'
import { type AnyNodeId, useScene } from '@pascal-app/core'
import {
  mirrorFootprints,
  mirrorPoint,
  mirrorSelection,
  planMirror,
} from '@pascal-app/core/building'
import { useViewer } from '@pascal-app/viewer'
import { useMemo, useState } from 'react'
import { commitMirror } from '../../lib/mirror'
import { useRepeatTools } from '../../store/use-repeat-tools'
import { Button } from '../ui/primitives/button'

export function MirrorPanel({ ids }: { ids: AnyNodeId[] }) {
  const nodes = useScene((s) => s.nodes)
  const readOnly = useScene((s) => s.readOnly)
  const [axis, setAxis] = useState<'x' | 'z'>('x')
  const [position, setPosition] = useState<string | null>(null)
  const [copy, setCopy] = useState(true)
  const [error, setError] = useState('')
  const selection = useMemo(() => {
    try {
      return { nodes: mirrorSelection(nodes, ids), error: '' }
    } catch (e) {
      return { nodes: [], error: (e as Error).message }
    }
  }, [nodes, ids])
  const paths = mirrorFootprints(selection.nodes)
  const points = paths.flat()
  const axisValues = points.map((p) => p[axis === 'x' ? 0 : 1])
  const min = axisValues.length ? Math.min(...axisValues) : 0,
    max = axisValues.length ? Math.max(...axisValues) : 0
  const floor = ids.length === 1 && nodes[ids[0]!]?.type === 'level'
  const coordinate =
    position === null
      ? floor || !copy
        ? (min + max) / 2
        : max
      : position.trim()
        ? Number(position)
        : NaN
  const options = { axis, coordinate, copy }
  let validation = selection.error
  if (!validation) {
    try {
      planMirror(nodes, ids, options)
    } catch (e) {
      validation = (e as Error).message
    }
  }
  const reflected = Number.isFinite(coordinate)
    ? paths.map((p) => p.map((v) => mirrorPoint(v, options)))
    : []
  const all = [...points, ...reflected.flat()]
  const left = Math.min(...(all.length ? all.map((p) => p[0]) : [0])),
    top = Math.min(...(all.length ? all.map((p) => p[1]) : [0]))
  const width = Math.max(1, ...all.map((p) => p[0] - left)),
    height = Math.max(1, ...all.map((p) => p[1] - top))
  const pad = Math.max(width, height) * 0.08
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Mirror axis" className="flex gap-2">
        {(['x', 'z'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={axis === value ? 'secondary' : 'outline'}
            aria-pressed={axis === value}
            onClick={() => {
              setAxis(value)
              setPosition(null)
            }}
          >
            {value === 'x' ? 'Left / right' : 'Front / back'}
          </Button>
        ))}
      </div>
      <label className="flex items-center justify-between gap-2 text-xs">
        Axis position (m)
        <input
          aria-label="Axis position (m)"
          type="number"
          step="0.1"
          className="w-24 rounded-md border border-border bg-background px-2 py-1.5"
          value={position ?? String(Math.round(coordinate * 1000) / 1000)}
          onChange={(e) => setPosition(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
        {floor ? 'Create a floor above' : 'Create a copy'}
      </label>
      <svg
        role="img"
        aria-label="Mirror preview: original in grey, result in purple"
        className="h-48 w-full rounded-lg border border-border bg-muted/30"
        viewBox={`${left - pad} ${top - pad} ${width + 2 * pad} ${height + 2 * pad}`}
      >
        {paths.map((p, i) => (
          <polyline
            key={`before-${i}`}
            points={p.map((v) => v.join(',')).join(' ')}
            fill="none"
            stroke="#94a3b8"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {reflected.map((p, i) => (
          <polyline
            key={`after-${i}`}
            points={p.map((v) => v.join(',')).join(' ')}
            fill="none"
            stroke="#a78bfa"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {Number.isFinite(coordinate) && (
          <line
            x1={axis === 'x' ? coordinate : left - pad}
            x2={axis === 'x' ? coordinate : left + width + pad}
            y1={axis === 'z' ? coordinate : top - pad}
            y2={axis === 'z' ? coordinate : top + height + pad}
            stroke="#f59e0b"
            strokeWidth="1"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {(validation || error) && (
        <p role="alert" className="text-xs text-destructive">
          {validation || error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => useRepeatTools.getState().close()}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={readOnly || !!validation}
          onClick={() => {
            try {
              const result = commitMirror(ids, options)
              if (floor)
                useViewer
                  .getState()
                  .setSelection({ levelId: result[0] as `level_${string}`, selectedIds: [] })
              else useViewer.getState().setSelection({ selectedIds: result })
              useRepeatTools.getState().close()
            } catch (e) {
              setError((e as Error).message)
            }
          }}
        >
          {copy ? 'Create mirror' : 'Apply mirror'}
        </Button>
      </div>
    </div>
  )
}
