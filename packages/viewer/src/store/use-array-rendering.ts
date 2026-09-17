import { create } from 'zustand'

/** Native nodes remain the fallback unless a host mounts the shared instance renderer. */
export const useArrayRendering = create<{
  enabled: boolean
  nativeRoots: Set<string>
  nativeNodeIds: Set<string>
  previewRoots: Set<string>
}>(() => ({
  enabled: false,
  nativeRoots: new Set(),
  nativeNodeIds: new Set(),
  previewRoots: new Set(),
}))
