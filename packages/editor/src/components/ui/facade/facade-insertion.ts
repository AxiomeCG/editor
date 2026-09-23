import type { FacadeBayPlacement, FacadeUnit } from '@pascal-app/core'

/**
 * Where a bay can be added, in wall metres: the ends of each pinned stack, the
 * gaps inside it, and the corners. `index` is where the new bay goes in the
 * unit's list — list order is stack order among bays pinned to the same side.
 */
export type InsertionSlot = {
  key: string
  x: number
  index: number
  side: 'left' | 'right'
}

const EPSILON = 1e-6
/** How far past a stack's last bay a slot sits when nothing follows it. */
const TRAILING = 0.8

const mid = (a: number, b: number) => (a + b) / 2

/**
 * The slots of every run. `placements` are in wall metres, keyed
 * `<run index>:<bay key>:<repeat>` as the studio's scenario resolution keys them.
 */
export function insertionSlots(
  unit: FacadeUnit,
  runs: readonly { start: number; end: number }[],
  placements: readonly FacadeBayPlacement[],
): InsertionSlot[] {
  const listIndex = new Map(unit.bays.map((bay, index) => [bay.key, index]))
  const pinnedTo = (side: 'left' | 'right') => (placement: FacadeBayPlacement) => {
    const bay = unit.bays[listIndex.get(placement.bay) ?? -1]
    return bay?.widthMode === 'fixed' && bay.horizontal === side
  }
  const slots: InsertionSlot[] = []

  runs.forEach((run, r) => {
    const here = placements
      .filter((p) => p.key.startsWith(`${r}:`))
      .sort((a, b) => a.left - b.left)
    const add = (side: 'left' | 'right', x: number, index: number) =>
      slots.push({ key: `${r}:${side}:${slots.length}`, x, index, side })

    // Left stack, from the corner inwards.
    const left = here.filter(pinnedTo('left'))
    if (!left.length) {
      add('left', here[0] ? mid(run.start, here[0].left) : mid(run.start, mid(run.start, run.end)), unit.bays.length)
    } else {
      add('left', mid(run.start, left[0]!.left), listIndex.get(left[0]!.bay)!)
      for (let i = 1; i < left.length; i++)
        add('left', mid(left[i - 1]!.right, left[i]!.left), listIndex.get(left[i]!.bay)!)
      const last = left.at(-1)!
      const next = here.find((p) => !left.includes(p) && p.left >= last.right - EPSILON)
      add(
        'left',
        mid(last.right, next ? next.left : Math.min(run.end, last.right + TRAILING)),
        listIndex.get(last.bay)! + 1,
      )
    }

    // Right stack, from the corner inwards.
    const right = here.filter(pinnedTo('right')).sort((a, b) => b.right - a.right)
    if (!right.length) {
      const last = here.at(-1)
      add('right', last ? mid(last.right, run.end) : mid(mid(run.start, run.end), run.end), unit.bays.length)
    } else {
      add('right', mid(right[0]!.right, run.end), listIndex.get(right[0]!.bay)!)
      for (let i = 1; i < right.length; i++)
        add('right', mid(right[i]!.right, right[i - 1]!.left), listIndex.get(right[i]!.bay)!)
      const last = right.at(-1)!
      const previous = [...here]
        .reverse()
        .find((p) => !right.includes(p) && p.right <= last.left + EPSILON)
      add(
        'right',
        mid(previous ? previous.right : Math.max(run.start, last.left - TRAILING), last.left),
        listIndex.get(last.bay)! + 1,
      )
    }
  })
  return slots
}
