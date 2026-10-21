import { tool } from 'ai'
import { z } from 'zod'
import type { ScannerSnapshot } from '@/lib/scanners'
import { fetchScannerSnapshot } from '@/lib/scanners'
import { fetchScannerDetail } from '@/lib/scanner-detail'

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
      .map((row) => ({ ...row, pair: `${row.symbol}-${row.quote??'USDC'}` }))
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
    coverageComplete:sources.length>0&&sources.every(source=>source.status==='ok'&&source.complete!==false),
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

const briefQuerySchema = z.object({
  venue: z.enum(['all', 'lighter', 'hyperliquid']).default('all'),
  search: z.string().max(64).default(''),
  minVolume: z.number().finite().nonnegative().default(0),
}).strict()
type BriefQuery = z.input<typeof briefQuerySchema>
type ResearchView = {
  total: number | null
  truncated: boolean
  omittedForSize: number
  sourceIds: Array<string>
  coverageComplete: boolean
  unavailable: string | null
  rows: Array<Record<string, unknown>>
}
const briefViews = ['gainers', 'losers', 'relativeStrength', 'crowding', 'fundingArbitrage', 'markGaps'] as const
type BriefViewName = typeof briefViews[number]
const compactMarket = (row: Record<string, unknown>) => ({
  ...Object.fromEntries(
    ['venue', 'symbol', 'pair', 'base', 'quote', 'dex', 'price', 'change24h', 'volume24h', 'fundingHourly', 'openInterestUsd', 'relativeStrength24h', 'oiToVolume', 'observedAt']
      .filter(key => row[key] !== undefined).map(key => [key, row[key]]),
  ),
  fundingPayer: typeof row.fundingHourly !== 'number' || !Number.isFinite(row.fundingHourly)
    ? 'unknown' : row.fundingHourly > 0 ? 'longs' : row.fundingHourly < 0 ? 'shorts' : 'none',
})
const compactComparison = (row: Record<string, unknown>) => ({
  ...Object.fromEntries(['base', 'fundingGapHourly', 'longVenue', 'shortVenue', 'markGapPct', 'lowerMarkVenue', 'higherMarkVenue'].map(key => [key, row[key]])),
  hyperliquid: compactMarket(row.hyperliquid as Record<string, unknown>),
  lighter: compactMarket(row.lighter as Record<string, unknown>),
})

