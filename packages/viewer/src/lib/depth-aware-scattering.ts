import { depthAwareBlend } from 'three/addons/tsl/display/depthAwareBlend.js'
import {
  abs,
  Fn,
  float as tslFloat,
  If,
  mix,
  nodeObject,
  orthographicDepthToViewZ,
  reference,
  textureSize,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Camera, Color, Node, OrthographicCamera, TextureNode } from 'three/webgpu'

type DepthAwareBlendOptions = {
  blendColor: Node<'vec3'> | Node<'color'> | Color
  edgeRadius?: number
  edgeStrength?: number
}

const POISSON_DISK = [
  [0.493_393, 0.394_269],
  [0.798_547, 0.885_922],
  [0.259_143, 0.650_754],
  [0.605_322, 0.023_588],
  [-0.574_681, 0.137_452],
  [-0.430_397, -0.638_423],
  [-0.849_487, -0.366_258],
  [0.170_621, -0.569_941],
] as const

function isOrthographicCamera(camera: Camera): camera is OrthographicCamera {
  return 'isOrthographicCamera' in camera && camera.isOrthographicCamera === true
}

function orthographicDepthAwareBlend(
  baseNode: TextureNode,
  blendNode: TextureNode,
  depthNode: TextureNode,
  camera: OrthographicCamera,
  options: DepthAwareBlendOptions,
): Node<'vec4'> {
  const blend = Fn<[TextureNode, TextureNode, TextureNode], Node<'vec4'>>(
    ([base, effect, depth]) => {
      const uvNode = base.uvNode || uv()
      const cameraNear: Node<'float'> = reference('near', 'float', camera)
      const cameraFar: Node<'float'> = reference('far', 'float', camera)
      const centerDepth = depth.sample(uvNode).r
      const centerViewZ = orthographicDepthToViewZ(centerDepth, cameraNear, cameraFar)
      const pushDirection = vec2(0).toVar()
      const count = tslFloat(0).toVar()
      // r185 returns a proxied uvec2; its bundled declarations erase that node type.
      const dimensions = textureSize(base) as unknown as Node<'uvec2'>
      const resolution = vec2(dimensions)
      const pixelStep = vec2(1).div(resolution)
      const edgeRadius = options.edgeRadius ?? 2

      for (const [x, y] of POISSON_DISK) {
        const offset = vec2(x, y).mul(edgeRadius)
        const sampleDepth = depth.sample(uvNode.add(offset.mul(pixelStep))).r
        const sampleViewZ = orthographicDepthToViewZ(sampleDepth, cameraNear, cameraFar)
        const sameSurface = abs(sampleViewZ.sub(centerViewZ)).lessThan(
          abs(centerViewZ).mul(0.05).max(0.01),
        )
        If(sameSurface, () => {
          pushDirection.addAssign(offset)
          count.addAssign(1)
        })
      }

      count.assign(count.equal(0).select(1, count))
      pushDirection.divAssign(count)
      const safeLength = pushDirection.length().max(0.000001)
      const sampleUv = uvNode.add(
        pushDirection.div(safeLength).mul(tslFloat(options.edgeStrength ?? 2)).div(resolution),
      )
      const mask = effect.sample(sampleUv).r
      const baseColor = base.sample(uvNode)
      const tint = nodeObject(options.blendColor)
      return mix(baseColor, vec4(vec3(tint.r, tint.g, tint.b), 1), mask)
    },
  )

  return blend(baseNode, blendNode, depthNode)
}

/**
 * Three r185's stock blend reconstructs perspective depth. Keep that maintained
 * implementation for perspective cameras and change only the depth conversion
 * needed by an orthographic beauty pass.
 */
export function depthAwareScatteringBlend(
  baseNode: TextureNode,
  blendNode: TextureNode,
  depthNode: TextureNode,
  camera: Camera,
  options: DepthAwareBlendOptions,
): Node<'vec4'> {
  if (isOrthographicCamera(camera)) {
    return orthographicDepthAwareBlend(baseNode, blendNode, depthNode, camera, options)
  }
  return depthAwareBlend(baseNode, blendNode, depthNode, camera, options)
}
