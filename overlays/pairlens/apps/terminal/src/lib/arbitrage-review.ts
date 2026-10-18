import Decimal from 'decimal.js'
import { z } from 'zod'
import type { ScannerSnapshot } from '@/lib/scanners'
import { quantTradeFetch } from '@/lib/plugins/quanttrade-session'

const venue = z.enum(['lighter', 'hyperliquid'])
const positive = z
  .string()
  .max(80)
  .refine((value) => {
    try {
      return new Decimal(value).isFinite() && new Decimal(value).gt(0)
    } catch {
      return false
    }
  })
const account = z.object({
  accountName: z.string(),
  mode: z.enum(['paper', 'live']),
  connectionRevision: z.string().nullable(),
  availableMargin: z.string(),
  observedAt: z.number(),
})
const legSchema = z.object({
  account,
  proposal: z.object({
    id: z.string(),
    accountName: z.string(),
    mode: z.enum(['paper', 'live']),
    connectionRevision: z.string().nullable().optional(),
    status: z.string(),
    order: z.object({
      venue,
      symbol: z.string(),
      side: z.enum(['buy', 'sell']),
      type: z.literal('market'),
      size: positive,
      leverage: z.number(),
      marginMode: z.enum(['cross', 'isolated']),
    }),
    referencePrice: positive,
    estimatedNotional: positive,
    expiresAt: z.number(),
  }),
  fillEvidence: z
    .object({
      status: z.enum(['filled', 'pending', 'failed']),
      fillSize: z.string().optional(),
      fillPrice: z.string().optional(),
      observedAt: z.number(),
    })
    .optional(),
})
export const arbitragePlanSchema = z.object({
  id: z.string().uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.number(),
  expiresAt: z.number(),
  updatedAt: z.number(),
  status: z.enum([
    'review',
    'executing',
    'filled',
    'partial',
    'unknown',
    'blocked',
  ]),
  maxTotalInitialMargin: positive.optional(),
  legs: z.tuple([legSchema, legSchema]),
  message: z.string(),
})
export type ArbitrageReviewPlan = z.infer<typeof arbitragePlanSchema>
type Comparison = ScannerSnapshot['comparisons'][number]
export function pairedBaseSize(
  margin: string,
  leverage: number,
  prices: [string, string],
  decimals: [number, number],
  bandBps: number,
): string {
  if (
    !/^\d+(?:\.\d+)?$/.test(margin) ||
    !new Decimal(margin).gt(0) ||
    !Number.isInteger(leverage) ||
    leverage < 1 ||
    leverage > 125 ||
    !Number.isInteger(bandBps) ||
    bandBps < 1 ||
    bandBps > 1000 ||
    decimals.some((n) => !Number.isInteger(n) || n < 0 || n > 18)
  )
    throw new Error('Enter a positive total margin and valid leverage')
  const marks = prices.map((value) => new Decimal(value))
  if (marks.some((value) => !value.isFinite() || value.lte(0)))
    throw new Error('Current market prices are unavailable')
  const size = new Decimal(margin)
    .mul(leverage)
    .div(2)
    .div(Decimal.max(...marks))
    .div(new Decimal(1).plus(new Decimal(bandBps).div(10000)))
    .toDecimalPlaces(Math.min(...decimals), Decimal.ROUND_DOWN)
  if (size.lte(0))
    throw new Error('Margin is below the common exchange size precision')
  return size.toFixed()
}
async function readResponse(response: Response): Promise<unknown> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error(`QuantTrade response unavailable (HTTP ${response.status})`)
  }
  if (!response.ok) {
    const error = z.object({ error: z.string().max(500) }).safeParse(body)
    throw new Error(
      error.success
        ? error.data.error
        : `QuantTrade request failed (HTTP ${response.status})`,
    )
  }
  return body
}
export async function prepareArbitrageReview(
  comparison: Comparison,
  margin: string,
  leverage: number,
  marginMode: 'cross' | 'isolated',
): Promise<ArbitrageReviewPlan> {
  if (
    !comparison.longVenue ||
    !comparison.shortVenue ||
    comparison.longVenue === comparison.shortVenue
  )
    throw new Error(
      'Both legs need distinct verified long and short directions',
    )
  if (
    !/^\d+(?:\.\d+)?$/.test(margin) ||
    !new Decimal(margin).gt(0) ||
    !Number.isInteger(leverage) ||
    leverage < 1 ||
    leverage > 125
  )
    throw new Error('Enter a positive total margin and valid leverage')
  const marketSchema = z.array(
    z.object({
      venue,
      symbol: z.string(),
      price: positive,
      sizeDecimals: z.number().int().min(0).max(18),
      maxLeverage: z.number().int().positive().optional(),
      updatedAt: z.number(),
    }),
  )
  const readMarkets = async (selected: 'hyperliquid' | 'lighter') =>
    marketSchema.parse(
      await readResponse(
        await fetch(
          `/_quanttrade/api/public/markets?venue=${selected}&marketType=perpetual`,
          {
            credentials: 'same-origin',
            signal: AbortSignal.timeout(30000),
            redirect: 'error',
          },
        ),
      ),
    )
  const [hl, lt, status] = await Promise.all([
    readMarkets('hyperliquid'),
    readMarkets('lighter'),
    quantTradeFetch('/_quanttrade/api/status', {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(20000),
    })
      .then(readResponse)
      .then((value) =>
        z
          .object({ maxPriceDeviationBps: z.number().int().min(1).max(1000) })
          .parse(value),
      ),
  ])
  const rows = [
    hl.find(
      (row) =>
        row.venue === 'hyperliquid' && row.symbol === `${comparison.base}-USDC`,
    ),
    lt.find(
      (row) =>
        row.venue === 'lighter' && row.symbol === `${comparison.base}-USDC`,
    ),
  ]
  if (
    rows.some(
      (row) =>
        !row ||
        Date.now() - row.updatedAt > 90000 ||
        row.updatedAt > Date.now() + 5000,
    )
  )
    throw new Error(
      'Both exact market quotes must be current before preparation',
    )
  const a = rows[0]!,
    b = rows[1]!
  if (
    [a, b].some(
      (row) => row.maxLeverage === undefined || leverage > row.maxLeverage,
    )
  )
    throw new Error('Leverage must fit both venues’ verified contract limits')
  const size = pairedBaseSize(
    margin,
    leverage,
    [a.price, b.price],
    [a.sizeDecimals, b.sizeDecimals],
    status.maxPriceDeviationBps,
  )
  const input = {
    requestId: crypto.randomUUID(),
    base: comparison.base,
    longVenue: comparison.longVenue,
    size,
    leverage,
    marginMode,
    maxTotalInitialMargin: new Decimal(margin).toFixed(),
  }
  const plan = arbitragePlanSchema.parse(
    await readResponse(
      await quantTradeFetch('/_quanttrade/api/arbitrage/prepare', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(120000),
      }),
    ),
  )
  if (
    plan.legs.some(
      (leg, index) =>
        leg.proposal.order.symbol !== `${comparison.base}-USDC` ||
        leg.proposal.order.side !== (index === 0 ? 'buy' : 'sell') ||
        leg.proposal.order.venue !==
          (index === 0 ? comparison.longVenue : comparison.shortVenue) ||
        !new Decimal(leg.proposal.order.size).eq(size) ||
        leg.proposal.order.leverage !== leverage ||
        leg.proposal.order.marginMode !== marginMode,
    ) ||
    plan.maxTotalInitialMargin !== input.maxTotalInitialMargin
  )
    throw new Error(
      'Paired review identity mismatch; no confirmation is available',
    )
  return plan
}
export async function confirmArbitrageReview(
  plan: ArbitrageReviewPlan,
): Promise<ArbitrageReviewPlan> {
  if (plan.status !== 'review' || plan.expiresAt <= Date.now())
    throw new Error('This paired review is no longer confirmable')
  const result = arbitragePlanSchema.parse(
    await readResponse(
      await quantTradeFetch(`/_quanttrade/api/arbitrage/${plan.id}/confirm`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint: plan.fingerprint }),
        signal: AbortSignal.timeout(180000),
      }),
    ),
  )
  if (
    result.id !== plan.id ||
    result.fingerprint !== plan.fingerprint ||
    result.legs.some(
      (leg, index) => leg.proposal.id !== plan.legs[index].proposal.id,
    )
  )
    throw new Error(
      'Paired confirmation identity mismatch; inspect the original plan',
    )
  return result
}
