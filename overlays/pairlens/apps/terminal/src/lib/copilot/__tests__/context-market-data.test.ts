import { afterEach, expect, test } from 'bun:test'
import { buildContextTools } from '../context-tools'
import type { CopilotToolDeps } from '../tool-deps'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
const tools = () => buildContextTools({} as CopilotToolDeps)
async function call(tool: unknown, args: unknown) {
  return (
    tool as { execute: (a: unknown, b: unknown) => Promise<unknown> }
  ).execute(args, { toolCallId: 'test', messages: [] })
}
test('assistant top coins falls back from standalone 503 to actual market-cap feed', async () => {
  globalThis.fetch = ((input: RequestInfo | URL) =>
    Promise.resolve(
      String(input).includes('coingecko.com')
        ? Response.json([
            {
              id: 'bitcoin',
              symbol: 'btc',
              name: 'Bitcoin',
              image: null,
              current_price: 100,
              market_cap: 1000,
              market_cap_rank: 1,
              total_volume: 5,
            },
          ])
        : new Response('unavailable', { status: 503 }),
    )) as typeof fetch
  const result = await call(tools().get_top_coins, { limit: 1 })
  expect(result).toMatchObject({
    status: 'available',
    source: 'CoinGecko',
    count: 1,
    coins: [{ symbol: 'BTC', marketCap: 1000 }],
  })
})
test('assistant sentiment preserves source observation timestamp after primary 503', async () => {
  globalThis.fetch = ((input: RequestInfo | URL) =>
    Promise.resolve(
      String(input).includes('alternative.me')
        ? Response.json({
            data: [
              {
                value: '31',
                value_classification: 'Fear',
                timestamp: '1783209600',
              },
            ],
          })
        : new Response('unavailable', { status: 503 }),
    )) as typeof fetch
  expect(await call(tools().get_fear_greed, {})).toMatchObject({
    status: 'available',
    source: 'Alternative.me',
    latest: { value: 31, timestamp: '1783209600' },
  })
})
test('failure is unavailable data without claiming credentials or provider outage', async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response('unavailable', { status: 503 }),
    )) as typeof fetch
  expect(await call(tools().get_top_coins, { limit: 1 })).toMatchObject({
    status: 'unavailable',
    error:
      'Market-cap data could not be retrieved. No market ranking is available; the failure does not identify an account or credential problem.',
  })
})

test('assistant sentiment failure does not claim sign-in or temporary outage', async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response('unavailable', { status: 503 }),
    )) as typeof fetch
  expect(await call(tools().get_fear_greed, {})).toMatchObject({
    status: 'unavailable',
    error:
      'Fear & Greed data could not be retrieved. No sentiment reading is available; the failure does not identify an account or credential problem.',
  })
})
test('assistant preserves App Server timestamp instead of presenting retrieval as observation', async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({
        coins: [{ symbol: 'BTC', marketCap: 1000 }],
        updatedAt: '2020-01-01T00:00:00Z',
      }),
    )) as typeof fetch
  expect(await call(tools().get_top_coins, { limit: 1 })).toMatchObject({
    status: 'available',
    source: 'App Server',
    updatedAt: '2020-01-01T00:00:00Z',
  })
})

test('missing public-feed changes stay unknown and retrieval time is not labelled observation', async () => {
  globalThis.fetch = ((input: RequestInfo | URL) =>
    Promise.resolve(
      String(input).includes('coingecko.com')
        ? Response.json([
            {
              id: 'bitcoin',
              symbol: 'btc',
              name: 'Bitcoin',
              image: null,
              current_price: 100,
              market_cap: 1000,
              market_cap_rank: 1,
              total_volume: 5,
            },
          ])
        : new Response('unavailable', { status: 503 }),
    )) as typeof fetch
  expect(await call(tools().get_top_coins, { limit: 1 })).toMatchObject({
    providerUpdatedAt: null,
    timestampMeaning:
      'updatedAt is retrieval time, not provider observation time',
    coins: [
      { percentChange1h: null, percentChange24h: null, percentChange7d: null },
    ],
  })
})

test('assistant does not offer an empty public ranking as a successful scan', async () => {
  globalThis.fetch = ((input: RequestInfo | URL) =>
    Promise.resolve(
      String(input).includes('coingecko.com')
        ? Response.json([])
        : new Response('unavailable', { status: 503 }),
    )) as typeof fetch
  expect(await call(tools().get_top_coins, { limit: 1 })).toMatchObject({
    status: 'unavailable',
    coins: [],
  })
})
