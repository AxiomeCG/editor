'use client'
import { type AnyNodeId, panelDepthOffset, sceneRegistry } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { DoubleSide, type Group } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { type FacadePreview, useFacadePreview } from '../../lib/use-facade-preview'
import { BalconyPreviewGeometry } from './balcony-preview'

/** Openings stand a little proud of both faces, so they read through the wall. */
const OPENING_PROUD = 0.04

/**
 * Children drawn in a registered node's frame. A wall's mesh is its local frame
 * (start, slab elevation, angle), the one its own windows are children of.
 */
function InFrameOf({ id, children }: { id: AnyNodeId; children: ReactNode }) {
  const root = useRef<Group>(null)
  useFrame(() => {
    const group = root.current
    const host = sceneRegistry.nodes.get(id)
    if (!group) return
    group.visible = !!host
    if (!host) return
    host.updateWorldMatrix(true, false)
    group.matrix.copy(host.matrixWorld)
    group.matrixWorldNeedsUpdate = true
  })
  return (
    <group ref={root} matrixAutoUpdate={false} visible={false}>
      {children}
    </group>
  )
}

function WallGhost({
  entry,
  material,
}: {
  entry: FacadePreview['walls'][number]
  material: MeshBasicNodeMaterial
}) {
  const { wall } = entry
  const depth = (wall.thickness ?? 0.2) + OPENING_PROUD
  return (
    <InFrameOf id={wall.id as AnyNodeId}>
      {entry.openings.map((opening) => (
        <mesh
          key={opening.id}
          position={opening.position}
          material={material}
          renderOrder={905}
          raycast={() => {}}
        >
          <boxGeometry args={[opening.width, opening.height, depth]} />
        </mesh>
      ))}
      {entry.panels.map((panel) => (
        <mesh
          key={panel.id}
          position={[panel.position[0], panel.position[1], panelDepthOffset(panel, entry.wall)]}
          material={material}
          renderOrder={905}
          raycast={() => {}}
        >
          <boxGeometry args={[panel.width, panel.height, panel.thickness]} />
        </mesh>
      ))}
    </InFrameOf>
  )
}

/**
 * A faint ghost of what applying the facade would do, while the apply button
 * is hovered: openings, cladding panels and balconies, never the scene itself.
 */
export function StandaloneFacadePreview3D() {
  const preview = useFacadePreview()
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: '#8b5cf6',
        opacity: 0.22,
        transparent: true,
        depthWrite: false,
        // Drawn over the scene like the balcony ghost: an existing facade's panels
        // would otherwise hide the preview of the one replacing it.
        depthTest: false,
        side: DoubleSide,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  if (!preview.walls.length && !preview.balconies.length) return null
  return (
    <group userData={{ facadePreview: true }}>
      {preview.walls.map((entry) => (
        <WallGhost key={entry.wall.id} entry={entry} material={material} />
      ))}
      {preview.levelId && preview.balconies.length > 0 && (
        <InFrameOf id={preview.levelId}>
          <BalconyPreviewGeometry nodes={preview.balconies} />
        </InFrameOf>
      )}
    </group>
  )
}
