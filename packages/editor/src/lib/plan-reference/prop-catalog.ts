import { propFitError, type SymbolFrame } from '@pascal-app/core/building'
import { CATALOG_ITEMS, type CatalogItem } from '../../components/ui/item-catalog/catalog-items'

/** Free-standing floor furniture: wall/ceiling items and modular cabinets place differently. */
export const PROP_CATALOG: CatalogItem[] = CATALOG_ITEMS.filter((item) => {
  const [width, , depth] = item.dimensions ?? []
  return !item.attachTo && item.tool !== 'cabinet' && Number(width) > 0 && Number(depth) > 0
})

export function propFootprint(item: CatalogItem): [number, number] {
  const [width, , depth] = item.dimensions ?? [1, 1, 1]
  return [width!, depth!]
}

export function propCatalogItem(id: string | undefined) {
  return id ? PROP_CATALOG.find((item) => item.id === id) : undefined
}

/**
 * Catalog props for the picker: search on name, tags and category, then — with
 * a symbol selected — best footprint fit first, so a sofa symbol surfaces sofas.
 */
export function rankPropCatalog(frame: SymbolFrame | null, query: string): CatalogItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = terms.length
    ? PROP_CATALOG.filter((item) => {
        const text = [item.name, item.category, ...(item.tags ?? [])].join(' ').toLowerCase()
        return terms.every((term) => text.includes(term))
      })
    : PROP_CATALOG
  if (!frame) return [...matches].sort((a, b) => a.name.localeCompare(b.name))
  return matches
    .map((item) => ({ item, error: propFitError(frame, propFootprint(item)) }))
    .sort((a, b) => a.error - b.error)
    .map(({ item }) => item)
}
