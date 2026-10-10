import { expect, test } from 'bun:test'
import { workflowRunStatus } from '../workflow-run-status'

const run = { id: 'reviewed-run', status: 'paused', error: 'Exchange credentials changed', plan: { mode: 'live', graph: { steps: [{ id: 'trigger', type: 'trigger' }, { id: 'entry', type: 'market-order' }, { id: 'sl', type: 'stop-loss' }] } }, states: [{ nodeId: 'trigger', status: 'executed' }, { nodeId: 'entry', status: 'pending' }, { nodeId: 'sl', status: 'executed', orderId: 'native-sl' }] }
test('paused graph shows pending entries and protective acknowledgment without claiming fill', () => {
  const status = workflowRunStatus([{ id: 'unrelated' }, run], 'reviewed-run')
  expect(status.summary).toContain('paused · 0 entry fills verified · 1 entries pending')
  expect(status.summary).toContain('Exchange credentials changed')
  expect(status.details[2]).toContain('protective submission recorded; fill not verified')
  expect(status.details[0]).toContain('no order submitted')
})
test('only reconciled live entry execution counts as a verified entry fill', () => {
  expect(workflowRunStatus([{ ...run, states: [run.states[0], { nodeId: 'entry', status: 'executed', orderId: 'entry-id' }, run.states[2]] }], run.id).summary).toContain('1 entry fills verified')
  expect(workflowRunStatus([{ ...run, plan: { mode: 'paper', graph: run.plan.graph } }], run.id).summary).toContain('0 entry fills verified')
})
test('missing, duplicate, malformed or inconsistent exact run cannot provide execution evidence', () => {
  for (const body of [null, [], [run, run], [{ ...run, status: 'unknown' }], [{ ...run, states: [{ status: 'executed', nodeId: 'missing' }] }]])
    expect(() => workflowRunStatus(body, run.id)).toThrow()
})
test('scheduled submission is not a verified fill', () => {
  const status = workflowRunStatus([{ id: run.id, status: 'completed', plan: { mode: 'live' }, states: [{ status: 'submitted', orderId: 'native' }] }], run.id)
  expect(status.summary).toContain('0 entry fills verified')
  expect(status.details[0]).toContain('fill not verified')
})
