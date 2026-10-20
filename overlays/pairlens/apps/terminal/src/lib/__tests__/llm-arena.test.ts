import { afterEach, expect, test } from 'bun:test'
import {
  arenaConfigSchema,
  arenaDefaults,
  arenaList,
  arenaMarkets,
  arenaStart,
} from '../llm-arena'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

test('arena config requires explicit bounded paper risk and rejects credential fields', () => {
  const config = {
    ...arenaDefaults('fixture-model'),
    name: 'Paper comparison',
    symbol: 'BTC-USDC',
  }
  expect(arenaConfigSchema.parse(config).model).toBe('fixture-model')
  for (const change of [
    { maxDailyLoss: 0 },
    { maxAiSpendDaily: -1 },
    { intervalMinutes: 1 },
    { leverage: Infinity },
    { marginPerTrade: NaN },
    { marginPerTrade: 1001 },
    { leverage: 1.5 },
    { stopLossPct: 51 },
    { feeBps: 101 },
    { apiKey: 'never-save' },
  ])
    expect(() => arenaConfigSchema.parse({ ...config, ...change })).toThrow()
})

test('arena list refuses a server advertising live capability', async () => {
  globalThis.fetch = Object.assign(
    async () =>
      Response.json({
        bots: [],
        capabilities: { paper: true, live: true },
      }),
    { preconnect: originalFetch.preconnect },
  )
  await expect(arenaList()).rejects.toThrow('invalid response')
})

test('arena HTTP failures are safe and never replay a start', async () => {
  let calls = 0
  globalThis.fetch = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit) => {
      calls++
      expect(init?.credentials).toBe('same-origin')
      expect(init?.redirect).toBe('error')
      expect(JSON.parse(String(init?.body))).toEqual({
        apiKey: 'offline-fixture-key',
      })
      return new Response('private provider payload', { status: 503 })
    },
    { preconnect: originalFetch.preconnect },
  )
  await expect(arenaStart('fixture-id', 'offline-fixture-key')).rejects.toThrow(
    'temporarily unavailable',
  )
  expect(calls).toBe(1)
})

test('arena symbol picker preserves exact native market IDs and venue scope', async () => {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      expect(String(input)).toBe(
        '/_quanttrade/api/public/markets?venue=hyperliquid&marketType=perpetual',
      )
      return Response.json([
        {
          venue: 'hyperliquid',
          symbol: 'xyz:TSLA-USDC',
          base: 'xyz:TSLA',
          maxLeverage: 5,
        },
        { venue: 'lighter', symbol: 'TSLA-USDC', base: 'TSLA', maxLeverage: 3 },
        {
          venue: 'hyperliquid',
          symbol: 'PAPER-USDC',
          base: 'PAPER',
          quote: 'USDC',
          maxLeverage: 3,
        },
        {
          venue: 'hyperliquid',
          symbol: 'MISLABELED-USDC',
          base: 'MISLABELED',
          quote: 'USDH',
          maxLeverage: 3,
        },
        {
          venue: 'hyperliquid',
          symbol: 'xyz:GOLD-USDH',
          base: 'xyz:GOLD',
          maxLeverage: 5,
        },
        {
          venue: 'hyperliquid',
          symbol: 'BTC-USDT',
          base: 'BTC',
          quote: 'USDT',
          maxLeverage: 10,
        },
      ])
    },
    { preconnect: originalFetch.preconnect },
  )
  expect(
    await arenaMarkets('hyperliquid', new AbortController().signal),
  ).toEqual([
    {
      venue: 'hyperliquid',
      symbol: 'xyz:TSLA-USDC',
      base: 'xyz:TSLA',
      maxLeverage: 5,
    },
    {
      venue: 'hyperliquid',
      symbol: 'PAPER-USDC',
      base: 'PAPER',
      quote: 'USDC',
      maxLeverage: 3,
    },
  ])
})
