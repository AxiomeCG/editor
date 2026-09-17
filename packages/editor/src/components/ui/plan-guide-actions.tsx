'use client'
import {
  type AnyNodeId,
  getLevelDisplayName,
  type GuideNode,
  type LevelNode,
  useScene,
} from '@pascal-app/core'
import { useEffect, useRef, useState } from 'react'
import { preparePlanGuide } from '../../lib/plan-reference/import'
import { getPlanMatchAnchors } from '../../lib/plan-reference/matching'
import useEditor from '../../store/use-editor'
import { usePlanWorkspace } from '../../store/use-plan-workspace'
import { Button } from './primitives/button'
import { ReferenceShapeActions } from './reference-shape-actions'

/** Plan roles are descriptive; any calibrated guide can anchor the next match. */
export function PlanGuideActions({ guide }: { guide: GuideNode }) {
  const nodes = useScene((s) => s.nodes),
    readOnly = useScene((s) => s.readOnly)
  const [anchorId, setAnchorId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const level = guide.parentId ? nodes[guide.parentId as AnyNodeId] : undefined
  const anchors = getPlanMatchAnchors(guide, nodes)
  const chosen = anchors.find((a) => a.id === anchorId) ?? anchors[0]
  const ready = !!guide.metadata.planReference
  const open = async (match = false) => {
    if (readOnly || level?.type !== 'level' || level.metadata.placeholderSource) return
    setBusy(true)
    setError('')
    try {
      const sources = match && chosen ? [guide, chosen] : [guide]
      if (match && !chosen) throw Error('Calibrate another plan in this building first.')
      const prepared = await Promise.all(sources.map(preparePlanGuide))
      if (!mounted.current) return
      const scene = useScene.getState()
      if (scene.readOnly || sources.some((g) => scene.nodes[g.id] !== g))
        throw Error('A plan changed. Try again with its latest version.')
      const updates = prepared
        .filter((g, i) => g !== sources[i])
        .map((g) => ({ id: g.id, data: { metadata: g.metadata } }))
      if (updates.length) scene.updateNodes(updates)
      usePlanWorkspace
        .getState()
        .openGuide(
          level as LevelNode,
          useScene.getState().nodes[guide.id] as GuideNode,
          match ? (useScene.getState().nodes[chosen!.id] as GuideNode) : undefined,
        )
      if (usePlanWorkspace.getState().draft) useEditor.getState().setSelectedReferenceId(null)
      else throw Error('Select this plan’s floor before editing it.')
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Cannot open this plan.')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  if (level?.type !== 'level' || level.metadata.placeholderSource) return null
  return (
    <fieldset disabled={readOnly || busy} className="space-y-2 disabled:opacity-50">
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full text-xs"
        onClick={() => void open()}
      >
        {busy ? 'Opening plan…' : 'Calibrate in viewport'}
      </Button>
      <div className="flex gap-1">
        <select
          aria-label="Match to calibrated plan"
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
          value={chosen?.id ?? ''}
          onChange={(e) => setAnchorId(e.target.value)}
          disabled={!anchors.length}
        >
          {!anchors.length && <option value="">Calibrate another plan first</option>}
          {anchors.map((a) => (
            <option key={a.id} value={a.id}>
              {getLevelDisplayName(nodes[a.parentId as AnyNodeId] as LevelNode)} · {a.name || 'Plan'}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 text-xs"
          disabled={!chosen}
          onClick={() => void open(true)}
        >
          Match
        </Button>
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">
        Match a shared span to inherit scale and alignment. The reference stays fixed; this plan
        moves.
      </p>
      {ready && <ReferenceShapeActions guide={guide} level={level} />}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  )
}
