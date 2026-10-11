import { expect, test } from 'bun:test'
import {
  prepareAdvancedCancellation,
  readAdvancedExecutionStatus,
  readAdvancedProtectionStatus,
} from '../advanced-execution-status'
import { prepareAdvancedExecution } from '../advanced-execution-orders'

test('native evidence is pinned to original receipt and never executes an order', async () => {
  const live = { ...status, maxPriceDeviationBps: 300 }
  const plan = await prepareAdvancedExecution(
    {
      kind: 'hyperliquid-twap',
      symbol: 'BTC-USDC',
      side: 'buy',
      size: '1',
      durationMinutes: 5,
      randomize: false,
      acceptNativeRisk: true,
      referenceNotionalBudget: '100',
    },
    credentials,
    async () => Response.json(live),
  )
  const requests: Array<{ url: string; body?: unknown }> = []
  const result = await readAdvancedExecutionStatus(
    plan,
    '42',
    credentials,
    async (url, init) => {
      requests.push({
        url,
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      })
      return Response.json(
        url.endsWith('/status')
          ? live
          : { status: 'observed', filled_size: '0.5' },
      )
    },
  )
  expect(result.kind).toBe('native-twap')
  expect(requests[1]).toEqual({
    url: '/_quanttrade/api/terminal/hyperliquid-twap-evidence',
    body: {
      symbol: plan.symbol,
      twapId: '42',
      side: 'buy',
      size: '1',
      accountName: plan.accountName,
      connectionRevision: plan.connectionRevision,
      requestId: plan.requestId,
    },
  })
  expect(requests).toHaveLength(3)
})

