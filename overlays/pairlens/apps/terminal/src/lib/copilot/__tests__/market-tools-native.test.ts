import { afterEach, expect, test } from 'bun:test'
import { buildMarketTools } from '../market-tools'
import type { CopilotToolDeps } from '../tool-deps'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
function setup(
  catalog: Array<{ venue: string; symbol: string; base: string }>,
  market = 'lighter',
) {
  const reads: Array<string> = []
  let catalogs = 0
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).includes('/public/candles?')) {
      const params = new URL(String(url), 'https://quanttrade.test')
        .searchParams
      const pair =
        params.get('symbol') +
        (params.get('marketType') === 'spot' ? '' : '-USDC')
      reads.push(`${params.get('venue')}:${pair}`)
      return Response.json([
        { time: 1, open: 1, close: 1, high: 1, low: 1, volume: 1 },
        { time: 2, open: 2, close: 2, high: 2, low: 2, volume: 1 },
      ])
    }
    catalogs++
    return Response.json(catalog)
  }) as typeof fetch
  const deps = {
    getContextInfo: () => ({
      market: 'binance-futures',
      pair: 'GRASS-USDT-USDT',
      timeframe: '1h',
    }),
    getCtx: () => ({
      candles: [
        { ts: 2, open: 999, close: 999, high: 999, low: 999, volume: 1 },
      ],
    }),
    getMarketData: () => ({
      fetchHistory: async (venue: string, pair: string) => {
        reads.push(`${venue}:${pair}`)
        return [
          { ts: 1, open: 1, close: 1, high: 1, low: 1, volume: 1 },
          { ts: 2, open: 2, close: 2, high: 2, low: 2, volume: 1 },
        ]
      },
    }),
  } as unknown as CopilotToolDeps
  const tools = buildMarketTools(deps)
  const tool = tools.compare_pairs
  const run = (pairs: Array<string>) =>
    (
      tool as unknown as {
        execute: (
          a: unknown,
          b: unknown,
        ) => Promise<{
          ranked: Array<{
            pair: string
            market?: string
            error?: string
            requestedPair?: string
          }>
        }>
      }
    ).execute({ market, pairs }, { toolCallId: 'scan', messages: [] })
  return { run, reads, tools, catalogs: () => catalogs }
}
test('Lighter basket resolves only catalog instruments and echoes corrected exact identity', async () => {
  const bases = ['BTC', 'SOL', 'ZEC', 'GRAM', 'PRL', 'MEGA', 'STRK', 'GRASS']
  const { run, reads, catalogs } = setup(
    bases.map((base) => ({ venue: 'lighter', base, symbol: `${base}-USDC` })),
  )
  const result = await run(bases.map((base) => `${base}-USDT-USDT`))
  expect(
    result.ranked.every(
      (row) =>
        !row.error &&
        row.market === 'lighter' &&
        row.pair.endsWith('-USDC-USDC'),
    ),
  ).toBe(true)
  expect(reads).toEqual(bases.map((base) => `lighter:${base}-USDC-USDC`))
  expect(catalogs()).toBe(1)
})
test('missing and ambiguous native symbols never fetch foreign candles', async () => {
  const { run, reads } = setup([
    { venue: 'lighter', base: 'BTC', symbol: 'BTC-USDC' },
    { venue: 'lighter', base: 'BTC', symbol: 'BTC-USDT' },
    { venue: 'hyperliquid', base: 'GRAM', symbol: 'GRAM-USDC' },
  ])
  const result = await run(['BTC', 'GRAM-USDT-USDT'])
  expect(result.ranked.every((row) => Boolean(row.error))).toBe(true)
  expect(reads).toEqual([])
})
test('Hyperliquid aliases resolve exact catalog contract and CEX routes stay unchanged', async () => {
  const hl = setup(
    [
      { venue: 'hyperliquid', base: 'SOL', symbol: 'SOL-USDC' },
      { venue: 'hyperliquid', base: 'BTC', symbol: 'BTC-USDC' },
    ],
    'hyperliquid',
  )
  await hl.run(['SOL', 'BTC-USDT'])
  expect(hl.reads).toEqual([
    'hyperliquid:SOL-USDC-USDC',
    'hyperliquid:BTC-USDC-USDC',
  ])
  const cex = setup([], 'binance-futures')
  await cex.run(['SOL-USDT-USDT', 'BTC-USDT-USDT'])
  expect(cex.reads).toEqual([
    'binance-futures:SOL-USDT-USDT',
    'binance-futures:BTC-USDT-USDT',
  ])
  expect(cex.catalogs()).toBe(0)
})

test('native snapshot does not reuse the foreign on-screen chart', async () => {
  const { tools, reads } = setup([
    { venue: 'lighter', base: 'GRASS', symbol: 'GRASS-USDC' },
  ])
  const result = await (
    tools.get_market_snapshot as unknown as {
      execute: (
        a: unknown,
        b: unknown,
      ) => Promise<{
        target: { pair: string; market: string }
        candles: { latestPrice: number }
      }>
    }
  ).execute(
    { market: 'lighter', pair: 'GRASS-USDT-USDT' },
    { toolCallId: 'snapshot', messages: [] },
  )
  expect(result.target).toMatchObject({
    market: 'lighter',
    pair: 'GRASS-USDC-USDC',
  })
  expect(result.candles.latestPrice).toBe(2)
  expect(reads).toEqual(['lighter:GRASS-USDC-USDC'])
})
test('catalog failure remains unavailable and a fresh retry can recover', async () => {
  const { run, reads } = setup([
    { venue: 'lighter', base: 'BTC', symbol: 'BTC-USDC' },
    { venue: 'lighter', base: 'SOL', symbol: 'SOL-USDC' },
  ])
  const validFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(null, { status: 503 })) as typeof fetch
  const failed = await run(['BTC', 'SOL'])
  expect(failed.ranked.every((row) => row.error?.includes('HTTP 503'))).toBe(
    true,
  )
  expect(reads).toEqual([])
  globalThis.fetch = validFetch
  const recovered = await run(['BTC', 'SOL'])
  expect(recovered.ranked.every((row) => !row.error)).toBe(true)
})
test('native spot quote is never silently substituted', async () => {
  const { run, reads } = setup(
    [
      { venue: 'lighter', base: 'BTC', symbol: 'BTC-USDC' },
      { venue: 'lighter', base: 'SOL', symbol: 'SOL-USDC' },
    ],
    'lighter-spot',
  )
  const result = await run(['BTC-USDT', 'SOL-USDT'])
  expect(result.ranked.every((row) => Boolean(row.error))).toBe(true)
  expect(reads).toEqual([])
})

test('native candle outage never falls back to cached chart or generic provider', async () => {
  const { run, reads } = setup([
    { venue: 'lighter', base: 'BTC', symbol: 'BTC-USDC' },
    { venue: 'lighter', base: 'SOL', symbol: 'SOL-USDC' },
  ])
  const fetchCatalog = globalThis.fetch
  globalThis.fetch = (async (url, init) =>
    String(url).includes('/public/candles?')
      ? new Response(null, { status: 503 })
      : fetchCatalog(url, init)) as typeof fetch
  const result = await run(['BTC', 'SOL'])
  expect(
    result.ranked.every((row) => row.error?.includes('no alternate venue')),
  ).toBe(true)
  expect(reads).toEqual([])
})
