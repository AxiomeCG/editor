import { z } from 'zod'
import type { AnyNode, GuideNode, WallNode } from '../schema'
import type { BalconyOptions } from './balcony'
import { outlineBatchPrimitiveNodes, type OutlinePrimitiveKind } from './reference-primitives'

const point = z.tuple([z.number().finite(), z.number().finite()])
export const ReferenceContour = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  points: z.array(point).min(2).max(1024),
  holes: z.array(z.array(point).min(3).max(1024)).max(32).optional(),
  stroke: z.boolean().optional(),
})
export type ReferenceContour = z.infer<typeof ReferenceContour>

export class ReferenceCalibrationRequired extends Error {
  constructor(readonly guideIds: string[]) {
    super('Human calibration required: select two points on the plan and enter a known length, then apply the reference in the editor.')
  }
}

export function referenceContours(guide: GuideNode): ReferenceContour[] {
  return z.array(ReferenceContour).min(1).max(512).parse(guide.metadata.referenceContours)
}

/** Both MCP and the editor commit this complete plan in one transaction. */
export function planReferenceConstruction({
  nodes, guideIds, kind, shapeIds, thickness, height, balcony,
}: {
  nodes: Record<string, AnyNode>
  guideIds: string[]
  kind: OutlinePrimitiveKind
  shapeIds?: string[]
  thickness?: number
  height?: number
  balcony?: BalconyOptions
}): AnyNode[] {
  if (!guideIds.length || guideIds.length > 32 || new Set(guideIds).size !== guideIds.length)
    throw Error('Choose 1–32 different references.')
  if (shapeIds && (!shapeIds.length || new Set(shapeIds).size !== shapeIds.length))
    throw Error('Choose different contour IDs, or omit the selection to use all contours.')
  const guides = guideIds.map((id) => {
    const guide = nodes[id]
    if (guide?.type !== 'guide') throw Error(`Reference not found: ${id}`)
    return guide
  })
  const pending = guides.filter((g) => !g.scaleReference).map((g) => g.id)
  if (pending.length) throw new ReferenceCalibrationRequired(pending)
  const created: AnyNode[] = []
  for (const guide of guides) {
    const level = nodes[guide.parentId ?? '']
    if (level?.type !== 'level') throw Error('Every reference must belong to a floor.')
    const contours = referenceContours(guide)
    if (shapeIds?.some((id) => !contours.some((c) => c.id === id)))
      throw Error(`A selected contour is missing from ${guide.name ?? guide.id}.`)
    const context = { ...nodes, ...Object.fromEntries(created.map((n) => [n.id, n])) }
    const existing = Object.values(context)
    const targetType = kind === 'walls' ? 'wall' : kind === 'balcony' ? 'slab' : kind
    const shapes = contours.filter((c) =>
      (!shapeIds || shapeIds.includes(c.id)) &&
      (kind === 'walls' || !existing.some((n) => {
        const origin = n.metadata.referenceOutline as { guideId?: string; outlineId?: string } | undefined
        return n.type === targetType && origin?.guideId === guide.id && origin.outlineId === c.id &&
          (targetType !== 'slab' || (kind === 'balcony') === !!n.metadata.balcony)
      })),
    )
    if (!shapes.length) continue
    created.push(...outlineBatchPrimitiveNodes({
      guide, level, shapes, kind, thickness, height, balcony,
      name: guide.name ?? 'Reference',
      contextNodes: context,
      existingWalls: existing.filter((n): n is WallNode => n.type === 'wall' && n.parentId === level.id),
    }))
    if (created.length > 10000) throw Error('Build fewer floors in one operation.')
  }
  return created
}

/** Only a declared identical image frame can inherit an existing measured transform. */
export function planReferenceFrameAlignment(
  nodes: Record<string, AnyNode>, anchorGuideId: string, targetGuideIds: string[],
): GuideNode[] {
  const anchor = nodes[anchorGuideId]
  if (anchor?.type !== 'guide') throw Error('Choose a reference as the anchor.')
  if (!anchor.scaleReference) throw new ReferenceCalibrationRequired([anchor.id])
  const ref = anchor.metadata.planReference as Record<string, unknown> | undefined
  const anchorLevel = nodes[anchor.parentId ?? '']
  if (!ref?.sharedFrame || anchorLevel?.type !== 'level')
    throw Error('The calibrated reference must declare a shared image frame and belong to a floor.')
  if (!targetGuideIds.length || targetGuideIds.length > 32 || new Set(targetGuideIds).size !== targetGuideIds.length)
    throw Error('Choose 1–32 different target references.')
  return targetGuideIds.filter((id) => id !== anchorGuideId).map((id) => {
    const guide = nodes[id]
    if (guide?.type !== 'guide') throw Error(`Reference not found: ${id}`)
    const target = guide.metadata.planReference as Record<string, unknown> | undefined
    const level = nodes[guide.parentId ?? '']
    if (target?.sharedFrame !== ref.sharedFrame || target?.width !== ref.width || target?.height !== ref.height ||
      level?.type !== 'level' || level.parentId !== anchorLevel.parentId)
      throw Error('Only references in the same building with identical declared frames can be aligned together.')
    return {
      ...guide,
      scale: anchor.scale,
      position: [anchor.position[0], guide.position[1], anchor.position[2]],
      rotation: [...anchor.rotation],
      scaleReference: structuredClone(anchor.scaleReference),
      metadata: {
        ...guide.metadata,
        planReference: {
          ...target,
          method: 'shared-frame',
          anchorGuideId,
          metersPerPixel: (anchor.scale * 10) / Number(ref.width),
          inheritedCalibration: { scaleReference: anchor.scaleReference, knownDimension: ref.knownDimension },
        },
      },
    }
  })
}
