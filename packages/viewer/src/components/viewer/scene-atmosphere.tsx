'use client'

import { useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { cameraPosition, fog, positionWorld, reference, smoothstep } from 'three/tsl'
import type { Color, DirectionalLight, Node, Scene, Vector3 } from 'three/webgpu'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

export type SceneAtmosphereSource = {
  skyRadiance(direction: Node<'vec3'>): Node<'vec3'>
  reflectionRadiance(direction: Node<'vec3'>): Node<'vec3'>
  fogRadiance(direction: Node<'vec3'>): Node<'vec3'>
  environmentNode: Node<'vec3'>
  sunDirection: Vector3
  sunColor: Color
  sunIntensity: number
  moonDirection: Vector3
  moonColor: Color
  moonIntensity: number
  skyColor: Color
  groundColor: Color
  hemisphereIntensity: number
  ambientIntensity: number
  exposure: number
  fogStart: number
  fogEnd: number
}

export type SceneSunScatteringSource = {
  color: Color
  strength: number
}

type AtmosphereState = {
  source: SceneAtmosphereSource | null
  sunLight: DirectionalLight | null
  sunScattering: SceneSunScatteringSource | null
}

type SceneNodeSnapshot = {
  environmentNode: Node<'vec3'> | null | undefined
  environmentIntensity: number
  fogNode: Node | null | undefined
}

type AtmosphereOwner = {
  id: symbol
  source: SceneAtmosphereSource
  fogNode: Node<'vec4'>
}

type SunScatteringOwner = {
  id: symbol
  source: SceneSunScatteringSource
}

type SceneAtmosphereRegistry = {
  base: SceneNodeSnapshot | null
  owners: AtmosphereOwner[]
  sunLight: DirectionalLight | null
  sunScatteringOwners: SunScatteringOwner[]
  store: StoreApi<AtmosphereState>
}

const sceneAtmospheres = new WeakMap<Scene, SceneAtmosphereRegistry>()

function registryFor(scene: Scene): SceneAtmosphereRegistry {
  let registry = sceneAtmospheres.get(scene)
  if (!registry) {
    registry = {
      base: null,
      owners: [],
      sunLight: null,
      sunScatteringOwners: [],
      store: createStore<AtmosphereState>(() => ({
        source: null,
        sunLight: null,
        sunScattering: null,
      })),
    }
    sceneAtmospheres.set(scene, registry)
  }
  return registry
}

function applyActiveOwner(scene: Scene, registry: SceneAtmosphereRegistry): void {
  const active = registry.owners.at(-1)
  if (active) {
    scene.environmentNode = active.source.environmentNode
    scene.environmentIntensity = 1
    scene.fogNode = active.fogNode
    registry.store.setState({ source: active.source })
    return
  }

  const base = registry.base
  if (base) {
    scene.environmentNode = base.environmentNode
    scene.environmentIntensity = base.environmentIntensity
    scene.fogNode = base.fogNode
  }
  registry.base = null
  registry.store.setState({ source: null })
}

function applyActiveSunScattering(registry: SceneAtmosphereRegistry): void {
  registry.store.setState({
    sunScattering: registry.sunScatteringOwners.at(-1)?.source ?? null,
  })
}

export function setSceneAtmosphereSunLight(scene: Scene, light: DirectionalLight | null): void {
  const registry = registryFor(scene)
  if (registry.sunLight === light) return
  registry.sunLight = light
  registry.store.setState({ sunLight: light })
}

/** Returns the atmosphere currently owning this React Three Fiber scene. */
export function useSceneAtmosphere(): SceneAtmosphereSource | null {
  const scene = useThree((state) => state.scene)
  const registry = useMemo(() => registryFor(scene), [scene])
  return useStore(registry.store, (state) => state.source)
}

/** Returns the directional light that supplies the active atmosphere's sun. */
export function useSceneAtmosphereSunLight(): DirectionalLight | null {
  const scene = useThree((state) => state.scene)
  const registry = useMemo(() => registryFor(scene), [scene])
  return useStore(registry.store, (state) => state.sunLight)
}

/** Returns the optional screen-space sun-scattering request for this scene. */
export function useSceneSunScattering(): SceneSunScatteringSource | null {
  const scene = useThree((state) => state.scene)
  const registry = useMemo(() => registryFor(scene), [scene])
  return useStore(registry.store, (state) => state.sunScattering)
}

/**
 * Registers a presentation-owned request for shadow-derived sun scattering.
 * The source remains mutable so animation only updates values, never the GPU graph.
 */
export function SceneSunScattering({ source }: { source: SceneSunScatteringSource }) {
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const ownerId = useRef(Symbol('scene-sun-scattering'))
  const registry = useMemo(() => registryFor(scene), [scene])

  useLayoutEffect(() => {
    const owner: SunScatteringOwner = { id: ownerId.current, source }
    registry.sunScatteringOwners.push(owner)
    applyActiveSunScattering(registry)
    invalidate()

    return () => {
      const index = registry.sunScatteringOwners.findIndex((entry) => entry.id === owner.id)
      if (index < 0) return
      const wasActive = index === registry.sunScatteringOwners.length - 1
      registry.sunScatteringOwners.splice(index, 1)
      if (wasActive) {
        applyActiveSunScattering(registry)
        invalidate()
      }
    }
  }, [invalidate, registry, source])

  return null
}

/**
 * Installs a generic radiance source into the current scene. The source object is
 * expected to remain stable while its colors, vectors, and numbers mutate.
 */
export function SceneAtmosphere({ source }: { source: SceneAtmosphereSource }) {
  const scene = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const ownerId = useRef(Symbol('scene-atmosphere'))
  const registry = useMemo(() => registryFor(scene), [scene])
  const fogNode = useMemo(() => {
    const offset = positionWorld.sub(cameraPosition)
    const direction = offset.normalize()
    const fogRange: Pick<SceneAtmosphereSource, 'fogStart' | 'fogEnd'> = source
    const fogStart: Node<'float'> = reference('fogStart', 'float', fogRange)
    const fogEnd: Node<'float'> = reference('fogEnd', 'float', fogRange)
    const factor = smoothstep(fogStart, fogEnd, offset.length())
    return fog(source.fogRadiance(direction), factor)
  }, [source])

  useLayoutEffect(() => {
    if (registry.owners.length === 0) {
      registry.base = {
        environmentNode: scene.environmentNode,
        environmentIntensity: scene.environmentIntensity,
        fogNode: scene.fogNode,
      }
    }

    const owner: AtmosphereOwner = { id: ownerId.current, source, fogNode }
    registry.owners.push(owner)
    applyActiveOwner(scene, registry)
    invalidate()

    return () => {
      const index = registry.owners.findIndex((entry) => entry.id === owner.id)
      if (index < 0) return
      const wasActive = index === registry.owners.length - 1
      registry.owners.splice(index, 1)
      if (wasActive) {
        applyActiveOwner(scene, registry)
        invalidate()
      }
    }
  }, [fogNode, invalidate, registry, scene, source])

  return null
}
