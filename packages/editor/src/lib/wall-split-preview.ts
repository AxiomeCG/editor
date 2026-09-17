import {
  type AnyNode,
  type AnyNodeId,
  getWallArcData,
  getWallCurveFrameAt,
  getWallCurveLength,
  planWallDivision,
  type WallNode,
} from '@pascal-app/core'

/** Kaizen's projected cut target, extended to Pascal's curved walls. */
export function wallSplitDistance(wall: WallNode, point: readonly [number, number]): number {
  const length = getWallCurveLength(wall)
  const arc = getWallArcData(wall)
  if (arc) {
    const angle = Math.atan2(point[1] - arc.center.y, point[0] - arc.center.x)
    const turn = Math.PI * 2
    const delta = (((arc.direction * (angle - arc.startAngle)) % turn) + turn) % turn
    if (delta <= Math.abs(arc.delta)) return (delta / Math.abs(arc.delta)) * length
    return Math.hypot(point[0] - wall.start[0], point[1] - wall.start[1]) <=
      Math.hypot(point[0] - wall.end[0], point[1] - wall.end[1])
      ? 0
      : length
  }
  if (length === 0) return 0
  return Math.max(
    0,
    Math.min(
      length,
      ((point[0] - wall.start[0]) * (wall.end[0] - wall.start[0]) +
        (point[1] - wall.start[1]) * (wall.end[1] - wall.start[1])) /
        length,
    ),
  )
}

export function wallSplitPreview(
  nodes: Record<AnyNodeId, AnyNode>,
  wall: WallNode,
  distance: number,
) {
  const length = getWallCurveLength(wall)
  const frame = getWallCurveFrameAt(wall, length > 0 ? distance / length : 0)
  let message = ''
  if (
    [wall, ...Object.values(nodes).filter((n) => n.parentId === wall.id)].some(
      (n) => n.metadata.arrayModifier || n.metadata.linkedArray,
    )
  ) {
    message = 'Make the linked array real before splitting this wall.'
  } else {
    try {
      planWallDivision(nodes, wall.id, distance)
    } catch (error) {
      message = error instanceof Error ? error.message : 'This wall cannot be split here.'
    }
  }
  return { distance, length, frame, valid: !message, message }
}

export type WallSplitPreview = ReturnType<typeof wallSplitPreview>