const credentials = [
  { id: 'hl', market: 'hyperliquid', mode: 'live', label: 'Live' },
]
const status = {
  accountName: 'desk',
  connectionRevisions: { hyperliquid: 'a'.repeat(64) },
  venueModes: { hyperliquid: 'live' },
}
test('assistant protection read pins original identity and returns no raw secret fields or mutations', async () => {
  const scope = {
    requestId: crypto.randomUUID(),
    credentialId: 'hl',
    accountName: 'desk',
    connectionRevision: 'a'.repeat(64),
    venue: 'hyperliquid',
    symbol: 'BTC-USDC',
    side: 'buy',
    size: '1',
  }
  const calls: Array<string> = []
  const response = await readAdvancedProtectionStatus(
    scope,
    credentials,
    async (url, init) => {
      calls.push(`${init?.method} ${url}`)
      return Response.json(
        url.endsWith('/status')
          ? status
          : {
              run: {
                id: scope.requestId,
                input: scope,
                status: 'waiting-evidence',
                protectedSize: '0',
                spent: '0',
                fills: [{ size: '0.5' }],
                groups: [],
                entryStopped: false,
                entrySettled: false,
                secret: 'must not leak',
              },
            },
      )
    },
  )
  expect(response.uncoveredVerifiedEntrySize).toBe('0.5')
  expect(JSON.stringify(response)).not.toContain('secret')
  expect(calls).toEqual([
    'GET /_quanttrade/api/status',
    `GET /_quanttrade/api/advanced-protection?requestId=${scope.requestId}`,
    'GET /_quanttrade/api/status',
  ])
  await expect(
    readAdvancedProtectionStatus(
      { ...scope, connectionRevision: 'b'.repeat(64) },
      credentials,
      async () => Response.json(status),
    ),
  ).rejects.toThrow(/changed/)
})
test('bundled protection status is scoped to exact entry and does not imply fill or native OCO', async () => {
  const plan = await prepareAdvancedExecution(
    {
      kind: 'hyperliquid-twap',
      symbol: 'BTC-USDC',
      side: 'buy',
      size: '1',
      durationMinutes: 5,
      acceptNativeRisk: true,
      referenceNotionalBudget: '1000',
      protection: {
        stopLossPrice: '90',
        takeProfits: [{ price: '110', sizePercent: '100' }],
        maxExitNotional: '220',
      },
    },
    credentials,
    async () => Response.json({ ...status, maxPriceDeviationBps: 300 }),
  )
  for (const wrong of [false, true]) {
    const request = async (url: string) =>
      Response.json(
        url.endsWith('/status')
          ? status
          : url.includes('/advanced-protection?')
            ? {
                run: {
                  id: plan.requestId,
                  input: {
                    accountName: wrong ? 'other' : plan.accountName,
                    connectionRevision: plan.connectionRevision,
                    venue: plan.venue,
                    symbol: plan.symbol,
                    side: 'buy',
                    size: '1',
                  },
                  status: 'waiting-evidence',
                  protectedSize: '0',
                  spent: '0',
                  fills: [{ size: '0.5' }],
                  groups: [],
                  entryStopped: false,
                  entrySettled: false,
                  error: 'Partial entry remains unprotected',
                },
              }
            : { status: 'fills-observed', verified_fill_size: '0.5' },
      )
    if (wrong)
      await expect(
        readAdvancedExecutionStatus(plan, '42', credentials, request),
      ).rejects.toThrow(/does not match/)
    else {
      const result = await readAdvancedExecutionStatus(
        plan,
        '42',
        credentials,
        request,
      )
      expect(result.protection).toEqual({
        status: 'waiting-evidence',
        acceptedExitCoverageSize: '0',
        verifiedClosedSize: '0',
        uncoveredVerifiedEntrySize: '0.5',
        coverageMeaning:
          'Remaining allocation with accepted paired exit identities; not proof exits are currently active or filled.',
        submittedExitNotional: '0',
        groups: 0,
        entryStopped: false,
        entrySettled: false,
        error: 'Partial entry remains unprotected',
      })
    }
  }
})
async function chase() {
  return prepareAdvancedExecution(
    {
      kind: 'chase',
      venue: 'hyperliquid',
      symbol: 'BTC-USDC',
      side: 'buy',
      size: '1',
      lowerPrice: '90',
      upperPrice: '110',
      durationSeconds: 60,
      intervalSeconds: 10,
      maxAttempts: 3,
      maxTotalNotional: '330',
    },
    credentials,
    async () => Response.json(status),
  )
}
test('protection coverage excludes retired closed quantities and pending cancellation residuals', async () => {
  const plan = await prepareAdvancedExecution(
    {
      kind: 'chase',
      venue: 'hyperliquid',
      symbol: 'BTC-USDC',
      side: 'buy',
      size: '1',
      lowerPrice: '90',
      upperPrice: '110',
      durationSeconds: 60,
      intervalSeconds: 10,
      maxAttempts: 3,
      maxTotalNotional: '330',
      protection: {
        stopLossPrice: '80',
        takeProfits: [{ price: '120', sizePercent: '100' }],
        maxExitNotional: '400',
      },
    },
    credentials,
    async () => Response.json(status),
  )
  for (const cancelling of [false, true]) {
    const result = await readAdvancedExecutionStatus(
      plan,
      plan.requestId,
      credentials,
      async (url) =>
        Response.json(
          url.endsWith('/status')
            ? status
            : url.includes('/advanced-protection?')
              ? {
                  run: {
                    id: plan.requestId,
                    input: plan,
                    status: 'active',
                    protectedSize: '1',
                    spent: '300',
                    fills: [{ size: '1' }],
                    groups: [
                      {
                        size: '1',
                        retired: true,
                        exits: [
                          { id: 'old-tp', phase: 'settled', filledSize: '0.4' },
                          { id: 'old-sl', phase: 'settled', filledSize: '0' },
                        ],
                      },
                      {
                        size: '0.6',
                        exits: [
                          {
                            id: 'new-tp',
                            phase: cancelling ? 'cancelling' : 'open',
                            filledSize: '0',
                          },
                          { id: 'new-sl', phase: 'open', filledSize: '0' },
                        ],
                      },
                    ],
                    entryStopped: false,
                    entrySettled: true,
                  },
                }
              : {
                  runs: [
                    {
                      id: plan.requestId,
                      plan,
                      status: 'completed',
                      filledSize: '1',
                      spent: '100',
                      attempts: [],
                      stopRequested: false,
                    },
                  ],
                },
        ),
    )
    expect(result.protection?.verifiedClosedSize).toBe('0.4')
    expect(result.protection?.acceptedExitCoverageSize).toBe(
      cancelling ? '0' : '0.6',
    )
    expect(result.protection?.uncoveredVerifiedEntrySize).toBe(
      cancelling ? '0.6' : '0',
    )
  }
})
test('status returns only the exact owned Chase run and never mutates', async () => {
  const plan = await chase(),
    calls: Array<string> = []
  const result = await readAdvancedExecutionStatus(
    plan,
    plan.requestId,
    credentials,
    async (url, init) => {
      calls.push(`${init?.method} ${url}`)
      return Response.json(
        url.endsWith('/status')
          ? status
          : {
              runs: [
                { id: 'other', plan: {}, status: 'active' },
                {
                  id: plan.requestId,
                  plan,
                  status: 'active',
                  filledSize: '0.5',
                  spent: '90',
                  attempts: [],
                  stopRequested: false,
                },
              ],
            },
      )
    },
  )
  expect(result).toEqual({
    kind: 'chase',
    status: 'active',
    filledSize: '0.5',
    submittedNotional: '90',
    attempts: 0,
    cancellationRequested: false,
  })
  expect(calls).toEqual([
    'GET /_quanttrade/api/status',
    'GET /_quanttrade/api/chase-plans',
    'GET /_quanttrade/api/status',
  ])
})
test('cancellation creates a fresh review without sending cancellation', async () => {
  const plan = await chase(),
    calls: Array<string> = []
  const cancel = await prepareAdvancedCancellation(
    plan,
    plan.requestId,
    credentials,
    async (url, init) => {
      calls.push(`${init?.method} ${url}`)
      return Response.json(status)
    },
  )
  expect(cancel.kind).toBe('chase-cancel')
  expect(cancel.requestId).not.toBe(plan.requestId)
  expect(cancel.accountName).toBe(plan.accountName)
  expect(calls).toEqual([
    'GET /_quanttrade/api/status',
    'GET /_quanttrade/api/status',
  ])
})
test('changed account blocks before querying run evidence', async () => {
  const plan = await chase(),
    calls: Array<string> = []
  await expect(
    readAdvancedExecutionStatus(
      plan,
      plan.requestId,
      credentials,
      async (url) => {
        calls.push(url)
        return Response.json({ ...status, accountName: 'other' })
      },
    ),
  ).rejects.toThrow('changed')
  expect(calls).toHaveLength(1)
})
test('foreign run identity cannot be presented as reviewed status', async () => {
  const plan = await chase()
  await expect(
    readAdvancedExecutionStatus(
      plan,
      plan.requestId,
      credentials,
      async (url) =>
        Response.json(
          url.endsWith('/status')
            ? status
            : {
                runs: [
                  {
                    id: plan.requestId,
                    plan: { ...plan, connectionRevision: 'b'.repeat(64) },
                    status: 'active',
                    filledSize: '0',
                    spent: '0',
                    attempts: [],
                    stopRequested: false,
                  },
                ],
              },
        ),
    ),
  ).rejects.toThrow('identity')
})
