'use client'
import type { AnyNodeId } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Layers3 } from 'lucide-react'
import { useRepeatTools } from '../../store/use-repeat-tools'

export function ArrayAction({className}: {className: string}) {
  const enabled = useRepeatTools(s => s.enabled)
  if (!enabled) return null
  return <button aria-label="Array" title="Array: linked copies" type="button" className={className} onClick={event => {
    event.stopPropagation()
    useRepeatTools.getState().open({kind:'array', ids:useViewer.getState().selection.selectedIds as AnyNodeId[]})
  }}><Layers3 className="h-4 w-4"/></button>
}
