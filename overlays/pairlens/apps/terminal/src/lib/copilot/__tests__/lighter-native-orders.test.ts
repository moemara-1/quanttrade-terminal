import { expect, test } from 'bun:test'
import {
  LighterNativeOrderApproval,
  prepareLighterNativeOrder,
} from '../lighter-native-orders'

const account = {
  id: 'qt-lighter-live',
  market: 'lighter',
  mode: 'live' as const,
  label: 'Lighter live',
}
const order = {
  symbol: 'GRAM-USDC',
  grouping: 'single' as const,
  legs: [
    {
      side: 'buy' as const,
      type: 'market' as const,
      amount: '171',
      price: '1.5',
      reduceOnly: false,
      timeInForce: 'ioc' as const,
    },
  ],
  leverage: 5,
  marginMode: 'cross' as const,
}
const proposal = {
  ...order,
  connectionRevision: 'a'.repeat(64),
  requestId: 'f8ca1f84-614d-4bdd-96a6-4acbfa7db0ab',
  proposedAt: 1000,
  mode: 'live',
  accountName: 'desk',
  credentialId: account.id,
  venue: 'lighter',
  marketType: 'perpetual',
}
const status = {
  accountName: 'desk',
  venueModes: { lighter: 'live' },
  connectionRevisions: { lighter: 'a'.repeat(64) },
}

test('native preparation only verifies account read and never submits', async () => {
  const methods: Array<string> = []
  const prepared = await prepareLighterNativeOrder(
    order,
    [account],
    async (_url, init) => {
      methods.push(init?.method ?? 'GET')
      return Response.json(status)
    },
    () => 1000,
  )
  expect(methods).toEqual(['GET'])
  expect(prepared).toMatchObject({
    mode: 'live',
    credentialId: account.id,
    accountName: 'desk',
    proposedAt: 1000,
    legs: order.legs,
  })
})

test('one human approval submits exact native plan once and acceptance never implies fill', async () => {
  const posts: Array<unknown> = []
  const approval = new LighterNativeOrderApproval(
    proposal,
    () => [account],
    async (_url, init) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)))
        return Response.json({
          status: 'accepted',
          result: {
            status: 'accepted',
            grouping: 'single',
            connector_name: 'lighter_perpetual',
            trading_pair: 'GRAM-USDC',
            tx_hash: 'hash',
            client_order_ids: ['123'],
          },
        })
      }
      return Response.json(status)
    },
    () => 1000,
  )
  expect(posts.length).toBe(0)
  await Promise.all([approval.approve(), approval.approve()])
  expect(posts).toEqual([proposal])
  expect(approval.status).toBe('accepted')
  expect(approval.evidence).toMatchObject({ txHash: 'hash', orderIds: ['123'] })
})

test('changed credentials, expired proposals and server account or mode changes prevent order POST', async () => {
  for (const failure of [
    'credential',
    'expired',
    'server-account',
    'mode',
    'revision',
  ]) {
    let posts = 0
    const approval = new LighterNativeOrderApproval(
      proposal,
      () => (failure === 'credential' ? [] : [account]),
      async (_url, init) => {
        if (init?.method === 'POST') posts++
        return Response.json({
          ...status,
          ...(failure === 'server-account' ? { accountName: 'other' } : {}),
          ...(failure === 'revision'
            ? { connectionRevisions: { lighter: 'b'.repeat(64) } }
            : {}),
          ...(failure === 'mode' ? { venueModes: { lighter: 'paper' } } : {}),
        })
      },
      () => (failure === 'expired' ? 181001 : 1000),
    )
    await approval.approve()
    expect(posts).toBe(0)
    expect(approval.status).toBe('blocked')
  }
})

test('uncertain POST cannot be retried even after another confirm', async () => {
  let posts = 0
  const approval = new LighterNativeOrderApproval(
    proposal,
    () => [account],
    async (_url, init) => {
      if (init?.method === 'POST') {
        posts++
        throw new Error('Connection interrupted')
      }
      return Response.json(status)
    },
    () => 1000,
  )
  await approval.approve()
  await approval.approve()
  expect(posts).toBe(1)
  expect(approval.status).toBe('unknown')
})

