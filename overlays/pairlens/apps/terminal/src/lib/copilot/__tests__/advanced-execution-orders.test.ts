import { expect, test } from 'bun:test'
import {
  AdvancedExecutionApproval,
  prepareAdvancedExecution,
} from '../advanced-execution-orders'

const credentials = [
  { id: 'hl', market: 'hyperliquid', mode: 'live', label: 'HL live' },
]
const input = {
  kind: 'hyperliquid-twap',
  symbol: 'BTC-USDC',
  side: 'buy',
  size: '0.01',
  durationMinutes: 5,
  randomize: false,
  reduceOnly: false,
  acceptNativeRisk: true,
  referenceNotionalBudget: '1000',
}
const status = {
  maxPriceDeviationBps: 300,
  accountName: 'desk',
  connectionRevisions: { hyperliquid: 'a'.repeat(64) },
  venueModes: { hyperliquid: 'live' },
}
test('bundled protection survives one confirmation unchanged and invalid allocations never prepare', async () => {
  const protection = {
    stopLossPrice: '50000',
    takeProfits: [
      { price: '70000', sizePercent: '40' },
      { price: '80000', sizePercent: '60' },
    ],
    maxExitNotional: '2000',
  }
  const reviewed = {
    ...protection,
    activation: 'after-full-entry-fill',
    management: 'managed',
  }
  const proposal = await prepareAdvancedExecution(
    { ...input, protection },
    credentials,
    async () => Response.json(status),
    () => 1000,
  )
  expect(proposal.kind === 'hyperliquid-twap' && proposal.protection).toEqual(
    reviewed,
  )
  let sent: unknown
  const approval = new AdvancedExecutionApproval(
    proposal,
    () => credentials,
    async (url, init) => {
      if (url.endsWith('/status')) return Response.json(status)
      sent = JSON.parse(String(init?.body))
      return Response.json({
        status: 'accepted',
        result: {
          status: 'accepted',
          connector_name: 'hyperliquid_perpetual',
          twap_id: '10',
          trading_pair: 'BTC-USD',
        },
      })
    },
    () => 1000,
  )
  expect(await approval.approve()).toBe('accepted')
  expect((sent as { protection: unknown }).protection).toEqual(reviewed)
  for (const bad of [
    { ...protection, takeProfits: [{ price: '70000', sizePercent: '99' }] },
    { ...protection, stopLossPrice: '0' },
    { ...protection, maxExitNotional: '0' },
    { ...protection, takeProfits: [{ price: '0', sizePercent: '100' }] },
  ])
    await expect(
      prepareAdvancedExecution(
        { ...input, protection: bad },
        credentials,
        async () => Response.json(status),
      ),
    ).rejects.toThrow()
  await expect(
    prepareAdvancedExecution(
      { ...input, reduceOnly: true, protection },
      credentials,
      async () => Response.json(status),
    ),
  ).rejects.toThrow(/opening/)
})
test('preparation reads account only; duplicate confirmation never repeats execution', async () => {
  const requests: Array<string> = []
  const request = async (url: string) => {
    requests.push(url)
    return Response.json(
      url.endsWith('/status')
        ? status
        : {
            status: 'accepted',
            result: {
              status: 'accepted',
              connector_name: 'hyperliquid_perpetual',
              twap_id: '10',
              trading_pair: 'BTC-USD',
            },
          },
    )
  }
  const proposal = await prepareAdvancedExecution(
    input,
    credentials,
    request,
    () => 1000,
  )
  expect(requests).toHaveLength(1)
  const approval = new AdvancedExecutionApproval(
    proposal,
    () => credentials,
    request,
    () => 1000,
  )
  expect(await approval.approve()).toBe('accepted')
  expect(await approval.approve()).toBe('accepted')
  expect(
    requests.filter((url) => url.endsWith('/hyperliquid-twap')),
  ).toHaveLength(1)
})
test('uncertain submission cannot be retried', async () => {
  const proposal = await prepareAdvancedExecution(
    input,
    credentials,
    async () => Response.json(status),
    () => 1000,
  )
  let posts = 0
  const approval = new AdvancedExecutionApproval(
    proposal,
    () => credentials,
    async (url) => {
      if (url.endsWith('/status')) return Response.json(status)
      posts++
      throw new Error('timeout')
    },
    () => 1000,
  )
  expect(await approval.approve()).toBe('unknown')
  expect(await approval.approve()).toBe('unknown')
  expect(posts).toBe(1)
})

test('changed account revision blocks before crossing execution boundary', async () => {
  const proposal = await prepareAdvancedExecution(
    input,
    credentials,
    async () => Response.json(status),
    () => 1000,
  )
  let posts = 0
  const approval = new AdvancedExecutionApproval(
    proposal,
    () => credentials,
    async (url) => {
      if (url.endsWith('/status'))
        return Response.json({
          ...status,
          connectionRevisions: { hyperliquid: 'b'.repeat(64) },
        })
      posts++
      return Response.json({})
    },
    () => 1000,
  )
  expect(await approval.approve()).toBe('blocked')
  expect(posts).toBe(0)
})

