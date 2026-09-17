'use client'
import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { FlipHorizontal2 } from 'lucide-react'
import useEditor from '../../store/use-editor'
import { useRepeatTools } from '../../store/use-repeat-tools'

export function MirrorAction({
  ids,
  className,
  label,
}: {
  ids?: AnyNodeId[]
  className: string
  label?: string
}) {
  const enabled = useRepeatTools((s) => s.enabled)
  const readOnly = useScene((s) => s.readOnly)
  if (!enabled) return null
  return (
    <button
      type="button"
      aria-label={label ?? 'Mirror'}
      title={label ?? 'Mirror'}
      className={className}
      disabled={readOnly}
      onClick={(event) => {
        event.stopPropagation()
        useEditor.getState().setMode('select')
        useRepeatTools
          .getState()
          .open({
            kind: 'mirror',
            ids: ids ?? (useViewer.getState().selection.selectedIds as AnyNodeId[]),
          })
      }}
    >
      <FlipHorizontal2 className="h-4 w-4" />
      {label && <span>{label}…</span>}
    </button>
  )
}
