import { catalogClassOf } from './pair-picker-data'
import type { PairEntry } from './pair-picker-data'
import { getSymbolListings } from '@/lib/instruments/local-index'

export type PairResultFilter = { venue: string; cls: string }
export const ALL_PAIR_RESULTS: PairResultFilter = { venue: 'all', cls: 'all' }

/** Venue-qualified rows must survive even when their contract symbols match. */
export function filterPairResults(
  rows: ReadonlyArray<PairEntry>,
  filter: PairResultFilter,
): Array<PairEntry> {
  const seen = new Set<string>()
  return rows.flatMap((row) => {
    if (filter.venue !== 'all' && row.market !== filter.venue) {
      if (row.market) return []
      const listings = getSymbolListings(row.symbol)
      if (
        !listings?.local.includes(filter.venue) &&
        !listings?.snapshot.includes(filter.venue)
      )
        return []
      row = { ...row, market: filter.venue }
    }
    if (
      filter.cls !== 'all' &&
      catalogClassOf(row.symbol, row.assetClass) !== filter.cls
    )
      return []
    const key = `${row.market ?? ''}:${row.id}`
    if (seen.has(key)) return []
    seen.add(key)
    return [row]
  })
}
