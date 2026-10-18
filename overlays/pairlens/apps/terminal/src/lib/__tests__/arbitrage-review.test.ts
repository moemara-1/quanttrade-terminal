import { expect, test } from 'bun:test'
import { confirmArbitrageReview, pairedBaseSize } from '../arbitrage-review'
import type { ArbitrageReviewPlan } from '../arbitrage-review'

test('total margin is split across two equal base legs and respects both precision limits and market band', () => {
  const size = pairedBaseSize('200', 5, ['100', '101'], [4, 2], 100)
  expect(size).toBe('4.9')
  expect(((Number(size) * 101 * 1.01) / 5) * 2).toBeLessThanOrEqual(200)
})
test('invalid sizing cannot produce a silently rounded unbounded paired order', () => {
  for (const margin of ['0', '-1', 'NaN', '1e100', ''])
    expect(() =>
      pairedBaseSize(margin, 5, ['100', '100'], [2, 2], 100),
    ).toThrow()
  expect(() => pairedBaseSize('200', 0, ['100', '100'], [2, 2], 100)).toThrow()
  expect(() => pairedBaseSize('200', 5, ['0', '100'], [2, 2], 100)).toThrow()
})
test('partial, unknown and expired cards cannot be confirmed by the client', async () => {
  const plan = {
    status: 'partial',
    expiresAt: Date.now() + 10000,
  } as ArbitrageReviewPlan
  await expect(confirmArbitrageReview(plan)).rejects.toThrow(
    'no longer confirmable',
  )
  await expect(
    confirmArbitrageReview({ ...plan, status: 'unknown' }),
  ).rejects.toThrow('no longer confirmable')
  await expect(
    confirmArbitrageReview({
      ...plan,
      status: 'review',
      expiresAt: Date.now() - 1,
    }),
  ).rejects.toThrow('no longer confirmable')
})

test('a confirmation response cannot substitute another reviewed plan', async () => {
  const originalFetch = globalThis.fetch
  const { arbitragePlanSchema } = await import('../arbitrage-review')
  const account = {
    accountName: 'desk',
    mode: 'paper',
    connectionRevision: null,
    availableMargin: '0',
    observedAt: Date.now(),
  }
  const proposal = {
    id: 'leg',
    accountName: 'desk',
    mode: 'paper',
    status: 'pending',
    order: {
      venue: 'lighter',
      symbol: 'BTC-USDC',
      side: 'buy',
      type: 'market',
      size: '1',
      leverage: 5,
      marginMode: 'cross',
    },
    referencePrice: '100',
    estimatedNotional: '101',
    expiresAt: Date.now() + 60000,
  }
  const plan = arbitragePlanSchema.parse({
    id: '00000000-0000-4000-8000-000000000001',
    fingerprint: 'a'.repeat(64),
    createdAt: Date.now(),
    expiresAt: Date.now() + 60000,
    updatedAt: Date.now(),
    status: 'review',
    message: 'review',
    legs: [
      { account, proposal },
      {
        account,
        proposal: {
          ...proposal,
          id: 'leg2',
          order: { ...proposal.order, venue: 'hyperliquid', side: 'sell' },
        },
      },
    ],
  })
  globalThis.fetch = (async () =>
    Response.json({
      ...plan,
      id: '00000000-0000-4000-8000-000000000002',
      status: 'filled',
    })) as typeof fetch
  try {
    await expect(confirmArbitrageReview(plan)).rejects.toThrow('identity')
  } finally {
    globalThis.fetch = originalFetch
  }
})
