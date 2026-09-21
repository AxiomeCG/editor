import {
  type AnyNode,
  DoorNode,
  FRENCH_DOOR_SEGMENTS,
  type SlabNode,
  type WallNode,
  WindowNode,
} from '../schema'

type Point = [number, number]

// A deck edge counts as against a wall when it runs along it within the
// wall's half thickness plus this (decks overlap the face or stop short of it).
const EDGE_REACH = 0.12
const MIN_SHARED = 0.3
// Clear margin kept to wall ends and neighbouring openings.
const MARGIN = 0.1
// Below this a French door keeps one glazed leaf; two would be too slim to pass.
const FRENCH_DOOR_MIN_DOUBLE = 1.1

const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
const norm = (a: Point) => Math.hypot(a[0], a[1])

/** Along-wall span (metres from the wall start) that a deck edge runs against. */
function sharedSpan(wall: WallNode, deck: readonly Point[]): [number, number] | null {
  const along = subtract(wall.end, wall.start),
    length = norm(along)
  if (length < MIN_SHARED || Math.abs(wall.curveOffset ?? 0) > 1e-6) return null
  const u: Point = [along[0] / length, along[1] / length],
    n: Point = [-u[1], u[0]]
  const reach = (wall.thickness ?? 0.1) / 2 + EDGE_REACH
  let best: [number, number] | null = null
  deck.forEach((p, i) => {
    const q = deck[(i + 1) % deck.length]!
    const edge = subtract(q, p),
      edgeLength = norm(edge)
    if (edgeLength < MIN_SHARED || Math.abs(dot(edge, n)) / edgeLength > 0.05) return
    const [dp, dq] = [p, q].map((point) => dot(subtract(point, wall.start), n))
    if (Math.abs(dp!) > reach || Math.abs(dq!) > reach) return
    const [sp, sq] = [p, q].map((point) => dot(subtract(point, wall.start), u))
    const from = Math.max(0, Math.min(sp!, sq!)),
      to = Math.min(length, Math.max(sp!, sq!))
    if (to - from >= MIN_SHARED && (!best || to - from > best[1] - best[0])) best = [from, to]
  })
  return best
}

export type BalconyOpeningKind = 'window' | 'door'

/**
 * A window or door giving onto a balcony: hosted by the wall the deck was built
 * from (or the one its longest edge runs against), centred on the shared span
 * and moved clear of openings already on that wall.
 */
export function planBalconyOpening(
  deck: SlabNode,
  nodes: Record<string, AnyNode>,
  kind: BalconyOpeningKind,
): WindowNode | DoorNode {
  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === deck.parentId,
  )
  const source = walls.find((wall) => wall.id === deck.metadata.balconySourceWall)
  const candidates = (source ? [source] : walls).flatMap((wall) => {
    const span = sharedSpan(wall, deck.polygon as Point[])
    return span ? [{ wall, span }] : []
  })
  const host = candidates.sort((a, b) => b.span[1] - b.span[0] - (a.span[1] - a.span[0]))[0]
  if (!host) throw Error('No wall runs along this balcony. Add the wall first.')

  const { wall, span } = host
  const length = norm(subtract(wall.end, wall.start))
  const shared = span[1] - span[0]
  // Doors onto a balcony are French doors (portes-fenêtres): two glazed leaves
  // when the span allows, one below that.
  const width = Math.min(kind === 'door' ? 1.5 : 1.2, shared - 2 * MARGIN)
  if (width < 0.6) throw Error(`This balcony is too narrow for a ${kind}.`)
  const taken = wall.children
    .map((id) => nodes[id])
    .filter((n): n is DoorNode | WindowNode => n?.type === 'door' || n?.type === 'window')
    .map((n) => [n.position[0] - n.width / 2 - MARGIN, n.position[0] + n.width / 2 + MARGIN])
  const low = Math.max(span[0], MARGIN) + width / 2,
    high = Math.min(span[1], length - MARGIN) - width / 2
  const centre = (span[0] + span[1]) / 2
  const free = (x: number) =>
    x >= low - 1e-9 &&
    x <= high + 1e-9 &&
    taken.every(([from, to]) => x + width / 2 <= from! || x - width / 2 >= to!)
  // The span centre, else the nearest spot hugging a neighbouring opening.
  const along = [centre, ...taken.flatMap(([from, to]) => [from! - width / 2, to! + width / 2])]
    .filter(free)
    .sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre))[0]
  if (along === undefined) throw Error(`No free space on this wall for a ${kind} onto the balcony.`)

  const common = {
    parentId: wall.id,
    wallId: wall.id,
    width,
    name: kind === 'door' ? 'Balcony French door' : 'Balcony window',
    metadata: { balconyAccess: deck.id },
  }
  if (kind === 'window') return WindowNode.parse({ ...common, position: [along, 0.9 + 1.5 / 2, 0] })
  const double = width >= FRENCH_DOOR_MIN_DOUBLE
  return DoorNode.parse({
    ...common,
    position: [along, 1.05, 0],
    height: 2.1,
    doorType: double ? 'french' : 'hinged',
    leafCount: double ? 2 : 1,
    handleSide: 'right',
    contentPadding: [0.045, 0.055],
    segments: FRENCH_DOOR_SEGMENTS.map((segment) =>
      double ? segment : { ...segment, columnRatios: [1] },
    ),
  })
}
