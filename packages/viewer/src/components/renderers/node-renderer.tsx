'use client'

import {
  type AnyNode,
  isNodeKindEnabled,
  nodeRegistry,
  type RendererSource,
  useScene,
} from '@pascal-app/core'
import { type ComponentType, lazy, type ReactNode, Suspense } from 'react'
import { useArrayRendering } from '../../store/use-array-rendering'
import { ParametricNodeRenderer } from './parametric-node-renderer'

// Cache lazy components by their RendererSource so React.lazy isn't re-invoked
// on every render — that would create a new Suspense boundary each time.
const lazyCache = new WeakMap<RendererSource<AnyNode>, ComponentType<{ node: AnyNode }>>()

export function getRegistryRenderer(
  source: RendererSource<AnyNode>,
): ComponentType<{ node: AnyNode }> | null {
  const cached = lazyCache.get(source)
  if (cached) return cached
  // GLB / instanced-GLB sources lower onto built-in renderers landed in
  // Phase 5 — for now only parametric (lazy module) sources are honored.
  if (source.kind !== 'parametric') return null
  const Comp = lazy(source.module) as unknown as ComponentType<{ node: AnyNode }>
  lazyCache.set(source, Comp)
  return Comp
}

export const NodeRenderer = ({ nodeId }: { nodeId: AnyNode['id'] }) => {
  const node = useScene((state) => state.nodes[nodeId])
  const installedPlugins = useScene((state) => state.installedPlugins)
  const arrayRendering = useArrayRendering((state) => state.enabled)
  const nativeArrayRoots = useArrayRendering((state) => state.nativeRoots)
  const nativeArrayNodes = useArrayRendering((state) => state.nativeNodeIds)
  const previewRoots = useArrayRendering((state) => state.previewRoots)
  if (!node) return null
  const link = node.metadata.linkedArray as
    | { sourceRootId: string; rootId: AnyNode['id'] }
    | undefined
  const floorArray = link && useScene.getState().nodes[link.rootId]?.type === 'level'
  if (arrayRendering && link && !floorArray && previewRoots?.has(link.sourceRootId)) return null
  // Linked opening records still participate in wall CSG and floor plans.
  // Their visuals share the source mesh through the host's instance layer.
  if (
    arrayRendering &&
    node.metadata.linkedArray &&
    node.type !== 'level' &&
    !nativeArrayNodes?.has(node.id) &&
    !nativeArrayRoots?.has((node.metadata.linkedArray as { sourceRootId: string }).sourceRootId)
  )
    return null
  if (!isNodeKindEnabled(node.type, installedPlugins)) return null
  const def = nodeRegistry.get(node.type)
  if (!def) return null
  // Two-checkbox dispatch (see wiki/architecture/node-definitions.md):
  //  1. Custom renderer — JSX-side composition for kinds that need GLB,
  //     drei, <Html>, instancing, shader materials.
  //  2. Else, if the kind ships `def.geometry`, the generic empty-group
  //     <ParametricNodeRenderer> is filled by <GeometrySystem> from the
  //     pure builder.
  // Keep the whole copied level mounted, including its native batch containers.
  // Hiding only individual meshes would leave those level-owned batches visible.
  const hidePreview = arrayRendering && floorArray
  const present = (content: ReactNode) =>
    hidePreview ? (
      <group
        visible={
          !previewRoots?.has((node.metadata.linkedArray as { sourceRootId: string }).sourceRootId)
        }
      >
        {content}
      </group>
    ) : (
      content
    )
  if (def.renderer) {
    const Renderer = getRegistryRenderer(def.renderer as RendererSource<AnyNode>)
    if (!Renderer) return null
    return present(
      <Suspense fallback={null}>
        <Renderer node={node} />
      </Suspense>,
    )
  }
  if (def.geometry) {
    return present(<ParametricNodeRenderer node={node} />)
  }
  return null
}
