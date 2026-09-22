import {
  type DoorNode,
  type FacadeUnit,
  type FenceNode,
  LevelNode,
  type SlabNode,
  WallNode,
  useScene,
  type WindowNode,
} from '@pascal-app/core'
import { type FacadeFillPlan, planFacadeFill } from '@pascal-app/core/building'
import {
  buildDoorPreviewMesh,
  buildPanelGeometry,
  buildWindowPreviewMesh,
  createMaterial,
  resolveMaterialRef,
} from '@pascal-app/viewer'
import {
  BoxGeometry,
  type BufferGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Shape,
  Vector2,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** The studio's test wall: thick enough for window reveals to read. */
const STUDIO_WALL_THICKNESS = 0.25
const RAIL = 0.04

export type FaceRect = { x0: number; x1: number; y0: number; y1: number }

/**
 * The wall face minus its openings, as rectangles. Column by column, so an
 * opening that reaches the floor — a door — needs no special case.
 */
export function wallFaceBoxes(
  width: number,
  height: number,
  openings: readonly { left: number; right: number; bottom: number; top: number }[],
): FaceRect[] {
  const clampX = (x: number) => Math.min(width, Math.max(0, x))
  const xs = [...new Set([0, width, ...openings.flatMap((o) => [clampX(o.left), clampX(o.right)])])]
    .sort((a, b) => a - b)
  const boxes: FaceRect[] = []
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i]!
    const x1 = xs[i + 1]!
    if (x1 - x0 < 1e-6) continue
    const mid = (x0 + x1) / 2
    const cuts = openings
      .filter((o) => o.left < mid && mid < o.right)
      .map((o) => [Math.max(0, o.bottom), Math.min(height, o.top)] as const)
      .sort((a, b) => a[0] - b[0])
    let y = 0
    for (const [bottom, top] of cuts) {
      if (bottom > y) boxes.push({ x0, x1, y0: y, y1: bottom })
      y = Math.max(y, top)
    }
    if (height > y) boxes.push({ x0, x1, y0: y, y1: height })
  }
  return boxes
}

/** Metre UVs across the whole face, so a finish runs continuously over every box. */
function faceBox(rect: FaceRect, depth: number): BufferGeometry {
  const geometry = new BoxGeometry(rect.x1 - rect.x0, rect.y1 - rect.y0, depth)
  geometry.translate((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2, 0)
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, position.getX(i), position.getY(i))
  return geometry
}

function openingRect(node: WindowNode | DoorNode) {
  return {
    left: node.position[0] - node.width / 2,
    right: node.position[0] + node.width / 2,
    bottom: node.position[1] - node.height / 2,
    top: node.position[1] + node.height / 2,
  }
}

/**
 * One run of the unit, built with the same planner and builders the real
 * facade uses — windows, doors and panels are the real meshes — on a wall
 * that exists only here. The exterior faces +Z.
 */
