import { z } from 'zod'
import type {
  FundingHistoryResponse,
  FundingSnapshotResponse,
  OpenInterestResponse,
} from '@pairlens/shared/instrument-types'
import type { BridgeFetcher } from './quanttrade-session'

type Venue = 'hyperliquid' | 'lighter'
const pair = z.string().min(3).max(100)
const pairs = z.array(pair).max(100)
const requestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('funding-rates'),
      pairs: pairs.optional(),
      bases: z.array(z.string().min(1).max(64)).max(100).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('open-interest'),
      pairs,
      history: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('funding-history'),
      pair,
      limit: z.number().int().min(1).max(744).optional().default(24),
    })
    .strict(),
])
const finite = z
  .union([z.number(), z.string().min(1)])
  .transform(Number)
  .pipe(z.number().finite())
const marketSchema = z.object({
  symbol: z.string(),
  base: z.string(),
  price: finite.pipe(z.number().positive()),
  fundingRate: finite.nullable().optional(),
  openInterest: finite.pipe(z.number().nonnegative()).nullable().optional(),
  updatedAt: z.number().finite().nonnegative(),
})

/** Public market fundingRate is normalized to an hourly fraction by the bridge. */
export async function executeQuantTradeFunding(
  venue: Venue,
  params: Record<string, unknown>,
  fetcher: BridgeFetcher = (url, init) => fetch(url, init),
): Promise<
  FundingSnapshotResponse | OpenInterestResponse | FundingHistoryResponse
> {
  const request = requestSchema.parse(params)
  const json = async (path: string): Promise<unknown> => {
    const response = await fetcher(`/_quanttrade/api/public/${path}`, {
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok)
      throw new Error(`Exchange research returned HTTP ${response.status}`)
    return response.json()
  }
  if (request.action === 'funding-history' && venue === 'lighter') {
    // The settled endpoint's rate/direction units differ from funding-rates.
    // Do not publish an annualized figure before those units are verified.
    throw new Error(
      'Lighter settled funding history units are not verified; current hourly funding and open interest remain available',
    )
  }
  const rows = z
    .array(marketSchema)
    .parse(await json(`markets?venue=${venue}&marketType=perpetual`))
  const nativePair = (symbol: string) => `${symbol}-USDC`
  const ts = Date.now()
  if (request.action === 'funding-rates') {
    const wanted = request.pairs?.length ? new Set(request.pairs) : null
    const bases =
      !wanted && request.bases?.length
        ? new Set(request.bases.map((base) => base.toUpperCase()))
        : null
    const entries = rows
      .filter(
        (row) =>
          (!wanted || wanted.has(nativePair(row.symbol))) &&
          (!bases || bases.has(row.base.toUpperCase())) &&
          row.fundingRate !== null &&
          row.fundingRate !== undefined,
      )
      .slice(0, request.limit ?? rows.length)
      .map((row) => ({
        pair: nativePair(row.symbol),
        base: row.base,
        quote: 'USDC',
        fundingRate: row.fundingRate!,
        intervalHours: 1,
        intervalKnown: true,
        markPrice: row.price,
        ts: row.updatedAt,
      }))
    return { market: venue, entries, ts }
  }
  if (request.action === 'open-interest') {
    const wanted = new Set(request.pairs)
    const entries = rows
      .filter(
        (row) =>
          wanted.has(nativePair(row.symbol)) &&
          row.openInterest !== null &&
          row.openInterest !== undefined,
      )
      .map((row) => ({
        pair: nativePair(row.symbol),
        base: row.base,
        amount: row.openInterest!,
        contractSize: 1,
        value: row.openInterest! * row.price,
        ts: row.updatedAt,
      }))
    return {
      market: venue,
      entries,
      supported: rows.some(
        (row) => row.openInterest !== null && row.openInterest !== undefined,
      ),
      ts,
    }
  }
  const market = rows.find((row) => nativePair(row.symbol) === request.pair)
  if (!market)
    throw new Error('Funding contract is unavailable on the selected venue')
  const limit = Math.min(100, request.limit)
  const startTime = ts - limit * 3600000
  const query = new URLSearchParams({
    venue,
    action: 'funding-history',
    coin: market.base,
    startTime: String(startTime),
    endTime: String(ts),
    limit: String(limit),
  })
  const history = z
    .object({
      venue: z.literal('hyperliquid'),
      action: z.literal('funding-history'),
      truncated: z.boolean(),
      data: z.array(
        z.object({ time: z.number().int().nonnegative(), fundingRate: finite }),
      ),
    })
    .parse(await json(`research?${query}`))
  const points = [
    ...new Map(
      history.data
        .filter((point) => point.time >= startTime && point.time <= ts)
        .map((point) => [
          point.time,
          { ts: point.time, rate: point.fundingRate },
        ]),
    ).values(),
  ]
    .sort((a, b) => a.ts - b.ts)
    .slice(-limit)
  return { market: venue, pair: request.pair, points, intervalHours: 1, ts }
}
