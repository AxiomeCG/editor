'use client'
import type { FacadeUnit } from '@pascal-app/core'
import { OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { getMaterialTextureVersion } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import { WebGPURenderer } from 'three/webgpu'
import { cn } from '../../../lib/utils'
import { buildFacadeBayScene } from './facade-bay-scene'
import type { FacadeScenario } from './facade-scenario'

function FacadeBayContent({ unit, scenario }: { unit: FacadeUnit; scenario: FacadeScenario }) {
  const scene = useMemo(() => buildFacadeBayScene(unit, scenario), [unit, scenario])
  useEffect(() => scene.dispose, [scene])
  return <primitive object={scene.group} />
}

/** Paint textures load after the first frame; the demand loop redraws once they land. */
function TextureRefresh() {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    let seen = getMaterialTextureVersion()
    const timer = setInterval(() => {
      const version = getMaterialTextureVersion()
      if (version === seen) return
      seen = version
      invalidate()
    }, 250)
    return () => clearInterval(timer)
  }, [invalidate])
  return null
}

/**
 * The unit in 3D, on a wall that exists only here: relief, balconies and
 * materials read as they will once applied. An independent canvas, so the
 * studio never writes into the project scene.
 */
export function FacadeBay3D({
  unit,
  scenario,
  className,
}: {
  unit: FacadeUnit
  /** Memoise it: a new object rebuilds the scene. */
  scenario: FacadeScenario
  className?: string
}) {
  const { width, height } = scenario
  const size = Math.max(width, height)
  return (
    <div className={cn('relative min-h-0', className)} role="img" aria-label={`${unit.name} in 3D`}>
      <Canvas
        shadows
        frameloop="demand"
        camera={{ position: [width * 0.7, height * 0.85, size * 1.1], fov: 40, near: 0.05, far: 500 }}
        gl={async (props) => {
          const renderer = new WebGPURenderer({ ...(props as Record<string, unknown>), alpha: true })
          await renderer.init()
          return renderer
        }}
      >
        <ambientLight intensity={1.1} />
        <hemisphereLight args={['#dfe8f2', '#8a8174', 0.8]} />
        <directionalLight
          castShadow
          intensity={2.6}
          position={[width * 0.25 - 4, height * 2.5, 9]}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-size}
          shadow-camera-right={size}
          shadow-camera-top={size}
          shadow-camera-bottom={-size}
          shadow-camera-far={60}
        />
        <FacadeBayContent unit={unit} scenario={scenario} />
        <TextureRefresh />
        <OrbitControls
          makeDefault
          target={[width / 2, height / 2, 0]}
          maxPolarAngle={Math.PI * 0.55}
          minDistance={1}
          maxDistance={size * 5}
        />
      </Canvas>
    </div>
  )
}
