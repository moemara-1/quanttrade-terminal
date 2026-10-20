import { afterEach, expect, test } from 'bun:test'
import { buildProviderTools } from '../provider-tools'
import type { CopilotToolDeps } from '../tool-deps'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function researchSchema() {
  return buildProviderTools({} as CopilotToolDeps).get_exchange_research
    .inputSchema as { parse: (value: unknown) => Record<string, unknown> }
}

test.each(['funding-rates', 'funding-history', 'market-stats', 'recent-trades'])(
  'Lighter %s converts bounded native market IDs before execution',
  (action) => {
    const input = {
      venue: 'lighter',
      action,
      marketId: '003',
      ...(action === 'funding-history'
        ? { startTime: '1000', endTime: '2000' }
        : {}),
    }
    expect(researchSchema().parse(input).marketId).toBe(3)
    for (const marketId of [
      '', true, '-1', -1, '1.5', 1.5, '32768', '1e2', '3x', ' 3', null,
    ])
      expect(() => researchSchema().parse({ ...input, marketId })).toThrow()
  },
)

test('venue research date and order IDs match bounded backend integer parsing', () => {
  const schema = researchSchema()
  const funding = schema.parse({
    venue: 'hyperliquid',
    action: 'funding-history',
    coin: 'BTC',
    startTime: '1000',
    endTime: '2000',
  })
  expect(funding.startTime).toBe(1000)
  expect(funding.endTime).toBe(2000)
  const order = {
    venue: 'hyperliquid',
    action: 'order-status',
    wallet: `0x${'1'.repeat(40)}`,
    orderId: '9007199254740991',
  }
  expect(schema.parse(order).orderId).toBe(Number.MAX_SAFE_INTEGER)
  for (const orderId of ['9007199254740992', '0', '1.5', '1e2'])
    expect(() => schema.parse({ ...order, orderId })).toThrow()
  expect(() =>
    schema.parse({
      venue: 'hyperliquid',
      action: 'funding-history',
      coin: 'BTC',
      startTime: '8640000000000001',
      endTime: '8640000000000001',
    }),
  ).toThrow()
})

test('Lighter funding-rates numeric-string market ID reaches the public research endpoint once', async () => {
  let calls = 0
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      calls++
      const url = new URL(String(input), 'https://fixture.example')
      expect(url.pathname).toBe('/_quanttrade/api/public/research')
      expect(url.searchParams.get('marketId')).toBe('3')
      return Response.json({
        venue: 'lighter',
        action: 'funding-rates',
        observedAt: 1,
        data: [],
        truncated: false,
      })
    },
    { preconnect: originalFetch.preconnect },
  )
  const execute = buildProviderTools({} as CopilotToolDeps).get_exchange_research
    .execute as unknown as (input: unknown, options: unknown) => Promise<unknown>
  await execute(
    { venue: 'lighter', action: 'funding-rates', marketId: '003' },
    {},
  )
  expect(calls).toBe(1)
})

test('venue research accepts bounded decimal-digit limits from model tools', async () => {
  const tool = buildProviderTools({} as CopilotToolDeps).get_exchange_research
  const schema = tool.inputSchema as {
    parse: (value: unknown) => { limit: number }
  }
  expect(
    schema.parse({ venue: 'hyperliquid', action: 'market-stats', limit: '100' })
      .limit,
  ).toBe(100)
  for (const limit of ['', true, '1.5', '101', '0', '1e2'])
    expect(() =>
      schema.parse({ venue: 'hyperliquid', action: 'market-stats', limit }),
    ).toThrow()
})
