import { expect, test } from 'bun:test'
import {
  prepareAdvancedCancellation,
  readAdvancedExecutionStatus,
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