test('linked children are explicit and TWAP cannot masquerade as a grouped order', () => {
  expect(
    () =>
      new LighterNativeOrderApproval({
        ...proposal,
        legs: [{ ...order.legs[0], amount: '0' }],
      }),
  ).toThrow()
  expect(
    () =>
      new LighterNativeOrderApproval({
        ...proposal,
        grouping: 'oto',
        legs: [
          { ...order.legs[0], type: 'twap', durationSeconds: 300 },
          {
            ...order.legs[0],
            type: 'tp-market',
            triggerPrice: '1.6',
            amount: '0',
            reduceOnly: true,
            side: 'sell',
          },
        ],
      }),
  ).toThrow()
})

test('all native order types and supported groups prepare for human review only', async () => {
  const request = async () => Response.json(status)
  for (const type of [
    'market',
    'limit',
    'sl-market',
    'sl-limit',
    'tp-market',
    'tp-limit',
    'twap',
  ]) {
    const prepared = await prepareLighterNativeOrder(
      {
        ...order,
        legs: [
          {
            ...order.legs[0],
            type,
            ...(type.startsWith('sl-') || type.startsWith('tp-')
              ? { triggerPrice: '1.4', reduceOnly: true }
              : {}),
            ...(type === 'twap' ? { durationSeconds: 600 } : {}),
          },
        ],
      },
      [account],
      request,
      () => 1000,
    )
    expect(prepared.legs[0].type).toBe(type)
  }
  const tp = {
    ...order.legs[0],
    side: 'sell',
    type: 'tp-market',
    triggerPrice: '1.6',
    reduceOnly: true,
    amount: '0',
  }
  const sl = { ...tp, type: 'sl-market', triggerPrice: '1.3' }
  for (const grouping of ['oto', 'otoco', 'oco']) {
    const legs =
      grouping === 'oto'
        ? [order.legs[0], tp]
        : grouping === 'otoco'
          ? [order.legs[0], tp, sl]
          : [tp, sl]
    const prepared = await prepareLighterNativeOrder(
      {
        ...order,
        grouping,
        legs,
        ...(grouping === 'oco' ? { positionSize: '171' } : {}),
      },
      [account],
      request,
      () => 1000,
    )
    expect(prepared.grouping).toBe(grouping)
  }
})

test('paper and ambiguous live accounts never perform preparation reads', async () => {
  let reads = 0
  const request = async () => {
    reads++
    return Response.json(status)
  }
  await expect(
    prepareLighterNativeOrder(
      { ...order, mode: 'paper' },
      [{ ...account, mode: 'paper' }],
      request,
    ),
  ).rejects.toThrow('live account')
  await expect(
    prepareLighterNativeOrder(
      order,
      [account, { ...account, id: 'other' }],
      request,
    ),
  ).rejects.toThrow('Multiple accounts')
  expect(reads).toBe(0)
})

test('account removal during verification and accepted envelopes without signer evidence block safe completion', async () => {
  let credentials = [account]
  let posts = 0
  const changed = new LighterNativeOrderApproval(
    proposal,
    () => credentials,
    async () => {
      credentials = []
      return Response.json(status)
    },
    () => 1000,
  )
  await changed.approve()
  expect(changed.status).toBe('blocked')
  const missingEvidence = new LighterNativeOrderApproval(
    proposal,
    () => [account],
    async (_url, init) => {
      if (init?.method === 'POST') {
        posts++
        return Response.json({ status: 'accepted', result: {} })
      }
      return Response.json(status)
    },
    () => 1000,
  )
  await missingEvidence.approve()
  await missingEvidence.approve()
  expect(missingEvidence.status).toBe('unknown')
  expect(posts).toBe(1)
})

test('explicit pre-submission rejection displays precise error and does not retry', async () => {
  let posts = 0
  const approval = new LighterNativeOrderApproval(
    proposal,
    () => [account],
    async (_url, init) => {
      if (init?.method === 'POST') {
        posts++
        return Response.json(
          {
            error: 'Order exceeds the approved risk budget.',
            submissionAttempted: false,
          },
          { status: 409 },
        )
      }
      return Response.json(status)
    },
    () => 1000,
  )
  await approval.approve()
  await approval.approve()
  expect(approval.status).toBe('blocked')
  expect(approval.error).toBe('Order exceeds the approved risk budget.')
  expect(posts).toBe(1)
})

