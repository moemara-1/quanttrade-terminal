import { afterEach, expect, test } from 'bun:test'
import { buildTradingTools, selectWorkflowRuns } from '../trading-tools'
import type { CopilotToolDeps } from '../tool-deps'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
const deps: CopilotToolDeps = {
  getCtx: () => null,
  getContextInfo: () => ({ market: 'lighter', pair: 'ZEC-USDC-USDC' }),
  getMarketData: () => {
    throw new Error('A status read must never execute a trade')
  },
  pluginManager: {} as CopilotToolDeps['pluginManager'],
  getChartSnapshot: () => null,
}
const readRuns = () =>
  (
    buildTradingTools(deps).get_workflow_runs as unknown as {
      execute: (
        input: Record<string, unknown>,
        context: unknown,
      ) => Promise<Record<string, unknown>>
    }
  ).execute({}, { toolCallId: 'read', messages: [] })

const run = (id: string) => ({
  id,
  status: 'paused',
  plan: { mode: 'live', input: { venue: 'lighter', symbol: 'ZEC-USDC' } },
  states: [{ nodeId: 'entry', status: 'waiting-fill', orderId: id }],
  graphState: { large: 'x'.repeat(40000) },
  graphOrders: { duplicate: 'x'.repeat(40000) },
})

test('default workflow read is bounded and declares omitted coverage', () => {
  const result = selectWorkflowRuns(
    Array.from({ length: 8 }, (_, i) => run(String(i))),
    {},
  )
  expect(result.runs.map((item) => item.id)).toEqual(['0', '1', '2', '3', '4'])
  expect(result.total).toBe(8)
  expect(result.truncated).toBe(true)
  expect(result.nextOffset).toBe(5)
  expect(JSON.stringify(result)).not.toContain('graphState')
  expect(result.runs[0]?.states).toEqual(run('0').states)
})

test('exact run read preserves original identity and evidence despite newer history', () => {
  const result = selectWorkflowRuns([run('new'), run('exact')], {
    runId: 'exact',
  })
  expect(result.runs).toHaveLength(1)
  expect(result.runs[0]?.id).toBe('exact')
  expect(result.matched).toBe(1)
  expect(result.truncated).toBe(false)
  expect(result.scope).toBe('exact-run')
  expect(result.runs[0]?.plan).toEqual(run('exact').plan)
})

test('pagination and size limits do not silently omit run evidence', () => {
  expect(
    selectWorkflowRuns([run('a'), run('b')], { offset: 1, limit: 1 }).runs[0]
      ?.id,
  ).toBe('b')
  const result = selectWorkflowRuns(
    [{ ...run('large'), states: [{ error: 'x'.repeat(25000) }] }],
    {},
  )
  expect(result.runs).toEqual([])
  expect(result.truncated).toBe(true)
  expect(result.oversizedRunIds).toEqual(['large'])
  expect(JSON.stringify(result).length).toBeLessThan(24000)
})

test('malformed and duplicate run evidence is unavailable rather than empty', () => {
  for (const value of [null, {}, [{}], [run('same'), run('same')]])
    expect(() => selectWorkflowRuns(value, {})).toThrow(
      'Workflow execution results could not be verified',
    )
})

test('failed network, malformed JSON and rejected reads never become an empty success', async () => {
  for (const failure of ['network', 'json', 'http']) {
    globalThis.fetch = (async () => {
      if (failure === 'network') throw new Error('Offline')
      return new Response(failure === 'json' ? '{' : '{}', {
        status: failure === 'http' ? 503 : 200,
      })
    }) as typeof fetch
    const result = await readRuns()
    expect(result.status).toBe('unavailable')
    expect(result.runs).toBeUndefined()
  }
})
