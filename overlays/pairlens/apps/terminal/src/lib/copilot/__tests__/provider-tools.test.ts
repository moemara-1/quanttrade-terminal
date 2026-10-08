import { afterEach, expect, test } from 'bun:test'
import { buildProviderTools } from '../provider-tools'
import type { CopilotToolDeps } from '../tool-deps'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
function fixture(execute: (p: unknown) => Promise<unknown>) {
  const deps = {
    pluginManager: {
      getContext: () => ({
        pair: '',
        market: '*',
        timeframe: '1h',
        mode: 'paper',
        country: '',
      }),
      getActivePlugins: () => [
        { manifest: { id: 'nanogpt-inference' }, execute },
      ],
    },
  } as unknown as CopilotToolDeps
  return buildProviderTools(deps)
}
async function call(tool: unknown, args: unknown) {
  return (
    tool as { execute: (a: unknown, b: unknown) => Promise<unknown> }
  ).execute(args, { toolCallId: 'test', messages: [] })
}
test('NanoGPT account reads route to the active provider without exposing key fields', async () => {
  let request: unknown
  const tools = fixture(async (p) => {
    request = p
    return {
      usd_balance: '10',
      apiKey: 'must-not-return',
      nested: { Authorization: 'hidden' },
    }
  })
  expect(await call(tools.get_nanogpt_balance, {})).toEqual({
    usd_balance: '10',
    nested: {},
  })
  expect(request).toEqual({
    capability: 'ai:inference',
    params: { action: 'balance' },
    context: {
      pair: '',
      market: '*',
      timeframe: '1h',
      mode: 'paper',
      country: '',
    },
  })
})
test('model filters and usage ranges are bounded before provider dispatch', async () => {
  let calls = 0
  const tools = fixture(async () => {
    calls++
    return { models: [] }
  })
  await expect(call(tools.get_nanogpt_models, { limit: 101 })).rejects.toThrow()
  await expect(
    call(tools.get_nanogpt_usage, { from: '2026-01-01' }),
  ).rejects.toThrow()
  await call(tools.get_nanogpt_models, {
    query: 'reasoning',
    toolsOnly: true,
    limit: 5,
  })
  expect(calls).toBe(1)
})
test('disconnected NanoGPT returns unavailable without reading configuration', async () => {
  const deps = {
    pluginManager: { getActivePlugins: () => [] },
  } as unknown as CopilotToolDeps
  expect(await call(buildProviderTools(deps).get_nanogpt_balance, {})).toEqual({
    status: 'unavailable',
    error: 'Connect NanoGPT to use its account and research tools.',
  })
})
test('funding windows and owner addresses are checked before networking', async () => {
  const tools = fixture(async () => ({}))
  globalThis.fetch = (async () => {
    throw new Error('Must not send invalid research')
  }) as typeof fetch
  await expect(
    call(tools.get_exchange_research, {
      venue: 'hyperliquid',
      action: 'account-state',
      wallet: 'private-key',
    }),
  ).rejects.toThrow()
  await expect(
    call(tools.get_exchange_research, {
      venue: 'hyperliquid',
      action: 'funding-history',
      coin: 'BTC',
      startTime: 0,
      endTime: 32 * 86400000,
    }),
  ).rejects.toThrow('31 days')
})
test('research URL reads reject credentials and internal hosts', async () => {
  const tools = fixture(async () => {
    throw new Error('Must not dispatch')
  })
  for (const url of [
    'http://example.com',
    'https://user:password@example.com',
    'https://127.0.0.1',
    'https://host.internal',
  ])
    await expect(
      call(tools.read_research_urls, { urls: [url] }),
    ).rejects.toThrow()
})
test('venue research routes strict public actions without authorization headers', async () => {
  const tools = fixture(async () => ({}))
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const request = new URL(String(url), 'https://quanttrade.example')
    expect(request.pathname).toBe('/_quanttrade/api/public/research')
    expect(Object.fromEntries(request.searchParams)).toEqual({
      venue: 'lighter',
      action: 'recent-trades',
      limit: '5',
      marketId: '0',
    })
    expect(init?.signal).toBeDefined()
    expect(init?.headers).toBeUndefined()
    return Response.json({
      venue: 'lighter',
      action: 'recent-trades',
      data: [],
      truncated: false,
      observedAt: 1,
    })
  }) as typeof fetch
  await call(tools.get_exchange_research, {
    venue: 'lighter',
    action: 'recent-trades',
    marketId: 0,
    limit: 5,
  })
  await expect(
    call(tools.get_exchange_research, {
      venue: 'lighter',
      action: 'withdraw',
      marketId: 0,
    }),
  ).rejects.toThrow()
  await expect(
    call(tools.get_exchange_research, {
      venue: 'lighter',
      action: 'recent-trades',
      marketId: 0,
      url: 'https://example.com',
    }),
  ).rejects.toThrow()
})
