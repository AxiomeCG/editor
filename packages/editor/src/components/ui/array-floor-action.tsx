'use client'

import { type LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Layers3 } from 'lucide-react'
import useEditor from '../../store/use-editor'
import { useRepeatTools } from '../../store/use-repeat-tools'

export function ArrayFloorAction({ levelId, compact = false }: { levelId: LevelNode['id']; compact?: boolean }) {
  const enabled = useRepeatTools((state) => state.enabled)
  const level = useScene((state) => state.nodes[levelId])
  const readOnly = useScene((state) => state.readOnly)
  if (!enabled || level?.type !== 'level' || level.metadata.placeholderSource) return null
  return (
    <button
      type="button"
      title="Array floor"
      aria-label="Array floor"
      disabled={readOnly}
      className={compact
        ? 'flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-accent disabled:opacity-50'
        : 'flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50'}
      onClick={(event) => {
        event.stopPropagation()
        useEditor.getState().setMode('select')
        useViewer.getState().setSelection({ levelId, buildingId: level.parentId as import('@pascal-app/core').BuildingNode['id'], selectedIds: [] })
        useRepeatTools.getState().open({ kind: 'array', ids: [levelId] })
      }}
    >
      <Layers3 className="h-3.5 w-3.5" />
      {!compact && 'Array floor…'}
    </button>
  )
}
