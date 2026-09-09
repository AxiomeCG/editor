'use client'

import { sceneRegistry } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { CameraControlsImpl } from '@react-three/drei'
import { type ThreeEvent, useFrame, useLoader, useThree } from '@react-three/fiber'
import { animate } from 'motion'
import { useReducedMotion } from 'motion/react'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  Plane,
  PlaneGeometry,
  Sphere,
  TextureLoader,
  Vector3,
} from 'three'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import useEditor, { isGridSnapActive } from '../../store/use-editor'
import { useFloorplanImportPlacement } from '../../store/use-floorplan-import-placement'
import useInteractionScope from '../../store/use-interaction-scope'

function ReferencePlane({
  url,
  width,
  depth,
  opacity,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  url: string
  width: number
  depth: number
  opacity: number
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void
}) {
  const texture = useLoader(TextureLoader, url)
  const resources = useMemo(
    () => ({
      geometry: new PlaneGeometry(width, depth),
      material: new MeshBasicNodeMaterial({
        map: texture,
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
      }),
    }),
    [texture, width, depth],
  )
  resources.material.opacity = opacity / 100
  useEffect(
    () => () => {
      resources.geometry.dispose()
      resources.material.dispose()
    },
    [resources],
  )
  return (
    <mesh
      geometry={resources.geometry}
      material={resources.material}
      position={[0, 0.015, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}

export function FloorplanImportPreview3D() {
  const owner = useFloorplanImportPlacement((s) => s.owner)
  const target = useFloorplanImportPlacement((s) => s.target)
  const source = useFloorplanImportPlacement((s) => s.source)
  const reconstruction = useFloorplanImportPlacement((s) => s.reconstruction)
  const placement = useFloorplanImportPlacement((s) => s.placement)
  const opacity = useFloorplanImportPlacement((s) => s.opacity)
  const revision = useFloorplanImportPlacement((s) => s.revision)
  const shouldAnimate = useFloorplanImportPlacement((s) => s.animate)
  const selectedLevel = useViewer((s) => s.selection.levelId)
  const reduceMotion = useReducedMotion()
  const controls = useThree((s) => s.controls) as CameraControlsImpl | undefined
  const invalidate = useThree((s) => s.invalidate)
  const root = useRef<Group>(null),
    reveal = useRef<Group>(null)
  const framed = useRef('')
  const drag = useRef<{ owner: string; start: Vector3; x: number; z: number } | null>(null)
  const scratch = useMemo(
    () => ({
      inverse: new Matrix4(),
      normal: new Vector3(),
      origin: new Vector3(),
      point: new Vector3(),
      plane: new Plane(),
      box: new Box3(),
      sphere: new Sphere(),
      transform: new Matrix4(),
    }),
    [],
  )
  const resources = useMemo(() => {
    if (!reconstruction) return null
    const group = new Group(),
      geometries: BufferGeometry[] = [],
      materials: MeshStandardNodeMaterial[] = []
    for (const part of reconstruction.scene.meshes) {
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(part.positions, 3))
      if (part.normals.length)
        geometry.setAttribute('normal', new Float32BufferAttribute(part.normals, 3))
      if (part.index) geometry.setIndex(part.index)
      if (!part.normals.length) geometry.computeVertexNormals()
      for (const range of part.groups)
        geometry.addGroup(range.start, range.count, range.materialIndex)
      const surfaces = part.materials.map(
        (value) =>
          new MeshStandardNodeMaterial({
            color: value.color,
            opacity: value.opacity,
            transparent: value.transparent,
            depthWrite: !value.transparent,
            roughness: 0.8,
          }),
      )
      const mesh = new Mesh(geometry, surfaces.length === 1 ? surfaces[0] : surfaces)
      mesh.applyMatrix4(new Matrix4().fromArray(part.matrix))
      mesh.raycast = () => {}
      mesh.castShadow = part.kind !== 'zone'
      mesh.receiveShadow = true
      group.add(mesh)
      geometries.push(geometry)
      materials.push(...surfaces)
    }
    return { group, geometries, materials }
  }, [reconstruction])
  useEffect(
    () => () => {
      resources?.geometries.forEach((g) => {
        g.dispose()
      })
      resources?.materials.forEach((m) => {
        m.dispose()
      })
    },
    [resources],
  )
  useEffect(() => {
    const group = reveal.current
    if (!group || !resources) return
    if (!shouldAnimate || reduceMotion) {
      group.scale.y = 1
      return
    }
    group.scale.y = 0.02
    // Start after the first GPU frame, not while WebGPU compiles the new materials.
    const mesh = resources.group.children.find((child) => child instanceof Mesh) as Mesh | undefined
    if (!mesh) {
      group.scale.y = 1
      return
    }
    const afterRender = mesh.onAfterRender
    let frame = 0,
      playback: ReturnType<typeof animate> | undefined
    mesh.onAfterRender = (...args) => {
      afterRender.apply(mesh, args)
      mesh.onAfterRender = afterRender
      frame = requestAnimationFrame(() => {
        playback = animate(0.02, 1, {
          duration: 0.28,
          ease: [0.23, 1, 0.32, 1],
          onUpdate: (value) => {
            group.scale.y = value
            invalidate()
          },
        })
      })
    }
    invalidate()
    return () => {
      cancelAnimationFrame(frame)
      playback?.stop()
      mesh.onAfterRender = afterRender
    }
  }, [resources, shouldAnimate, reduceMotion, invalidate])
  useEffect(
    () => () => {
      if (owner)
        useInteractionScope
          .getState()
          .endIf((scope) => scope.kind === 'handle-drag' && scope.nodeId === owner)
    },
    [owner],
  )
  useFrame(() => {
    const group = root.current
    if (!group || !target || !source) return
    const floor = sceneRegistry.nodes.get(target.levelId)
    group.visible = !!floor && selectedLevel === target.levelId
    if (!floor) return
    floor.updateWorldMatrix(true, false)
    group.matrix.copy(floor.matrixWorld)
    group.matrixWorldNeedsUpdate = true
    const key = `${owner}:${revision}`
    if (framed.current !== key && controls && selectedLevel === target.levelId) {
      framed.current = key
      const width = source.width * source.metersPerPixel,
        depth = source.height * source.metersPerPixel
      scratch.box.min.set(-width / 2, 0, -depth / 2)
      scratch.box.max.set(width / 2, target.levelHeight, depth / 2)
      scratch.transform.makeRotationY(placement.rotation).setPosition(placement.x, 0, placement.z)
      scratch.transform.premultiply(floor.matrixWorld)
      scratch.box.applyMatrix4(scratch.transform)
      scratch.box.getCenter(scratch.point)
      scratch.box.getSize(scratch.normal)
      const span = Math.max(scratch.normal.x, scratch.normal.z, target.levelHeight)
      const { x, y, z } = scratch.point
      void controls.setLookAt(x + span * 0.8, y + span, z + span, x, y, z, !reduceMotion)
      // fitToBox snaps to an axis, flattening this deliberately oblique floor view.
      scratch.box.getBoundingSphere(scratch.sphere)
      scratch.sphere.radius *= 1.1
      void controls.fitToSphere(scratch.sphere, !reduceMotion)
      void controls.setFocalOffset(scratch.sphere.radius * 0.35, 0, 0, !reduceMotion)
    }
  })
  const down = (event: ThreeEvent<PointerEvent>) => {
    if (
      !owner ||
      !root.current ||
      useFloorplanImportPlacement.getState().committing ||
      event.button !== 0
    )
      return
    event.stopPropagation()
    scratch.inverse.copy(root.current.matrix).invert()
    drag.current = {
      owner,
      start: event.point.clone().applyMatrix4(scratch.inverse),
      x: placement.x,
      z: placement.z,
    }
    useInteractionScope
      .getState()
      .begin({ kind: 'handle-drag', nodeId: owner, handle: 'floorplan-import-position' })
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  }
  const move = (event: ThreeEvent<PointerEvent>) => {
    const active = drag.current
    if (!active || !root.current || active.owner !== useFloorplanImportPlacement.getState().owner)
      return
    event.stopPropagation()
    scratch.normal.set(0, 1, 0).transformDirection(root.current.matrix)
    scratch.origin.set(0, 0.015, 0).applyMatrix4(root.current.matrix)
    scratch.plane.setFromNormalAndCoplanarPoint(scratch.normal, scratch.origin)
    if (!event.ray.intersectPlane(scratch.plane, scratch.point)) return
    scratch.inverse.copy(root.current.matrix).invert()
    scratch.point.applyMatrix4(scratch.inverse)
    let x = active.x + scratch.point.x - active.start.x,
      z = active.z + scratch.point.z - active.start.z
    if (isGridSnapActive() && !event.nativeEvent.altKey) {
      const step = useEditor.getState().gridSnapStep
      x = Math.round(x / step) * step
      z = Math.round(z / step) * step
    }
    useFloorplanImportPlacement.getState().move(active.owner, { x, z })
  }
  const up = (event: ThreeEvent<PointerEvent>) => {
    const active = drag.current
    if (!active) return
    event.stopPropagation()
    drag.current = null
    ;(event.target as HTMLElement).releasePointerCapture(event.pointerId)
    useInteractionScope
      .getState()
      .endIf((scope) => scope.kind === 'handle-drag' && scope.nodeId === active.owner)
  }
  if (!owner || !source || !target) return null
  const width = source.width * source.metersPerPixel,
    depth = source.height * source.metersPerPixel
  return (
    <group
      ref={root}
      matrixAutoUpdate={false}
      visible={false}
      userData={{ floorplanImportPreview: true }}
    >
      <group position={[placement.x, 0, placement.z]} rotation={[0, placement.rotation, 0]}>
        <Suspense fallback={null}>
          <ReferencePlane
            url={source.imageUrl}
            width={width}
            depth={depth}
            opacity={opacity}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
          />
        </Suspense>
        <group ref={reveal}>
          <group position={[-width / 2, 0, -depth / 2]}>
            {resources && <primitive object={resources.group} dispose={null} />}
          </group>
        </group>
      </group>
    </group>
  )
}
