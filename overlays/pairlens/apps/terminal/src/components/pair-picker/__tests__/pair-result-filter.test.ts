import { describe, expect, test } from 'bun:test'
import { ALL_PAIR_RESULTS, filterPairResults } from '../pair-result-filter'
import { synthesizeEntry } from '../pair-picker-data'
import type { PairEntry } from '../pair-picker-data'

const row = (market: string, symbol: string): PairEntry => ({
  id: `${market}:${symbol}`,
  symbol,
  market,
  name: symbol,
  base: symbol.split('-')[0],
  quote: 'USDC',
  assetClass: 'crypto-perp',
  categories: [],
  rank: 1,
})
describe('venue-qualified pair discovery', () => {
  test('a recent perpetual shows the actual quote rather than the settle suffix', () => {
    expect(synthesizeEntry('PRL-USDC-USDC', 'perp').quote).toBe('USDC')
  })
  test('same contract stays reachable on both venues', () => {
    const rows = [
      row('hyperliquid', 'BTC-USDC-USDC'),
      row('lighter', 'BTC-USDC-USDC'),
      row('binance-futures', 'BTC-USDT-USDT'),
    ]
    expect(filterPairResults(rows, ALL_PAIR_RESULTS)).toHaveLength(3)
    expect(
      filterPairResults(rows, { venue: 'lighter', cls: 'crypto-perp' }),
    ).toEqual([rows[1]])
  })
  test('native PRL is not lost behind more than twenty major-market hits', () => {
    const rows = [
      ...Array.from({ length: 50 }, (_, i) =>
        row('binance-futures', `PRL${i}-USDT-USDT`),
      ),
      row('lighter', 'PRL-USDC-USDC'),
    ]
    expect(filterPairResults(rows, ALL_PAIR_RESULTS)).toHaveLength(51)
    expect(
      filterPairResults(rows, { venue: 'lighter', cls: 'all' }).map(
        (r) => r.symbol,
      ),
    ).toEqual(['PRL-USDC-USDC'])
  })
  test('class and venue constraints intersect and exact duplicate identities collapse', () => {
    const perp = row('lighter', 'ETH-USDC-USDC')
    const spot = { ...row('lighter-spot', 'ETH-USDC'), assetClass: 'crypto' }
    expect(
      filterPairResults([perp, perp, spot], { venue: 'all', cls: 'crypto' }),
    ).toEqual([spot])
    expect(
      filterPairResults([perp, spot], { venue: 'lighter', cls: 'crypto' }),
    ).toEqual([])
  })
})
