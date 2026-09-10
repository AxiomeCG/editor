import type { AnyNode } from '@pascal-app/core'
import { AnyNode as AnyNodeSchema } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { FloorplanImportCounts } from './native'

export interface NativeMeshData {
  nodeId: string
  name: string
  kind: string
  positions: number[]
  normals: number[]
  index: number[] | null
  matrix: number[]
  groups: { start: number; count: number; materialIndex: number }[]
  materials: { color: string; opacity: number; transparent: boolean }[]
}
export interface NativeSceneData {
  meshes: NativeMeshData[]
}
export interface NativeGeometrySnapshot {
  nodes: Record<string, AnyNode>
}
export interface FloorplanReconstructionSource {
  id: string
  name: string
  imageUrl: string
  width: number
  height: number
  metersPerPixel: number
  sha256: string
}
export interface FloorplanReconstruction extends NativeGeometrySnapshot {
  source: FloorplanReconstructionSource
  levelId: string
  wallHeight: number
  scene: NativeSceneData
  counts: FloorplanImportCounts
  warnings: string[]
}
export interface FloorplanImportProvider {
  source: FloorplanReconstructionSource
  reconstruct(
    request: { metersPerPixel: number; wallHeight: number },
    options: { signal: AbortSignal },
  ): Promise<FloorplanReconstruction>
}
export interface FloorplanPlacement {
  x: number
  z: number
  rotation: number
}

export const reconstructionOptionsSchema = z
  .object({
    metersPerPixel: z.number().finite().min(0.0001).max(0.2),
    wallHeight: z.number().finite().min(0.5).max(12),
  })
  .strict()

/** Validate the fixed sample before any scene insertion; unsupported nodes are errors, not silently skipped. */
export function parseReconstructionNodes(input: Record<string, unknown>): Record<string, AnyNode> {
  if (Object.keys(input).length > 1000)
    throw new Error('The floorplan sample exceeds the native node limit.')
  const nodes: Record<string, AnyNode> = {}
  for (const [id, value] of Object.entries(input)) {
    const node = AnyNodeSchema.parse(value)
    if (
      node.id !== id ||
      !['building', 'level', 'wall', 'door', 'window', 'zone', 'block', 'slab'].includes(node.type)
    )
      throw new Error(`Unsupported sample node ${id}`)
    nodes[id] = node
  }
  for (const node of Object.values(nodes)) {
    if (node.parentId && !nodes[node.parentId]) throw new Error(`Detached sample node ${node.id}`)
    if (
      (node.type === 'door' || node.type === 'window') &&
      (nodes[node.parentId!]?.type !== 'wall' || node.wallId !== node.parentId)
    )
      throw new Error(`Detached sample opening ${node.id}`)
  }
  return nodes
}

/** Change scale and height in semantic data first, so preview and committed primitive geometry agree. */
export function rescaleReconstructionNodes(
  input: Record<string, AnyNode>,
  baseMetersPerPixel: number,
  options: { metersPerPixel: number; wallHeight: number },
): Record<string, AnyNode> {
  const scale = options.metersPerPixel / baseMetersPerPixel
  const nodes = structuredClone(input)
  for (const node of Object.values(nodes)) {
    if (node.type === 'wall') {
      node.start = [node.start[0] * scale, node.start[1] * scale]
      node.end = [node.end[0] * scale, node.end[1] * scale]
      node.thickness = (node.thickness ?? 0.1) * scale
      node.height = options.wallHeight
    } else if (node.type === 'door' || node.type === 'window') {
      node.position[0] *= scale
      node.width *= scale
      const sill = node.type === 'window' ? Math.min(0.9, options.wallHeight * 0.35) : 0
      node.height = Math.min(node.type === 'window' ? 1.2 : 2.1, options.wallHeight - sill - 0.05)
      node.position[1] = sill + node.height / 2
    } else if (node.type === 'zone') {
      node.polygon = node.polygon.map(([x, z]) => [x * scale, z * scale])
      node.ceilingHeight = options.wallHeight
    } else if (node.type === 'slab') {
      node.polygon = node.polygon.map(([x, z]) => [x * scale, z * scale])
      node.holes = node.holes.map((hole) => hole.map(([x, z]) => [x * scale, z * scale]))
    } else if (node.type === 'block') {
      node.position[0] *= scale
      node.position[2] *= scale
      const top = Math.max(...node.topology.vertices.map((vertex) => vertex.position[1]), 0.1)
      const verticalScale = Math.min(1, (options.wallHeight - 0.05) / top)
      for (const vertex of node.topology.vertices)
        vertex.position = [
          vertex.position[0] * scale,
          vertex.position[1] * verticalScale,
          vertex.position[2] * scale,
        ]
    } else if (node.type === 'level') node.height = options.wallHeight
  }
  return nodes
}

/** Three.js positive Y yaw: same transform used by the guide, ghost, and native commit. */
export function placeFloorplanPoint(
  point: [number, number],
  placement: FloorplanPlacement,
  pivot: [number, number],
): [number, number] {
  const x = point[0] - pivot[0],
    z = point[1] - pivot[1],
    c = Math.cos(placement.rotation),
    s = Math.sin(placement.rotation)
  return [placement.x + x * c + z * s, placement.z - x * s + z * c]
}

export function placeFloorplanNode(
  node: AnyNode,
  placement: FloorplanPlacement,
  pivot: [number, number],
): AnyNode {
  if (node.type === 'wall')
    return {
      ...node,
      start: placeFloorplanPoint(node.start, placement, pivot),
      end: placeFloorplanPoint(node.end, placement, pivot),
    }
  if (node.type === 'zone')
    return {
      ...node,
      polygon: node.polygon.map((point) => placeFloorplanPoint(point, placement, pivot)),
    }
  if (node.type === 'slab')
    return {
      ...node,
      polygon: node.polygon.map((point) => placeFloorplanPoint(point, placement, pivot)),
      holes: node.holes.map((hole) =>
        hole.map((point) => placeFloorplanPoint(point, placement, pivot)),
      ),
    }
  if (node.type === 'block') {
    const [x, z] = placeFloorplanPoint([node.position[0], node.position[2]], placement, pivot)
    return {
      ...node,
      position: [x, node.position[1], z],
      rotation: node.rotation + placement.rotation,
    }
  }
  // Hosted openings remain wall-local. Their parent wall carries the rigid placement.
  return node
}
