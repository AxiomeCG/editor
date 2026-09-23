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
  /** What following it does, in words, for the preview banner. */
  caption: string
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
 * A link in every gap between two neighbouring placements where at least one
 * has a balcony — around `onlyBay` when given, else everywhere (the elevation
 * reveals them by proximity). `placements` are keyed
 * `<run index>:<bay key>:<repeat>`.
 */
export function balconyLinks(
  unit: FacadeUnit,
  placements: readonly FacadeBayPlacement[],
  onlyBay: string | null = null,
): BalconyLink[] {
  const bayOf = new Map(unit.bays.map((bay) => [bay.key, bay]))
  const runOf = (placement: FacadeBayPlacement) => placement.key.split(':')[0]
  const inOrder = [...placements].sort((a, b) =>
    runOf(a) === runOf(b) ? a.left - b.left : runOf(a)! < runOf(b)! ? -1 : 1,
  )
  const links: BalconyLink[] = []
  for (let i = 0; i + 1 < inOrder.length; i++) {
    const left = inOrder[i]!
    const right = inOrder[i + 1]!
    if (runOf(left) !== runOf(right)) continue
    if (onlyBay && left.bay !== onlyBay && right.bay !== onlyBay) continue
    const a = bayOf.get(left.bay)
    const b = bayOf.get(right.bay)
    if (!a || !b || (!a.balcony && !b.balcony)) continue
    const joined = !!a.balcony && !!b.balcony && continuous(a) && continuous(b)
    const name = (bay: FacadeBay) => bay.name ?? bay.key
    const pairName = a.key === b.key ? `every ${name(a)}` : `${name(a)} and ${name(b)}`
    links.push({
      key: `${left.key}|${right.key}`,
      x: (left.right + right.left) / 2,
      joined,
      bays: joined ? split(a, b) : join(a, b),
      caption: joined
        ? `Split: ${pairName} get their own balconies`
        : `Join: one continuous balcony across ${pairName}`,
    })
  }
  return links
}
