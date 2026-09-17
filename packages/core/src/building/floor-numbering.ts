import type { AnyNode, LevelNode } from '../schema'

const numberedFloor = /^(?:(?:floor|level|étage|etage)\s*|R\+)?(-?\d+)$/i

export function floorNumber(level: Pick<LevelNode, 'name' | 'level'>): number {
  const match = level.name?.trim().match(numberedFloor)
  return match ? Number(match[1]) : level.level
}

export function repeatedFloorName(level: Pick<LevelNode, 'name' | 'level'>, next: number): string {
  const name = level.name?.trim()
  const number = floorNumber(level) + next - level.level
  return name && numberedFloor.test(name)
    ? name.replace(/-?\d+$/, String(number))
    : `Floor ${number}`
}

/** Only a single, unambiguous floor prefix followed by a two-digit unit number is inferred. */
export function renumberUnitName(
  name: string | undefined,
  from: number,
  to: number,
): string | undefined {
  if (!name || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < 0)
    return name
  const numbers = [...name.matchAll(/\d+/g)]
  if (numbers.length !== 1) return name
  const token = numbers[0]!
  if (token[0].length < 3 || Number(token[0].slice(0, -2)) !== from) return name
  const prefix = token[0].startsWith('0')
    ? String(to).padStart(token[0].length - 2, '0')
    : String(to)
  return (
    name.slice(0, token.index) +
    prefix +
    token[0].slice(-2) +
    name.slice(token.index! + token[0].length)
  )
}

export function reconcileFloorNumbering(
  before: Record<string, AnyNode>,
  next: Record<string, AnyNode>,
  changedIds: Iterable<string>,
) {
  const updates = new Map<string, AnyNode>()
  const moved = new Map<string, { from: number; to: number }>()
  for (const id of changedIds) {
    const old = before[id],
      level = next[id]
    if (old?.type !== 'level' || level?.type !== 'level' || old.level === level.level) continue
    const from = floorNumber(old)
    const to = old.name === level.name ? from + level.level - old.level : floorNumber(level)
    moved.set(id, { from, to })
    if (old.name && old.name === level.name && numberedFloor.test(old.name.trim())) {
      updates.set(id, { ...level, name: repeatedFloorName(old, level.level) })
    }
  }
  if (!moved.size) return []
  for (const node of Object.values(next)) {
    const old = before[node.id]
    if (!old || node.name !== old.name) continue
    const levels =
      node.type === 'unit'
        ? new Set(node.members.map((id) => next[id]?.parentId))
        : node.type === 'zone'
          ? new Set([node.parentId])
          : new Set<string>()
    if (levels.size !== 1) continue
    const change = moved.get([...levels][0] ?? '')
    if (!change) continue
    const name = renumberUnitName(node.name, change.from, change.to)
    if (name !== node.name) updates.set(node.id, { ...node, name } as AnyNode)
  }
  return [...updates.values()]
}
