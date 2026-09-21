'use client'
import { type AnyNode, type SlabNode, sceneRegistry } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { DoubleSide, ExtrudeGeometry, type Group, Path, Shape, Vector2 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { useBalconyPreview } from '../../lib/use-balcony-preview'

function DeckGhost({ node, material }: { node: SlabNode; material: MeshBasicNodeMaterial }) {
  const geometry = useMemo(() => {
    const shape = new Shape(node.polygon.map(([x, z]) => new Vector2(x, -z)))
    shape.holes = node.holes.map((h) => new Path(h.map(([x, z]) => new Vector2(x, -z))))
    const g = new ExtrudeGeometry(shape, { depth: node.thickness, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    g.translate(0, node.elevation - node.thickness, 0)
    return g
  }, [node])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={material} renderOrder={905} raycast={() => {}} />
}

/** Ephemeral geometry only; supported rail heights match the eventual native slab. */
export function BalconyPreviewGeometry({ nodes }: { nodes: AnyNode[] }) {
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: '#8b5cf6',
        opacity: 0.35,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: DoubleSide,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  const decks = new Map(
    nodes.filter((n): n is SlabNode => n.type === 'slab').map((n) => [n.id as string, n]),
  )
  return (
    <>
      {nodes.map((n) => {
        if (n.type === 'slab') return <DeckGhost key={n.id} node={n} material={material} />
        if (n.type !== 'fence') return null
        const base = decks.get(n.supportSlabId ?? '')?.elevation ?? 0
        const dx = n.end[0] - n.start[0],
          dz = n.end[1] - n.start[1]
        return (
          <mesh
            key={n.id}
            position={[
              (n.start[0] + n.end[0]) / 2,
              base + n.height / 2,
              (n.start[1] + n.end[1]) / 2,
            ]}
            rotation={[0, -Math.atan2(dz, dx), 0]}
            material={material}
            renderOrder={906}
            raycast={() => {}}
          >
            <boxGeometry args={[Math.hypot(dx, dz), n.height, n.thickness]} />
          </mesh>
        )
      })}
    </>
  )
}

export function StandaloneBalconyPreview3D() {
  const preview = useBalconyPreview(),
    root = useRef<Group>(null)
  useFrame(() => {
    const group = root.current,
      floor = preview.levelId ? sceneRegistry.nodes.get(preview.levelId) : undefined
    if (!group) return
    group.visible = !!floor
    if (!floor) return
    floor.updateWorldMatrix(true, false)
    group.matrix.copy(floor.matrixWorld)
    group.matrixWorldNeedsUpdate = true
  })
  if (!preview.nodes.length) return null
  return (
    <group ref={root} matrixAutoUpdate={false} visible={false} userData={{ balconyPreview: true }}>
      <BalconyPreviewGeometry nodes={preview.nodes} />
    </group>
  )
}
