'use client'

import { imagePointToLevel } from '@pascal-app/core/building'

import { type AnyNode, sceneRegistry } from '@pascal-app/core'
import { useAssetUrl, useViewer } from '@pascal-app/viewer'
import { type CameraControlsImpl, Html } from '@react-three/drei'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  Matrix4,
  type OrthographicCamera,
  Path,
  type PerspectiveCamera,
  Plane,
  Raycaster,
  Shape,
  ShapeGeometry,
  Sphere,
  TextureLoader,
  Vector2,
  Vector3,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { type PlanPoint } from '../../lib/plan-reference/calibration'
import { useWorkspacePreview } from '../../lib/plan-reference/use-workspace-preview'
import {
  activeReferencePoints,
  type PlanHandle,
  type PlanWorkspaceDraft,
  type ReferenceView,
  workspaceHandles,
  workspaceReferences,
} from '../../lib/plan-reference/workspace'
import { bindPlanWorkspacePointer } from '../../lib/plan-reference/workspace-pointer'
import { usePlanWorkspace } from '../../store/use-plan-workspace'
import { BalconyPreviewGeometry, StandaloneBalconyPreview3D } from './balcony-preview'

const Y = 0.06
function PlanPlane({ view }: { view: ReferenceView }) {
  const url = useAssetUrl(view.image.url)
  return url ? <ResolvedPlanPlane view={view} url={url} /> : null
}
function ResolvedPlanPlane({ view, url }: { view: ReferenceView; url: string }) {
  const texture = useLoader(TextureLoader, url)
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        map: texture,
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      }),
    [texture],
  )
  useEffect(() => () => material.dispose(), [material])
  material.opacity = view.opacity / 100
  const w = view.image.width * view.transform.metersPerPixel,
    h = view.image.height * view.transform.metersPerPixel
  return (
    <group
      position={[view.transform.position[0], Y, view.transform.position[1]]}
      rotation={[0, view.transform.rotation, 0]}
    >
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        material={material}
        renderOrder={view.role === 'floorplan' ? 902 : 901}
        raycast={() => {}}
      >
        <planeGeometry args={[w, h]} />
      </mesh>
    </group>
  )
}

function PlanLines({
  lines,
  opacity = 1,
  color = '#8b5cf6',
}: {
  lines: [number, number, number][][]
  opacity?: number
  color?: string
}) {
  const geometry = useMemo(() => {
    const positions: number[] = []
    for (const line of lines)
      for (let i = 1; i < line.length; i++) positions.push(...line[i - 1]!, ...line[i]!)
    return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3))
  }, [lines])
  const material = useMemo(
    () =>
      new LineBasicNodeMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
      }),
    [color, opacity],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  return (
    <lineSegments geometry={geometry} material={material} renderOrder={906} raycast={() => {}} />
  )
}

function PlanPolygon({
  points,
  holes,
  opacity,
  height = Y,
}: {
  points: PlanPoint[]
  holes?: PlanPoint[][]
  opacity: number
  height?: number
}) {
  const geometry = useMemo(() => {
    const shape = new Shape(points.map((p) => new Vector2(p[0], -p[1])))
    shape.holes = (holes ?? []).map((h) => new Path(h.map((p) => new Vector2(p[0], -p[1]))))
    return new ShapeGeometry(shape)
  }, [points, holes])
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: '#8b5cf6',
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    [],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  material.opacity = opacity
  return (
    <mesh
      position={[0, height, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      geometry={geometry}
      material={material}
      renderOrder={903}
      raycast={() => {}}
    />
  )
}

function PlanMarker({ handle }: { handle: PlanHandle }) {
  const root = useRef<Group>(null)
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: handle.id === 'anchor' ? '#fbbf24' : '#a78bfa',
        depthTest: false,
        depthWrite: false,
      }),
    [handle.id],
  )
  const world = useMemo(() => new Vector3(), [])
  useEffect(() => () => material.dispose(), [material])
  useFrame(({ camera, size }) => {
    if (!root.current) return
    root.current.getWorldPosition(world)
    const pixel = (camera as OrthographicCamera).isOrthographicCamera
      ? ((camera as OrthographicCamera).top - (camera as OrthographicCamera).bottom) /
        (camera.zoom * Math.max(1, size.height))
      : (2 *
          world.distanceTo(camera.position) *
          Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360)) /
        Math.max(1, size.height)
    root.current.scale.setScalar(pixel * 6)
  })
  return (
    <group position={[handle.point[0], Y + handle.height, handle.point[1]]}>
      <group ref={root}>
        <mesh material={material} renderOrder={908} raycast={() => {}}>
          {handle.id === 'scale' ? (
            <boxGeometry args={[1.6, 1.6, 1.6]} />
          ) : (
            <sphereGeometry args={[1, 12, 8]} />
          )}
        </mesh>
      </group>
      <Html
        style={{
          pointerEvents: 'none',
          transform: 'translate(12px,-50%)',
          whiteSpace: 'nowrap',
          color: '#ede9fe',
          background: '#171717d9',
          borderRadius: 4,
          padding: '2px 5px',
          fontSize: 11,
        }}
        zIndexRange={[30, 0]}
      >
        {handle.label}
      </Html>
    </group>
  )
}

