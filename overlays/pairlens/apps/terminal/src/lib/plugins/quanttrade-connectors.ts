import { z } from 'zod'
import { quantTradeFetch } from './quanttrade-session'
import { executeQuantTradeFunding } from './quanttrade-funding'
import type {
  PluginExecuteParams,
  PluginInstance,
  PluginManifest,
} from '@pairlens/plugin-system/types'
import type { Instrument, NormalizedOrderUpdate } from '@pairlens/market-engine'
import type { NormalizedPosition } from '@pairlens/market-engine/types'
import { useCredentialsStore } from '@/stores/credentials-store'

type MarketType = 'perpetual' | 'spot'
type Venue = 'hyperliquid' | 'lighter'
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
const modeSchema = z.enum(['paper', 'live'])
const marketSchema = z.object({
  symbol: z.string(),
  base: z.string(),
  quote: z.string().optional(),
  price: z.string(),
  change24h: z.number(),
  volume24h: z.string(),
  updatedAt: z.number(),
})
const candleSchema = z.object({
  time: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
})
const bookSchema = z.object({
  bids: z.array(z.object({ price: z.string(), size: z.string() })),
  asks: z.array(z.object({ price: z.string(), size: z.string() })),
  updatedAt: z.number(),
})
const proposalSchema = z.object({
  id: z.string(),
  status: z.string(),
  mode: modeSchema.optional(),
  orderId: z.string().optional(),
  error: z.string().optional(),
})
const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d']

const assetNames: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  dogecoin: 'DOGE',
  ripple: 'XRP',
  hyperliquid: 'HYPE',
}
/** Search aliases affect discovery only; execution keeps the listed native key. */
function matchesMarketQuery(
  market: { symbol: string; base: string },
  query: string,
): boolean {
  const raw = query.trim().toLowerCase()
  if (!raw) return true
  if (assetNames[raw]) return market.base.toUpperCase() === assetNames[raw]
  const compact = raw.replace(/[\s/:-]+/g, '').toUpperCase()
  const base = market.base.replace(/[\s/:-]+/g, '').toUpperCase()
  // A complete stablecoin pair can discover the same base on another quote.
  // Do not strip size multipliers or namespaced bases, or match arbitrary quotes.
  const pair = /^(.*?)(USDTUSDT|USDCUSDC|USDT|USDC|USD)$/.exec(compact)
  if (pair?.[1]) {
    const localBase=market.base.split(':').at(-1)?.replace(/[\s/:-]+/g,'').toUpperCase()
    return base === pair[1] || (!raw.includes(':') && localBase === pair[1])
  }
  return (
    market.symbol.toLowerCase().includes(raw) ||
    market.symbol
      .replace(/[\s/:-]+/g, '')
      .toUpperCase()
      .includes(compact)
  )
}

export function quantTradeManifest(
  venue: Venue,
  marketType: MarketType = 'perpetual',
): PluginManifest {
  const market = marketType === 'spot' ? `${venue}-spot` : venue
  return {
    id: `${market}-market-connector`,
    name: venue === 'hyperliquid' ? 'Hyperliquid' : 'Lighter',
    icon:
      venue === 'hyperliquid'
        ? '/posters/hyperliquid-market-connector.png'
        : '/posters/lighter-market-connector.svg',
    version: '0.1.0',
    author: 'QuantTrade',
    description:
      'Public perpetual markets and human-approved Hummingbot orders through the local QuantTrade service.',
    capabilities: [
      ...(
        [
          'market-data:discovery',
          'market-data:discovery:search',
          'market-data:history',
          ...(marketType === 'perpetual'
            ? ['market-data:funding' as const]
            : []),
        ] as const
      ).map((id) => ({
        id,
        singleton: false,
        markets: [market],
        priority: 1,
        streaming: false,
      })),
      ...(
        [
          'market-data:candles',
          'market-data:ticker',
          'market-data:orderbook',
        ] as const
      ).map((id) => ({
        id,
        singleton: false,
        markets: [market],
        priority: 1,
        streaming: true,
      })),
      {
        id: 'trading:balances',
        singleton: false,
        markets: [market],
        priority: 1,
        streaming: false,
      },
      {
        id: 'trading:positions',
        singleton: false,
        markets: [market],
        priority: 1,
        streaming: false,
      },
      {
        id: 'trading:orders',
        singleton: false,
        markets: [market],
        priority: 1,
        streaming: false,
        sideEffect: true,
      },
    ],
    config: {},
    metadata: {
      logoUrl:
        venue === 'hyperliquid'
          ? '/posters/hyperliquid-market-connector.png'
          : '/posters/lighter-market-connector.svg',
      family: marketType === 'spot' ? 'cex-spot' : 'cex-futures',
      assetClass: marketType === 'spot' ? 'crypto' : 'crypto-perp',
      timeframes,
      limitOnly: false,
      marketOrders: 'native',
      marketType,
      triggerOrders: marketType !== 'spot',
      ...(marketType === 'spot' ? {} : { maxLeverage: 125 }),
      abbr: venue === 'hyperliquid' ? 'HL' : 'LT',
      paperTrading: true,
    },
  }
}

