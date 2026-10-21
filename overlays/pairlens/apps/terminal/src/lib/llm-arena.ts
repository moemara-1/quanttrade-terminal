import { z } from 'zod'
import { getLedgerEntry } from '@/lib/plugins/plugin-ledger'
import { buildActivationConfig } from '@/lib/plugins/official-config'

const number = z.number().finite()
const nativeSymbol=z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/)
const universeSchema=z.object({kind:z.enum(['single','watchlist','liquid']),symbols:z.array(nativeSymbol).min(1).max(40).optional(),maxCandidates:number.int().min(1).max(8).default(4),ranking:z.enum(['volume','gainers','losers','movement']).default('volume')}).strict().refine(value=>value.kind==='watchlist'?!!value.symbols?.length&&new Set(value.symbols).size===value.symbols.length:value.symbols===undefined,{message:'Choose 1–40 unique native watchlist symbols; other scopes do not accept a watchlist'})
export const arenaConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    mode: z.enum(['paper', 'live']).default('paper'),
    accountName: z.string().trim().min(1).max(100).optional(),
    marginMode: z.enum(['cross', 'isolated']).default('isolated'),
    maxDailyNotional: number.positive().max(100_000_000).default(1000),
    model: z.string().trim().min(1).max(200),
    venue: z.enum(['lighter', 'hyperliquid']),
    symbol:nativeSymbol.or(z.literal('')).default(''),
    universe:universeSchema.optional(),
    timeframe:z.enum(['1m','5m','15m','1h','4h']).default('1h'),
    intervalMinutes: number.int().min(1).max(1440),
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
  .refine((config) => config.mode === 'live' || config.marginPerTrade <= config.initialEquity, {
    path: ['marginPerTrade'],
    message: 'Margin cannot exceed the paper bankroll',
  })
  .refine((config) => config.mode !== 'live' || Boolean(config.accountName), {
    path: ['accountName'], message: 'Select the live exchange account explicitly',
  })
  .refine(config=>config.allowedSide==='long'||config.takeProfitPct<100,{path:['takeProfitPct'],message:'Short-capable strategies require take-profit below 100%'})
  .refine(config=>(config.universe?.kind??(config.symbol?'single':'liquid'))!=='single'||!!config.symbol,{path:['symbol'],message:'Select an exact single-market contract'})
  .transform(config=>({...config,universe:config.universe??{kind:config.symbol?'single' as const:'liquid' as const,maxCandidates:4,ranking:'volume' as const}}))
export type ArenaConfig = z.infer<typeof arenaConfigSchema>
export type ArenaReviewDraft = Omit<ArenaConfig, 'allowedSide' | 'marginMode'> & {
  allowedSide: ArenaConfig['allowedSide'] | ''
  marginMode: ArenaConfig['marginMode'] | ''
}
/** Assistant proposals are unvalidated review drafts; missing risk fields stay empty. */
export function arenaReviewDraft(initial: Partial<ArenaConfig>, model: string, existing?: ArenaConfig): ArenaReviewDraft {
  const result: ArenaReviewDraft = { ...arenaDefaults(model), ...existing, ...initial, mode: initial.mode ?? existing?.mode ?? 'paper',universe:initial.universe??existing?.universe??{kind:initial.symbol?'single':'liquid',maxCandidates:4,ranking:'volume'} }
  if (existing) return result
  const numeric = ['intervalMinutes', 'initialEquity', 'marginPerTrade', 'leverage', 'maxDailyLoss', 'maxDailyNotional', 'maxAiSpendDaily', 'maxRunsDaily', 'stopLossPct', 'takeProfitPct', 'minVolume24h', 'maxAbsFundingBps', 'minConfidence', 'feeBps', 'slippageBps'] as const
  for (const key of numeric) {
    if (result.mode === 'live' && ['initialEquity', 'feeBps', 'slippageBps'].includes(key)) continue
    if (initial[key] === undefined) result[key] = NaN
  }
  if (initial.allowedSide === undefined) result.allowedSide = ''
  if (initial.marginMode === undefined) result.marginMode = ''
  if (initial.rules === undefined) result.rules = ''
  return result
}
const positionSchema = z.object({
  symbol:z.string().optional(),
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
  activeSymbol:z.string().nullable().default(null),
  lastScan:z.object({at:number,total:number,eligible:number,considered:number,symbols:z.array(z.string()),skipped:number}).nullable().default(null),
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
    orderNotional:number.default(0),
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
  live: z.object({
    collateralScope:z.string().optional(),
    armed: z.boolean(), accountName: z.string(), connectionRevision: z.string(),
    equity: number.nullable(), availableMargin: number.nullable(),
    position: z.object({ side: z.enum(['long', 'short']), size: z.string(), entryPrice: z.string() }).nullable(),
    receipt: z.object({ requestId: z.string(), entryOrderId: z.string(), protectionOrderIds: z.array(z.string()), status: z.enum(['pending', 'protected', 'flat', 'uncertain']) }).nullable(),
    daily: z.object({ date: z.string(), startEquity: number.nullable(), notional: number }),
    observedAt: number.nullable(),
  }).optional(),
})
export type ArenaBot = z.infer<typeof botSchema>
const listSchema = z.object({
  bots: z.array(botSchema),
  capabilities: z.object({ paper: z.literal(true), live: z.boolean(), liveClose: z.boolean().default(false) }),
  accounts: z.array(z.object({
    venue: z.enum(['lighter', 'hyperliquid']), accountName: z.string().min(1),
    connectionRevision: z.string().regex(/^[a-f0-9]{64}$/i), mode: z.literal('live'),
  })).default([]),
})
export type ArenaAccount = z.infer<typeof listSchema>['accounts'][number]
export type ArenaCapabilities = z.infer<typeof listSchema>['capabilities']
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
    onlyIsolated: z.boolean().optional(),
    marginModes: z.array(z.enum(['cross', 'isolated'])).optional(),
    volume24h:z.string().optional(),
  }),
)
export type ArenaMarket = z.infer<typeof marketsSchema>[number]
const prefix = '/_quanttrade/api/llm-arena'

async function request<TOutput, TInput>(
  path: string,
  schema: z.ZodType<TOutput, z.ZodTypeDef, TInput>,
  body?: unknown,
  method = 'POST',
  signal?: AbortSignal,
): Promise<TOutput> {
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
    const failureBody:unknown=await response.json().catch(()=>null)
    const detail=z.object({error:z.string().max(600)}).safeParse(failureBody)
    if([400,409,422].includes(response.status)&&detail.success&&![...detail.data.error].some(character=>character.charCodeAt(0)<32)&&/^(?:Live bot (?:authorization|account|collateral|requires|daily|available|position|entry|close|submission|filled|protective|detected|cannot|flat|receipt)|LM Arena |Pause the |Pause and |Close the |Wait for |Choose a |Configured leverage |Starting equity )/.test(detail.data.error))throw new Error(detail.data.error)
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
export type ArenaLiveArm = { accountName: string; connectionRevision: string; acknowledgeAutonomousLive: true }
export const arenaStart = (id: string, apiKey: string, signal?: AbortSignal, liveArm?: ArenaLiveArm) =>
  request(
    '/' + encodeURIComponent(id) + '/start',
    botSchema,
    { apiKey, ...(liveArm ? { liveArm } : {}) },
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
    mode: 'paper',
    marginMode: 'isolated',
    maxDailyNotional: 1000,
    model,
    venue: 'lighter',
    symbol: '',
    universe:{kind:'liquid',maxCandidates:4,ranking:'volume'},
    timeframe:'1h',
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
