import { afterEach, expect, test } from 'bun:test'
import { buildTradingTools, confirmedOrderFields } from '../trading-tools'
import type { CopilotToolDeps } from '../tool-deps'

const deps: CopilotToolDeps = {
  getCtx: () => null,
  getContextInfo: () => ({ market: 'hyperliquid', pair: 'ETH-USDC-USDC' }),
  getMarketData: () => {
    throw new Error('Must not execute an order')
  },
  pluginManager: {} as CopilotToolDeps['pluginManager'],
  getChartSnapshot: () => null,
}
const call = (input: Record<string, unknown>) =>
  (
    buildTradingTools(deps).place_order as unknown as {
      execute: (a: unknown, b: unknown) => Promise<Record<string, unknown>>
    }
  ).execute(input, { toolCallId: 'test', messages: [] })
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
test('preparation preserves exact venue controls without execution', async () => {
  const result = await call({
    side: 'sell',
    type: 'market',
    size: 1,
    exactSize: '0.000000000123',
    reduceOnly: true,
    leverage: 5,
    marginMode: 'isolated',
    trigger: { triggerPrice: '3000.123', triggerType: 'sl' },
  })
  expect(result.status).toBe('awaiting_confirmation')
  expect(result.autoApproval).toEqual({ paper: false, live: false })
  expect(result.order).toMatchObject({
    exactSize: '0.000000000123',
    reduceOnly: true,
    leverage: 5,
    marginMode: 'isolated',
    trigger: { triggerPrice: '3000.123', triggerType: 'sl' },
  })
})
test('confirmation forwards exact reviewed sizes, prices and venue flags', () => {
  const trigger = { triggerPrice: '123.456789', triggerType: 'sl' as const }
  expect(
    confirmedOrderFields({
      size: 1,
      price: 123,
      type: 'limit',
      exactSize: '0.000000000123',
      exactPrice: '123.456789',
      reduceOnly: true,
      leverage: 3,
      marginMode: 'isolated',
      trigger,
    }),
  ).toEqual({
    size: '0.000000000123',
    price: '123.456789',
    reduceOnly: true,
    leverage: 3,
    marginMode: 'isolated',
    trigger,
  })
})
test('spot and other venues reject perpetual controls', async () => {
  for (const market of ['hyperliquid-spot', 'lighter-spot', 'binance']) {
    expect(
      (
        await call({
          market,
          pair: 'ETH-USDC',
          side: 'buy',
          type: 'market',
          size: 1,
          leverage: 2,
        })
      ).status,
    ).toBe('invalid')
  }
})
test('market post-only and margin without leverage are rejected', async () => {
  expect(
    (await call({ side: 'buy', type: 'market', size: 1, postOnly: true }))
      .status,
  ).toBe('invalid')
  expect(
    (
      await call({
        side: 'buy',
        type: 'market',
        size: 1,
        marginMode: 'isolated',
      })
    ).status,
  ).toBe('invalid')
})
test('snapshot is an authenticated same-origin read with normalized perpetual symbol', async () => {
  let payload: unknown
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    expect(url).toBe('/_quanttrade/api/terminal/snapshot')
    expect(init?.credentials).toBe('same-origin')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    payload = JSON.parse(String(init?.body))
    return Response.json({
      connector_name: 'hyperliquid_perpetual',
      trading_pair: 'ETH-USD',
      open_orders: [],
      order_history: [],
      fills: [],
      account: {},
    })
  }) as typeof fetch
  const tool = buildTradingTools(deps).get_exchange_snapshot as unknown as {
    execute: (args: unknown, options: unknown) => Promise<unknown>
  }
  await tool.execute(
    { market: 'hyperliquid', pair: 'ETH-USDC-USDC' },
    { toolCallId: 'test', messages: [] },
  )
  expect(payload).toEqual({
    venue: 'hyperliquid',
    marketType: 'perpetual',
    symbol: 'ETH-USDC',
  })
})
