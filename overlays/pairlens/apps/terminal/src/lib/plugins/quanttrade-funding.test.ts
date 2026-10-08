import { describe, expect, test } from 'bun:test'
import { executeQuantTradeFunding } from './quanttrade-funding'
import {
  createQuantTradeConnector,
  quantTradeManifest,
} from './quanttrade-connectors'
import type {
  FundingHistoryResponse,
  FundingSnapshotResponse,
  OpenInterestResponse,
} from '@pairlens/shared/instrument-types'
import { futuresPluginsFor } from '@/lib/venues/venue-plugins'

const markets = [
  {
    symbol: 'PRL-USDC',
    base: 'PRL',
    price: '2',
    fundingRate: 0.00001,
    openInterest: '15',
    updatedAt: 123,
    marketId: 4097,
  },
  {
    symbol: 'BTC-USDC',
    base: 'BTC',
    price: '60000',
    fundingRate: null,
    openInterest: null,
    updatedAt: 123,
  },
]
describe('native funding and open interest', () => {
  test('the board venue selector discovers both native perpetual plugins and excludes spot', () => {
    const plugins = (['hyperliquid', 'lighter'] as const).flatMap((venue) =>
      (['perpetual', 'spot'] as const).map((type) =>
        createQuantTradeConnector(quantTradeManifest(venue, type)),
      ),
    )
    expect(
      futuresPluginsFor(plugins, 'market-data:funding').map(
        (venue) => venue.market,
      ),
    ).toEqual(['hyperliquid', 'lighter'])
  })
  test('both venues use hourly market data without replacing unknowns with zeros', async () => {
    for (const venue of ['hyperliquid', 'lighter'] as const) {
      const result = (await executeQuantTradeFunding(
        venue,
        { action: 'funding-rates' },
        async (url) => {
          expect(url).toBe(
            `/_quanttrade/api/public/markets?venue=${venue}&marketType=perpetual`,
          )
          return Response.json(markets)
        },
      )) as FundingSnapshotResponse
      expect(result.entries).toEqual([
        {
          pair: 'PRL-USDC-USDC',
          base: 'PRL',
          quote: 'USDC',
          fundingRate: 0.00001,
          intervalHours: 1,
          intervalKnown: true,
          markPrice: 2,
          ts: 123,
        },
      ])
    }
  })
  test('pair filters stay exact; base hints cannot override an explicit pair list', async () => {
    const result = (await executeQuantTradeFunding(
      'lighter',
      { action: 'funding-rates', pairs: ['BTC-USDC-USDC'], bases: ['PRL'] },
      async () => Response.json(markets),
    )) as FundingSnapshotResponse
    expect(result.entries).toEqual([])
  })
  test('open interest reports base units and value, without inventing history', async () => {
    const result = (await executeQuantTradeFunding(
      'lighter',
      { action: 'open-interest', pairs: ['PRL-USDC-USDC'], history: true },
      async () => Response.json(markets),
    )) as OpenInterestResponse
    expect(result.supported).toBe(true)
    expect(result.entries).toEqual([
      {
        pair: 'PRL-USDC-USDC',
        base: 'PRL',
        amount: 15,
        contractSize: 1,
        value: 30,
        ts: 123,
      },
    ])
  })
  test('Hyperliquid history uses bounded dates, sorts and deduplicates timestamps', async () => {
    const now = Date.now()
    const result = (await executeQuantTradeFunding(
      'hyperliquid',
      { action: 'funding-history', pair: 'PRL-USDC-USDC', limit: 3 },
      async (url) => {
        if (url.includes('/markets?')) return Response.json(markets)
        const query = new URL(url, 'https://quanttrade.test').searchParams
        expect(query.get('coin')).toBe('PRL')
        expect(
          Number(query.get('endTime')) - Number(query.get('startTime')),
        ).toBeLessThanOrEqual(31 * 86400000)
        return Response.json({
          venue: 'hyperliquid',
          action: 'funding-history',
          truncated: false,
          data: [
            { time: now - 1, fundingRate: '0.1' },
            { time: now - 2, fundingRate: '-0.2' },
            { time: now - 1, fundingRate: '0.1' },
          ],
        })
      },
    )) as FundingHistoryResponse
    expect(result.points).toEqual([
      { ts: now - 2, rate: -0.2 },
      { ts: now - 1, rate: 0.1 },
    ])
  })
  test('invalid params, unavailable pairs, unverified history and HTTP failures are explicit', async () => {
    let calls = 0
    const fetcher = async () => {
      calls++
      return Response.json(markets)
    }
    await expect(
      executeQuantTradeFunding('lighter', { action: 'send-trade' }, fetcher),
    ).rejects.toThrow()
    expect(calls).toBe(0)
    await expect(
      executeQuantTradeFunding(
        'lighter',
        { action: 'funding-history', pair: 'PRL-USDC-USDC' },
        fetcher,
      ),
    ).rejects.toThrow('units')
    await expect(
      executeQuantTradeFunding(
        'hyperliquid',
        { action: 'funding-history', pair: 'UNKNOWN-USDC-USDC' },
        fetcher,
      ),
    ).rejects.toThrow('unavailable')
    await expect(
      executeQuantTradeFunding(
        'lighter',
        { action: 'funding-rates' },
        async () => new Response('', { status: 503 }),
      ),
    ).rejects.toThrow('503')
  })
})
