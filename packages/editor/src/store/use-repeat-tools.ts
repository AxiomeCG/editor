'use client'
import type { AnyNodeId } from '@pascal-app/core'
import { create } from 'zustand'

export type RepeatRequest = {
  kind: 'array' | 'placeholder' | 'floorplan' | 'mirror'
  ids: AnyNodeId[]
}
/** Host opt-in for repetition controls, shared by floor and object action menus. */
export const useRepeatTools = create<{
  enabled: boolean
  request: RepeatRequest | null
  open: (request: RepeatRequest) => void
  close: () => void
}>((set) => ({
  enabled: false,
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}))