test('Chase has one registration and requires matching run identity', async () => {
  const proposal = await prepareAdvancedExecution(
    {
      kind: 'chase',
      venue: 'hyperliquid',
      symbol: 'BTC-USDC',
      side: 'buy',
      size: '0.01',
      lowerPrice: '50000',
      upperPrice: '60000',
      durationSeconds: 300,
      intervalSeconds: 10,
      maxAttempts: 10,
      maxTotalNotional: '6000',
    },
    credentials,
    async () => Response.json(status),
    () => 1000,
  )
  const approval = new AdvancedExecutionApproval(
    proposal,
    () => credentials,
    async (url) =>
      Response.json(
        url.endsWith('/status')
          ? status
          : {
              status: 'registered',
              run: { id: proposal.requestId, status: 'active' },
            },
      ),
    () => 1000,
  )
  expect(await approval.approve()).toBe('registered')
  expect(approval.evidence).toContain(proposal.requestId)
})

test('native acknowledgment for another pair is never accepted', async () => {
  const proposal = await prepareAdvancedExecution(
    input,
    credentials,
    async () => Response.json(status),
    () => 1000,
  )
  const approval = new AdvancedExecutionApproval(
    proposal,
    () => credentials,
    async (url) =>
      Response.json(
        url.endsWith('/status')
          ? status
          : {
              status: 'accepted',
              result: {
                status: 'accepted',
                connector_name: 'hyperliquid_perpetual',
                twap_id: '10',
                trading_pair: 'ETH-USD',
              },
            },
      ),
    () => 1000,
  )
  expect(await approval.approve()).toBe('unknown')
})

test('native creation refuses a narrower configured risk band without changing it', async () => {
  await expect(
    prepareAdvancedExecution(
      input,
      credentials,
      async () => Response.json({ ...status, maxPriceDeviationBps: 100 }),
      () => 1000,
    ),
  ).rejects.toThrow('at least 3%')
})
test('explicit account native permission allows preparation without widening ordinary risk', async () => {
  const proposal = await prepareAdvancedExecution(
    input,
    credentials,
    async () =>
      Response.json({
        ...status,
        maxPriceDeviationBps: 100,
        nativeTwapRiskAllowed: true,
      }),
    () => 1000,
  )
  expect(proposal.kind).toBe('hyperliquid-twap')
})

test('native cancellation is explicitly scoped and does not require creation risk acceptance', async () => {
  const proposal = await prepareAdvancedExecution(
    { kind: 'hyperliquid-twap-cancel', symbol: 'BTC-USDC', twapId: '10' },
    credentials,
    async () => Response.json({ ...status, maxPriceDeviationBps: 100 }),
    () => 1000,
  )
  let sent: unknown
  const approval = new AdvancedExecutionApproval(
    proposal,
    () => credentials,
    async (url, init) => {
      if (url.endsWith('/status')) return Response.json(status)
      sent = JSON.parse(String(init?.body))
      return Response.json({
        status: 'accepted',
        result: {
          status: 'accepted',
          connector_name: 'hyperliquid_perpetual',
          twap_id: '10',
          trading_pair: 'BTC-USD',
        },
      })
    },
    () => 1000,
  )
  expect(await approval.approve()).toBe('accepted')
  expect(sent).toMatchObject({
    action: 'cancel',
    twapId: '10',
    mode: 'live',
    connectionRevision: 'a'.repeat(64),
    credentialId: 'hl',
  })
  expect(sent).not.toHaveProperty('size')
})

test('managed Chase cancellation submits only the reviewed run in one approval', async () => {
  const runId = 'a8fa553a-857c-45f0-8258-b7bfa7bdd653'
  const proposal = await prepareAdvancedExecution(
    { kind: 'chase-cancel', venue: 'hyperliquid', symbol: 'BTC-USDC', runId },
    credentials,
    async () => Response.json(status),
    () => 1000,
  )
  let posts = 0
  const approval = new AdvancedExecutionApproval(
    proposal,
    () => credentials,
    async (url, init) => {
      if (url.endsWith('/status')) return Response.json(status)
      expect(url.endsWith('/chase-cancel')).toBe(true)
      expect(JSON.parse(String(init?.body))).toMatchObject({
        runId,
        venue: 'hyperliquid',
        mode: 'live',
      })
      posts++
      return Response.json({
        status: 'cancellation-requested',
        run: { id: runId, status: 'active' },
      })
    },
    () => 1000,
  )
  expect(await approval.approve()).toBe('registered')
  expect(await approval.approve()).toBe('registered')
  expect(posts).toBe(1)
})
