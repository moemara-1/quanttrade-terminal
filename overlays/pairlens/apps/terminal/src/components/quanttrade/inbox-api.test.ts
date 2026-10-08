import { afterEach, describe, expect, test } from 'bun:test'
import {
  canApproveProposal,
  canCancelProposal,
  inboxProposalSchema,
  inboxRequest,
} from './inbox-api'
import type { InboxProposal, InboxStatus } from './inbox-api'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
const proposal: InboxProposal = {
  id: '159a2a01-e205-4c3b-bab4-36fc4ea11b3a',
  accountName: 'desk',
  source: 'agent',
  mode: 'live',
  status: 'pending',
  createdAt: 10,
  expiresAt: 100,
  referencePrice: '60000',
  estimatedNotional: '60',
  order: {
    venue: 'hyperliquid',
    symbol: 'BTC-USDC',
    side: 'buy',
    type: 'limit',
    size: '0.001',
    price: '60000',
    rationale: 'Test',
  },
}
const status: InboxStatus = {
  accountName: 'desk',
  mode: 'live',
  halted: false,
  executionConfigured: true,
  maxOrderNotional: '1000',
  dailyNotionalLimit: '5000',
  dailyNotionalUsed: '0',
}
describe('agent inbox approval availability', () => {
  test('cancellation requires an open order in the current account and mode', () => {
    const live = {
      ...proposal,
      status: 'submitted' as const,
      orderId: 'order-1',
    }
    expect(canCancelProposal(live, status)).toBe(true)
    expect(canCancelProposal(live, { ...status, halted: true })).toBe(true)
    expect(canCancelProposal(live, { ...status, accountName: 'other' })).toBe(
      false,
    )
    expect(canCancelProposal(live, { ...status, mode: 'paper' })).toBe(false)
    expect(
      canCancelProposal(live, { ...status, executionConfigured: false }),
    ).toBe(false)
    expect(canCancelProposal({ ...live, orderId: undefined }, status)).toBe(
      false,
    )
    for (const state of [
      'pending',
      'unknown',
      'cancel-requested',
      'cancelled',
    ] as const) {
      expect(canCancelProposal({ ...live, status: state }, status)).toBe(false)
    }
    const paper = {
      ...proposal,
      mode: 'paper' as const,
      status: 'paper-open' as const,
    }
    const paperStatus = {
      ...status,
      mode: 'paper' as const,
      executionConfigured: false,
    }
    expect(canCancelProposal(paper, paperStatus)).toBe(true)
    expect(canCancelProposal(paper, status)).toBe(false)
    expect(
      canCancelProposal(paper, { ...paperStatus, accountName: 'other' }),
    ).toBe(false)
    expect(
      canCancelProposal({ ...paper, status: 'paper-filled' }, paperStatus),
    ).toBe(false)
  })
  test('cancellation sends one explicit request and retains the acknowledgement status', async () => {
    let calls = 0
    let requestUrl = ''
    let requestMethod: string | undefined
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, options?: RequestInit) => {
        calls++
        requestUrl = String(input)
        requestMethod = options?.method
        return Response.json({ ...proposal, status: 'cancel-requested' })
      },
      { preconnect: originalFetch.preconnect },
    )
    const result = inboxProposalSchema.parse(
      await inboxRequest('operator', `/proposals/${proposal.id}/cancel`, true),
    )
    expect(result.status).toBe('cancel-requested')
    expect(requestUrl).toBe(`/_quanttrade/api/proposals/${proposal.id}/cancel`)
    expect(requestMethod).toBe('POST')
    expect(calls).toBe(1)
  })
  test('allows only pending unexpired matching account/mode with execution ready', () => {
    expect(canApproveProposal(proposal, status, 50)).toBe(true)
    expect(canApproveProposal(proposal, status, 100)).toBe(false)
    expect(canApproveProposal(proposal, { ...status, halted: true }, 50)).toBe(
      false,
    )
    expect(
      canApproveProposal(proposal, { ...status, accountName: 'other' }, 50),
    ).toBe(false)
    expect(canApproveProposal(proposal, { ...status, mode: 'paper' }, 50)).toBe(
      false,
    )
    expect(
      canApproveProposal(
        proposal,
        { ...status, executionConfigured: false },
        50,
      ),
    ).toBe(false)
    expect(
      canApproveProposal({ ...proposal, status: 'unknown' }, status, 50),
    ).toBe(false)
  })
  test('paper approval does not need live credentials', () => {
    expect(
      canApproveProposal(
        { ...proposal, mode: 'paper' },
        { ...status, mode: 'paper', executionConfigured: false },
        50,
      ),
    ).toBe(true)
  })
  test('rejects malformed proposal responses', () => {
    expect(
      inboxProposalSchema.safeParse({
        ...proposal,
        order: { ...proposal.order, venue: 'other' },
      }).success,
    ).toBe(false)
  })
  test('sends explicit approval to same-origin bridge with operator token and no order rewrite', async () => {
    let url: string | undefined
    let init: RequestInit | undefined
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, options?: RequestInit) => {
        url = String(input)
        init = options
        return Response.json(proposal)
      },
      { preconnect: originalFetch.preconnect },
    )
    await inboxRequest(
      'test-operator',
      `/proposals/${proposal.id}/approve`,
      true,
    )
    expect(url).toBe(`/_quanttrade/api/proposals/${proposal.id}/approve`)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{}')
    expect(init?.headers).toEqual({
      Authorization: 'Bearer test-operator',
      'Content-Type': 'application/json',
    })
  })
  test('surfaces bridge rejection without retries', async () => {
    let calls = 0
    globalThis.fetch = Object.assign(
      async () => {
        calls++
        return Response.json(
          { error: 'Human approval required' },
          { status: 403 },
        )
      },
      { preconnect: originalFetch.preconnect },
    )
    await expect(
      inboxRequest('agent', '/proposals/example/approve', true),
    ).rejects.toThrow('Human approval required')
    expect(calls).toBe(1)
  })
  test('hosted approval uses the browser session without an operator token', async () => {
    let init: RequestInit | undefined
    globalThis.fetch = Object.assign(
      async (_input: RequestInfo | URL, options?: RequestInit) => {
        init = options
        return Response.json(proposal)
      },
      { preconnect: originalFetch.preconnect },
    )
    await inboxRequest('', `/proposals/${proposal.id}/approve`, true)
    expect(init?.credentials).toBe('same-origin')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
  })
})
