import { afterEach, expect, test } from 'bun:test'
import { api } from '../../api'
import { buildContextTools } from '../context-tools'
import type { CopilotToolDeps } from '../tool-deps'

const original = api.getTickerOverview
afterEach(() => {
  api.getTickerOverview = original
})
const read = async () => {
  const tools = buildContextTools({
    getContextInfo: () => ({ pair: 'ZEC-USDC-USDC', market: 'lighter' }),
  } as CopilotToolDeps)
  return (
    tools.get_asset_overview.execute as unknown as (
      input: unknown,
      options: unknown,
    ) => Promise<Record<string, unknown>>
  )({}, { toolCallId: 'profile', messages: [] })
}

test('asset overview failures are unknown fundamentals, not credential problems or remembered supply', async () => {
  api.getTickerOverview = async () => {
    throw new Error('API error: 503')
  }
  expect(await read()).toMatchObject({
    status: 'unavailable',
    symbol: 'ZEC',
    supply: null,
    nextResearch: {
      tool: 'web_search',
      maxFollowups: 1,
      query: 'Zcash official circulating total maximum supply tokenomics',
    },
  })
})

test('asset overview preserves provider and supply observation timestamps', async () => {
  api.getTickerOverview = async () => ({
    overview: null,
    fetchedAt: '2026-10-23T12:00:00Z',
    source: 'CoinGecko',
    providerUpdatedAt: '2026-10-23T11:59:00Z',
    freshness: 'current',
    supply: {
      circulating: 16,
      total: 16,
      max: 21,
      asOf: '2026-10-23T11:59:00Z',
    },
  })
  expect(await read()).toMatchObject({
    status: 'no-coverage',
    fetchedAt: '2026-10-23T12:00:00Z',
    source: 'CoinGecko',
    providerUpdatedAt: '2026-10-23T11:59:00Z',
    freshness: 'current',
    supply: { circulating: 16, total: 16, max: 21 },
  })
})
