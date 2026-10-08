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
