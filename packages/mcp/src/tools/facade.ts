import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { FacadeUnitSchema } from '@pascal-app/core'
import {
  type FacadeFillPlan,
  facadeFillPatches,
  facadeScopeTargets,
  PARTITION_THICKNESS,
  planFacadeFill,
  SCENARIO_WIDTHS,
  scenarioScene,
} from '@pascal-app/core/building'
import type { AnyNode, AnyNodeId, PanelNode, SlabNode, WallNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { DESTRUCTIVE_TOOL_ANNOTATIONS, READ_ONLY_TOOL_ANNOTATIONS } from './annotations'
import { ErrorCode, throwMcpError } from './errors'
import { liveSyncOutput, persistencePayload, publishLiveSceneSnapshot } from './live-sync'
import { NodeIdSchema } from './schemas'

const UNIT_DESCRIPTION =
  'A facade unit: the minimal facade of one run, corner to corner (or to any wall meeting it). ' +
  '`bays` in precedence order; each bay has a width, a widthMode (repeat | fixed | stretch), ' +
  'an anchor (`horizontal`), piers, and optionally an opening (window or door, with sill, ' +
  'panes and type), a balcony, infill panels beside the opening and a spandrel below/above it. ' +
  '`paint` holds library material refs (`library:<id>`) for the wall face and frames. ' +
  'Pinned (fixed) bays are placed first; repeating and stretching bays fill what is left.'

const round = (value: number) => Math.round(value * 1000) / 1000
const Extent = z.object({
  left: z.number(),
  right: z.number(),
  bottom: z.number(),
  top: z.number(),
})

const previewInput = {
  unit: FacadeUnitSchema.describe(UNIT_DESCRIPTION),
  widths: z
    .array(z.number().min(0.5).max(60))
    .max(12)
    .optional()
    .describe(`Run widths to test, in metres. Default ${SCENARIO_WIDTHS.join(', ')}.`),
  height: z.number().min(2).max(8).default(3).describe('Storey height, in metres.'),
  partitions: z
    .array(z.number())
    .max(12)
    .default([])
    .describe(
      'Interior walls meeting the facade, in metres from its left corner. Each ends a run and the unit starts again beside it; positions outside a width are ignored for it.',
    ),
}

const previewOutput = {
  scenarios: z.array(
    z.object({
      width: z.number(),
      runs: z.array(z.object({ start: z.number(), end: z.number() })),
      openings: z.array(Extent.extend({ kind: z.enum(['window', 'door']) })),
      panels: z.array(Extent.extend({ part: z.string() })),
      balconies: z.array(z.object({ left: z.number(), right: z.number() })),
      skipped: z.number(),
      error: z.string().nullable(),
      sketch: z.string(),
    }),
  ),
}

/**
 * The facade at four characters a metre: `|` corners, `#` interior walls,
 * `W`/`D` openings, `x` infill, `.` bare wall; a second line marks balconies.
 */
function sketch(width: number, partitions: readonly number[], plan: FacadeFillPlan | null) {
  const per = 4
  const cells = Math.max(1, Math.round(width * per))
  const row = Array.from({ length: cells }, () => '.')
  const under = Array.from({ length: cells }, () => ' ')
  const paint = (line: string[], left: number, right: number, char: string) => {
    for (let i = Math.floor(left * per); i < Math.ceil(right * per) && i < cells; i++)
      if (i >= 0) line[i] = char
  }
  const wallPlan = plan?.walls[0]
  for (const panel of wallPlan?.panels.values ?? [])
    if (String(panel.metadata.facadeCell).includes(':infill'))
      paint(row, panel.position[0] - panel.width / 2, panel.position[0] + panel.width / 2, 'x')
  for (const opening of wallPlan?.openings.values ?? [])
    paint(
      row,
      opening.position[0] - opening.width / 2,
      opening.position[0] + opening.width / 2,
      opening.type === 'door' ? 'D' : 'W',
    )
  for (const x of partitions)
    paint(row, x - PARTITION_THICKNESS / 2, x + PARTITION_THICKNESS / 2, '#')
  for (const part of wallPlan?.balconies.values ?? [])
    if (part.type === 'slab') {
      const xs = (part as SlabNode).polygon.map(([x]) => x)
      paint(under, Math.min(...xs), Math.max(...xs), '_')
    }
  const top = `|${row.join('')}|`
  const bottom = ` ${under.join('')} `
  return bottom.trim() ? `${top}\n${bottom.trimEnd()}` : top
}

function previewScenario(
  unit: z.infer<typeof FacadeUnitSchema>,
  width: number,
  height: number,
  partitions: readonly number[],
) {
  const scene = scenarioScene({ width, height, partitions })
  const inRange = scene.partitions.map((p) => p.start[0])
  let plan: FacadeFillPlan | null = null
  let error: string | null = null
  try {
    plan = planFacadeFill({ walls: [scene.wall], nodes: scene.nodes, unit })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  const wallPlan = plan?.walls[0]
  const extent = (node: { position: [number, number, number]; width: number; height: number }) => ({
    left: round(node.position[0] - node.width / 2),
    right: round(node.position[0] + node.width / 2),
    bottom: round(node.position[1] - node.height / 2),
    top: round(node.position[1] + node.height / 2),
  })
  return {
    width,
    runs: (plan?.runs ?? [])
      .map((run) => ({ start: round(run.start), end: round(run.end) }))
      .sort((a, b) => a.start - b.start),
    openings: (wallPlan?.openings.values ?? [])
      .map((node) => ({ kind: node.type, ...extent(node) }))
      .sort((a, b) => a.left - b.left),
    panels: (wallPlan?.panels.values ?? [])
      .map((node: PanelNode) => ({
        part: String(node.metadata.facadeCell).split(':').at(-1) ?? 'panel',
        ...extent(node),
      }))
      .sort((a, b) => a.left - b.left),
    balconies: (wallPlan?.balconies.values ?? [])
      .filter((node): node is SlabNode => node.type === 'slab')
      .map((slab) => {
        const xs = slab.polygon.map(([x]) => x)
        return { left: round(Math.min(...xs)), right: round(Math.max(...xs)) }
      })
      .sort((a, b) => a.left - b.left),
    skipped: plan?.skipped ?? 0,
    error,
    sketch: sketch(width, inRange, plan),
  }
}

const applyInput = {
  wallId: NodeIdSchema.describe('A wall on the facade to fill.'),
  scope: z
    .enum(['wall', 'exterior', 'interior', 'both'])
    .default('exterior')
    .describe(
      '`wall`: this wall only. `exterior` / `interior`: the whole outside or inside loop of walls this wall belongs to, on its level. `both`: both faces of the loop.',
    ),
  unit: FacadeUnitSchema.describe(UNIT_DESCRIPTION),
}

const applyOutput = {
  walls: z.number(),
  runs: z.number(),
  created: z.number(),
  updated: z.number(),
  removed: z.number(),
  skipped: z.number(),
  ...liveSyncOutput,
}

export function registerFacadeTools(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'preview_facade_unit',
    {
      title: 'Preview facade unit',
      description:
        "Resolve a facade unit on test runs without touching any scene, the way the editor's facade studio does: at several run widths (like breakpoints) and with interior walls meeting the facade. Returns, per width, the runs, openings, panels and balconies in metres from the left corner, placements skipped for lack of room, and a one-line sketch. Use it to check a unit before apply_facade.",
      inputSchema: previewInput,
      outputSchema: previewOutput,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ unit, widths, height, partitions }) => {
      const payload = {
        scenarios: (widths ?? [...SCENARIO_WIDTHS]).map((width) =>
          previewScenario(unit, width, height, partitions),
        ),
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )

  server.registerTool(
    'apply_facade',
    {
      title: 'Apply facade',
      description:
        'Fill walls of the active scene with a facade unit: native windows, doors, cladding panels and balconies, owned by the facade so a later apply_facade re-solves them in place. The unit restarts at every corner and every wall meeting the facade. Use this, not apply_patch or cut_opening, for facades; re-apply with a changed unit to change one. Load a scene first; test the unit with preview_facade_unit.',
      inputSchema: applyInput,
      outputSchema: applyOutput,
      annotations: DESTRUCTIVE_TOOL_ANNOTATIONS,
    },
    async ({ wallId, scope, unit }) => {
      const nodes = bridge.getNodes() as Record<string, AnyNode>
      const wall = nodes[wallId]
      if (!wall) throwMcpError(ErrorCode.InvalidParams, `Wall not found: ${wallId}`)
      if (wall.type !== 'wall')
        throwMcpError(ErrorCode.InvalidParams, `Node ${wallId} is a ${wall.type}, expected wall`)

      let patches: ReturnType<typeof facadeFillPatches>
      let plan: FacadeFillPlan
      try {
        const { walls, targets } = facadeScopeTargets(
          nodes as Record<AnyNodeId, AnyNode>,
          wall as WallNode,
          scope,
        )
        plan = planFacadeFill({ walls, nodes, unit, targets })
        patches = facadeFillPatches(plan, nodes)
      } catch (error) {
        throwMcpError(
          ErrorCode.InvalidParams,
          error instanceof Error ? error.message : String(error),
        )
      }
      if (patches.length) bridge.applyPatch(patches)
      const persistence = await publishLiveSceneSnapshot(bridge, 'apply_facade')
      const count = (op: string) => patches.filter((p) => p.op === op).length
      const payload = {
        walls: plan.walls.length,
        runs: plan.runs.length,
        created: count('create'),
        updated: count('update'),
        removed: count('delete'),
        skipped: plan.skipped,
        ...persistencePayload(persistence),
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
