import type { AnyNode, AnyNodeId, WallNode } from '../schema'
import { resolveWallLoop } from '../systems/wall/wall-loop'
import type { FacadeWallTarget } from './facade-runs'

export type FacadeScope = 'wall' | 'exterior' | 'interior' | 'both'

const COVERAGE_TOLERANCE = 0.01

const polylineLength = (points: readonly [number, number][]) =>
  points
    .slice(1)
    .reduce(
      (total, point, i) => total + Math.hypot(point[0] - points[i]![0], point[1] - points[i]![1]),
      0,
    )

/**
 * The walls a facade applies to from one picked wall, and which face of each.
 * A loop scope takes the whole closed perimeter on the picked wall's level.
 */
export function facadeScopeTargets(
  nodes: Record<AnyNodeId, AnyNode>,
  wall: WallNode,
  scope: FacadeScope,
): { walls: WallNode[]; targets: Record<string, FacadeWallTarget> } {
  if (scope === 'wall') return { walls: [wall], targets: {} }
  const loop = resolveWallLoop(nodes, wall.id, scope === 'both' ? 'exterior' : scope)
  const targets: Record<string, FacadeWallTarget> = {}
  for (const target of loop.walls) {
    const faces = loop.boundary.filter((b) => b.wallId === target.id)
    const covered = faces.reduce((sum, b) => sum + polylineLength(b.points), 0)
    const length = Math.hypot(target.end[0] - target.start[0], target.end[1] - target.start[1])
    // A wall running past a perimeter junction would get openings outside the loop.
    if (covered < length - COVERAGE_TOLERANCE)
      throw Error('Split the wall at the perimeter junction before filling this loop.')
    const face = faces[0]!.face
    const semantic = face === 'front' ? target.frontSide : target.backSide
    const slot =
      semantic === 'interior' || semantic === 'exterior'
        ? semantic
        : face === 'front'
          ? 'interior'
          : 'exterior'
    targets[target.id] = { surface: scope === 'both' ? 'both' : slot, face }
  }
  return { walls: loop.walls, targets }
}