/** Six scanner perspectives from one public read; no account or order actions. */
export function tradeResearchBrief(snapshot: ScannerSnapshot | null, input: BriefQuery) {
  const query = briefQuerySchema.parse(input)
  const now = Date.now()
  const stale = snapshot !== null && (now - snapshot.asOf > 90000 || snapshot.asOf > now + 5000)
  const unavailable = snapshot === null ? 'scanner_unavailable' : stale ? 'stale_snapshot' : null
  const sourceRows = snapshot?.sources ?? []
  const sources = sourceRows.slice(0, 8).map(source => ({
    id: source.id.length <= 256 ? source.id : null,
    identityOmitted: source.id.length > 256,
    status: source.status,
    observedAt: source.observedAt,
    count: source.count,
    complete: source.complete !== false,
    failedDexCount: source.failedDexs?.length ?? 0,
  }))
  const definitions: Record<BriefViewName, Query> = {
    gainers: {scanner:'strength', direction:'gainers'},
    losers: {scanner:'strength', direction:'losers'},
    relativeStrength: {scanner:'strength', strengthMetric:'relativeStrength24h'},
    crowding: {scanner:'crowding'},
    fundingArbitrage: {scanner:'funding'},
    markGaps: {scanner:'price-gap'},
  }
  const views = Object.fromEntries(briefViews.map(name => {
    const definition = definitions[name]
    if (!snapshot || unavailable) return [name, {total:null,truncated:false,omittedForSize:0,sourceIds:[],coverageComplete:false,unavailable,rows:[]} satisfies ResearchView]
    const result = scanSnapshot(snapshot, {...definition,...query,limit:3})
    const comparison = definition.scanner === 'funding' || definition.scanner === 'price-gap'
    const rows = result.rows.map<Record<string, unknown>>(comparison ? compactComparison : compactMarket)
    const view: ResearchView = {
      total:result.total,truncated:result.truncated,omittedForSize:0,
      sourceIds:result.sources.filter(source=>source.id==='lighter'||source.id==='hyperliquid').map(source=>source.id).slice(0,2),
      coverageComplete:result.coverageComplete && result.sources.every(source=>(source.id==='lighter'||source.id==='hyperliquid') && source.observedAt !== null && now-source.observedAt<=90000 && source.observedAt<=now+5000),
      unavailable:result.unavailable, rows,
    }
    return [name,view]
  })) as Record<BriefViewName,ResearchView>
  const result = {
    asOf:snapshot?.asOf ?? null, unavailable, scope:query,
    sources,sourceTotal:sourceRows.length,sourceCoverageTruncated:sourceRows.length>sources.length || sources.some(source=>source.identityOmitted),
    positioningEvidence:'not-measured; crowding is an absolute-funding proxy only',
    comparisonScope:'Hyperliquid and Lighter cross-venue context; selected venue limits directional rankings, not the comparison legs.',
    methodology,
    nextChecks:'This is scanner context only, not a trade decision. Check relevant news and catalysts, fresh target-venue charts/book/funding, account exposure, contract constraints, fees and weighted risk/reward before preparing an entry. Missing sources are unknown. No orders were prepared or submitted.',
    views,
  }
  // Drop whole rows rather than clipping native identities or pretending partial
  // order-like data is complete. Counts preserve the observed eligible universe.
  while (JSON.stringify(result).length > 12000) {
    const candidates = briefViews.filter(name=>views[name].rows.length>0)
    const largest = candidates.sort((a,b)=>JSON.stringify(views[b].rows).length-JSON.stringify(views[a].rows).length)[0]
    if (!largest) break
    views[largest].rows.pop()
    views[largest].omittedForSize++
    views[largest].truncated=true
  }
  return result
}

export function buildScannerTools(
  read: () => Promise<ScannerSnapshot> = () =>
    fetchScannerSnapshot(AbortSignal.timeout(25000)),
) {
  return {
    get_trade_research_brief: tool({
      description:
        'Start broad Lighter/Hyperliquid trade research with one compact public scanner read: top three raw gainers, losers, BTC-relative leaders, funding/crowding, funding differences and mark gaps. Preserves exact venue-native identities, timestamps, failures and truncated coverage. Not news, account checks, executable quotes, guaranteed opportunities or order preparation. Use focused reads for the selected candidate next.',
      inputSchema: briefQuerySchema,
      execute: async (input) => {
        try { return tradeResearchBrief(await read(), input) }
        catch { return tradeResearchBrief(null, input) }
      },
    }),
    get_scanner_detail: tool({
      description:
        'Read selected native Lighter/Hyperliquid market funding and strength history. Includes verified settled 24-hour funding sums only when all 24 hourly observations are present, separate constant-current-rate projections, actual closed hourly prices and same-venue BTC-relative performance. Use this to check scanner candidates before suggesting a paired review. Historical results and annualized scenarios do not predict future funding or establish net profitability; fees and slippage remain unknown. This tool never prepares or executes orders.',
      inputSchema: z
        .object({
          base: z
            .string()
            .min(1)
            .max(64)
            .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
          venue: z.enum(['all', 'lighter', 'hyperliquid']).default('all'),
        })
        .strict(),
      execute: async ({ base, venue }) => {
        try {
          return await fetchScannerDetail(base, venue)
        } catch {
          return {
            unavailable: 'scanner_detail_unavailable',
            message:
              'Selected funding or price history could not be verified. Missing history is unknown, not zero.',
          }
        }
      },
    }),
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
