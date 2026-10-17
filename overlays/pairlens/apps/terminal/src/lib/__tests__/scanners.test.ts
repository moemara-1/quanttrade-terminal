import { describe, expect, test } from 'bun:test'
import {
  fetchScannerSnapshot,
  filterScannerMarkets,
  scannerLegLabel,
  scannerMarketPath,
  scannerPercent,
  scannerSnapshotSchema,
  scannerSparkline,
} from '../scanners'

describe('scanner presentation', () => {
  test('HTML or malformed responses do not expose raw response bodies', async () => {
    const original = globalThis.fetch
    globalThis.fetch = Object.assign(
      async () =>
        new Response('<html>private login response</html>', {
          headers: { 'Content-Type': 'text/html' },
        }),
      original,
    )
    try {
      await expect(fetchScannerSnapshot()).rejects.toThrow(
        'Scanner response was incomplete or invalid',
      )
    } finally {
      globalThis.fetch = original
    }
  })
  test('read errors keep HTTP status instead of silently becoming empty markets', async () => {
    const original = globalThis.fetch
    globalThis.fetch = Object.assign(
      async () => new Response('{}', { status: 503 }),
      original,
    )
    try {
      await expect(fetchScannerSnapshot()).rejects.toThrow('HTTP 503')
    } finally {
      globalThis.fetch = original
    }
  })

  test('sparklines use real seconds-based recent closes and hide stale series', () => {
    const now = 1700000000000
    const rows = [
      { time: now / 1000 - 3600, close: 2 },
      { time: now / 1000, close: 4 },
    ]
    expect(scannerSparkline(rows, now)).toBe('M0.0,22.0 L72.0,2.0')
    expect(scannerSparkline(rows, now + 7200001)).toBe(null)
    expect(
      scannerSparkline(
        [
          { time: now, close: 2 },
          { time: now + 1, close: 3 },
        ],
        now,
      ),
    ).toBe(null)
  })
  test('equal or unavailable funding never assigns both legs short', () => {
    expect(scannerLegLabel('lighter', null, 'funding')).toBe(
      'Equal / unavailable',
    )
    expect(scannerLegLabel('lighter', 'lighter', 'funding')).toBe('Long')
    expect(scannerLegLabel('hyperliquid', 'lighter', 'mark')).toBe(
      'Higher mark',
    )
  })
  test('preserves the exact venue and native perpetual symbol', () => {
    expect(scannerMarketPath({ venue: 'lighter', symbol: 'BTC-USDC' })).toBe(
      '/perp/lighter/BTC-USDC-USDC',
    )
    expect(
      scannerMarketPath({ venue: 'hyperliquid', symbol: 'BTC-USDC-USDC' }),
    ).toBe('/perp/hyperliquid/BTC-USDC-USDC')
  })
  test('keeps missing data distinct from zero and funding in fractional units', () => {
    expect(scannerPercent(null)).toBe('—')
    expect(scannerPercent(0)).toBe('0.00%')
    expect(scannerPercent(0.0001, true)).toBe('+0.0100%')
  })
  test('filters symbols, venue and quote volume together', () => {
    const rows = [
      { base: 'BTC', symbol: 'BTC-USDC', venue: 'lighter', volume24h: 200 },
      { base: 'ETH', symbol: 'ETH-USDC', venue: 'hyperliquid', volume24h: 500 },
    ]
    expect(filterScannerMarkets(rows, 'btc', 'lighter', 100)).toHaveLength(1)
    expect(filterScannerMarkets(rows, 'btc', 'lighter', 300)).toHaveLength(0)
  })
  test('rejects malformed upstream snapshots rather than showing empty success', () => {
    expect(scannerSnapshotSchema.safeParse({ markets: [] }).success).toBe(false)
  })
})
