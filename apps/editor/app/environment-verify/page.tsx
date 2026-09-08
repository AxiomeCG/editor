'use client'

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useLoader, useThree } from '@react-three/fiber'
import { Editor, useEditor, exportSceneToGlb } from '@pascal-app/editor'
import { Viewer, ViewerPresentations, GlbScene, buildGlbReplaceNodes, useViewer } from '@pascal-app/viewer'
import { createTerrainField, encodeTerrainField, SiteNode, BuildingNode, LevelNode, useScene, nodeRegistry, sceneRegistry, useLiveTerrain, flattenPatch, applyHeightPatch, terrainFieldOf, type AnyNode, type AnyNodeId, type SceneGraph } from '@pascal-app/core'
import { GrassFieldNode, exportEnvironmentConfiguration, importEnvironmentConfiguration } from '@pascal-app/plugin-environment'
import { useEnvironmentStore } from '../../node_modules/@pascal-app/plugin-environment/src/store'
import { createGrassPaintField, encodeGrassPaintField } from '../../node_modules/@pascal-app/plugin-environment/src/ground-cover/paint-field'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

type Mode = 'editor' | 'parametric' | 'generic' | 'pascal'
type Bake = { url: string; replaceNodes: AnyNode[] }
type ProbeProps = { mode: Mode; setMode: Dispatch<SetStateAction<Mode>>; setBake: Dispatch<SetStateAction<Bake|null>>; savedRoots: {current: AnyNodeId[]} }

function GenericGlb({url}:{url:string}) {
  const gltf=useLoader(GLTFLoader,url)
  const scene=useMemo(()=>gltf.scene.clone(true),[gltf.scene])
  return <primitive object={scene} />
}

function Probe({mode,setMode,setBake,savedRoots}:ProbeProps) {
  const { gl, scene, camera, invalidate } = useThree()
  useEffect(() => {
    const proof = {
      gl, scene, camera, invalidate, mode, useScene, useEditor, useViewer, useEnvironmentStore, nodeRegistry, sceneRegistry,
      exportEnvironmentConfiguration, importEnvironmentConfiguration, exportSceneToGlb,
      fixture() {
        const terrain = createTerrainField({ cols: 33, rows: 33, spacing: 14/32, origin: [-7,-7], step: 0.01 })
        for(let row=0;row<33;row++) for(let col=0;col<33;col++) terrain.heights[row*33+col]=Math.round(Math.sin(col*.15)*Math.cos(row*.12)*40)
        const paint = createGrassPaintField({ minX:-7,maxX:7,minZ:-7,maxZ:7 }, '#58723c')
        const site = SiteNode.parse({id:'site_environment_proof',polygon:{type:'polygon',points:[[-7,-7],[7,-7],[7,7],[-7,7]]},terrain:encodeTerrainField(terrain),children:['grass-field_environment_proof','building_environment_proof']})
        const building = BuildingNode.parse({id:'building_environment_proof',parentId:site.id,children:['level_environment_proof']})
        const level = LevelNode.parse({id:'level_environment_proof',parentId:building.id,children:[]})
        const grass = GrassFieldNode.parse({id:'grass-field_environment_proof',parentId:site.id,paintMap:encodeGrassPaintField(paint),flowerDensity:25})
        useScene.setState({nodes:{[site.id]:site,[building.id]:building,[level.id]:level,[grass.id]:grass as unknown as AnyNode},rootNodeIds:[site.id]})
        useViewer.getState().setSelection({buildingId:building.id,levelId:level.id,selectedIds:[]})
        savedRoots.current=[site.id]
        useScene.getState().markDirty(site.id)
        useScene.getState().markDirty(grass.id as AnyNodeId)
        useEditor.getState().setTool(null)
        invalidate()
        return {site,grass}
      },
      sculpt() {
        const site = useScene.getState().nodes['site_environment_proof'] as SiteNode
        const field = terrainFieldOf(site)!
        useLiveTerrain.getState().begin(site.id,field)
        let live=field
        for(const [x,z,h] of [[-5,-5,2],[3,4,-1]]) {
          const patch=flattenPatch(live,{minX:x!,minZ:z!,maxX:x!+1,maxZ:z!+1},h!)!
          live=applyHeightPatch(live,patch)
          useLiveTerrain.getState().advance(site.id,live,patch)
        }
        useScene.getState().updateNode(site.id,{terrain:encodeTerrainField(live)})
        useLiveTerrain.getState().end(site.id)
      },
      async bake() {
        const state=useScene.getState()
        const root=scene.getObjectByName('scene-renderer')!
        const buffer=await exportSceneToGlb(root,state.nodes)
        const graph={nodes:state.nodes,rootNodeIds:state.rootNodeIds,installedPlugins:state.installedPlugins} as SceneGraph
        savedRoots.current=[...state.rootNodeIds]
        const view=new DataView(buffer)
        const json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,view.getUint32(12,true))))
        Reflect.set(window,'__environmentBakedBuffer',buffer)
        setBake({url:URL.createObjectURL(new Blob([buffer],{type:'model/gltf-binary'})),replaceNodes:buildGlbReplaceNodes(graph)})
        return {bytes:buffer.byteLength,json}
      },
      show(next:Mode) {
        useScene.setState({rootNodeIds:next==='generic'||next==='pascal'?[]:savedRoots.current})
        setMode(next)
      },
    }
    Reflect.set(window, '__environmentProof', proof)
    return () => { if(Reflect.get(window,'__environmentProof')===proof) Reflect.deleteProperty(window,'__environmentProof') }
  }, [gl,scene,camera,invalidate,mode,setMode,setBake,savedRoots])
  return null
}

export default function EnvironmentVerificationPage() {
  const [mode,setMode]=useState<Mode>('editor')
  const [bake,setBake]=useState<Bake|null>(null)
  const savedRoots=useRef<AnyNodeId[]>([])
  useEffect(()=>()=>{if(bake)URL.revokeObjectURL(bake.url)},[bake])
  const probe=<Probe mode={mode} setMode={setMode} setBake={setBake} savedRoots={savedRoots}/>
  return <div style={{height:'100vh',width:'100vw'}}>
    {mode==='editor'?<Editor layoutVersion="v2" projectId="environment-completion-verification" viewerSceneSlot={probe}/>:<Viewer renderContext="viewer" useBvh={false}>
      {mode==='parametric'?<ViewerPresentations/>:bake?(mode==='generic'?<GenericGlb url={bake.url}/>:<GlbScene url={bake.url} replaceNodes={bake.replaceNodes}/>):null}
      {probe}
    </Viewer>}
  </div>
}
