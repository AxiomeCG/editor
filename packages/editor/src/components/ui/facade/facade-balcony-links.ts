import type { FacadeBay, FacadeBayPlacement, FacadeUnit } from '@pascal-app/core'

/**
 * A link between two neighbouring placements' balconies, shown in the gap
 * between them: joining makes one continuous balcony across both bays (giving
 * the bay without one the other's balcony), splitting gives each its own again.
 */
export type BalconyLink = {
  key: string
  /** Where it sits: the middle of the gap, in wall metres. */
  x: number
  joined: boolean
  /** The bays as the link would leave them. */
  bays: FacadeBay[]
}

const continuous = (bay: FacadeBay) => bay.balcony?.span === 'continuous'

function join(a: FacadeBay, b: FacadeBay): FacadeBay[] {
  const look = (a.balcony ?? b.balcony)!
  const joined = (bay: FacadeBay): FacadeBay => ({
    ...bay,
    balcony: { ...(bay.balcony ?? look), span: 'continuous' },
  })
  return a.key === b.key ? [joined(a)] : [joined(a), joined(b)]
}

function split(a: FacadeBay, b: FacadeBay): FacadeBay[] {
  const own = (bay: FacadeBay): FacadeBay => ({ ...bay, balcony: { ...bay.balcony!, span: 'bay' } })
  return a.key === b.key ? [own(a)] : [own(a), own(b)]
}

/**
 * The links around the selected bay: one per neighbouring bay pair in each
 * run, where at least one of the two has a balcony. `placements` are keyed
 * `<run index>:<bay key>:<repeat>`.
 */
export function balconyLinks(
  unit: FacadeUnit,
  placements: readonly FacadeBayPlacement[],
  selectedBay: string | null,
): BalconyLink[] {
  if (!selectedBay) return []
  const bayOf = new Map(unit.bays.map((bay) => [bay.key, bay]))
  const runOf = (placement: FacadeBayPlacement) => placement.key.split(':')[0]
  const inOrder = [...placements].sort((a, b) =>
    runOf(a) === runOf(b) ? a.left - b.left : runOf(a)! < runOf(b)! ? -1 : 1,
  )
  const seen = new Set<string>()
  const links: BalconyLink[] = []
  for (let i = 0; i + 1 < inOrder.length; i++) {
    const left = inOrder[i]!
    const right = inOrder[i + 1]!
    if (runOf(left) !== runOf(right)) continue
    if (left.bay !== selectedBay && right.bay !== selectedBay) continue
    const a = bayOf.get(left.bay)
    const b = bayOf.get(right.bay)
    if (!a || !b || (!a.balcony && !b.balcony)) continue
    const pair = `${runOf(left)}:${[a.key, b.key].sort().join('|')}`
    if (seen.has(pair)) continue
    seen.add(pair)
    const joined = !!a.balcony && !!b.balcony && continuous(a) && continuous(b)
    links.push({
      key: pair,
      x: (left.right + right.left) / 2,
      joined,
      bays: joined ? split(a, b) : join(a, b),
    })
  }
  return links
}
