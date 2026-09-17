'use client'
import { create } from 'zustand'
import { type BalconyOptions, DEFAULT_BALCONY } from '@pascal-app/core/building'

export const useBalconyTool = create<{
  active: boolean
  options: BalconyOptions
  elevation: number
  setActive: (active: boolean) => void
  setOptions: (options: BalconyOptions) => void
  setElevation: (elevation: number) => void
}>((set) => ({
  active: false,
  options: { ...DEFAULT_BALCONY },
  elevation: 0,
  setActive: (active) => set({ active }),
  setOptions: (options) => set({ options }),
  setElevation: (elevation) => set({ elevation }),
}))
