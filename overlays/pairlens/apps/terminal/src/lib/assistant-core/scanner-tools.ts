import { tool } from 'ai'
import { z } from 'zod'
import type { ScannerSnapshot } from '@/lib/scanners'
import { fetchScannerSnapshot } from '@/lib/scanners'

const querySchema = z
  .object({
    scanner: z.enum([
      'funding',
      'price-gap',
      'strength',
      'crowding',
      'option-blocks',
      'option-overview',
    ]),
    venue: z.enum(['all', 'lighter', 'hyperliquid']).default('all'),
    search: z.string().max(64).default(''),
    minVolume: z.number().finite().nonnegative().default(0),
    direction: z.enum(['gainers', 'losers']).default('gainers'),
    strengthMetric: z
      .enum(['change24h', 'relativeStrength24h'])
      .default('change24h'),
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict()
type Query = z.input<typeof querySchema>
const methodology =
  'Public observations only. Funding is a fractional hourly estimate: positive means longs pay shorts. Funding differences and mark gaps exclude fees, slippage and execution risk; mark gaps are a percentage of midpoint, not executable spreads. Strength uses the returned rankingMetric: change24h is raw 24h percent, relativeStrength24h is percentage points versus BTC on the same venue. Crowding ranks absolute funding, not measured long/short positioning. Options are sampled real Deribit block legs, not inferred strategies; premium USD is not underlying notional. No trades were prepared or submitted.'

export function scanSnapshot(snapshot: ScannerSnapshot, input: Query) {
  const query = querySchema.parse(input)
  const options = query.scanner.startsWith('option-')
  const comparison =
    query.scanner === 'funding' || query.scanner === 'price-gap'
  const sources = options
    ? snapshot.options.sources
    : comparison
      ? snapshot.sources
      : snapshot.sources.filter(
          (s) => query.venue === 'all' || s.id === query.venue,
        )
  const needle = query.search.trim().toUpperCase()
  let rows: Array<Record<string, unknown>> = []
  if (query.scanner === 'funding' || query.scanner === 'price-gap') {
    rows = snapshot.comparisons
      .filter(
        (row) =>
          (!needle || row.base.toUpperCase().includes(needle)) &&
          Math.min(row.hyperliquid.volume24h, row.lighter.volume24h) >=
            query.minVolume &&
          (query.scanner !== 'funding' || row.fundingGapHourly !== null),
      )
      .sort((a, b) =>
        query.scanner === 'funding'
          ? (b.fundingGapHourly ?? 0) - (a.fundingGapHourly ?? 0)
          : b.markGapPct - a.markGapPct,
      )
      .map((row) => ({
        ...row,
        hyperliquid: {
          ...row.hyperliquid,
          pair: `${row.hyperliquid.symbol}-USDC`,
        },
        lighter: { ...row.lighter, pair: `${row.lighter.symbol}-USDC` },
      }))
  } else if (query.scanner === 'strength' || query.scanner === 'crowding') {
    rows = snapshot.markets
      .filter(
        (row) =>
          (query.venue === 'all' || query.venue === row.venue) &&
          (!needle ||
            row.base.toUpperCase().includes(needle) ||
            row.symbol.toUpperCase().includes(needle)) &&
          row.volume24h >= query.minVolume &&
          (query.scanner === 'strength'
            ? query.strengthMetric === 'change24h' ||
              row.relativeStrength24h !== null
            : row.fundingHourly !== null),
      )
      .sort((a, b) =>
        query.scanner === 'crowding'
          ? Math.abs(b.fundingHourly ?? 0) - Math.abs(a.fundingHourly ?? 0)
          : (query.direction === 'gainers' ? 1 : -1) *
            ((b[query.strengthMetric] ?? 0) - (a[query.strengthMetric] ?? 0)),
      )
      .map((row) => ({ ...row, pair: `${row.symbol}-USDC` }))
  } else if (query.scanner === 'option-blocks') {
    rows = snapshot.options.trades
      .filter((row) => !needle || row.instrument.includes(needle))
      .map((row) => ({ ...row }))
  } else
    rows = snapshot.options.overview
      .filter((row) => !needle || row.currency.includes(needle))
      .map((row) => ({ ...row }))
  return {
    asOf: snapshot.asOf,
    sources,
    methodology,
    ...(query.scanner === 'strength'
      ? { rankingMetric: query.strengthMetric, direction: query.direction }
      : {}),
    unavailable:
      sources.length === 0 || sources.every((s) => s.status === 'error')
        ? 'source_unavailable'
        : null,
    total: rows.length,
    truncated: rows.length > query.limit,
    rows: rows.slice(0, query.limit),
    ...(options ? { sampleCoverage: snapshot.options.coverage } : {}),
  }
}

export function buildScannerTools(
  read: () => Promise<ScannerSnapshot> = () =>
    fetchScannerSnapshot(AbortSignal.timeout(25000)),
) {
  return {
    scan_markets: tool({
      description:
        'Read QuantTrade integrated Lighter/Hyperliquid scanners or Deribit options. Use this before claiming to have scanned all gainers/losers, funding arbitrage, mark gaps, crowding or options block trades. Strength defaults to raw change24h; choose relativeStrength24h explicitly for percentage-point outperformance versus BTC. Filters apply before ranking; total and truncated disclose scope. Returned pair and venue are exact native perpetual identifiers for subsequent quote/account/risk checks and one human-confirmed trade proposal; the scanner itself never places orders. Public signals are not guaranteed opportunities.',
      inputSchema: querySchema,
      execute: async (input) => {
        try {
          const snapshot = await read()
          if (
            Date.now() - snapshot.asOf > 90000 ||
            snapshot.asOf > Date.now() + 5000
          )
            return {
              unavailable: 'stale_snapshot',
              hint: 'The scanner snapshot is stale. Do not describe it as current or use it to prepare a trade.',
            }
          return scanSnapshot(snapshot, input)
        } catch {
          return {
            unavailable: 'scanner_unavailable',
            hint: 'The scanner could not be read. Coverage is unknown, not an empty market. No trading action was performed.',
          }
        }
      },
    }),
  }
}
