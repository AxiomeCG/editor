import {
  DEFAULT_WALL_THICKNESS,
  type GeometryContext,
  type PanelNode,
  type WallNode,
} from '@pascal-app/core'
import {
  applyWorldScaleBoxUVs,
  type ColorPreset,
  createSurfaceRoleMaterial,
  type RenderShading,
  resolveMaterialRef,
} from '@pascal-app/viewer'
import { BoxGeometry, FrontSide, Group, Mesh } from 'three'
import { PANEL_SLOT_ID } from './slots'

/**
 * How far the panel's centre sits from the wall centreline, toward its face.
 * A wall's front is its local +Z.
 */
export function panelDepthOffset(
  panel: Pick<PanelNode, 'side' | 'offset' | 'thickness'>,
  wall: Pick<WallNode, 'thickness'> | null,
): number {
  const halfWall = (wall?.thickness ?? DEFAULT_WALL_THICKNESS) / 2
  const sign = panel.side === 'front' ? 1 : -1
  return sign * (halfWall + panel.offset + panel.thickness / 2)
}

/** One box on the wall face, in the wall's frame; UVs in metres so finishes tile at real size. */
export function buildPanelGeometry(
  node: PanelNode,
  ctx?: Pick<GeometryContext, 'parent' | 'materials'>,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  const group = new Group()
  group.name = 'panel-geometry'
  const wall = ctx?.parent?.type === 'wall' ? ctx.parent : null
  const geometry = new BoxGeometry(node.width, node.height, node.thickness)
  applyWorldScaleBoxUVs(geometry, node.width, node.height, node.thickness)
  const ref = node.slots?.[PANEL_SLOT_ID]
  const material =
    (textures && ref ? resolveMaterialRef(ref, ctx?.materials, shading) : null) ??
    createSurfaceRoleMaterial('wall', colorPreset, FrontSide, sceneTheme)
  const mesh = new Mesh(geometry, material)
  mesh.name = 'panel-body'
  mesh.position.z = panelDepthOffset(node, wall)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.slotId = PANEL_SLOT_ID
  group.add(mesh)
  return group
}
