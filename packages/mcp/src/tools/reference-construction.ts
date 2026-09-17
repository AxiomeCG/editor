import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { planReferenceConstruction, planReferenceFrameAlignment, ReferenceCalibrationRequired } from '@pascal-app/core/building'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { ADDITIVE_TOOL_ANNOTATIONS } from './annotations'
import { toolError } from './errors'
import { persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { NodeIdSchema } from './schemas'

const guideIds = z.array(NodeIdSchema).min(1).max(32)
function failure(error: unknown) {
  return error instanceof ReferenceCalibrationRequired
    ? toolError(error.message, { status: 'human_action_required', action: 'calibrate_reference', guideIds: error.guideIds, retryAfter: 'The user applies the reference in the editor. Reload the scene before retrying. Never invent or fill the measurement for the user.' })
    : toolError(error instanceof Error ? error.message : 'Reference construction failed.')
}
const result = (payload: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload,
})

export function registerReferenceConstruction(server: McpServer, operations: SceneOperations) {
  server.registerTool('create_reference_elements', {
    title: 'Build from calibrated references',
    description: 'Create editable walls, slabs, units, zones or balconies from referenceContours stored on guides. Uses the same construction operation as the editor. Read get_node for contour IDs. Omit shapeIds to use all contours; pass several guideIds for a building. Requires human calibration; never invent a real measurement. Review the source contours: apartment envelopes do not include interior walls, corridors, doors or facade details. Repeated calls reuse existing walls and skip existing contour elements.',
    inputSchema: {
      guideIds, kind: z.enum(['walls', 'slab', 'unit', 'zone', 'balcony']),
      shapeIds: z.array(z.string()).min(1).max(512).optional(),
      thickness: z.number().min(0.02).max(1).optional(),
      height: z.number().min(0).max(100).optional(),
      balcony: z.object({ depth: z.number().min(0.2).max(10), reverse: z.boolean(), thickness: z.number().min(0.02).max(1), railing: z.enum(['slat','rail','glass','none']), railingHeight: z.number().min(0.3).max(3), openEdge: z.number().int().nonnegative().nullable() }).optional(),
    },
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  }, async (input) => {
    let nodes
    try { nodes = planReferenceConstruction({ ...input, nodes: operations.getNodes() }) }
    catch (error) { return failure(error) }
    if (!nodes.length) return result({ status: 'already_present', createdIds: [] })
    const applied = operations.applyPatch(nodes.map((node) => ({ op: 'create' as const, node, parentId: node.parentId as AnyNodeId })))
    const persistence = await publishLiveSceneSnapshot(operations, 'create_reference_elements')
    return result({ status: 'created', createdIds: applied.createdIds, ...persistencePayload(persistence) })
  })
  server.registerTool('align_reference_frames', {
    title: 'Share measured reference frame',
    description: 'Transfer a human-calibrated guide transform to guides with the exact same declared sharedFrame and dimensions in the same building. Moves linked reference geometry with the frame. Does not infer scale or align unrelated images. Calibrate the anchor manually first.',
    inputSchema: { anchorGuideId: NodeIdSchema, targetGuideIds: guideIds },
    annotations: ADDITIVE_TOOL_ANNOTATIONS,
  }, async ({ anchorGuideId, targetGuideIds }) => {
    let guides
    try { guides = planReferenceFrameAlignment(operations.getNodes(), anchorGuideId, targetGuideIds) }
    catch (error) { return failure(error) }
    if (!guides.length) return result({ status: 'already_present', updatedIds: [] })
    operations.applyPatch(guides.map((guide) => ({ op: 'update' as const, id: guide.id, data: guide })))
    const persistence = await publishLiveSceneSnapshot(operations, 'align_reference_frames')
    return result({ status: 'aligned', updatedIds: guides.map((g) => g.id), ...persistencePayload(persistence) })
  })
}