test('unmarked server errors and mismatched acceptance identity remain uncertain', async () => {
  for (const scenario of [
    'unmarked',
    'grouping',
    'connector',
    'pair',
    'count',
  ]) {
    const approval = new LighterNativeOrderApproval(
      proposal,
      () => [account],
      async (_url, init) => {
        if (init?.method !== 'POST') return Response.json(status)
        if (scenario === 'unmarked')
          return Response.json(
            { error: 'Connector unavailable' },
            { status: 503 },
          )
        return Response.json({
          status: 'accepted',
          result: {
            status: 'accepted',
            tx_hash: 'hash',
            grouping: scenario === 'grouping' ? 'oco' : 'single',
            connector_name:
              scenario === 'connector'
                ? 'hyperliquid_perpetual'
                : 'lighter_perpetual',
            trading_pair: scenario === 'pair' ? 'ETH-USDC' : 'GRAM-USDC',
            client_order_ids: scenario === 'count' ? ['123', '124'] : ['123'],
          },
        })
      },
      () => 1000,
    )
    await approval.approve()
    expect(approval.status).toBe('unknown')
  }
})

test('native receipt is absent until Confirm and records signer IDs separately from exchange order IDs', async () => {
  const { getTradeSubmissions } = await import('../trade-submissions')
  const reviewed = {
    ...proposal,
    requestId: '74f188c1-f415-4853-9f96-184956988d47',
  }
  const approval = new LighterNativeOrderApproval(
    reviewed,
    () => [account],
    async (_url, init) => {
      if (init?.method !== 'POST') return Response.json(status)
      expect(
        getTradeSubmissions().find(
          (entry) => entry.clientOrderId === reviewed.requestId,
        )?.status,
      ).toBe('submitting')
      return Response.json({
        status: 'accepted',
        result: {
          status: 'accepted',
          grouping: 'single',
          connector_name: 'lighter_perpetual',
          trading_pair: 'GRAM-USDC',
          tx_hash: 'hash',
          client_order_ids: ['123'],
        },
      })
    },
    () => 1000,
  )
  expect(
    getTradeSubmissions().find(
      (entry) => entry.clientOrderId === reviewed.requestId,
    ),
  ).toBeUndefined()
  await approval.approve()
  expect(
    getTradeSubmissions().find(
      (entry) => entry.clientOrderId === reviewed.requestId,
    ),
  ).toMatchObject({
    status: 'submitted',
    nativeClientOrderIds: ['123'],
    txHash: 'hash',
    mode: 'live',
    market: 'lighter',
    pair: 'GRAM-USDC',
    credentialId: account.id,
  })
  expect(
    getTradeSubmissions().find(
      (entry) => entry.clientOrderId === reviewed.requestId,
    ),
  ).not.toHaveProperty('orderId')
})

test('native unknown and blocked receipts remain visible without another submission', async () => {
  const { getTradeSubmissions } = await import('../trade-submissions')
  for (const failure of ['unknown', 'blocked']) {
    const reviewed = {
      ...proposal,
      requestId:
        failure === 'unknown'
          ? '74f188c1-f415-4853-9f96-184956988d48'
          : '74f188c1-f415-4853-9f96-184956988d49',
    }
    let posts = 0
    const approval = new LighterNativeOrderApproval(
      reviewed,
      () => [account],
      async (_url, init) => {
        if (init?.method !== 'POST') return Response.json(status)
        posts++
        if (failure === 'unknown') throw new Error('Interrupted')
        return Response.json(
          { submissionAttempted: false, error: 'Budget exceeded' },
          { status: 409 },
        )
      },
      () => 1000,
    )
    await approval.approve()
    await approval.approve()
    expect(posts).toBe(1)
    expect(
      getTradeSubmissions().find(
        (entry) => entry.clientOrderId === reviewed.requestId,
      )?.status,
    ).toBe(failure === 'unknown' ? 'unverified' : 'blocked')
  }
})