function ShapeVolume({ draft, nodes }: { draft: PlanWorkspaceDraft; nodes: AnyNode[] }) {
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: '#8b5cf6',
        transparent: true,
        opacity: 0.35,
        side: DoubleSide,
        depthWrite: false,
        depthTest: false,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  if (draft.mode !== 'shapes') return null
  if (draft.kind === 'balcony') return <BalconyPreviewGeometry nodes={nodes} />
  return (
    <group scale={[1, draft.height / draft.floorHeight, 1]}>
      {nodes.map((n) => {
        if (n.type === 'wall') {
          const dx = n.end[0] - n.start[0],
            dz = n.end[1] - n.start[1]
          return (
            <mesh
              key={[...n.start, ...n.end].join(':')}
              position={[
                (n.start[0] + n.end[0]) / 2,
                draft.floorHeight / 2,
                (n.start[1] + n.end[1]) / 2,
              ]}
              rotation={[0, -Math.atan2(dz, dx), 0]}
              material={material}
              renderOrder={904}
              raycast={() => {}}
            >
              <boxGeometry args={[Math.hypot(dx, dz), draft.floorHeight, n.thickness]} />
            </mesh>
          )
        }
        if (n.type === 'slab')
          return (
            <group key={n.id}>
              <PlanPolygon
                points={n.polygon}
                holes={n.holes}
                opacity={0.35}
                height={draft.floorHeight}
              />
              {[n.polygon, ...n.holes].flatMap((loop, ring) =>
                loop.map((p, i) => {
                  const q = loop[(i + 1) % loop.length]!,
                    dx = q[0] - p[0],
                    dz = q[1] - p[1]
                  return (
                    <mesh
                      key={`${ring}:${i}`}
                      position={[(p[0] + q[0]) / 2, draft.floorHeight / 2, (p[1] + q[1]) / 2]}
                      rotation={[0, -Math.atan2(dz, dx), 0]}
                      material={material}
                      renderOrder={904}
                      raycast={() => {}}
                    >
                      <planeGeometry args={[Math.hypot(dx, dz), draft.floorHeight]} />
                    </mesh>
                  )
                }),
              )}
            </group>
          )
        return null
      })}
    </group>
  )
}

export function PlanWorkspace3D() {
  return (
    <>
      <StandaloneBalconyPreview3D />
      <PlanWorkspaceContent3D />
    </>
  )
}

