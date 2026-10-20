import { z } from 'zod'
import { getLedgerEntry } from '@/lib/plugins/plugin-ledger'
import { buildActivationConfig } from '@/lib/plugins/official-config'

const number = z.number().finite()
export const arenaConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(200),
    venue: z.enum(['lighter', 'hyperliquid']),
    symbol: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_.:-]+$/),
    intervalMinutes: number.int().min(15).max(1440),
    initialEquity: number.positive().max(100_000_000),
    marginPerTrade: number.positive().max(10_000_000),
    leverage: number.int().min(1).max(100),
    maxDailyLoss: number.positive().max(100_000_000),
    maxAiSpendDaily: number.positive().max(1000),
    maxRunsDaily: number.int().min(1).max(96),
    stopLossPct: number.positive().max(50),
    takeProfitPct: number.positive().max(500),
    minVolume24h: number.nonnegative().max(1e14),
    maxAbsFundingBps: number.nonnegative().max(10000),
    allowedSide: z.enum(['both', 'long', 'short']),
    minConfidence: number.min(0).max(1),
    feeBps: number.nonnegative().max(100),
    slippageBps: number.nonnegative().max(100),
    rules: z.string().trim().min(1).max(2000),
  })
  .strict()
  .refine((config) => config.marginPerTrade <= config.initialEquity, {
    path: ['marginPerTrade'],
    message: 'Margin cannot exceed the paper bankroll',
  })
export type ArenaConfig = z.infer<typeof arenaConfigSchema>
const positionSchema = z.object({
  side: z.enum(['long', 'short']),
  size: number,
  entryPrice: number,
  margin: number,
  leverage: number,
  stopPrice: number,
  takeProfitPrice: number,
  openedAt: number,
  lastFundingAt: number,
})
const botSchema = z.object({
  id: z.string().min(1),
  config: arenaConfigSchema,
  status: z.enum([
    'paused',
    'running',
    'error',
    'needs-key',
    'budget-paused',
    'loss-paused',
  ]),
  reason: z.string().nullable(),
  archived: z.boolean(),
  nextWakeAt: number.nullable(),
  leaseExpiresAt: number.nullable(),
  createdAt: number,
  updatedAt: number,
  paper: z.object({
    cash: number,
    equity: number,
    realizedPnl: number,
    peakEquity: number,
    maxDrawdownPct: number,
    closedTrades: number,
    winningTrades: number,
    feesPaid: number,
    fundingPaid: number,
    position: positionSchema.nullable(),
  }),
  daily: z.object({
    date: z.string(),
    startEquity: number,
    aiSpent: number,
    calls: number,
  }),
  history: z.array(
    z.object({
      at: number,
      action: z.string(),
      status: z.string(),
      rationale: z.string(),
      cost: number,
      estimatedCost: z.boolean(),
    }),
  ),
  equityCurve: z.array(z.object({ at: number, equity: number })),
})
export type ArenaBot = z.infer<typeof botSchema>
const listSchema = z.object({
  bots: z.array(botSchema),
  capabilities: z.object({ paper: z.literal(true), live: z.literal(false) }),
})
const modelsSchema = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      inputPerMillion: number.nonnegative(),
      outputPerMillion: number.nonnegative(),
      contextLength: number.positive(),
    }),
  ),
  updatedAt: number,
})
export type ArenaModel = z.infer<typeof modelsSchema>['models'][number]
const marketsSchema = z.array(
  z.object({
    venue: z.enum(['lighter', 'hyperliquid']),
    symbol: z.string().min(1),
    base: z.string().min(1),
    quote: z.string().nullable().optional(),
    maxLeverage: number.nullable(),
  }),
)
export type ArenaMarket = z.infer<typeof marketsSchema>[number]
const prefix = '/_quanttrade/api/llm-arena'

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  method = 'POST',
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(prefix + path, {
    method: body === undefined ? 'GET' : method,
    credentials: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(body === undefined ? 20_000 : 120_000),
    ]),
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'Sign in to QuantTrade to manage the Arena.'
        : response.status === 409
          ? 'This bot changed or cannot perform that action. Refresh its status and pause it before editing.'
          : response.status === 429
            ? 'Arena request limit reached. Wait before trying again.'
            : response.status >= 500
              ? 'Arena is temporarily unavailable. Refresh status before repeating an action.'
              : 'Arena rejected this action. Check the settings and current bot status.',
    )
  }
  const parsed = schema.safeParse(await response.json())
  if (!parsed.success)
    throw new Error(
      'Arena returned an invalid response. Refresh before taking another action.',
    )
  return parsed.data
}
export const arenaList = (signal?: AbortSignal) =>
  request('', listSchema, undefined, 'GET', signal)
