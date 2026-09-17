import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { planMirror } from '@pascal-app/core/building'
import type { AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { toolError } from './errors'
import { persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { NodeIdSchema } from './schemas'

export function registerMirror(server: McpServer, operations: SceneOperations) {
  server.registerTool(
    'mirror_elements',
    {
      title: 'Mirror elements, units, or a floor',
      description:
        'Reflect architectural elements across x=coordinate or z=coordinate in building coordinates. Expands units to their rooms and contained structure, including hosted openings. copy=true creates editable copies (a floor copy is inserted above its source and numbered accordingly); false edits the originals. Supports walls, fences, slabs, ceilings, zones and doors/windows hosted by selected walls. Unsupported kinds fail atomically. References remain in place; mirrored geometry detaches from calibration. Use preview=true first to inspect the exact sourceIds and geometry without changing the scene.',
      inputSchema: {
        ids: z.array(NodeIdSchema).min(1).max(1000),
        axis: z.enum(['x', 'z']),
        coordinate: z.number().finite(),
        copy: z.boolean().default(true),
        preview: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ ids, axis, coordinate, copy, preview }) => {
      try {
        const plan = planMirror(operations.getNodes(), ids as AnyNodeId[], {
          axis,
          coordinate,
          copy,
        })
        const persistence = preview
          ? undefined
          : await (async () => {
              operations.applyPatch([
                ...plan.updates.map((p) => ({ op: 'update' as const, ...p })),
                ...plan.creates.map((node) => ({
                  op: 'create' as const,
                  node,
                  parentId: node.parentId as AnyNodeId,
                })),
              ])
              return publishLiveSceneSnapshot(operations, 'mirror_elements')
            })()
        const payload = {
          status: preview ? 'preview' : 'mirrored',
          ...plan,
          ...(persistence ? persistencePayload(persistence) : {}),
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          structuredContent: payload,
        }
      } catch (error) {
        return toolError(error instanceof Error ? error.message : 'Mirror failed.')
      }
    },
  )
}
