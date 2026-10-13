import { expect, test } from 'bun:test'
import { buildTradingTools } from '../trading-tools'
import { ExchangeOperationApproval } from '../exchange-operation'
import type { CopilotToolDeps } from '../tool-deps'

const operation = {
  venue: 'hyperliquid',
  marketType: 'perpetual',
  symbol: 'ETH-USDC',
  action: 'margin',
  amount: '12.345678',
  direction: 'add',
}
const proposal = {
  ...operation,
  requestId: 'f8ca1f84-614d-4bdd-96a6-4acbfa7db0ab',
  mode: 'live',
}
test('preparing operation returns exact proposal without execution', async () => {
  const tools = buildTradingTools({} as CopilotToolDeps)
  const execute = (
    tools.prepare_exchange_operation as unknown as {
      execute: (a: unknown, b: unknown) => Promise<Record<string, unknown>>
    }
  ).execute
  const result = await execute(operation, { toolCallId: 'test', messages: [] })
  expect(result.status).toBe('awaiting_confirmation')
  expect(result.operation).toMatchObject({ ...operation, mode: 'live' })
  expect(result).not.toHaveProperty('autoApproval')
})
test('approval sends exact payload once and blocks repeated clicks', async () => {
  let calls = 0
  const controller = new ExchangeOperationApproval(
    proposal,
    async (_url, init) => {
      calls++
      expect(JSON.parse(String(init?.body))).toEqual(proposal)
      expect(init?.credentials).toBe('same-origin')
      return Response.json({ status: 'accepted', result: {} })
    },
  )
  expect(calls).toBe(0)
  await Promise.all([controller.approve(), controller.approve()])
  expect(calls).toBe(1)
  expect(controller.status).toBe('accepted')
})
test('unknown outcomes retain the original key and never resubmit', async () => {
  let calls = 0
  const controller = new ExchangeOperationApproval(proposal, async () => {
    calls++
    return Response.json({ status: 'unknown', result: { error: 'Uncertain' } })
  })
  await controller.approve()
  await controller.approve()
  expect(controller.status).toBe('unknown')
  expect(calls).toBe(1)
})
test('spot margin/leverage and Lighter TIF changes fail before approval', () => {
  expect(
    () => new ExchangeOperationApproval({ ...proposal, marketType: 'spot' }),
  ).toThrow()
  expect(
    () =>
      new ExchangeOperationApproval({
        venue: 'hyperliquid',
        symbol: 'ETH-USDC',
        requestId: proposal.requestId,
        mode: 'live',
        action: 'leverage',
        leverage: 2,
        marginMode: 'isolated',
        marketType: 'spot',
      }),
  ).toThrow('perpetual')
  expect(
    () =>
      new ExchangeOperationApproval({
        marketType: 'perpetual',
        symbol: 'ETH-USDC',
        requestId: proposal.requestId,
        mode: 'live',
        venue: 'lighter',
        action: 'amend',
        amount: '1',
        price: '12',
        exchangeOrderId: '12',
        timeInForce: 'Alo',
      }),
  ).toThrow('time in force')
})

test('native cancellation preparation verifies account scope without submitting', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request) => {
    expect(String(url)).toBe('/_quanttrade/api/status')
    return Response.json({
      accountName: 'desk',
      venueModes: { lighter: 'live' },
      connectionRevisions: { lighter: 'a'.repeat(64) },
    })
  }) as typeof fetch
  try {
    const tools = buildTradingTools({} as CopilotToolDeps)
    const execute = (
      tools.prepare_exchange_operation as unknown as {
        execute: (a: unknown, b: unknown) => Promise<Record<string, unknown>>
      }
    ).execute
    const result = await execute(
      {
        venue: 'lighter',
        marketType: 'perpetual',
        symbol: 'PRL-USDC-USDC',
        action: 'cancel',
        exchangeOrderId: '14918173922809911',
      },
      {},
    )
    expect(result.status).toBe('awaiting_confirmation')
    expect(result.operation).toMatchObject({
      symbol: 'PRL-USDC',
      accountName: 'desk',
      connectionRevision: 'a'.repeat(64),
      mode: 'live',
    })
  } finally {
    globalThis.fetch = original
  }
})

test('native cancellation returns a structured error for unavailable scope', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('Offline')
  }) as typeof fetch
  try {
    const tools = buildTradingTools({} as CopilotToolDeps)
    const execute = (
      tools.prepare_exchange_operation as unknown as {
        execute: (a: unknown, b: unknown) => Promise<Record<string, unknown>>
      }
    ).execute
    const result = await execute(
      {
        venue: 'lighter',
        marketType: 'perpetual',
        symbol: 'PRL-USDC',
        action: 'cancel',
        exchangeOrderId: '12',
      },
      {},
    )
    expect(result.status).toBe('invalid')
    expect(result).not.toHaveProperty('operation')
  } finally {
    globalThis.fetch = original
  }
})

test('generic cancellation routes large native ID through scoped operation card', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    Response.json({
      accountName: 'desk',
      venueModes: { lighter: 'live' },
      connectionRevisions: { lighter: 'a'.repeat(64) },
    })) as typeof fetch
  try {
    const tools = buildTradingTools({
      getContextInfo: () => ({ market: 'lighter', pair: 'GRASS-USDC-USDC' }),
    } as CopilotToolDeps)
    const execute = (
      tools.cancel_order as unknown as {
        execute: (a: unknown, b: unknown) => Promise<Record<string, unknown>>
      }
    ).execute
    const result = await execute(
      {
        market: 'lighter',
        pair: 'GRASS-USDC-USDC',
        orderId: '14918173922809911',
      },
      {},
    )
    expect(result).not.toHaveProperty('cancel')
    expect(result.operation).toMatchObject({
      action: 'cancel',
      exchangeOrderId: '14918173922809911',
      symbol: 'GRASS-USDC',
      accountName: 'desk',
    })
    const approval = new ExchangeOperationApproval(result.operation)
    expect(approval.proposal).toMatchObject({
      connectionRevision: 'a'.repeat(64),
      exchangeOrderId: '14918173922809911',
    })
  } finally {
    globalThis.fetch = original
  }
})
