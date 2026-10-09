import { expect, test } from 'bun:test'
import { submitReviewedOrder } from '../submit-reviewed-order'
import type { ExchangeCredential } from '@/stores/credentials-store'
import type { CopilotOrderRequest } from '@/components/copilot/copilot-order-card'

const account: ExchangeCredential = {
  id: 'lighter-main',
  label: 'Main',
  market: 'lighter',
  mode: 'live',
  apiKey: '',
  apiSecret: '',
  createdAt: 0,
}
const order: CopilotOrderRequest = {
  market: 'lighter',
  pair: 'PRL-USDC-USDC',
  side: 'buy',
  type: 'limit',
  size: 1,
  exactSize: '123.456',
  price: 1,
  exactPrice: '0.12345',
  leverage: 3,
  marginMode: 'isolated',
  mode: 'live',
  credentialId: 'lighter-main',
  clientOrderId: 'reviewed-once',
}

test('one confirmation directly submits exactly the reviewed terms once', async () => {
  const calls: Array<Record<string, unknown>> = []
  const outcome = await submitReviewedOrder(
    order,
    'live',
    [account],
    async (params) => {
      calls.push(params)
      return { success: true, orderId: 'exchange-order' }
    },
  )
  expect(calls).toEqual([
    {
      market: 'lighter',
      pair: 'PRL-USDC-USDC',
      side: 'buy',
      type: 'limit',
      size: '123.456',
      price: '0.12345',
      leverage: 3,
      marginMode: 'isolated',
      mode: 'live',
      credentialId: 'lighter-main',
      clientOrderId: 'reviewed-once',
      analyticsSource: 'copilot',
    },
  ])
  expect(outcome).toEqual({ success: true, orderId: 'exchange-order' })
})

test('removed account, changed venue/mode or unbound live review never submit', async () => {
  let calls = 0
  const submit = async () => {
    calls += 1
    return { success: true }
  }
  await expect(submitReviewedOrder(order, 'live', [], submit)).rejects.toThrow(
    'reviewed exchange account',
  )
  await expect(
    submitReviewedOrder(
      order,
      'live',
      [{ ...account, market: 'hyperliquid' }],
      submit,
    ),
  ).rejects.toThrow('reviewed exchange account')
  await expect(
    submitReviewedOrder(order, 'live', [{ ...account, mode: 'paper' }], submit),
  ).rejects.toThrow('reviewed exchange account')
  await expect(
    submitReviewedOrder(order, 'paper', [account], submit),
  ).rejects.toThrow('reviewed trading mode')
  await expect(
    submitReviewedOrder(
      { ...order, credentialId: undefined },
      'live',
      [account],
      submit,
    ),
  ).rejects.toThrow('no reviewed account')
  expect(calls).toBe(0)
})

test('wallet venues preserve their direct live route without exchange credentials', async () => {
  const walletOrder: CopilotOrderRequest = {
    market: 'ethereum',
    pair: 'ETH-USDC',
    side: 'buy',
    type: 'market',
    size: 1,
    mode: 'live',
    clientOrderId: 'wallet-reviewed',
  }
  const calls: Array<Record<string, unknown>> = []
  await submitReviewedOrder(walletOrder, 'live', [], async (params) => {
    calls.push(params)
    return { success: true }
  })
  expect(calls).toHaveLength(1)
  expect(calls[0]).not.toHaveProperty('credentialId')
})
