import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildLevelDuplicateCreateOps } from '@pascal-app/core/building'
import type { AnyNodeId, LevelNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { Patch as BridgePatch } from '../bridge/scene-bridge'
import type { SceneOperations } from '../operations'
import { ADDITIVE_TOOL_ANNOTATIONS } from './annotations'
import { ErrorCode, throwMcpError } from './errors'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { NodeIdSchema } from './schemas'

export const duplicateLevelInput = {
  levelId: NodeIdSchema,
}

export const duplicateLevelOutput = {
  newLevelId: z.string(),
  newNodeIds: z.array(z.string()),
  ...liveSyncOutput,
}

export function registerDuplicateLevel(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'duplicate_level',
    {
      title: 'Duplicate level',
      description:
        'Insert a copy above a level in the same building, including its units and building elements. Shift higher floors and update clear floor-based unit numbers. Reference images, scans and spawn points are excluded.',
      inputSchema: duplicateLevelInput,
      outputSchema: duplicateLevelOutput,
      annotations: ADDITIVE_TOOL_ANNOTATIONS,
    },
    async ({ levelId }) => {
      const node = bridge.getNode(levelId as AnyNodeId)
      if (!node) {
        throwMcpError(ErrorCode.InvalidParams, `Level not found: ${levelId}`)
      }
      if (node.type !== 'level') {
        throwMcpError(ErrorCode.InvalidParams, `Node ${levelId} is a ${node.type}, expected level`)
      }

      const nodes = bridge.getNodes()
      const { createOps, newLevelId, shiftedLevels } = buildLevelDuplicateCreateOps({
        nodes,
        level: node,
        levels: Object.values(nodes).filter(
          (n): n is LevelNode => n.type === 'level' && n.parentId === node.parentId,
        ),
        preset: 'everything',
      })
      const patches: BridgePatch[] = [
        ...shiftedLevels.map((level) => ({
          op: 'update' as const,
          id: level.id,
          data: { level: level.level },
        })),
        ...createOps.map(({ node, parentId }) => ({
          op: 'create' as const,
          node,
          ...(parentId ? { parentId } : {}),
        })),
      ]

      const result = bridge.applyPatch(patches)
      const persistence = await publishLiveSceneSnapshot(bridge, 'duplicate_level')

      const payload = {
        newLevelId: newLevelId as string,
        newNodeIds: result.createdIds as unknown as string[],
        ...persistencePayload(persistence),
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
