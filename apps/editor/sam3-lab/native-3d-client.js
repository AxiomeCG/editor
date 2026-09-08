import { ACESFilmicToneMapping, AmbientLight, Box3, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute, GridHelper, Group, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export function mountNativePreview(container, data, status) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.shadowMap.enabled = true
  renderer.localClippingEnabled = true
  renderer.domElement.tabIndex = 0
  renderer.domElement.setAttribute('aria-label', 'Reconstructed Pascal room. Drag to orbit; wheel to zoom; arrow keys to pan.')
  container.append(renderer.domElement)
  const scene = new Scene()
  scene.background = new Color('#f0f0eb')
  scene.add(new AmbientLight('#ffffff', 1.4))
  const light = new DirectionalLight('#ffffff', 2.5)
  light.position.set(7, 14, 5); scene.add(light)
  const root = new Group(), ownedMaterials = [], geometries = [], wallMaterials = []
  scene.add(root)
  for (const part of data.meshes) {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(part.positions, 3))
    if (part.normals.length) geometry.setAttribute('normal', new Float32BufferAttribute(part.normals, 3))
    if (part.index) geometry.setIndex(part.index)
    if (!part.normals.length) geometry.computeVertexNormals()
    for (const group of part.groups) geometry.addGroup(group.start, group.count, group.materialIndex)
    const materials = part.materials.map(value => new MeshStandardMaterial({ color: value.color, opacity: value.opacity, transparent: value.transparent, roughness: .82, metalness: 0, depthWrite: !value.transparent }))
    const mesh = new Mesh(geometry, materials.length === 1 ? materials[0] : materials)
    mesh.applyMatrix4(new Matrix4().fromArray(part.matrix))
    mesh.userData = { name: part.name, nodeId: part.nodeId, kind: part.kind }
    root.add(mesh); geometries.push(geometry); ownedMaterials.push(...materials)
    mesh.castShadow = part.kind !== 'zone'
    mesh.receiveShadow = true
    if (part.kind === 'wall') wallMaterials.push(...materials)
  }
  const box = new Box3().setFromObject(root), center = box.getCenter(new Vector3()), size = box.getSize(new Vector3())
  const span = Math.max(size.x, size.y, size.z, 1)
  const grid = new GridHelper(Math.ceil(span * 1.4), Math.ceil(span * 1.4), '#c6c7be', '#ddded5')
  grid.position.set(center.x, -.03, center.z); scene.add(grid)
  const camera = new PerspectiveCamera(42, 1, .01, span * 20)
  const controls = new OrbitControls(camera, renderer.domElement)
  light.position.copy(center).add(new Vector3(span * .6, span * 1.2, span * .4))
  light.target.position.copy(center); scene.add(light.target)
  light.castShadow = true
  Object.assign(light.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: .1, far: span * 5 })
  light.shadow.mapSize.set(1024, 1024)
  light.shadow.normalBias = .015
  controls.enableDamping = false
  controls.listenToKeyEvents(renderer.domElement)
  controls.minDistance = .2; controls.maxDistance = span * 6
  let frame = 0, disposed = false
  const render = () => { if (!frame && !disposed) frame = requestAnimationFrame(() => { frame = 0; renderer.render(scene, camera) }) }
  const reset = (top = false) => {
    camera.up.set(0, 1, 0)
    camera.position.copy(center).add(top ? new Vector3(0, span * 1.5, .001) : new Vector3(span * .75, span * 1.1, span))
    controls.target.copy(center); controls.update(); render()
  }
  const resize = () => {
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight)
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); render()
  }
  const observer = new ResizeObserver(resize); observer.observe(container)
  controls.addEventListener('change', render)
  const raycaster = new Raycaster(), pointer = new Vector2()
  let down = null
  const pointerDown = event => { down = [event.clientX, event.clientY] }
  const pointerUp = event => {
    if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 4) return
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(root.children, false)[0]
    status(hit ? `${hit.object.userData.name} · native ${hit.object.userData.kind}` : 'Drag to orbit · wheel to zoom · click a primitive to identify it.')
  }
  renderer.domElement.addEventListener('pointerdown', pointerDown)
  renderer.domElement.addEventListener('pointerup', pointerUp)
  reset(); resize()
  status(`3D ready · ${new Set(data.meshes.map(part => part.nodeId)).size} native objects. Drag to orbit; wheel to zoom.`)
  return {
    reset,
    cutaway(enabled) { for (const material of wallMaterials) { material.clippingPlanes = enabled ? [new Plane(new Vector3(0, -1, 0), 1.1)] : []; material.needsUpdate = true }; render() },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pointerUp)
      for (const geometry of geometries) geometry.dispose()
      for (const material of ownedMaterials) material.dispose()
      grid.geometry.dispose(); for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.dispose()
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
    },
  }
}
