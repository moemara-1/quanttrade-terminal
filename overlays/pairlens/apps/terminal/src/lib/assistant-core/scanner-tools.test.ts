import { expect, test } from 'bun:test'
import { scanSnapshot } from './scanner-tools'
import type { ScannerSnapshot } from '@/lib/scanners'

function snapshot(): ScannerSnapshot {
  const row = {
    venue: 'hyperliquid' as const,
    symbol: 'BTC-USDC',
    base: 'BTC',
    price: 100,
    change24h: 2,
    volume24h: 1000000,
    fundingHourly: 0.0001,
    openInterestBase: 20,
    openInterestUsd: 2000,
    relativeStrength24h: 0,
    oiToVolume: 0.002,
    observedAt: Date.now(),
  }
  return {
    asOf: Date.now(),
    refreshAfterMs: 30000,
    sources: [
      {
        id: 'hyperliquid',
        status: 'ok',
        observedAt: Date.now(),
        count: 2,
        message: null,
      },
    ],
    markets: [
      row,
      {
        ...row,
        symbol: 'ETH-USDC',
        base: 'ETH',
        relativeStrength24h: 5,
        change24h: 7,
      },
    ],
    comparisons: [],
    options: { sources: [], trades: [], overview: [], coverage: [] },
  }
}
test('assistant scanner ranks the full eligible universe, preserves exact contract and reports sample limits', () => {
  const result = scanSnapshot(snapshot(), {
    scanner: 'strength',
    limit: 1,
    venue: 'all',
    search: '',
    minVolume: 0,
    direction: 'gainers',
  })
  expect(result.total).toBe(2)
  expect(result.truncated).toBe(true)
  expect(result.rows[0]).toMatchObject({
    base: 'ETH',
    pair: 'ETH-USDC-USDC',
    venue: 'hyperliquid',
  })
  expect(result.methodology).toContain('percentage points')
})
test('assistant scanner preserves source failure rather than fabricating an empty healthy result', () => {
  const data = snapshot()
  data.sources = [
    {
      id: 'hyperliquid',
      status: 'error',
      observedAt: null,
      count: 0,
      message: 'Unavailable',
    },
  ]
  data.markets = []
  const result = scanSnapshot(data, {
    scanner: 'strength',
    limit: 10,
    venue: 'all',
    search: '',
    minVolume: 0,
    direction: 'gainers',
  })
  expect(result.unavailable).toBe('source_unavailable')
  expect(result.rows).toEqual([])
})
test('assistant scanner filters venue/search/volume before ranking and does not turn missing relative returns into zero', () => {
  const data = snapshot()
  data.markets[1]!.relativeStrength24h = null
  expect(
    scanSnapshot(data, {
      scanner: 'strength',
      limit: 10,
      venue: 'all',
      search: 'ETH',
      minVolume: 0,
      direction: 'gainers',
    }).rows,
  ).toEqual([])
  expect(
    scanSnapshot(data, {
      scanner: 'strength',
      limit: 10,
      venue: 'lighter',
      search: '',
      minVolume: 0,
      direction: 'gainers',
    }).rows,
  ).toEqual([])
})
