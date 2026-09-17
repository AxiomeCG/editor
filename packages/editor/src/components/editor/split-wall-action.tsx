'use client'
import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Scissors } from 'lucide-react'
import { useWallSplit } from '../../store/use-wall-split'

export function SplitWallAction() {
  const selected = useViewer((s) => s.selection.selectedIds)
  const wall = useScene((s) =>
    selected.length === 1 ? s.nodes[selected[0] as AnyNodeId] : undefined,
  )
  const readOnly = useScene((s) => s.readOnly)
  if (wall?.type !== 'wall') return null
  return (
    <button
      type="button"
      aria-label="Split wall"
      title="Split wall"
      disabled={readOnly}
      className="tooltip-trigger rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
      onClick={(event) => {
        event.stopPropagation()
        useWallSplit.getState().open(wall)
      }}
    >
      <Scissors className="size-4" />
    </button>
  )
}
