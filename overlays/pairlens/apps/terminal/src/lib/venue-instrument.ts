// Copyright (c) 2026 Juan Ignacio Molina Estrada
// SPDX-License-Identifier: FSL-1.1-Apache-2.0
import type { MarketRef } from '@pairlens/shared/market-ref'

export type VenueInstrumentRow = {
  market: string
  symbol: string
  base: string
  quote: string
  kind: string
  settle?: string
  contract?: string
  linear?: boolean
}

export function isQuantTradeVenue(market: string): boolean {
  return [
    'hyperliquid',
    'lighter',
    'hyperliquid-spot',
    'lighter-spot',
  ].includes(market)
}

/** Dollar quotes are different instruments: return the target's listed ID, never rewrite one. */
export function resolveVenueInstrument(
  ref: MarketRef,
  market: string,
  rows: ReadonlyArray<VenueInstrumentRow>,
): MarketRef | null {
  if (ref.cls !== 'spot' && ref.cls !== 'perp') return null
  const parts = ref.id.split('-')
  const [base, quote, settle] = parts
  if (
    !base ||
    !quote ||
    (ref.cls === 'spot'
      ? parts.length !== 2
      : parts.length !== 3 || settle !== quote)
  )
    return null
  const stableQuotes = ['USDC', 'USDT', 'USD']
  const candidates = rows.filter(
    (row) =>
      row.market === market &&
      row.base === base &&
      (ref.cls === 'spot'
        ? row.kind === 'cex-pair'
        : row.kind === 'cex-derivative' &&
          row.contract === 'perp' &&
          row.linear === true &&
          row.settle === row.quote) &&
      (row.quote === quote ||
        (stableQuotes.includes(quote) && stableQuotes.includes(row.quote))),
  )
  candidates.sort((a, b) => {
    const rank = (row: VenueInstrumentRow) =>
      row.symbol === ref.id
        ? -2
        : row.quote === quote
          ? -1
          : stableQuotes.indexOf(row.quote)
    return rank(a) - rank(b) || a.symbol.localeCompare(b.symbol)
  })
  const selected = candidates[0]
  return selected ? { cls: ref.cls, market, id: selected.symbol } : null
}

export async function loadVenueCatalog(
  read: () => Promise<Array<VenueInstrumentRow>>,
  warm: () => Promise<unknown>,
): Promise<Array<VenueInstrumentRow>> {
  const cached = await read()
  if (cached.length) return cached
  // Warming may reject the requested pair after loading its venue table; only that table proves availability.
  await warm().catch(() => undefined)
  const loaded = await read()
  if (!loaded.length) throw new Error('Venue listings have not loaded yet')
  return loaded
}