function bridgeSymbol(
  value: unknown,
  marketType: MarketType = 'perpetual',
): string {
  if (marketType === 'spot')
    return z
      .string()
      .regex(/^[A-Za-z0-9:_.]+-[A-Za-z0-9:_.]+$/)
      .parse(value)
  const symbol=z.string().regex(/^[A-Za-z0-9:_.]+-([A-Za-z0-9_.]+)-\1$/, 'Select a listed perpetual contract').parse(value)
  return symbol.slice(0,symbol.lastIndexOf('-'))
}

export function createQuantTradeConnector(
  manifest: PluginManifest,
  fetcher: Fetcher = (url, init) => fetch(url, init),
): PluginInstance {
  const marketType: MarketType =
    manifest.metadata?.['marketType'] === 'spot' ? 'spot' : 'perpetual'
  const market = manifest.id.replace('-market-connector', '')
  const connectorName =
    marketType === 'spot' ? market.replace('-spot', '') : `${market}_perpetual`
  const nativeSymbol = (symbol: string) =>
    marketType === 'spot' ? symbol : `${symbol}-${symbol.slice(symbol.lastIndexOf('-')+1)}`
  const venue = z
    .enum(['hyperliquid', 'lighter'])
    .parse(market.replace('-spot', ''))
  const credentials = new Map<
    string,
    { token?: string; mode: 'paper' | 'live' }
  >()
  const subscriptions = new Set<() => void>()
  let destroyed = false
  async function api(
    path: string,
    token?: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await quantTradeFetch(
      `/_quanttrade/api${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        signal: AbortSignal.timeout(15000),
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      fetcher,
    )
    const data: unknown = await response.json()
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(data)
      throw new Error(
        error.success
          ? error.data.error
          : `QuantTrade service returned ${response.status}`,
      )
    }
    return data
  }
  async function markets() {
    return z
      .array(marketSchema)
      .parse(
        await api(`/public/markets?venue=${venue}&marketType=${marketType}`),
      )
  }
  function credential(params: Record<string, unknown>) {
    if (destroyed) throw new Error('This exchange connector is disabled')
    let slot =
      typeof params.credentialId === 'string'
        ? credentials.get(params.credentialId)
        : undefined
    // Account queries can run before the parent's provisioning effect. Restore
    // only the exact saved account for this connector; never choose a default.
    if (!slot && typeof params.credentialId === 'string') {
      const saved = useCredentialsStore.getState().credentials.find(
        (entry) => entry.id === params.credentialId && entry.market === market,
      )
      if (saved) {
        slot = {
          ...(saved.serverManaged === true
            ? {}
            : { token: z.string().min(1).parse(saved.apiKey) }),
          mode: modeSchema.parse(saved.mode),
        }
        credentials.set(saved.id, slot)
      }
    }
    if (!slot)
      throw new Error('Connect this exchange’s credentials in QuantTrade first')
    return slot
  }
  async function execute({
    capability,
    params,
    context,
  }: PluginExecuteParams): Promise<unknown> {
    if (capability === 'market-data:funding') {
      if (marketType !== 'perpetual')
        throw new Error('Funding is available for perpetual markets only')
      return executeQuantTradeFunding(venue, params, fetcher)
    }
    if (
      capability === 'market-data:discovery' ||
      capability === 'market-data:discovery:search'
    ) {
      const query = String(params.q ?? params.query ?? '').toLowerCase()
      const items: Array<Instrument> = (await markets())
        .filter((m) => matchesMarketQuery(m, query))
        .map((m, rank): Instrument => {
          const common = {
            id: `${market}:${nativeSymbol(m.symbol)}`,
            market,
            symbol: nativeSymbol(m.symbol),
            name:
              marketType === 'spot' ? `${m.base} spot` : `${m.base} perpetual`,
            base: m.base,
            quote: m.quote ?? 'USDC',
            categories: [],
            rank,
            featured: m.base === 'BTC' || m.base === 'ETH',
          }
          return marketType === 'spot'
            ? { ...common, kind: 'cex-pair', assetClass: 'crypto' }
            : {
                ...common,
                kind: 'cex-derivative',
                assetClass: 'crypto-perp',
                settle: m.quote ?? 'USDC',
                contract: 'perp',
                linear: true,
              }
        })
      const offset =
        typeof params.offset === 'number' ? Math.max(0, params.offset) : 0
      const limit =
        typeof params.limit === 'number'
          ? Math.max(1, params.limit)
          : items.length
      return {
        items: items.slice(offset, offset + limit),
        total: items.length,
        hasMore: offset + limit < items.length,
      }
    }
    if (capability === 'trading:balances') {
      const slot = credential(params)
      return z
        .array(
          z.object({
            currency: z.string(),
            available: z.string(),
            frozen: z.string(),
            total: z.string(),
          }),
        )
        .parse(
          await api(
            `/connections/${venue}/balances?marketType=${marketType}`,
            slot.token,
          ),
        )
    }
    if (capability === 'trading:positions') {
      const slot = credential(params)
      if (marketType === 'spot') return []
      if (slot.mode === 'paper') return []
      const result = z
        .object({
          positions: z.object({
            data: z.array(
              z.object({
                connector_name: z.string(),
                trading_pair: z.string(),
                side: z.enum(['LONG', 'SHORT']),
                amount: z.number().finite(),
                entry_price: z.number().finite().nullable(),
                unrealized_pnl: z.number().finite().nullable(),
                leverage: z.number().finite().nullable(),
              }),
            ),
          }),
        })
        .parse(await api('/account', slot.token))
      const positions: Array<NormalizedPosition> = result.positions.data
        .filter((p) => p.connector_name === connectorName && p.amount !== 0)
        .map((p) => ({
          pair: `${venue === 'hyperliquid' ? p.trading_pair.replace(/-USD$/, '-USDC') : p.trading_pair}-USDC`,
          side: p.side === 'LONG' ? 'long' : 'short',
          contracts: Math.abs(p.amount),
          contractSize: 1,
          ...(p.entry_price === null ? {} : { entryPrice: p.entry_price }),
          ...(p.unrealized_pnl === null
            ? {}
            : { unrealizedPnl: p.unrealized_pnl }),
          ...(p.leverage === null ? {} : { leverage: p.leverage }),
        }))
      return positions
    }
    if (capability === 'trading:orders') {
      const slot = credential(params)
      if (params.action === 'place') {
        if (
          params.extendedHours === true ||
          (params.tgtCcy !== undefined &&
            params.tgtCcy !== 'base_ccy' &&
            !(marketType === 'spot' && params.tgtCcy === 'quote_ccy'))
        )
          throw new Error(
            'Extended-hours and quote-sized orders are not supported by this connector',
          )
        if (
          marketType === 'spot' &&
          (params.leverage !== undefined ||
            params.trigger !== undefined ||
            params.marginMode !== undefined)
        )
          throw new Error(
            'Spot orders do not support perpetual leverage, margin or native conditional orders',
          )
        if (marketType === 'spot' && params.reduceOnly === true)
          throw new Error('Spot orders cannot be reduce-only')
        const mode = modeSchema.parse(params.mode ?? slot.mode)
        if (mode !== slot.mode)
          throw new Error(
            'Order mode does not match the selected credential mode',
          )
        const proposal = proposalSchema.parse(
          await api('/terminal/orders', slot.token, {
            clientOrderId: z.string().min(1).parse(params.clientOrderId),
            mode,
            order: {
              venue,
              marketType,
              symbol: bridgeSymbol(params.pair, marketType),
              side: z.enum(['buy', 'sell']).parse(params.side),
              type: z.enum(['limit', 'market']).parse(params.type),
              size: z.string().parse(params.size),
              ...(marketType === 'spot'
                ? { sizeUnit: params.tgtCcy === 'quote_ccy' ? 'quote' : 'base' }
                : {}),
              ...(params.leverage === undefined
                ? {}
                : {
                    leverage: z
                      .number()
                      .int()
                      .min(1)
                      .max(125)
                      .parse(params.leverage),
                  }),
              ...(params.marginMode === undefined
                ? {}
                : {
                    marginMode: z
                      .enum(['cross', 'isolated'])
                      .parse(params.marginMode),
                  }),
              ...(params.trigger === undefined
                ? {}
                : {
                    trigger: z
                      .object({
                        triggerPrice: z.string(),
                        triggerType: z.enum(['tp', 'sl']),
                      })
                      .strict()
                      .parse(params.trigger),
                  }),
              ...(params.type === 'limit'
                ? { price: z.string().parse(params.price) }
                : {}),
              ...(params.postOnly !== undefined
                ? { postOnly: z.boolean().parse(params.postOnly) }
                : {}),
              ...(params.reduceOnly !== undefined
                ? { reduceOnly: z.boolean().parse(params.reduceOnly) }
                : {}),
              rationale: 'Confirmed in QuantTrade terminal',
            },
          }),
        )
        return {
          success: ['submitted', 'paper-open', 'paper-filled'].includes(
            proposal.status,
          ),
          orderId: proposal.id,
          ...(!['submitted', 'paper-open', 'paper-filled'].includes(
            proposal.status,
          )
            ? {
                error:
                  proposal.error ??
                  `Order requires reconciliation (${proposal.status})`,
              }
            : {}),
        }
      }
      if (params.action === 'cancel') {
        if (params.trigger)
          throw new Error('Trigger cancellation is not supported')
        const id = z.string().min(1).parse(params.orderId)
        if (id.startsWith('exchange:'))
          throw new Error(
            'This order was placed outside QuantTrade. Cancel it through the exchange or Hummingbot.',
          )
        const proposal = proposalSchema.parse(
          await api(
            `/proposals/${encodeURIComponent(id)}/cancel`,
            slot.token,
            {},
          ),
        )
        // The native journal treats success as a confirmed cancellation.
        return proposal.status === 'cancelled'
          ? { success: true, orderId: proposal.id }
          : {
              success: false,
              orderId: proposal.id,
              error:
                'Cancellation requested. Verify the exchange order status before retrying.',
            }
      }
      if (params.action === 'list' && slot.mode === 'live') {
        const [account, proposals] = await Promise.all([
          api('/account', slot.token),
          api('/proposals', slot.token),
        ])
        const local = z
          .array(
            proposalSchema.extend({
              order: z.object({
                venue: z.string(),
                marketType: z.enum(['perpetual', 'spot']).optional(),
              }),
            }),
          )
          .parse(proposals)
        const rows = z
          .object({
            orders: z.object({
              data: z.array(
                z.object({
                  order_id: z.string(),
                  connector_name: z.string(),
                  trading_pair: z.string(),
                  trade_type: z.enum(['BUY', 'SELL']),
                  order_type: z.enum(['LIMIT', 'LIMIT_MAKER', 'MARKET']),
                  amount: z.number().finite(),
                  price: z.number().finite().nullable(),
                  status: z.string(),
                  filled_amount: z.number().finite(),
                  average_fill_price: z.number().finite().nullable(),
                  fee_paid: z.number().finite().nullable(),
                  fee_currency: z.string().nullable(),
                  created_at: z.string(),
                  updated_at: z.string(),
                }),
              ),
            }),
          })
          .parse(account).orders.data
        const orders: Array<NormalizedOrderUpdate> = rows
          .filter(
            (o) =>
              o.connector_name === connectorName &&
              [
                'SUBMITTED',
                'OPEN',
                'PENDING_CANCEL',
                'PARTIALLY_FILLED',
                'FILLED',
                'CANCELLED',
              ].includes(o.status),
          )
          .map((o) => ({
            orderId:
              local.find(
                (p) =>
                  p.mode === 'live' &&
                  p.order.venue === venue &&
                  (p.order.marketType ?? 'perpetual') === marketType &&
                  p.orderId === o.order_id,
              )?.id ?? `exchange:${o.order_id}`,
            pair: nativeSymbol(
              venue === 'hyperliquid' && marketType === 'perpetual'
                ? o.trading_pair.replace(/-USD$/, '-USDC')
                : o.trading_pair,
            ),
            side: o.trade_type === 'BUY' ? 'buy' : 'sell',
            type: o.order_type === 'MARKET' ? 'market' : 'limit',
            size: String(o.amount),
            price: o.price === null ? '' : String(o.price),
            fillSize: String(o.filled_amount),
            avgPrice:
              o.average_fill_price === null ? '' : String(o.average_fill_price),
            status:
              o.status === 'FILLED'
                ? 'filled'
                : o.status === 'CANCELLED'
                  ? 'cancelled'
                  : o.filled_amount > 0
                    ? 'partially_filled'
                    : 'live',
            fee: o.fee_paid === null ? '' : String(o.fee_paid),
            feeCcy: o.fee_currency ?? '',
            createdAt: Date.parse(o.created_at),
            ts: Date.parse(o.updated_at),
          }))
        return {
          open: orders.filter(
            (o) => o.status === 'live' || o.status === 'partially_filled',
          ),
          history: orders.filter(
            (o) => o.status === 'filled' || o.status === 'cancelled',
          ),
        }
      }
      if (params.action === 'list') {
        // Live acknowledgments are not fills or authoritative open-order reports.
        // Only local paper lifecycle is normalized until live reconciliation exists.
        const schema = proposalSchema.extend({
          mode: modeSchema,
          createdAt: z.number(),
          order: z.object({
            venue: z.string(),
            marketType: z.enum(['perpetual', 'spot']).optional(),
            symbol: z.string(),
            side: z.enum(['buy', 'sell']),
            type: z.enum(['limit', 'market']),
            size: z.string(),
            price: z.string().optional(),
          }),
          referencePrice: z.string(),
        })
        const proposals = z
          .array(schema)
          .parse(await api('/proposals', slot.token))
        const orders: Array<NormalizedOrderUpdate> = proposals
          .filter(
            (p) =>
              p.mode === slot.mode &&
              p.mode === 'paper' &&
              p.order.venue === venue &&
              (p.order.marketType ?? 'perpetual') === marketType &&
              ['paper-open', 'paper-filled', 'cancelled'].includes(p.status),
          )
          .map((p) => ({
            orderId: p.id,
            pair: nativeSymbol(p.order.symbol),
            side: p.order.side,
            type: p.order.type,
            size: p.order.size,
            price: p.order.price ?? '',
            fillSize: p.status === 'paper-filled' ? p.order.size : '0',
            avgPrice: p.status === 'paper-filled' ? p.referencePrice : '0',
            status:
              p.status === 'paper-filled'
                ? 'filled'
                : p.status === 'cancelled'
                  ? 'cancelled'
                  : 'live',
            fee: '0',
            feeCcy: 'USDC',
            ts: p.createdAt,
            createdAt: p.createdAt,
          }))
        return {
          open: orders.filter((o) => o.status === 'live'),
          history: orders.filter((o) => o.status !== 'live'),
        }
      }
      throw new Error('Unsupported QuantTrade order action')
    }
    const symbol = bridgeSymbol(params.pair ?? context.pair, marketType)
    const query = `venue=${venue}&marketType=${marketType}&symbol=${encodeURIComponent(symbol)}`
    if (
      capability === 'market-data:history' ||
      capability === 'market-data:candles'
    ) {
      const interval = z
        .enum(['1m', '5m', '15m', '1h', '4h', '1d'])
        .parse(params.timeframe ?? context.timeframe)
      const historyQuery = new URLSearchParams()
      if (capability === 'market-data:history') {
        if (params.endTs !== undefined)
          historyQuery.set(
            'endTs',
            String(z.number().int().nonnegative().parse(params.endTs)),
          )
        if (params.limit !== undefined)
          historyQuery.set(
            'limit',
            String(z.number().int().min(1).max(1000).parse(params.limit)),
          )
      }
      const candles = z
        .array(candleSchema)
        .parse(
          await api(
            `/public/candles?${query}&interval=${interval}&${historyQuery}`,
          ),
        )
        .map(({ time, ...c }) => ({ ts: time * 1000, ...c }))
      if (capability === 'market-data:history') {
        const endTs = typeof params.endTs === 'number' ? params.endTs : Infinity
        const limit =
          typeof params.limit === 'number'
            ? Math.max(1, Math.floor(params.limit))
            : candles.length
        return candles.filter((c) => c.ts < endTs).slice(-limit)
      }
      return { type: 'snapshot', candles }
    }
    if (capability === 'market-data:orderbook') {
      const book = bookSchema.parse(await api(`/public/book?${query}`))
      return {
        type: 'snapshot',
        bids: book.bids.map((l) => [Number(l.price), Number(l.size)]),
        asks: book.asks.map((l) => [Number(l.price), Number(l.size)]),
        ts: book.updatedAt,
      }
    }
    if (capability === 'market-data:ticker') {
      const [list, book] = await Promise.all([
        markets(),
        api(`/public/book?${query}`).then((value) => bookSchema.parse(value)),
      ])
      const m = list.find((row) => row.symbol === symbol)
      if (!m) throw new Error('Contract is unavailable')
      return {
        type: 'ticker',
        ticker: {
          last: Number(m.price),
          bid: Number(book.bids[0]?.price ?? NaN),
          ask: Number(book.asks[0]?.price ?? NaN),
          high24h: NaN,
          low24h: NaN,
          volume24h: Number(m.volume24h),
          change24h: m.change24h,
          ts: m.updatedAt,
        },
      }
    }
    throw new Error(`Unsupported QuantTrade capability: ${capability}`)
  }
  return {
    manifest,
    status: 'installed',
    config: {},
    execute,
    async initialize(config) {
      destroyed = false
      if (config.credentialId !== undefined)
        credentials.set(z.string().parse(config.credentialId), {
          ...(config.serverManaged === true
            ? {}
            : { token: z.string().min(1).parse(config.apiKey) }),
          mode: modeSchema.parse(config.mode),
        })
    },
    subscribe(request, callback) {
      if (
        ![
          'market-data:candles',
          'market-data:ticker',
          'market-data:orderbook',
        ].includes(request.capability)
      )
        throw new Error('This capability does not stream')
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const poll = async () => {
        try {
          const result = await execute(request)
          if (!stopped) callback(result)
        } catch (error) {
          if (!stopped)
            callback({
              type: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : 'Market data unavailable',
            })
        }
        if (!stopped)
          timer = setTimeout(
            poll,
            request.capability === 'market-data:candles' ? 15000 : 5000,
          )
      }
      const stop = () => {
        stopped = true
        clearTimeout(timer)
        subscriptions.delete(stop)
      }
      subscriptions.add(stop)
      void poll()
      return stop
    },
    async destroy() {
      destroyed = true
      for (const stop of subscriptions) stop()
      credentials.clear()
    },
  }
}
