import { afterEach, expect, test } from 'bun:test'
import { buildTradingTools, confirmedOrderFields } from '../trading-tools'
import { proposalApprovalError } from '../ai-proposal-approval'
import type { CopilotToolDeps } from '../tool-deps'
import { useTradeConsentStore } from '@/stores/trade-consent-store'
import { useCredentialsStore } from '@/stores/credentials-store'

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
const originalCredentials = useCredentialsStore.getState().credentials
afterEach(() => {
  useCredentialsStore.setState({ credentials: originalCredentials })
  globalThis.fetch = originalFetch
  useTradeConsentStore.setState({ paper: false, liveMarkets: [] })
})

test('live preparation binds reviewed account and all order terms without execution', async () => {
  const account = {
    id: 'hl-main',
    market: 'hyperliquid',
    label: 'Main account',
    mode: 'live' as const,
    apiKey: 'never expose',
    apiSecret: 'never expose',
    createdAt: 0,
  }
  useCredentialsStore.setState({ credentials: [account] })
  const result = await call({
    side: 'buy',
    size: 1,
    exactSize: '0.125',
    leverage: 3,
    marginMode: 'isolated',
    mode: 'live',
  })
  expect(result.status).toBe('awaiting_confirmation')
  expect(result.order).toMatchObject({
    mode: 'live',
    credentialId: 'hl-main',
    accountLabel: 'Main account',
    exactSize: '0.125',
    leverage: 3,
    marginMode: 'isolated',
  })
  expect(JSON.stringify(result)).not.toContain('never expose')
  useCredentialsStore.setState({
    credentials: [account, { ...account, id: 'hl-other' }],
  })
  expect(await call({ side: 'buy', size: 1, mode: 'live' })).toMatchObject({
    status: 'invalid',
    error: expect.stringContaining('Multiple live accounts'),
  })
  expect(
    await call({
      side: 'buy',
      size: 1,
      mode: 'live',
      credentialId: 'hl-other',
    }),
  ).toMatchObject({ order: { credentialId: 'hl-other' } })
  expect(
    await call({ side: 'buy', size: 1, mode: 'live', credentialId: 'missing' }),
  ).toMatchObject({ status: 'invalid' })
})

test('Lighter live preparation resolves an explicit account without network or secret exposure', async () => {
  let requests = 0
  globalThis.fetch = (() => {
    requests += 1
    throw new Error('Preparation must not fetch or submit')
  }) as typeof fetch
  const first = {
    id: 'lt-one',
    market: 'lighter',
    label: 'First',
    mode: 'live' as const,
    apiKey: 'private-key-placeholder',
    apiSecret: 'secret-placeholder',
    createdAt: 0,
  }
  const second = { ...first, id: 'lt-two', label: 'Second' }
  useCredentialsStore.setState({ credentials: [first, second] })
  const input = {
    market: 'lighter',
    pair: 'PRL-USDC-USDC',
    mode: 'live',
    side: 'buy',
    size: 1,
  }
  const ambiguous = await call(input)
  expect(ambiguous).toMatchObject({
    status: 'invalid',
    accounts: [
      {
        credentialId: 'lt-one',
        label: 'First',
        market: 'lighter',
        mode: 'live',
      },
      {
        credentialId: 'lt-two',
        label: 'Second',
        market: 'lighter',
        mode: 'live',
      },
    ],
  })
  expect(JSON.stringify(ambiguous)).not.toContain('placeholder')
  expect(await call({ ...input, credentialId: 'lt-two' })).toMatchObject({
    status: 'awaiting_confirmation',
    order: {
      market: 'lighter',
      pair: 'PRL-USDC-USDC',
      mode: 'live',
      credentialId: 'lt-two',
      accountLabel: 'Second',
    },
  })
  useCredentialsStore.setState({ credentials: [] })
  expect(await call(input)).toMatchObject({
    status: 'invalid',
    error: expect.stringContaining('No live account'),
  })
  expect(requests).toBe(0)
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

test('legacy standing consent never authorizes AI preparation on any exchange', async () => {
  useTradeConsentStore.setState({
    paper: true,
    liveMarkets: ['binance', 'bybit', 'hyperliquid', 'lighter'],
  })
  for (const market of [
    'binance',
    'bybit',
    'hyperliquid',
    'lighter',
    'hyperliquid-spot',
    'lighter-spot',
  ]) {
    const result = await call({
      market,
      pair: 'ETH-USDC',
      side: 'buy',
      type: 'market',
      size: 1,
    })
    expect(result.status).toBe('awaiting_confirmation')
    expect(result.autoApproval).toEqual({ paper: false, live: false })
    expect(String(result.message)).toContain('until the user confirms')
  }
})

test('approval rejects stale, future and replayed proposals, preserving legacy manual review', () => {
  const now = 1_000_000
  expect(proposalApprovalError(now, false, now)).toBeNull()
  expect(proposalApprovalError(undefined, false, now)).toBeNull()
  expect(proposalApprovalError(now - 180_001, false, now)).toContain('expired')
  expect(proposalApprovalError(now + 1, false, now)).toContain('expired')
  expect(proposalApprovalError(NaN, false, now)).toContain('expired')
  expect(proposalApprovalError(now, true, now)).toContain('already submitted')
})

test('perpetual leverage requires an explicit margin mode without execution', async () => {
  for (const market of ['hyperliquid', 'lighter']) {
    const result = await call({
      market,
      pair: 'ETH-USDC-USDC',
      side: 'buy',
      type: 'market',
      size: 1,
      leverage: 2,
    })
    expect(result.status).toBe('invalid')
    expect(String(result.error)).toContain('choose Cross or Isolated')
  }
})
