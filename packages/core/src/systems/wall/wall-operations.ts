import type { AnyNode, AnyNodeId, WallNode } from '../../schema'
import { getWallCurveFrameAt, getWallCurveLength } from './wall-curve'
import type { WallPlanPoint } from './wall-move'
import {
  planWallInsertion,
  planWallSplitAtPoint,
  type WallTopologyChanges,
} from './wall-topology'

export function wallRectangleCorners(a: WallPlanPoint, b: WallPlanPoint): WallPlanPoint[] {
  if (
    ![...a, ...b].every(Number.isFinite) ||
    Math.abs(a[0] - b[0]) < 0.05 ||
    Math.abs(a[1] - b[1]) < 0.05
  )
    return []
  const x = Math.min(a[0], b[0]),
    z = Math.min(a[1], b[1])
  const right = Math.max(a[0], b[0]),
    top = Math.max(a[1], b[1])
  return [
    [x, z],
    [right, z],
    [right, top],
    [x, top],
  ]
}

/** Plan against a scratch graph so four sides commit atomically, including junction splits. */
export function planWallRectangle(
  nodes: Record<AnyNodeId, AnyNode>,
  args: {
    levelId: AnyNodeId
    start: WallPlanPoint
    end: WallPlanPoint
    wallDefaults?: Partial<WallNode>
  },
): { changes: WallTopologyChanges; walls: WallNode[] } {
  if (nodes[args.levelId]?.type !== 'level') throw Error('Select an editable floor.')
  const corners = wallRectangleCorners(args.start, args.end)
  if (!corners.length) throw Error('Both rectangle dimensions must be at least 5 cm.')
  const virtual = { ...nodes }
  const added = new Set<AnyNodeId>()
  for (let i = 0; i < 4; i++) {
    const result = planWallInsertion(virtual, {
      ...args,
      start: corners[i]!,
      end: corners[(i + 1) % 4]!,
      joinRadius: 0,
    })
    if (!result.ok) {
      if (result.reason === 'covered-existing-wall') continue
      throw Error('The rectangle cannot be drawn at this size.')
    }
    for (const id of result.plan.changes.delete) delete virtual[id]
    for (const { node, parentId } of result.plan.changes.create) {
      virtual[node.id] = { ...node, ...(parentId ? { parentId } : {}) } as AnyNode
    }
    for (const wall of result.plan.insertedWalls) added.add(wall.id)
    for (const { id, data } of result.plan.changes.update) {
      if (virtual[id]) virtual[id] = { ...virtual[id], ...data } as AnyNode
    }
  }
  const created = Object.values(virtual).filter((n) => !nodes[n.id])
  return {
    changes: {
      create: created.map((node) => ({ node, parentId: node.parentId as AnyNodeId })),
      update: Object.values(virtual)
        .filter((n) => nodes[n.id] && n !== nodes[n.id])
        .map((n) => ({ id: n.id, data: n })),
      delete: Object.keys(nodes).filter((id) => !virtual[id as AnyNodeId]) as AnyNodeId[],
    },
    walls: created.filter((n): n is WallNode => n.type === 'wall' && added.has(n.id)),
  }
}

/** Explicit split keeps the first wall's identity and reuses the junction planner's host migration. */
export function planWallDivision(
  nodes: Record<AnyNodeId, AnyNode>,
  wallId: WallNode['id'],
  distance: number,
) {
  const wall = nodes[wallId]
  if (wall?.type !== 'wall' || !wall.parentId) throw Error('Select a wall.')
  const length = getWallCurveLength(wall)
  if (!Number.isFinite(distance) || distance < 0.05 || distance > length - 0.05)
    throw Error('Keep at least 5 cm on each side of the split.')
  const point = getWallCurveFrameAt(wall, distance / length).point
  const result = planWallSplitAtPoint(nodes, {
    levelId: wall.parentId as AnyNodeId,
    point: [point.x, point.y],
    radius: 0.001,
    ignoreWallIds: Object.values(nodes)
      .filter((n) => n.type === 'wall' && n.id !== wallId)
      .map((n) => n.id),
  })
  if (!result.ok || result.plan.changes.create.length !== 2)
    throw Error('Move the split away from doors, windows and mounted objects.')
  const [first, second] = result.plan.changes.create
  const firstId = first!.node.id
  const changes: WallTopologyChanges = {
    create: [second!],
    delete: [],
    update: [
      {
        id: wallId,
        data: { ...first!.node, id: wallId, parentId: wall.parentId } as Partial<AnyNode>,
      },
      ...result.plan.changes.update.map((op) => ({
        ...op,
        data: {
          ...op.data,
          ...(op.data.parentId === firstId ? { parentId: wallId } : {}),
          ...('wallId' in op.data && op.data.wallId === firstId ? { wallId } : {}),
        } as Partial<AnyNode>,
      })),
    ],
  }
  for (const node of Object.values(nodes)) {
    if (
      node.type === 'zone' &&
      node.parentId === wall.parentId &&
      node.boundaryWallIds?.includes(wallId)
    ) {
      changes.update.push({
        id: node.id,
        data: {
          boundaryWallIds: node.boundaryWallIds.flatMap((id) =>
            id === wallId ? [wallId, second!.node.id as WallNode['id']] : [id],
          ),
        },
      })
    }
  }
  return { changes, secondId: second!.node.id, point: [point.x, point.y] as WallPlanPoint }
}
