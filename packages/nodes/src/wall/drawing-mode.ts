import { emitter } from '@pascal-app/core'
import { create } from 'zustand'

export const useWallDrawingMode = create<{
  mode: 'line' | 'rectangle'
  setMode: (mode: 'line' | 'rectangle') => void
}>((set) => ({
  mode: 'line',
  setMode: (mode) => {
    emitter.emit('tool:cancel')
    set({ mode })
  },
}))