export function buildFacadeBayScene(
  unit: FacadeUnit,
  width: number,
  height: number,
): { group: Group; plan: FacadeFillPlan | null; dispose: () => void } {
  const group = new Group()
  const owned: Material[] = []
  const level = LevelNode.parse({ level: 0, height })
  const wall = WallNode.parse({
    parentId: level.id,
    start: [0, 0],
    end: [width, 0],
    thickness: STUDIO_WALL_THICKNESS,
    height,
    frontSide: 'exterior',
    backSide: 'interior',
  })

  // `scene:` paint resolves against the open project, as it will once applied.
  const materials = useScene.getState().materials
  const paint = (ref: string | undefined) => resolveMaterialRef(ref, materials)

  let plan: FacadeFillPlan | null = null
  try {
    plan = planFacadeFill({
      walls: [wall],
      nodes: { [level.id]: level, [wall.id]: wall },
      unit,
    })
  } catch {
    // The elevation shows the resolver's message; the 3D view shows the bare wall.
  }
  const wallPlan = plan?.walls[0]
  const openings = (wallPlan?.openings.values ?? []) as (WindowNode | DoorNode)[]

  const faces = wallFaceBoxes(width, height, openings.map(openingRect)).map((rect) =>
    faceBox(rect, STUDIO_WALL_THICKNESS),
  )
  if (faces.length) {
    const wallMesh = new Mesh(
      mergeGeometries(faces),
      paint(unit.paint.wall) ?? createMaterial(),
    )
    for (const face of faces) face.dispose()
    wallMesh.castShadow = true
    wallMesh.receiveShadow = true
    group.add(wallMesh)
  }

  for (const opening of openings) {
    const mesh =
      opening.type === 'door'
        ? buildDoorPreviewMesh(opening as DoorNode)
        : buildWindowPreviewMesh(opening as WindowNode)
    mesh.position.set(...opening.position)
    mesh.traverse((object) => {
      object.castShadow = true
    })
    group.add(mesh)
  }

  for (const panel of wallPlan?.panels.values ?? []) {
    const mesh = buildPanelGeometry(panel, { wall, materials })
    mesh.position.set(...panel.position)
    group.add(mesh)
  }

  const metal = new MeshStandardMaterial({ color: '#26292c', roughness: 0.45, metalness: 0.6 })
  const glass = new MeshStandardMaterial({
    color: '#bcd7e4',
    transparent: true,
    opacity: 0.35,
    roughness: 0.1,
    side: DoubleSide,
  })
  const deck = new MeshStandardMaterial({ color: '#a4a8ab', roughness: 0.85 })
  owned.push(metal, glass, deck)
  for (const part of wallPlan?.balconies.values ?? []) {
    if (part.type === 'slab') group.add(balconyDeck(part, paint(part.slots?.surface) ?? deck))
    else group.add(balconyRailing(part, paint(part.slots?.posts) ?? metal, glass))
  }

  const ground = new Mesh(
    new BoxGeometry(width + 12, 0.02, 14),
    new MeshStandardMaterial({ color: '#d9d6d0', roughness: 1 }),
  )
  owned.push(ground.material as Material)
  ground.position.set(width / 2, -0.21, 3)
  ground.receiveShadow = true
  group.add(ground)

  return {
    group,
    plan,
    dispose: () => {
      // Materials from `createMaterial` and the node builders are cached and shared; only
      // what this scene created is disposed.
      group.traverse((object: Object3D) => (object as Mesh).geometry?.dispose())
      for (const material of owned) material.dispose()
    },
  }
}

/** The deck's top sits on the floor; plan (x, z) extrudes downwards by its thickness. */
function balconyDeck(slab: SlabNode, material: Material): Mesh {
  const shape = new Shape(slab.polygon.map(([x, z]) => new Vector2(x, z)))
  const geometry = new ExtrudeGeometry(shape, { depth: slab.thickness ?? 0.18, bevelEnabled: false })
  geometry.rotateX(Math.PI / 2)
  const mesh = new Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** A simplified railing — top rail plus bars, rails or glass — enough to judge the bay. */
function balconyRailing(fence: FenceNode, metal: Material, glass: Material): Group {
  const railing = new Group()
  const [x0, z0] = fence.start
  const [x1, z1] = fence.end
  const length = Math.hypot(x1 - x0, z1 - z0)
  const height = fence.height ?? 1.1
  railing.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2)
  railing.rotation.y = -Math.atan2(z1 - z0, x1 - x0)
  const add = (w: number, h: number, d: number, x: number, y: number, material = metal) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material)
    mesh.position.set(x, y, 0)
    mesh.castShadow = true
    railing.add(mesh)
  }
  add(length, RAIL, RAIL * 1.5, 0, height)
  for (const end of [-1, 1]) add(RAIL, height, RAIL, (end * length) / 2, height / 2)
  // A glass railing is a fence whose infill slot is glass (see `balconyGuard`).
  if (fence.slots?.infill === 'library:preset-glass') add(length, height - 0.1, 0.012, 0, height / 2, glass)
  else if (fence.style === 'rail')
    for (const y of [0.35, 0.7]) add(length, RAIL * 0.6, RAIL * 0.6, 0, y)
  else
    for (let x = -length / 2 + 0.12; x < length / 2 - 0.05; x += 0.12)
      add(0.018, height, 0.018, x, height / 2)
  return railing
}
