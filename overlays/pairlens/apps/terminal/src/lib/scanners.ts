import { z } from 'zod'
import { marketRefToPath } from '@pairlens/shared/market-ref'

const venue = z.enum(['lighter', 'hyperliquid'])
const nullableNumber = z.number().finite().nullable()
const source = z.object({
  complete:z.boolean().optional(),
  failedDexs:z.array(z.string()).optional(),
  id: z.string(),
  status: z.enum(['ok', 'error']),
  observedAt: nullableNumber,
  count: z.number(),
  message: z.string().nullable(),
})
export const scannerMarketSchema = z.object({
  quote:z.string().optional(),
  dex:z.string().optional(),
  venue,
  symbol: z.string(),
  base: z.string(),
  price: z.number().finite(),
  change24h: z.number().finite(),
  volume24h: z.number().finite(),
  fundingHourly: nullableNumber,
  openInterestBase: nullableNumber,
  openInterestUsd: nullableNumber,
  relativeStrength24h: nullableNumber,
  oiToVolume: nullableNumber,
  observedAt: z.number(),
})
export const scannerSnapshotSchema = z.object({
  asOf: z.number(),
  refreshAfterMs: z.number(),
  sources: z.array(source),
  markets: z.array(scannerMarketSchema),
  comparisons: z.array(
    z.object({
      base: z.string(),
      hyperliquid: scannerMarketSchema,
      lighter: scannerMarketSchema,
      fundingGapHourly: nullableNumber,
      longVenue: venue.nullable(),
      shortVenue: venue.nullable(),
      markGapPct: z.number(),
      lowerMarkVenue: venue.nullable(),
      higherMarkVenue: venue.nullable(),
    }),
  ),
  options: z.object({
    sources: z.array(source),
    trades: z.array(
      z.object({
        id: z.string(),
        blockId: z.string(),
        instrument: z.string(),
        currency: z.enum(['BTC', 'ETH']),
        timestamp: z.number(),
        side: z.enum(['buy', 'sell']),
        amount: z.number(),
        price: z.number(),
        premiumUsd: nullableNumber,
        indexPrice: nullableNumber,
        iv: nullableNumber,
        optionType: z.enum(['call', 'put']),
        strike: z.number(),
        expiry: z.string(),
        legCount: nullableNumber,
      }),
    ),
    overview: z.array(
      z.object({
        currency: z.enum(['BTC', 'ETH']),
        observedAt: z.number(),
        contracts: z.number(),
        callOpenInterest: z.number(),
        putOpenInterest: z.number(),
        callVolume24h: z.number(),
        putVolume24h: z.number(),
        putCallVolumeRatio: nullableNumber,
      }),
    ),
    coverage: z.array(
      z.object({
        currency: z.enum(['BTC', 'ETH']),
        sampledTrades: z.number(),
        hasMore: z.boolean(),
        oldestTimestamp: nullableNumber,
        newestTimestamp: nullableNumber,
      }),
    ),
  }),
})
export type ScannerSnapshot = z.infer<typeof scannerSnapshotSchema>
export type ScannerMarket = z.infer<typeof scannerMarketSchema>
export const SCANNER_QUERY_KEY = ['quanttrade-public-scanners'] as const
export async function fetchScannerSnapshot(
  signal?: AbortSignal,
): Promise<ScannerSnapshot> {
  const response = await fetch('/_quanttrade/api/public/scanners', {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(25_000)])
      : AbortSignal.timeout(25_000),
    credentials: 'same-origin',
  })
  if (!response.ok)
    throw new Error(
      `Scanner sources could not be read (HTTP ${response.status}).`,
    )
  const parsed = scannerSnapshotSchema.safeParse(
    await response.json().catch(() => undefined),
  )
  if (!parsed.success)
    throw new Error(
      'Scanner response was incomplete or invalid. Refresh to try again.',
    )
  return parsed.data
}
export function scannerMarketPath(market: {
  venue: 'lighter' | 'hyperliquid'
  symbol: string
}) {
  return marketRefToPath({
    cls: 'perp',
    market: market.venue,
    id: /^.+-([A-Za-z0-9_.]+)-\1$/.test(market.symbol)
      ? market.symbol
      : `${market.symbol}-${market.symbol.slice(market.symbol.lastIndexOf('-')+1)}`,
  })
}
export function scannerPercent(
  value: number | null,
  fractional = false,
): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const scaled = fractional ? value * 100 : value
  return `${scaled > 0 ? '+' : ''}${scaled.toFixed(fractional ? 4 : 2)}%`
}
export function filterScannerMarkets<
  T extends { base: string; symbol: string; venue: string; volume24h: number },
>(
  rows: Array<T>,
  search: string,
  selectedVenue: string,
  minVolume: number,
): Array<T> {
  const text = search.trim().toUpperCase()
  return rows.filter(
    (row) =>
      (!text ||
        row.base.toUpperCase().includes(text) ||
        row.symbol.toUpperCase().includes(text)) &&
      (selectedVenue === 'all' || row.venue === selectedVenue) &&
      row.volume24h >= minVolume,
  )
}

export function scannerLegLabel(
  current: string,
  lower: string | null,
  mode: 'funding' | 'mark',
): string {
  if (lower === null) return 'Equal / unavailable'
  return mode === 'funding'
    ? current === lower
      ? 'Long'
      : 'Short'
    : current === lower
      ? 'Lower mark'
      : 'Higher mark'
}
const sparkCandlesSchema = z
  .array(
    z.object({
      time: z.number().finite(),
      close: z.number().finite().positive(),
    }),
  )
  .max(24)
export function scannerSparkline(
  rows: Array<{ time: number; close: number }>,
  now = Date.now(),
): string | null {
  if (rows.length < 2) return null
  const sorted = [...rows].sort((a, b) => a.time - b.time)
  const last = sorted.at(-1)!
  if (last.time * 1000 > now + 60_000 || now - last.time * 1000 > 7_200_000)
    return null
  const low = Math.min(...sorted.map((row) => row.close)),
    high = Math.max(...sorted.map((row) => row.close))
  return sorted
    .map(
      (row, index) =>
        `${index ? 'L' : 'M'}${((index / (sorted.length - 1)) * 72).toFixed(1)},${(high === low ? 12 : 22 - ((row.close - low) / (high - low)) * 20).toFixed(1)}`,
    )
    .join(' ')
}
export async function fetchScannerSparkline(
  market: { venue: 'lighter' | 'hyperliquid'; symbol: string },
  signal?: AbortSignal,
): Promise<string | null> {
  const query = new URLSearchParams({
    venue: market.venue,
    symbol: market.symbol,
    marketType: 'perpetual',
    interval: '1h',
    limit: '24',
  })
  const response = await fetch(`/_quanttrade/api/public/candles?${query}`, {
    credentials: 'same-origin',
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
      : AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error('Preview candles unavailable')
  return scannerSparkline(sparkCandlesSchema.parse(await response.json()))
}
