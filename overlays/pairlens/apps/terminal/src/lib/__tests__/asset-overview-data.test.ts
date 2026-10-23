import { afterEach, describe, expect, test } from 'bun:test'
import {
  assetOverviewFetch,
  createAssetOverviewReader,
} from '../asset-overview-data'

const now = Date.parse('2026-10-23T12:00:00Z')
const coin = (extra: Record<string, unknown> = {}) => ({
  id: 'zcash',
  symbol: 'zec',
  name: 'Zcash',
  description: { en: '<p>Privacy-focused cryptocurrency.</p>' },
  links: { homepage: ['https://z.cash/'] },
  market_data: {
    circulating_supply: 16_000_000,
    total_supply: 16_000_000,
    max_supply: 21_000_000,
    market_cap: { usd: 1_000_000_000 },
    last_updated: new Date(now).toISOString(),
  },
  ...extra,
})
const failedPrimary = async (): Promise<never> => {
  throw new Error('API error: 503')
}

describe('asset overview public fallback', () => {
  test('recovers a missing cloud route with exact coin identity and dated supply fields', async () => {
    const paths: Array<string> = []
    const read = createAssetOverviewReader(
      async (url) => {
        paths.push(String(url))
        return Response.json(coin())
      },
      () => now,
    )
    const result = await read('X:ZECUSD', 'crypto', failedPrimary)
    expect(paths).toHaveLength(1)
    expect(paths[0]).toContain('/coins/zcash?')
    expect(result).toMatchObject({
      source: 'CoinGecko',
      freshness: 'current',
      providerUpdatedAt: new Date(now).toISOString(),
      supply: {
        circulating: 16_000_000,
        total: 16_000_000,
        max: 21_000_000,
        asOf: new Date(now).toISOString(),
      },
      overview: {
        ticker: 'X:ZECUSD',
        name: 'Zcash',
        description: 'Privacy-focused cryptocurrency.',
        marketCap: 1_000_000_000,
      },
    })
  })

  test('does not invent supply or call missing timestamps current', async () => {
    const read = createAssetOverviewReader(
      async () =>
        Response.json(
          coin({ market_data: { circulating_supply: null, max_supply: null } }),
        ),
      () => now,
    )
    expect(await read('ZEC', 'crypto')).toMatchObject({
      freshness: 'unknown',
      providerUpdatedAt: null,
      supply: { circulating: null, total: null, max: null, asOf: null },
      overview: { marketCap: null },
    })
  })

  test('stale market figures are withheld rather than becoming current fundamentals', async () => {
    const read = createAssetOverviewReader(
      async () =>
        Response.json(
          coin({
            last_updated: '2024-01-01T00:00:00Z',
            market_data: {
              last_updated: '2024-01-01T00:00:00Z',
              circulating_supply: 10,
              total_supply: 20,
              max_supply: 30,
              market_cap: { usd: 40 },
            },
          }),
        ),
      () => now,
    )
    expect(await read('ZEC', 'crypto')).toMatchObject({
      freshness: 'stale',
      supply: { circulating: null, total: null, max: null },
      overview: { marketCap: null },
    })
  })

  test('does not select a namesake by arbitrary search rank', async () => {
    let calls = 0
    const read = createAssetOverviewReader(
      async () => {
        calls++
        return Response.json({
          coins: [
            { id: 'foo', symbol: 'FOO' },
            { id: 'other-foo', symbol: 'FOO' },
          ],
        })
      },
      () => now,
    )
    await expect(read('FOO', 'crypto')).rejects.toThrow('ambiguous')
    expect(calls).toBe(1)
  })

  test('checks the final provider identity before exposing any metadata', async () => {
    const read = createAssetOverviewReader(
      async () => Response.json(coin({ id: 'bitcoin', symbol: 'btc' })),
      () => now,
    )
    await expect(read('ZEC', 'crypto')).rejects.toThrow('identity')
  })

  test('deduplicates concurrent reads and reuses the bounded five-minute snapshot', async () => {
    let calls = 0,
      time = now
    const read = createAssetOverviewReader(
      async () => {
        calls++
        return Response.json(coin())
      },
      () => time,
    )
    await Promise.all([read('ZEC', 'crypto'), read('X:ZECUSD', 'crypto')])
    await read('ZEC', 'crypto')
    expect(calls).toBe(1)
    time += 301_000
    await read('ZEC', 'crypto')
    expect(calls).toBe(2)
  })

  test('crypto provider failure remains unavailable; stocks never fall back to crypto namesakes', async () => {
    let calls = 0
    const read = createAssetOverviewReader(
      async () => {
        calls++
        return new Response(null, { status: 429 })
      },
      () => now,
    )
    await expect(read('ZEC', 'crypto')).rejects.toThrow('unavailable')
    await expect(read('ZEC', 'stocks', failedPrimary)).rejects.toThrow(
      'unavailable',
    )
    expect(calls).toBe(1)
  })

  test('keeps a successful primary result, including explicit no coverage', async () => {
    const primary = { overview: null, fetchedAt: new Date(now).toISOString() }
    const read = createAssetOverviewReader(
      async () => {
        throw new Error('Unexpected fallback')
      },
      () => now,
    )
    expect(await read('ZEC', 'crypto', async () => primary)).toMatchObject({
      ...primary,
      source: 'App Server',
    })
  })
})

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
test('hosted asset profiles use only the existing same-origin server session', async () => {
  let target = '',
    credentials: RequestCredentials | undefined
  globalThis.fetch = async (url, init) => {
    target = String(url)
    credentials = init?.credentials
    return Response.json(coin())
  }
  await assetOverviewFetch(
    'https://api.coingecko.com/api/v3/coins/zcash?localization=false',
    undefined,
    true,
  )
  expect(target).toBe('/_quanttrade/api/asset-profile?action=profile&id=zcash')
  expect(credentials).toBe('same-origin')
  await assetOverviewFetch(
    'https://api.coingecko.com/api/v3/search?query=PRL',
    undefined,
    true,
  )
  expect(target).toBe('/_quanttrade/api/asset-profile?action=search&query=PRL')
})

test('cached current figures expire before crossing the freshness threshold', async () => {
  let time = now,
    calls = 0
  const read = createAssetOverviewReader(
    async () => {
      calls++
      return Response.json(
        coin({
          market_data: {
            circulating_supply: 1,
            last_updated: new Date(now - 14 * 60_000).toISOString(),
          },
        }),
      )
    },
    () => time,
  )
  expect((await read('ZEC', 'crypto')).freshness).toBe('current')
  time += 2 * 60_000
  expect((await read('ZEC', 'crypto')).freshness).toBe('stale')
  expect(calls).toBe(2)
})
