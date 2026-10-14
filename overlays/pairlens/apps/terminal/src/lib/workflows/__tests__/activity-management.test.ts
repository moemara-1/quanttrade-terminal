import { describe, expect, test } from 'bun:test'
import { parseOpenOrders, parseWorkflowRuns } from '../live-activity'
import {
  buildActivityWorkflowDraft,
  copyActivityWorkflowDraft,
  prepareActivityOrderAction,
  prepareActivityRunAction,
} from '../activity-management'
import type {
  ActivityIdentity,
  ActivityRow,
  ActivitySection,
} from '../live-activity'
import { useWorkflowStore } from '@/stores/workflow-store'

const now = 100000
const revision = 'a'.repeat(64)
const identity: ActivityIdentity = {
  accountName: 'desk',
  executionConfigured: true,
  venueModes: { lighter: 'live' },
  connectionRevisions: { lighter: revision },
  connections: [
    { venue: 'lighter', accountName: 'desk', connected: true, mode: 'live' },
  ],
}
const row: ActivityRow = {
  id: '14918173922809911',
  kind: 'order',
  name: 'limit',
  venue: 'lighter',
  marketType: 'perpetual',
  symbol: 'GRAM-USDC',
  accountName: 'desk',
  mode: 'live',
  connectionRevision: revision,
  status: 'open',
  steps: [],
  scopeMismatch: false,
}
const section: ActivitySection = {
  items: [row],
  warnings: [],
  loading: false,
  error: null,
  updatedAt: now,
  stale: false,
}
describe('activity management approvals', () => {
  test('parsers retain editable scope and total quantity without copying execution state into the graph', () => {
    const orders = parseOpenOrders(
      {
        venue: 'lighter',
        marketType: 'perpetual',
        accountName: 'desk',
        connectionRevision: revision,
        scope: 'all-perpetual-markets',
        complete: true,
        orders: [
          {
            exchangeOrderId: row.id,
            symbol: row.symbol,
            type: 'limit',
            size: '2',
            totalSize: '5',
          },
        ],
      },
      identity,
      'lighter',
      'perpetual',
    )
    expect(orders.items[0]).toMatchObject({
      connectionRevision: revision,
      totalSize: '5',
      size: '2',
    })
    const runs = parseWorkflowRuns(
      [
        {
          id: 'r',
          fingerprint: revision,
          startedAt: now,
          status: 'active',
          plan: {
            name: 'Plan',
            accountName: 'desk',
            mode: 'live',
            connectionRevision: revision,
            input: { venue: 'lighter', symbol: row.symbol },
            graph: {
              steps: [{ id: 'trigger', type: 'trigger', data: {} }],
              edges: [],
            },
          },
          states: [{ nodeId: 'trigger', status: 'executed' }],
        },
      ],
      identity,
    )
    expect(runs.items[0].fingerprint).toBe(revision)
    expect(runs.items[0].graph?.steps[0]).not.toHaveProperty('status')
  })
  test('run response must identify the exact reviewed run, even if plans match', async () => {
    const run = {
      ...row,
      kind: 'workflow' as const,
      id: 'run',
      status: 'active',
      fingerprint: revision,
    }
    let calls = 0
    const action = prepareActivityRunAction(
      run,
      { ...section, items: [run] },
      identity,
      'pause',
      () => now,
      async () => {
        calls++
        return Response.json({
          id: 'another-run',
          fingerprint: revision,
          status: 'paused',
        })
      },
    )
    expect(await action.approve()).toBe('unknown')
    await action.approve()
    expect(calls).toBe(1)
  })
  test('preparation sends nothing and explicit approval retains exact ID and scope', async () => {
    const calls: Array<Record<string, unknown>> = []
    const action = prepareActivityOrderAction(
      row,
      section,
      identity,
      'cancel',
      undefined,
      () => now,
      async (_url, init) => {
        calls.push(JSON.parse(String(init?.body)))
        return Response.json({ status: 'accepted', result: {} })
      },
    )
    expect(calls).toHaveLength(0)
    expect(await action.approve()).toBe('accepted')
    expect(calls[0]).toMatchObject({
      exchangeOrderId: row.id,
      accountName: 'desk',
      connectionRevision: revision,
      proposedAt: now,
      action: 'cancel',
    })
    await action.approve()
    expect(calls).toHaveLength(1)
  })
  test('stale and historical rows cannot prepare writes; TWAP amendments are not ordinary limit edits', () => {
    expect(() =>
      prepareActivityOrderAction(
        row,
        { ...section, stale: true },
        identity,
        'cancel',
        undefined,
        () => now,
      ),
    ).toThrow('fresh')
    expect(() =>
      prepareActivityOrderAction(
        { ...row, connectionRevision: 'b'.repeat(64) },
        section,
        identity,
        'cancel',
        undefined,
        () => now,
      ),
    ).toThrow('connection')
    expect(() =>
      prepareActivityOrderAction(
        { ...row, name: 'twap' },
        section,
        identity,
        'amend',
        { amount: '2', price: '1' },
        () => now,
      ),
    ).toThrow('limit')
  })
  test('known rejection is blocked while uncertain transport cannot be replayed', async () => {
    let calls = 0
    const blocked = prepareActivityOrderAction(
      row,
      section,
      identity,
      'cancel',
      undefined,
      () => now,
      async () => {
        calls++
        return new Response('Denied', { status: 409 })
      },
    )
    expect(await blocked.approve()).toBe('blocked')
    await blocked.approve()
    expect(calls).toBe(1)
    const unknown = prepareActivityOrderAction(
      row,
      section,
      identity,
      'cancel',
      undefined,
      () => now,
      async () => {
        throw Error('network')
      },
    )
    expect(await unknown.approve()).toBe('unknown')
  })
  test('expired confirmation sends no request', async () => {
    let time = now,
      calls = 0
    const action = prepareActivityOrderAction(
      row,
      section,
      identity,
      'cancel',
      undefined,
      () => time,
      async () => {
        calls++
        return Response.json({ status: 'accepted', result: {} })
      },
    )
    time += 180001
    expect(await action.approve()).toBe('blocked')
    expect(calls).toBe(0)
  })
  test('Lighter edits require total initial quantity rather than remaining size', () => {
    expect(() =>
      prepareActivityOrderAction(
        row,
        section,
        identity,
        'amend',
        { amount: '2', price: '1' },
        () => now,
      ),
    ).toThrow('total')
    const action = prepareActivityOrderAction(
      { ...row, totalSize: '5' },
      section,
      identity,
      'amend',
      { amount: '5', price: '1' },
      () => now,
    )
    expect(action.proposal.amount).toBe('5')
  })
  test('run management pins fingerprint and never resumes or touches exchange orders', async () => {
    let url = '',
      body: unknown
    const run = {
      ...row,
      kind: 'workflow' as const,
      id: 'run',
      status: 'active',
      fingerprint: revision,
    }
    const action = prepareActivityRunAction(
      run,
      { ...section, items: [run] },
      identity,
      'pause',
      () => now,
      async (path, init) => {
        url = path
        body = JSON.parse(String(init?.body))
        return Response.json({
          id: 'run',
          status: 'paused',
          fingerprint: revision,
        })
      },
    )
    expect(await action.approve()).toBe('accepted')
    expect(url).toBe('/_quanttrade/api/workflow-runs/run/pause')
    expect(body).toEqual({ fingerprint: revision })
  })
  test('copy creates a fresh editable definition and keeps the reviewed graph unchanged', () => {
    const graph = {
      oco: true,
      steps: [
        { id: 'trigger', type: 'trigger', data: {} },
        {
          id: 'entry',
          type: 'market-order',
          data: { side: 'buy', sizeMode: 'absolute', size: 2 },
        },
      ],
      edges: [{ id: 'e', source: 'trigger', target: 'entry' }],
    }
    const original = structuredClone(graph)
    const draft = buildActivityWorkflowDraft(
      { ...row, kind: 'workflow', graph },
      now,
    )
    expect(draft.id).not.toBe(row.id)
    expect(draft.steps[1].data.size).toBe(2)
    draft.steps[1].data.size = 3
    expect(graph).toEqual(original)
    expect(draft.description).toContain('fresh')
    expect(draft.description).toContain('OCO')
  })
  test('copy persists a new Builder draft without replacing the old definition', () => {
    useWorkflowStore.setState({ workflows: [], draft: null, loaded: true })
    const source = {
      ...row,
      kind: 'workflow' as const,
      graph: {
        oco: true,
        steps: [
          { id: 'trigger', type: 'trigger', data: {} },
          { id: 'order', type: 'market-order', data: { size: 1 } },
        ],
        edges: [{ id: 'e', source: 'trigger', target: 'order' }],
      },
    }
    const id = copyActivityWorkflowDraft(source)
    const saved = useWorkflowStore.getState().workflows[0]
    expect(saved.id).toBe(id)
    expect(saved.description).toContain('fresh confirmation')
    expect(saved.steps).toHaveLength(2)
    const before = structuredClone(saved)
    useWorkflowStore.getState().updateStepData('order', { size: 10 })
    expect(() => copyActivityWorkflowDraft(source)).toThrow('Save or discard')
    expect(useWorkflowStore.getState().workflows[0]).toEqual(before)
    useWorkflowStore.setState({ workflows: [], draft: null })
  })
})