function PlanWorkspaceContent3D() {
  const draft = usePlanWorkspace((s) => s.draft),
    hover = usePlanWorkspace((s) => s.hover)
  const selectedLevel = useViewer((s) => s.selection.levelId)
  const { camera, gl, controls: rawControls } = useThree(),
    controls = rawControls as CameraControlsImpl | undefined
  const root = useRef<Group>(null),
    focused = useRef(-1)
  const id = draft?.id
  const { contours, nodes } = useWorkspacePreview(draft)
  useEffect(() => {
    if (!id) return
    const ray = new Raycaster(),
      mouse = new Vector2(),
      plane = new Plane(),
      inverse = new Matrix4(),
      point = new Vector3(),
      normal = new Vector3(),
      origin = new Vector3()
    return bindPlanWorkspacePointer({
      surface: gl.domElement,
      point: (e) => {
        const group = root.current
        if (!group?.visible) return null
        const rect = gl.domElement.getBoundingClientRect()
        if (!rect.width || !rect.height) return null
        mouse.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        )
        ray.setFromCamera(mouse, camera)
        normal.set(0, 1, 0).transformDirection(group.matrixWorld)
        origin.set(0, Y, 0).applyMatrix4(group.matrixWorld)
        plane.setFromNormalAndCoplanarPoint(normal, origin)
        if (!ray.ray.intersectPlane(plane, point)) return null
        point.applyMatrix4(inverse.copy(group.matrixWorld).invert())
        return [point.x, point.z]
      },
      project: (p, height) => {
        if (!root.current) return null
        const rect = gl.domElement.getBoundingClientRect()
        point
          .set(p[0], Y + height, p[1])
          .applyMatrix4(root.current.matrixWorld)
          .project(camera)
        return [
          ((point.x + 1) / 2) * rect.width + rect.left,
          ((1 - point.y) / 2) * rect.height + rect.top,
        ]
      },
      lockNavigation: () => {
        const enabled = controls?.enabled
        if (controls) controls.enabled = false
        return () => {
          if (controls && enabled !== undefined) controls.enabled = enabled
        }
      },
    })
  }, [id, gl, camera, controls])
  const scratch = useMemo(
    () => ({ box: new Box3(), sphere: new Sphere(), point: new Vector3() }),
    [],
  )
  useFrame(() => {
    const current = usePlanWorkspace.getState(),
      group = root.current
    if (!current.draft || !group) return
    const floor = sceneRegistry.nodes.get(current.draft.levelId)
    group.visible = !!floor && selectedLevel === current.draft.levelId
    if (!floor) return
    floor.updateWorldMatrix(true, false)
    group.matrix.copy(floor.matrixWorld)
    group.matrixWorldNeedsUpdate = true
    if (controls && focused.current !== current.focusRevision && group.visible) {
      focused.current = current.focusRevision
      const view = workspaceReferences(current.draft).at(-1)!
      scratch.box.makeEmpty()
      for (const p of [
        [0, 0],
        [view.image.width, 0],
        [view.image.width, view.image.height],
        [0, view.image.height],
      ] as PlanPoint[]) {
        const q = imagePointToLevel(p, view.image, view.transform)
        scratch.point.set(q[0], 0, q[1]).applyMatrix4(floor.matrixWorld)
        scratch.box.expandByPoint(scratch.point)
      }
      scratch.box.getBoundingSphere(scratch.sphere)
      scratch.sphere.radius = Math.max(2, scratch.sphere.radius * 1.15)
      void controls.setFocalOffset(0, 0, 0, false)
      void controls.fitToSphere(scratch.sphere, false)
    }
  })
  if (!draft) return null
  const views = workspaceReferences(draft),
    active = views.at(-1)!
  const handles = workspaceHandles(draft)
  const point3 = (p: PlanPoint, h = Y): [number, number, number] => [p[0], h, p[1]]
  const lines: [number, number, number][][] = contours.flatMap((s) =>
    [s.points, ...s.holes].map((loop) => [...loop, loop[0]!].map((p) => point3(p))),
  )
  if (draft.mode === 'references' && draft.stage !== 'adjust') {
    const points = activeReferencePoints(draft)
    const line = points.map((p) => imagePointToLevel(p, active.image, active.transform))
    if (line.length === 1 && hover)
      line.push(imagePointToLevel(hover, active.image, active.transform))
    lines.push(line.map((p) => point3(p)))
    if (hover && points.length === 1)
      for (const ends of [
        [
          [0, hover[1]],
          [active.image.width, hover[1]],
        ],
        [
          [hover[0], 0],
          [hover[0], active.image.height],
        ],
      ] as PlanPoint[][])
        lines.push(ends.map((p) => point3(imagePointToLevel(p, active.image, active.transform))))
  }
  for (const h of handles)
    if (h.id === 'height' && draft.mode === 'shapes')
      lines.push([point3(h.point), point3(h.point, Y + draft.floorHeight)])
  return (
    <group
      ref={root}
      matrixAutoUpdate={false}
      visible={false}
      userData={{ planWorkspacePreview: true }}
    >
      {views.map((v) => (
        <Suspense key={v.role} fallback={null}>
          <PlanPlane view={v} />
        </Suspense>
      ))}
      {contours.map((s) => (
        <PlanPolygon
          key={s.id}
          points={s.points}
          holes={s.holes}
          opacity={draft.mode === 'shapes' && draft.selected.includes(s.id) ? 0.4 : 0.06}
        />
      ))}
      <ShapeVolume draft={draft} nodes={nodes} />
      <PlanLines lines={lines} />
      {handles.map((h) => (
        <PlanMarker key={h.id} handle={h} />
      ))}
      {draft.mode === 'references' &&
        draft.stage !== 'adjust' &&
        activeReferencePoints(draft).map((p, i) => (
          <PlanMarker
            key={i}
            handle={{
              id: 'anchor',
              point: imagePointToLevel(p, active.image, active.transform),
              height: 0,
              label: `${draft.stage === 'measure' ? 'A' : 'B'}${i + 1}`,
            }}
          />
        ))}
    </group>
  )
}
