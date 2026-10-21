import { afterEach, expect, test } from 'bun:test'
import {
  arenaConfigSchema,
  arenaDefaults,
  arenaList,
  arenaMarkets,
  arenaStart,
  arenaReviewDraft,
} from '../llm-arena'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

test('agent actions preserve known safe stage diagnostics without exposing arbitrary upstream text',async()=>{
  for(const [message,expected]of [['Live bot requires an empty dedicated connected account scope before arming','empty dedicated'],['private upstream bearer fixture-secret','cannot perform']]){
    globalThis.fetch=Object.assign(async()=>Response.json({error:message},{status:409}),{preconnect:originalFetch.preconnect})
    await expect(arenaStart('fixture-id','fixture-key')).rejects.toThrow(expected)
  }
})

test('multi-market review supports liquid/watchlist scopes and paused mode changes without a mandatory coin',()=>{
  const base={...arenaDefaults('fixture-model'),name:'Strategy agent'}
  expect(arenaConfigSchema.parse(base).universe.kind).toBe('liquid')
  expect(arenaConfigSchema.parse({...base,universe:{kind:'watchlist',symbols:['BTC-USDC','ETH-USDC'],maxCandidates:2,ranking:'gainers'}}).symbol).toBe('')
  expect(()=>arenaConfigSchema.parse({...base,universe:{kind:'watchlist',symbols:['BTC-USDC','BTC-USDC']}})).toThrow()
  expect(arenaReviewDraft({mode:'live',accountName:'desk'},'fixture',base).mode).toBe('live')
})

test('assistant agent drafts leave missing risk limits empty and preserve existing edit values', () => {
  const fresh = arenaReviewDraft({ name: 'Scalper', rules: 'Hold until the stated signal.' }, 'fixture-model')
  expect(fresh.mode).toBe('paper')
  expect(Number.isNaN(fresh.marginPerTrade)).toBe(true)
  expect(Number.isNaN(fresh.maxDailyLoss)).toBe(true)
  expect(fresh.allowedSide).toBe('')
  const existing = { ...arenaDefaults('fixture-model'), name: 'Existing', symbol: 'BTC-USDC' }
  const edit = arenaReviewDraft({ rules: 'Updated exact rule.' }, 'other-model', existing)
  expect(edit.marginPerTrade).toBe(existing.marginPerTrade)
  expect(edit.model).toBe(existing.model)
  expect(edit.rules).toBe('Updated exact rule.')
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
    { intervalMinutes: 0 },
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

test('trading agents retain safe paper defaults and require an explicit live account', () => {
  const config = { ...arenaDefaults('fixture-model'), name: 'Review agent', symbol: 'BTC-USDC' }
  expect(arenaConfigSchema.parse(config)).toMatchObject({ mode: 'paper', marginMode: 'isolated', maxDailyNotional: 1000 })
  expect(() => arenaConfigSchema.parse({ ...config, mode: 'live' })).toThrow()
  expect(arenaConfigSchema.parse({ ...config, mode: 'live', accountName: 'desk' }).mode).toBe('live')
})

test('live capability is separate from verified current account binding', async () => {
  globalThis.fetch = Object.assign(
    async () =>
      Response.json({
        bots: [],
        capabilities: { paper: true, live: true },
        accounts: [{ venue: 'lighter', accountName: 'desk', connectionRevision: 'a'.repeat(64), mode: 'live' }],
      }),
    { preconnect: originalFetch.preconnect },
  )
  expect(await arenaList()).toMatchObject({ capabilities: { live: true }, accounts: [{ venue: 'lighter', accountName: 'desk', mode: 'live' }] })
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
