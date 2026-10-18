import { describe, expect, test } from 'bun:test'
import { queryInstruments } from '@pairlens/plugins/catalog'
import { buildWatchlistItems } from '../watchlist-items'
import { createStarterLists } from '../starter-watchlists'
import type { Instrument } from '@pairlens/shared/instrument-types'
import { readWatchlistEntry } from '@/stores/watchlists-store'

describe('saved watchlist rows', () => {
  test('native-only discovery cannot hide the real bundled Top Crypto metadata', () => {
    const refs = createStarterLists()[0].symbols.map(readWatchlistEntry)
    const native: Instrument = {
      id: 'lighter:BTC-USDC-USDC',
      kind: 'cex-derivative',
      market: 'lighter',
      symbol: 'BTC-USDC-USDC',
      name: 'BTC perpetual',
      base: 'BTC',
      quote: 'USDC',
      settle: 'USDC',
      contract: 'perp',
      linear: true,
      assetClass: 'crypto-perp',
      categories: [],
      rank: 1,
      featured: false,
    }
    const expected = queryInstruments('', {
      symbols: refs.map((ref) => ref.id).join(','),
    }).items
    expect(expected).toHaveLength(30)
    const rows = buildWatchlistItems(refs, [native])
    expect(rows.filter((row) => row.metadataResolved)).toHaveLength(30)
    expect(rows.map((row) => row.name)).toEqual(
      refs.map((ref) => expected.find((item) => item.symbol === ref.id)?.name),
    )
    expect(
      rows.every((row) => row.market === '' && row.listedOn.length === 0),
    ).toBe(true)
    expect(
      buildWatchlistItems([{ cls: 'spot', id: 'XMR-USDT' }], [native])[0]
        .metadataResolved,
    ).toBe(false)
  })
  test('missing or loading catalogs cannot erase saved XMR', () => {
    const rows = buildWatchlistItems([{ cls: 'spot', id: 'XMR-USDT' }], [])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      symbol: 'XMR-USDT',
      name: 'XMR-USDT',
      assetClass: 'spot',
      market: '',
    })
    expect(rows[0]).not.toHaveProperty('price')
    expect(rows[0].metadataResolved).toBe(false)
    expect(buildWatchlistItems([], [])).toEqual([])
  })

  test('same-name classes remain separate and receive correct metadata', () => {
    const equity: Instrument = {
      id: 'stocks:ABC',
      kind: 'equity',
      market: 'alpaca',
      symbol: 'ABC',
      name: 'ABC shares',
      base: 'ABC',
      quote: 'USD',
      assetClass: 'stocks',
      categories: [],
      rank: 1,
      featured: false,
    }
    const rows = buildWatchlistItems(
      [
        { cls: 'spot', id: 'ABC' },
        { cls: 'stocks', id: 'ABC' },
      ],
      [equity],
    )
    expect(rows.map((row) => row.name)).toEqual(['ABC', 'ABC shares'])
    expect(new Set(rows.map((row) => row.id)).size).toBe(2)
  })

  test('preserves an explicitly pinned native venue', () => {
    const native: Instrument = {
      id: 'lighter:PRL-USDC-USDC',
      kind: 'cex-derivative',
      market: 'lighter',
      symbol: 'PRL-USDC-USDC',
      name: 'PRL perpetual',
      base: 'PRL',
      quote: 'USDC',
      settle: 'USDC',
      contract: 'perp',
      linear: true,
      assetClass: 'crypto-perp',
      categories: [],
      rank: 1,
      featured: false,
    }
    const rows = buildWatchlistItems(
      [{ cls: 'perp', market: 'lighter', id: native.symbol }],
      [{ ...native, market: 'hyperliquid' }, native],
    )
    expect(rows[0].market).toBe('lighter')
    expect(rows[0].name).toBe('PRL perpetual')
    expect(rows[0].metadataResolved).toBe(true)
  })
})
