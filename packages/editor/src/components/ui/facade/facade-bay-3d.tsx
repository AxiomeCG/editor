'use client'
import type { FacadeUnit } from '@pascal-app/core'
import { type FacadeScenario, STUDIO_WALL_THICKNESS } from '@pascal-app/core/building'
import { getMaterialTextureVersion } from '@pascal-app/viewer'
import { OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Layers } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { DoubleSide } from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { cn } from '../../../lib/utils'
import { useFacadeTool } from '../../../store/use-facade-tool'
import { ToggleControl } from '../controls/toggle-control'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { bayColor } from './facade-bay-colors'
import { buildFacadeBayScene } from './facade-bay-scene'
import { resolveScenario } from './facade-elevation'

function FacadeBayContent({ unit, scenario }: { unit: FacadeUnit; scenario: FacadeScenario }) {
  const scene = useMemo(() => buildFacadeBayScene(unit, scenario), [unit, scenario])
  useEffect(() => scene.dispose, [scene])
  return <primitive object={scene.group} />
}

/** Just proud of the facade face, so the tint never fights the wall for depth. */
const FACE_Z = STUDIO_WALL_THICKNESS / 2 + 0.006

/**
 * Bays on the facade: the one under the pointer tinted in its colour, every
 * one when "Show bays" is on. Pointing picks the bay in every studio view;
 * clicking selects it, as in the elevation.
 */
function BayOverlay({ unit, scenario }: { unit: FacadeUnit; scenario: FacadeScenario }) {
  const { placements } = useMemo(() => resolveScenario(unit, scenario), [unit, scenario])
  const hoveredBay = useFacadeTool((s) => s.hoveredBay)
  const selectedBay = useFacadeTool((s) => s.selectedBay)
  const showBays = useFacadeTool((s) => s.showBays)
  const { setHoveredBay, selectBay } = useFacadeTool.getState()
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => invalidate(), [hoveredBay, selectedBay, showBays, invalidate])
  const bayAt = (x: number) => placements.find((p) => p.left <= x && x <= p.right)?.bay ?? null
  const { width, height } = scenario
  return (
    <group>
      <mesh
        position={[width / 2, height / 2, FACE_Z + 0.002]}
        onPointerMove={(event) => {
          const bay = bayAt(event.point.x)
          if (bay !== useFacadeTool.getState().hoveredBay) setHoveredBay(bay)
        }}
        onPointerOut={() => setHoveredBay(null)}
        onClick={(event) => {
          const bay = bayAt(event.point.x)
          if (bay) selectBay(bay)
        }}
      >
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {placements.map((placement) => {
        const hovered = placement.bay === hoveredBay
        const selected = placement.bay === selectedBay
        if (!hovered && !showBays) return null
        return (
          <mesh
            key={placement.key}
            position={[(placement.left + placement.right) / 2, height / 2, FACE_Z]}
            raycast={() => {}}
            renderOrder={10}
          >
            <planeGeometry args={[placement.right - placement.left, height]} />
            <meshBasicMaterial
              color={bayColor(unit, placement.bay)}
              transparent
              opacity={hovered ? 0.34 : selected ? 0.26 : 0.18}
              depthWrite={false}
              side={DoubleSide}
            />
          </mesh>
        )
      })}
    </group>
  )
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
        <BayOverlay unit={unit} scenario={scenario} />
        <TextureRefresh />
        <OrbitControls
          makeDefault
          target={[width / 2, height / 2, 0]}
          maxPolarAngle={Math.PI * 0.55}
          minDistance={1}
          maxDistance={size * 5}
        />
      </Canvas>
      <ViewOptions />
    </div>
  )
}

/** The 3D view's display options, folded behind one small HUD button. */
function ViewOptions() {
  const showBays = useFacadeTool((s) => s.showBays)
  const { setShowBays } = useFacadeTool.getState()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="View options"
          className={cn(
            'absolute bottom-3 left-3 flex size-8 items-center justify-center rounded-full border border-border/60 bg-background/80 text-muted-foreground shadow-sm backdrop-blur hover:text-foreground',
            showBays && 'text-foreground',
          )}
        >
          <Layers className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-56 p-2">
        <ToggleControl label="Show bays" checked={showBays} onChange={setShowBays} />
      </PopoverContent>
    </Popover>
  )
}
