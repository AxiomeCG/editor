import { calculateLevelMiters } from '@pascal-app/core'
import { Group, Mesh, Color, Shape, ShapeGeometry, Vector2, MeshBasicMaterial, DoubleSide, type BufferAttribute, type Material } from 'three'
import { generateExtrudedWall } from '../../../packages/viewer/src/systems/wall/wall-system'
import { buildDoorPreviewMesh } from '../../../packages/viewer/src/systems/door/door-system'
import { buildWindowPreviewMesh } from '../../../packages/viewer/src/systems/window/window-system'
import { buildBlockGeometry } from '../../../packages/nodes/src/block/geometry'
import type { NativeMaskPreview } from './comparison-types'

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
export interface NativeSceneData { meshes: NativeMeshData[] }

/** Same wall CSG, miters, doors, windows and primitive builders as Pascal; no scene-store installation. */
export function buildNativePreviewScene(preview: NativeMaskPreview): NativeSceneData {
  const nodes = preview.nodes, walls = Object.values(nodes).filter(n => n.type === 'wall')
  const miters = calculateLevelMiters(walls), root = new Group()
  const wallGroups = new Map<string, Group>()
  for (const wall of walls) {
    const group = new Group()
    group.position.set(wall.start[0], 0, wall.start[1])
    group.rotation.y = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
    const geometry = generateExtrudedWall(wall, wall.children.map(id => nodes[id]!).filter(Boolean), miters, 0, 0, undefined, wall.height ?? 2.8)
    const mesh = new Mesh(geometry)
    mesh.userData.previewNode = { id: wall.id, name: wall.name ?? 'Wall', kind: 'wall' }
    group.add(mesh); root.add(group); wallGroups.set(wall.id, group)
  }
  for (const node of Object.values(nodes)) {
    let object: Group | Mesh | undefined
    if (node.type === 'door' || node.type === 'window') {
      object = node.type === 'door' ? buildDoorPreviewMesh(node) : buildWindowPreviewMesh(node)
      object.position.set(...node.position)
      object.rotation.set(...node.rotation)
      wallGroups.get(node.wallId ?? '')?.add(object)
    } else if (node.type === 'block') {
      object = buildBlockGeometry(node, undefined, 'rendered', false)
      object.position.set(...node.position); object.rotation.y = node.rotation; root.add(object)
    } else if (node.type === 'zone') {
      const shape = new Shape(node.polygon.map(([x, z]) => new Vector2(x, -z)))
      const geometry = new ShapeGeometry(shape)
      geometry.rotateX(-Math.PI / 2)
      object = new Mesh(geometry, new MeshBasicMaterial({ color: node.color, side: DoubleSide }))
      object.position.y = 0.01
      root.add(object)
    }
    if (object) object.traverse(child => { child.userData.previewNode = { id: node.id, name: node.name ?? node.type, kind: node.type } })
  }
  root.updateMatrixWorld(true)
  const meshes: NativeMeshData[] = [], geometries = new Set<Mesh['geometry']>(), materials = new Set<Material>()
  root.traverse(object => {
    if (!(object instanceof Mesh)) return
    geometries.add(object.geometry)
    const positions = object.geometry.getAttribute('position') as BufferAttribute | undefined
    if (!positions?.count) return
    const normals = object.geometry.getAttribute('normal') as BufferAttribute | undefined
    const identity = object.userData.previewNode
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of sourceMaterials) materials.add(material)
    const color = identity.kind === 'wall' ? '#dfddd5' : identity.kind === 'zone' ? '#c3d5c7' : identity.kind === 'block' ? '#b28f68' : '#b1bbc1'
    meshes.push({ nodeId: identity.id, name: identity.name, kind: identity.kind,
      positions: Array.from(positions.array), normals: normals ? Array.from(normals.array) : [],
      index: object.geometry.index ? Array.from(object.geometry.index.array) : null,
      matrix: object.matrixWorld.toArray(),
      groups: object.geometry.groups.map((group: { start: number; count: number; materialIndex?: number }) => ({ start: group.start, count: group.count, materialIndex: group.materialIndex ?? 0 })),
      materials: sourceMaterials.map(material => {
        const glass = material.transparent && material.opacity < .9
        const materialColor = 'color' in material && material.color instanceof Color ? material.color : null
        return { color: identity.kind === 'zone' && materialColor ? '#' + materialColor.getHexString() : glass ? '#adcbd2' : color,
          opacity: glass ? Math.max(.25, material.opacity) : 1, transparent: glass }
      }),
    })
  })
  for (const geometry of geometries) geometry.dispose()
  // Native builders may share cached materials. Only the temporary wall defaults are owned here.
  for (const material of materials) if (material.type === 'MeshBasicMaterial') material.dispose()
  return { meshes }
}
