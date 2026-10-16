import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'bun:test'
import { buildContextTools } from '../context-tools'
import { buildWorkspaceTools } from '../workspace-tools'
import type { CopilotToolDeps } from '../tool-deps'

const originalFetch = globalThis.fetch
const originalStorage = globalThis.localStorage
afterEach(() => {
  globalThis.fetch = originalFetch
  if (process.env['QT_JOURNAL_TEST_PROCESS'] === '1')
    globalThis.localStorage = originalStorage
})
const tools = () => buildContextTools({} as CopilotToolDeps)
async function call(tool: unknown, args: unknown) {
  return (
    tool as { execute: (a: unknown, b: unknown) => Promise<unknown> }
  ).execute(args, { toolCallId: 'test', messages: [] })
}

// Other suites mock hasAppServer at module scope. Exercise the real standalone
// API in a fresh process so the build-time flag and journal assertions cannot
// inherit those unrelated cloud-auth mocks.
if (process.env['QT_JOURNAL_TEST_PROCESS'] !== '1') {
  test('standalone journal API and tools pass in an isolated standalone process', () => {
    const child = Bun.spawnSync(
      [process.execPath, 'test', fileURLToPath(import.meta.url)],
      {
        env: {
          ...process.env,
          VITE_APP_SERVER_URL: '',
          QT_JOURNAL_TEST_PROCESS: '1',
        },
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 15000,
      },
    )
    expect(child.exitCode, new TextDecoder().decode(child.stderr)).toBe(0)
  }, 20000)
} else {
  test('standalone journal is device-only and never calls unavailable cloud API', async () => {
    const values = new Map<string, string>()
    globalThis.localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    } as Storage
    let requests = 0
    globalThis.fetch = (() => {
      requests++
      return Promise.resolve(new Response(null, { status: 503 }))
    }) as typeof fetch
    const { api } = await import('../../api')
    const entry = await api.addTradeJournalEntry({
      market: 'lighter',
      pairKey: 'GRAM-USDC-USDC',
      side: 'buy',
      price: 1.4,
      quantity: 100,
    })
    expect(await call(tools().get_trade_journal, { limit: 50 })).toMatchObject({
      status: 'available',
      source: 'device-journal',
      completeExchangeHistory: false,
      recordKind: 'manually-logged-trades',
      entries: [entry],
      count: 1,
    })
    expect(requests).toBe(0)
  })

  test('journal storage failure is unknown rather than an empty successful history', async () => {
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
    } as Storage
    const result = await call(tools().get_trade_journal, { limit: 50 })
    expect(result).toMatchObject({
      status: 'unavailable',
      completeExchangeHistory: false,
    })
    expect(result).not.toHaveProperty('entries')
  })

  test('journal write tool labels saved records device-only without placing orders', async () => {
    const values = new Map<string, string>()
    globalThis.localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    } as Storage
    const workspace = buildWorkspaceTools({
      getContextInfo: () => ({}),
    } as CopilotToolDeps)
    expect(
      await call(workspace.add_journal_entry, {
        market: 'lighter',
        pair: 'GRAM-USDC-USDC',
        side: 'buy',
        price: 1.4,
        quantity: 100,
      }),
    ).toMatchObject({
      ok: true,
      source: 'device-journal',
      recordKind: 'manually-logged-trades',
      orderPlaced: false,
    })
  })

  test('journal write tool rejects failed persistence without acknowledging a saved entry', async () => {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    } as Storage
    const workspace = buildWorkspaceTools({
      getContextInfo: () => ({}),
    } as CopilotToolDeps)
    const result = await call(workspace.add_journal_entry, {
      market: 'lighter',
      pair: 'GRAM-USDC-USDC',
      side: 'buy',
      price: 1.4,
      quantity: 100,
    })
    expect(result).toMatchObject({ ok: false })
    expect(result).not.toHaveProperty('entryId')
  })
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
