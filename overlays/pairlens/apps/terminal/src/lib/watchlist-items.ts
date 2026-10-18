import { formatInstrumentRef } from '@pairlens/shared/market-ref'
import { queryInstruments } from '@pairlens/plugins/catalog'
import { entryToInstrumentRef } from './market-ref/entry'
import type { Instrument } from '@pairlens/shared/instrument-types'
import type { InstrumentRef } from '@pairlens/shared/market-ref'

export type WatchlistItem = Instrument & {
  watchRef: InstrumentRef
  metadataResolved: boolean
  listedOn: Array<string>
}

/** Saved identity owns the row; discovery only enriches its label and listing. */
export function buildWatchlistItems(
  refs: Array<InstrumentRef>,
  instruments: Array<Instrument>,
): Array<WatchlistItem> {
  // Global discovery may be routed to the focused native connector. Its table
  // is not the catalog for every saved asset; bundled rows supply labels only.
  const catalog = queryInstruments('', {
    symbols: refs.map((ref) => ref.id).join(','),
  }).items
  return refs.map((ref) => {
    const matches = instruments.filter((item) => {
      const identity = entryToInstrumentRef(item)
      return (
        identity.id === ref.id &&
        identity.cls === ref.cls &&
        (!ref.market || item.market === ref.market)
      )
    })
    const instrument =
      matches[0] ??
      (!ref.market
        ? catalog.find((item) => {
            const identity = entryToInstrumentRef(item)
            return identity.id === ref.id && identity.cls === ref.cls
          })
        : undefined)
    const [base = ref.id, quote = ''] = ref.id.split('-')
    // Match mobile's label-only fallback. No exchange listing or price is invented.
    const fallback: Instrument = {
      id: ref.id,
      kind: 'cex-pair',
      market: ref.market ?? '',
      symbol: ref.id,
      name: ref.id,
      base,
      quote,
      assetClass: ref.cls,
      categories: [],
      rank: Number.MAX_SAFE_INTEGER,
      featured: false,
    }
    return {
      ...(instrument ?? fallback),
      id: formatInstrumentRef(ref),
      watchRef: ref,
      metadataResolved: instrument !== undefined,
      listedOn: [
        ...new Set(matches.map((item) => item.market).filter(Boolean)),
      ],
    }
  })
}
