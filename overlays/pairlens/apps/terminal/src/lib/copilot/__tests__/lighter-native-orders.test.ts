import { expect, test } from 'bun:test'
import {
  LighterNativeOrderApproval,
  lighterNativeAmountLabel,
  parseLighterNativeOrder,
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
function previewResponse(init?: RequestInit) {
  return Response.json({
    plan: JSON.parse(String(init?.body)),
    estimatedNotional: '256.5',
    openingNotional: '256.5',
    initialMargin: '51.3',
    availableMargin: '243',
    marginStatus: 'verified',
  })
}
const preparationRequest = async (url: string, init?: RequestInit) =>
  url.endsWith('/lighter-native-preview')
    ? previewResponse(init)
    : Response.json(status)

test('server preflight rejection never produces a native confirmation card', async () => {
  const paths: Array<string> = []
  await expect(
    prepareLighterNativeOrder(
      order,
      [account],
      async (url) => {
        paths.push(url)
        return url.endsWith('/lighter-native-preview')
          ? Response.json(
              {
                error: 'Insufficient available margin',
                submissionAttempted: false,
              },
              { status: 409 },
            )
          : Response.json(status)
      },
      () => 1000,
    ),
  ).rejects.toThrow('Insufficient available margin')
  expect(paths.some((path) => path.endsWith('/lighter-native-orders'))).toBe(
    false,
  )
})

test('server preflight may not rewrite the reviewed plan', async () => {
  await expect(
    prepareLighterNativeOrder(
      order,
      [account],
      async (url, init) => {
        if (!url.endsWith('/lighter-native-preview'))
          return Response.json(status)
        const plan = JSON.parse(String(init?.body))
        return Response.json({
          plan: { ...plan, leverage: 1 },
          estimatedNotional: '256.5',
          openingNotional: '256.5',
          initialMargin: null,
          availableMargin: null,
          marginStatus: 'unknown',
        })
      },
      () => 1000,
    ),
  ).rejects.toThrow('reviewed plan')
})

test('read-only margin review does not leak into the strict execution payload', async () => {
  const prepared = await prepareLighterNativeOrder(
    order,
    [account],
    preparationRequest,
    () => 1000,
  )
  expect(prepared.review?.initialMargin).toBe('51.3')
  let submitted: unknown
  const approval = new LighterNativeOrderApproval(
    prepared,
    () => [account],
    async (_url, init) => {
      if (init?.method !== 'POST') return Response.json(status)
      submitted = JSON.parse(String(init.body))
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
  expect(await approval.approve()).toBe('accepted')
  expect(submitted).not.toHaveProperty('review')
  expect(submitted).toMatchObject({ legs: order.legs, leverage: 5 })
})

const linkedStop = {
  side: 'sell' as const,
  type: 'sl-market' as const,
  amount: '0',
  price: '1.3',
  triggerPrice: '1.3',
  reduceOnly: true,
  timeInForce: 'ioc' as const,
}
const linkedTakeProfit = {
  ...linkedStop,
  type: 'tp-market' as const,
  price: '1.6',
  triggerPrice: '1.6',
}

test('invalid native groups never become confirmation cards or perform account reads', async () => {
  const cases = [
    {
      ...order,
      grouping: 'oto',
      legs: [order.legs[0], { ...linkedStop, amount: '171' }],
    },
    {
      ...order,
      grouping: 'oto',
      legs: [order.legs[0], { ...linkedStop, timeInForce: 'gtt' }],
    },
    {
      ...order,
      grouping: 'oto',
      legs: [order.legs[0], { ...linkedStop, expiry: 2592001001 }],
    },
    {
      ...order,
      grouping: 'oto',
      legs: [order.legs[0], { ...linkedStop, expiry: 300999 }],
    },
    { ...order, legs: [{ ...order.legs[0], expiry: 301000 }] },
    {
      ...order,
      legs: [{ ...order.legs[0], type: 'twap', durationSeconds: 600 }],
    },
    {
      ...order,
      grouping: 'oco',
      legs: [
        { ...linkedTakeProfit, amount: '10' },
        { ...linkedStop, amount: '9' },
      ],
      leverage: undefined,
      marginMode: undefined,
    },
    {
      ...order,
      grouping: 'oco',
      legs: [
        { ...linkedTakeProfit, amount: '10' },
        { ...linkedStop, amount: '10', expiry: 301000 },
      ],
      leverage: undefined,
      marginMode: undefined,
    },
    {
      ...order,
      grouping: 'oco',
      legs: [
        { ...linkedTakeProfit, amount: '10', triggerPrice: '1.2' },
        { ...linkedStop, amount: '10' },
      ],
      leverage: undefined,
      marginMode: undefined,
    },
    {
      ...order,
      grouping: 'oco',
      positionSize: '171',
      legs: [linkedTakeProfit, linkedStop],
    },
    {
      ...order,
      grouping: 'oto',
      legs: [
        { ...order.legs[0], type: 'limit', timeInForce: 'gtt', expiry: 301000 },
        linkedStop,
      ],
    },
  ]
  let reads = 0
  for (const invalid of cases) {
    await expect(
      prepareLighterNativeOrder(
        invalid,
        [account],
        async () => {
          reads++
          return Response.json(status)
        },
        () => 1000,
      ),
    ).rejects.toThrow()
  }
  expect(reads).toBe(0)
})

test('a valid entry-linked stop uses zero signed amount without changing the reviewed entry', () => {
  const prepared = parseLighterNativeOrder({
    ...proposal,
    grouping: 'oto',
    legs: [order.legs[0], linkedStop],
  })
  expect(prepared.legs).toEqual([order.legs[0], linkedStop])
  expect(() =>
    parseLighterNativeOrder({
      ...prepared,
      legs: [order.legs[0], { ...linkedStop, amount: '171' }],
    }),
  ).toThrow('zero amount')
})

test('linked child review describes actual fill coverage instead of zero base units', () => {
  const plan = parseLighterNativeOrder({
    ...proposal,
    grouping: 'oto',
    legs: [order.legs[0], linkedStop],
  })
  expect(lighterNativeAmountLabel(plan, 0)).toBe('171')
  expect(lighterNativeAmountLabel(plan, 1)).toBe(
    'Actual entry fill (up to 171)',
  )
})

test('expiry is revalidated after the account read without rewriting or submitting the reviewed plan', async () => {
  let clock = 1000
  let posts = 0
  const approval = new LighterNativeOrderApproval(
    {
      ...proposal,
      legs: [
        { ...order.legs[0], type: 'limit', timeInForce: 'gtt', expiry: 301000 },
      ],
    },
    () => [account],
    async (_url, init) => {
      if (init?.method === 'POST') posts++
      clock = 1001
      return Response.json(status)
    },
    () => clock,
  )
  expect(await approval.approve()).toBe('blocked')
  expect(approval.error).toContain('five minutes')
  expect(posts).toBe(0)
  expect(approval.proposal.legs[0].expiry).toBe(301000)
})

test('native preparation only verifies account read and never submits', async () => {
  const methods: Array<string> = []
  const prepared = await prepareLighterNativeOrder(
    order,
    [account],
    async (url, init) => {
      methods.push(init?.method ?? 'GET')
      return preparationRequest(url, init)
    },
    () => 1000,
  )
  expect(methods).toEqual(['GET', 'POST'])
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

test('native approval renews an expired bridge session only after a pre-handler 401 and preserves exact request identity', async () => {
  const bodies: Array<string> = []
  let renewals = 0
  const approval = new LighterNativeOrderApproval(
    proposal,
    () => [account],
    async (url, init) => {
      if (url.endsWith('/status')) return Response.json(status)
      if (url.endsWith('/session')) {
        renewals++
        return Response.json({ ok: true })
      }
      bodies.push(String(init?.body))
      if (bodies.length === 1)
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
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
  expect(await approval.approve()).toBe('accepted')
  expect(renewals).toBe(1)
  expect(bodies).toEqual([
    JSON.stringify(approval.proposal),
    JSON.stringify(approval.proposal),
  ])
  expect(JSON.parse(bodies[0])).toEqual(proposal)
  expect(await approval.approve()).toBe('accepted')
  expect(bodies).toHaveLength(2)
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
  const request = preparationRequest
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
        ...(type.startsWith('sl-') || type.startsWith('tp-')
          ? { leverage: undefined, marginMode: undefined }
          : {}),
        legs: [
          {
            ...order.legs[0],
            type,
            ...(type.startsWith('sl-') || type.startsWith('tp-')
              ? { triggerPrice: '1.4', reduceOnly: true }
              : {}),
            ...(type === 'twap'
              ? { durationSeconds: 600, timeInForce: 'gtt' }
              : {}),
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
        ...(grouping === 'oco'
          ? { positionSize: '171', leverage: undefined, marginMode: undefined }
          : {}),
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

test('terminal perpetual symbol is normalized to the exact native Lighter pair before review', async () => {
  const prepared = await prepareLighterNativeOrder(
    { ...order, symbol: 'GRAM-USDC-USDC' },
    [account],
    preparationRequest,
    () => 1000,
  )
  expect(prepared.symbol).toBe('GRAM-USDC')
})

test('entry plus stop-loss rejects OCO with the supported OTO correction', async () => {
  await expect(
    prepareLighterNativeOrder(
      {
        ...order,
        grouping: 'oco',
        legs: [
          order.legs[0],
          {
            ...order.legs[0],
            side: 'sell',
            type: 'sl-market',
            triggerPrice: '1.3',
            reduceOnly: true,
          },
        ],
      },
      [account],
    ),
  ).rejects.toThrow('Use OTO for an opening entry plus one protective exit')
})

test('missing revision and paper mode produce distinct errors without claiming expired credentials', async () => {
  await expect(
    prepareLighterNativeOrder(order, [account], async () =>
      Response.json({ ...status, connectionRevisions: {} }),
    ),
  ).rejects.toThrow('could not be verified')
  await expect(
    prepareLighterNativeOrder(order, [account], async () =>
      Response.json({ ...status, venueModes: { lighter: 'paper' } }),
    ),
  ).rejects.toThrow('configured for paper')
})

test('fresh preparation restores only a missing live revision once and rereads exact account scope', async () => {
  const calls: Array<string> = []
  const prepared = await prepareLighterNativeOrder(
    order,
    [account],
    async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/lighter-native-preview')) return previewResponse(init)
      if (url.endsWith('/recover')) {
        expect(JSON.parse(String(init?.body))).toEqual({ accountName: 'desk' })
        return Response.json({
          venue: 'lighter',
          accountName: 'desk',
          connectionRevision: 'a'.repeat(64),
          connected: true,
          mode: 'live',
        })
      }
      return Response.json(
        calls.length === 1
          ? {
              ...status,
              executionConfigured: true,
              connectionRevisions: { lighter: null },
            }
          : status,
      )
    },
    () => 1000,
  )
  expect(prepared.connectionRevision).toBe('a'.repeat(64))
  expect(calls).toHaveLength(4)
})

test('approval never restores a missing revision from an old reviewed card', async () => {
  let posts = 0
  const approval = new LighterNativeOrderApproval(
    proposal,
    () => [account],
    async (_url, init) => {
      if (init?.method === 'POST') posts++
      return Response.json({
        ...status,
        executionConfigured: true,
        connectionRevisions: { lighter: null },
      })
    },
    () => 1000,
  )
  expect(await approval.approve()).toBe('blocked')
  expect(posts).toBe(0)
})

test('malformed revisions, disabled execution and paper accounts never trigger connection recovery', async () => {
  for (const replacement of [
    {
      connectionRevisions: { lighter: 'malformed' },
      executionConfigured: true,
    },
    { connectionRevisions: { lighter: null }, executionConfigured: false },
    {
      connectionRevisions: { lighter: null },
      executionConfigured: true,
      venueModes: { lighter: 'paper' },
    },
  ]) {
    let mutations = 0
    await expect(
      prepareLighterNativeOrder(order, [account], async (_url, init) => {
        if (init?.method === 'POST') mutations++
        return Response.json({ ...status, ...replacement })
      }),
    ).rejects.toThrow()
    expect(mutations).toBe(0)
  }
})
