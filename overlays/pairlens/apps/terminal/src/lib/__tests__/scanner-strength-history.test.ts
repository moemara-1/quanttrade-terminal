import { afterEach, expect, test } from 'bun:test'
import { fetchScannerStrengthHistory } from '../scanner-strength-history'

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})
const end = Math.floor(Date.now() / 3600000) * 3600000
const snapshot = {
  asOf: Date.now(),
  window: '1d',
  windowStart: end - 86400000,
  windowEnd: end,
  benchmarkSymbol: 'BTC-USDC',
  series: [
    {
      venue: 'hyperliquid',
      symbol: 'ETH-USDC',
      base: 'ETH',
      status: 'partial',
      points: [],
      message: 'Missing',
    },
  ],
}

test('all-error history remains a usable report with native namespace identity', async () => {
  globalThis.fetch = (async () =>
    Response.json({
      ...snapshot,
      benchmarkSymbol: null,
      series: [
        {
          venue: 'hyperliquid',
          symbol: 'xyz:TSLA-USDH',
          base: 'xyz:TSLA',
          status: 'error',
          points: [],
          message: 'Unavailable',
        },
      ],
    })) as typeof fetch
  const result = await fetchScannerStrengthHistory({
    venue: 'hyperliquid',
    symbols: ['xyz:TSLA-USDH'],
    window: '1d',
  })
  expect(result.series[0].status).toBe('error')
})
test('strength fetch preserves exact identities and validates returned selection', async () => {
  globalThis.fetch = (async (url) => {
    expect(String(url)).toBe(
      '/_quanttrade/api/public/scanners/strength-history?venue=hyperliquid&symbols=ETH-USDC&window=1d',
    )
    return Response.json(snapshot)
  }) as typeof fetch
  expect(
    (
      await fetchScannerStrengthHistory({
        venue: 'hyperliquid',
        symbols: ['ETH-USDC'],
        window: '1d',
      })
    ).series[0].symbol,
  ).toBe('ETH-USDC')
  globalThis.fetch = (async () =>
    Response.json({
      ...snapshot,
      series: [{ ...snapshot.series[0], symbol: 'BTC-USDC' }],
    })) as typeof fetch
  await expect(
    fetchScannerStrengthHistory({
      venue: 'hyperliquid',
      symbols: ['ETH-USDC'],
      window: '1d',
    }),
  ).rejects.toThrow('identity')
})
test('strength fetch rejects stale observations and invalid windows', async () => {
  globalThis.fetch = (async () =>
    Response.json({ ...snapshot, asOf: Date.now() - 180000 })) as typeof fetch
  await expect(
    fetchScannerStrengthHistory({
      venue: 'hyperliquid',
      symbols: ['ETH-USDC'],
      window: '1d',
    }),
  ).rejects.toThrow('stale')
  globalThis.fetch = (async () =>
    Response.json({ ...snapshot, windowEnd: end - 1 })) as typeof fetch
  await expect(
    fetchScannerStrengthHistory({
      venue: 'hyperliquid',
      symbols: ['ETH-USDC'],
      window: '1d',
    }),
  ).rejects.toThrow('window')
})
