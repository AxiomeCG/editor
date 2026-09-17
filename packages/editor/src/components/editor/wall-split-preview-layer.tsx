'use client'
import { getWallThickness, sceneRegistry, useScene } from '@pascal-app/core'
import { BATCHED_LAYER, SCENE_LAYER } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { type Group, type Mesh, Raycaster, Vector2 } from 'three'
import { EDITOR_LAYER } from '../../lib/constants'
import { bindWallSplitPointer } from '../../lib/wall-split-pointer'
import { wallSplitDistance } from '../../lib/wall-split-preview'
import { useWallSplit } from '../../store/use-wall-split'

const noRaycast = () => {}

export function WallSplitPreviewLayer() {
  const draft = useWallSplit((s) => s.draft)
  const wallId = draft?.wallId
  const wall = useScene((s) => (draft ? s.nodes[draft.wallId] : undefined))
  const { gl, camera } = useThree()
  const root = useRef<Group>(null)
  const marker = useRef<Group>(null)
  useEffect(() => {
    if (!wallId) return
    const surface = gl.domElement
    const raycaster = new Raycaster()
    raycaster.layers.set(SCENE_LAYER)
    raycaster.layers.enable(BATCHED_LAYER)
    const pointer = new Vector2()
    return bindWallSplitPointer(surface, (event) => {
      if (event.target !== surface) return null
      const current = useScene.getState().nodes[wallId]
      const object = sceneRegistry.nodes.get(wallId)
      if (current?.type !== 'wall' || !object?.parent) return null
      const rect = surface.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      )
      raycaster.setFromCamera(pointer, camera)
      object.updateWorldMatrix(true, true)
      const hit = raycaster.intersectObject(object, true)[0]
      if (!hit) return null
      const local = object.parent.worldToLocal(hit.point.clone())
      return wallSplitDistance(current, [local.x, local.z])
    })
  }, [wallId, gl, camera])
  useFrame(() => {
    if (!root.current || !marker.current || wall?.type !== 'wall' || !draft) return
    const object = sceneRegistry.nodes.get(wall.id) as Mesh | undefined
    if (!object?.parent || !object.geometry) {
      root.current.visible = false
      return
    }
    root.current.visible = true
    object.updateWorldMatrix(true, false)
    root.current.matrix.copy(object.parent.matrixWorld)
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
    const bounds = object.geometry.boundingBox
    const bottom = object.position.y + (bounds?.min.y ?? 0)
    const height = bounds ? bounds.max.y - bounds.min.y : (wall.height ?? 3)
    marker.current.position.y = bottom + height / 2
    marker.current.scale.y = Math.max(0.05, height + 0.05)
  })
  if (!draft || wall?.type !== 'wall') return null
  const { point, tangent } = draft.preview.frame
  const thickness = getWallThickness(wall)
  const color = draft.preview.valid ? '#c86f45' : '#a63d2e'
  return (
    <group ref={root} matrixAutoUpdate={false}>
      <group
        ref={marker}
        position={[point.x, 0, point.y]}
        rotation={[0, -Math.atan2(tangent.y, tangent.x), 0]}
        userData={{ testId: 'pascal-split-marker', valid: draft.preview.valid }}
      >
        <mesh
          layers={EDITOR_LAYER}
          raycast={noRaycast}
          renderOrder={8900}
          scale={[0.074, 1, thickness + 0.12]}
        >
          <boxGeometry />
          <meshBasicMaterial
            color={draft.preview.valid ? '#f7f3ed' : '#faece9'}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh
          layers={EDITOR_LAYER}
          raycast={noRaycast}
          renderOrder={8910}
          scale={[0.026, 1.001, thickness + 0.07]}
        >
          <boxGeometry />
          <meshBasicMaterial
            color={color}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  )
}