export const arenaModels = (signal?: AbortSignal) =>
  request('/models', modelsSchema, undefined, 'GET', signal)
export async function arenaMarkets(
  venue: ArenaConfig['venue'],
  signal: AbortSignal,
): Promise<Array<ArenaMarket>> {
  const response = await fetch(
    `/_quanttrade/api/public/markets?venue=${venue}&marketType=perpetual`,
    {
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
    },
  )
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(
      'Arena market catalog is unavailable. Refresh before choosing a symbol.',
    )
  }
  const result = marketsSchema.safeParse(await response.json())
  if (!result.success)
    throw new Error('Arena returned an invalid market catalog.')
  return result.data.filter(
    (market) =>
      market.venue === venue &&
      (market.quote === undefined
        ? market.symbol.endsWith('-USDC')
        : market.quote === 'USDC'),
  )
}
export const arenaSave = (
  config: ArenaConfig,
  id?: string,
  signal?: AbortSignal,
) =>
  request(
    id ? '/' + encodeURIComponent(id) : '',
    botSchema,
    arenaConfigSchema.parse(config),
    id ? 'PATCH' : 'POST',
    signal,
  )
export const arenaStart = (id: string, apiKey: string, signal?: AbortSignal) =>
  request(
    '/' + encodeURIComponent(id) + '/start',
    botSchema,
    { apiKey },
    'POST',
    signal,
  )
export const arenaAction = (
  id: string,
  action: 'pause' | 'evaluate' | 'close-position' | 'archive',
  archived?: boolean,
  signal?: AbortSignal,
) =>
  request(
    '/' + encodeURIComponent(id) + '/' + action,
    botSchema,
    action === 'archive' ? { archived } : {},
    'POST',
    signal,
  )

export function configuredArenaModel(): string {
  const value = getLedgerEntry('nanogpt-inference')?.config.model
  return typeof value === 'string' ? value : ''
}
/** Read only for an explicit Start; never copy the key into UI state or config. */
export function arenaProviderKey(): string {
  const entry = getLedgerEntry('nanogpt-inference')
  if (!entry || entry.tombstoned || !entry.enabled)
    throw new Error(
      'Connect and enable NanoGPT in Plugins before starting an Arena bot.',
    )
  const config = buildActivationConfig('nanogpt-inference', entry.config)
  const key = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
  if (!key || /^enc\./.test(key))
    throw new Error(
      'Unlock or reconnect NanoGPT in Plugins before starting an Arena bot.',
    )
  return key
}
/** Editable paper suggestions, never applied to a live account or auto-started. */
export function arenaDefaults(model: string): ArenaConfig {
  return {
    name: '',
    model,
    venue: 'lighter',
    symbol: '',
    intervalMinutes: 60,
    initialEquity: 1000,
    marginPerTrade: 50,
    leverage: 2,
    maxDailyLoss: 50,
    maxAiSpendDaily: 1,
    maxRunsDaily: 24,
    stopLossPct: 3,
    takeProfitPct: 6,
    minVolume24h: 100000,
    maxAbsFundingBps: 10,
    allowedSide: 'both',
    minConfidence: 0.7,
    feeBps: 5,
    slippageBps: 5,
    rules:
      'Use the supplied market snapshot. Hold unless the direction is clear. Respect every configured risk limit.',
  }
}
