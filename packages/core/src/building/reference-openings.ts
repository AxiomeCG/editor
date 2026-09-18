import type { WallNode } from '../schema/nodes/wall'

export type OpeningKind = 'door' | 'window'

export type OpeningFootprint = {
  center: [number, number]
  longAxis: [number, number]
  halfLong: number
  halfShort: number
}

export type OpeningPlacement = {
  /** Existing wall hosting the opening, when one covers the footprint. */
  hostWall: WallNode | null
  /** Missing wall segment to create between two flanking wall ends. */
  bridge: { start: [number, number]; end: [number, number]; thickness: number } | null
  /** Opening centre offset in metres from the host/bridge wall start. */
  along: number
  width: number
}

const MAX_BRIDGE = 3
const MIN_BRIDGE = 0.2
const WIDTH_MIN = 0.4
const WIDTH_MAX = 3

const subtract = (a: [number, number], b: [number, number]): [number, number] => [a[0] - b[0], a[1] - b[1]]
const dot = (a: [number, number], b: [number, number]) => a[0] * b[0] + a[1] * b[1]
const cross = (a: [number, number], b: [number, number]) => a[0] * b[1] - a[1] * b[0]
const norm = (a: [number, number]) => Math.hypot(a[0], a[1])
const unit = (a: [number, number]): [number, number] => {
  const length = norm(a)
  return length > 0 ? [a[0] / length, a[1] / length] : [1, 0]
}

/** Axis-aligned footprint of the selected symbol shapes, in level metres. */
export function openingFootprint(points: [number, number][]): OpeningFootprint {
  let minX = Number.POSITIVE_INFINITY,
    maxX = Number.NEGATIVE_INFINITY,
    minZ = Number.POSITIVE_INFINITY,
    maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of points) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  const center: [number, number] = [(minX + maxX) / 2, (minZ + maxZ) / 2]
  return (maxX - minX >= maxZ - minZ
    ? { center, longAxis: [1, 0] as [number, number], halfLong: (maxX - minX) / 2, halfShort: (maxZ - minZ) / 2 }
    : { center, longAxis: [0, 1] as [number, number], halfLong: (maxZ - minZ) / 2, halfShort: (maxX - minX) / 2 })
}

export function planOpeningPlacement(args: {
  footprint: OpeningFootprint
  kind: OpeningKind
  walls: readonly WallNode[]
}): OpeningPlacement {
  const { footprint, kind, walls } = args
  if (!walls.length) throw Error('Create or import the walls first, then place doors and windows.')

  const straight = walls.filter((wall) => Math.abs(wall.curveOffset ?? 0) < 1e-6)
  let bestHost: { wall: WallNode; distance: number; along: number; length: number } | null = null
  for (const wall of straight) {
    const a = wall.start,
      ab = subtract(wall.end, wall.start),
      length = norm(ab)
    if (length < MIN_BRIDGE) continue
    const direction = unit(ab)
    if (Math.abs(dot(direction, footprint.longAxis)) < 0.5) continue
    const v = subtract(footprint.center, a)
    const t = Math.max(0, Math.min(1, dot(v, ab) / (length * length)))
    const distance = norm(subtract(v, [ab[0] * t, ab[1] * t]))
    // Door symbols swing an arc out of the wall, pushing the footprint centre
    // off the centreline; windows sit on it and must stay tight.
    const tolerance = (wall.thickness ?? 0.1) / 2 + (kind === 'door' ? 0.6 : 0.2)
    if (distance > tolerance) continue
    if (!bestHost || distance < bestHost.distance)
      bestHost = { wall, distance, along: t * length, length }
  }

  let bestBridge: {
    start: [number, number]
    end: [number, number]
    thickness: number
    distance: number
  } | null = null
  const ends = straight.flatMap((wall) => [
    { wall, point: wall.start },
    { wall, point: wall.end },
  ])
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i]!,
        b = ends[j]!
      if (a.wall.id === b.wall.id) continue
      const span = subtract(b.point, a.point),
        length = norm(span)
      if (length < MIN_BRIDGE || length > MAX_BRIDGE) continue
      if (Math.abs(dot(unit(span), footprint.longAxis)) < 0.6) continue
      const midpoint: [number, number] = [
        (a.point[0] + b.point[0]) / 2,
        (a.point[1] + b.point[1]) / 2,
      ]
      const offset = subtract(midpoint, footprint.center)
      if (Math.abs(dot(offset, footprint.longAxis)) > Math.max(footprint.halfLong, 0.3) + 0.15)
        continue
      if (
        Math.abs(cross(footprint.longAxis, offset)) >
        Math.max(footprint.halfShort, 0.15) + 0.15
      )
        continue
      const distance = norm(offset)
      if (!bestBridge || distance < bestBridge.distance)
        bestBridge = {
          start: a.point,
          end: b.point,
          thickness: a.wall.thickness ?? b.wall.thickness ?? 0.18,
          distance,
        }
    }

  // Doors usually mark a gap between two wall ends — bridge it. Windows sit
  // inside existing walls — host them, bridging only when no wall covers them.
  const preferBridge = kind === 'door'
  const host = preferBridge && bestBridge ? null : bestHost
  const bridge = bestBridge && (preferBridge || !bestHost) ? bestBridge : null
  if (host) {
    const width = clampWidth(2 * footprint.halfLong)
    if (host.length < width + 0.1)
      throw Error('This wall is too short for the selected opening size.')
    const along = Math.max(width / 2 + 0.05, Math.min(host.length - width / 2 - 0.05, host.along))
    return { hostWall: host.wall, bridge: null, along, width }
  }
  if (bridge) {
    const length = norm(subtract(bridge.end, bridge.start))
    const width = Math.min(clampWidth(2 * footprint.halfLong), Math.max(WIDTH_MIN, length - 0.1))
    return { hostWall: null, bridge, along: length / 2, width }
  }
  throw Error(
    'Place the symbol on a wall, or select it spanning a gap between two wall ends.',
  )
}

function clampWidth(width: number) {
  return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, width))
}
