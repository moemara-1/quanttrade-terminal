import { afterEach, expect, test } from 'bun:test'
import { submitReviewedWorkflow } from '../submit-reviewed-workflow'
import { approvedWorkflowSchema } from '../trading-tools'
import type { CopilotOrderRequest } from '@/components/copilot/copilot-order-card'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
const request = (): CopilotOrderRequest => ({ market: 'lighter', pair: 'PRL-USDC-USDC', mode: 'live', credentialId: 'lt-main', clientOrderId: 'reviewed-plan', proposedAt: Date.now(), side: 'buy', type: 'market', size: 48, workflow: { name: 'PRL DCA', maxTotalNotional: '600', steps: Array.from({ length: 8 }, (_, index) => ({ delaySeconds: index * 10800, side: 'buy', type: 'market', exactSize: '48', leverage: 3, marginMode: 'cross' })) } })
test('one approval forwards all eight exact DCA legs and does not submit an entry separately', async () => {
  const urls: Array<string> = []; let sent: unknown
  globalThis.fetch = (async (input, init) => {
    const url = String(input); urls.push(url)
    if (url.endsWith('/status')) return Response.json({ accountName: 'desk' })
    sent = JSON.parse(String(init?.body)); return Response.json({ id: 'reviewed-plan', status: 'active' })
  }) as typeof fetch
  expect(await submitReviewedWorkflow(request(), 'live')).toEqual({ success: true, orderId: 'reviewed-plan' })
  expect(urls).toEqual(['/_quanttrade/api/status', '/_quanttrade/api/workflow-runs'])
  expect(sent).toMatchObject({ plan: { mode: 'live', maxTotalNotional: '600' } })
  expect((sent as { plan: { steps: Array<unknown> } }).plan.steps[0]).toMatchObject({ delaySeconds: 0, order: { venue: 'lighter', symbol: 'PRL-USDC', size: '48', leverage: 3, marginMode: 'cross' } })
  expect((sent as { plan: { steps: Array<unknown> } }).plan.steps).toHaveLength(8)
})
test('expired and changed-mode plans fail before any registration', async () => {
  let calls = 0; globalThis.fetch = (() => { calls++; throw new Error('No requests allowed') }) as typeof fetch
  await expect(submitReviewedWorkflow({ ...request(), proposedAt: Date.now() - 180001 }, 'live')).rejects.toThrow('expired')
  await expect(submitReviewedWorkflow(request(), 'paper')).rejects.toThrow('reviewed account')
  expect(calls).toBe(0)
})
test('workflow schema refuses unordered, missing-price and incompatible margin steps', () => {
  const workflow = request().workflow!
  for (const steps of [[{ ...workflow.steps[0], type: 'limit' }], [{ ...workflow.steps[0], marginMode: undefined }], [{ ...workflow.steps[0], delaySeconds: 10 }, workflow.steps[0]]])
    expect(approvedWorkflowSchema.safeParse({ ...workflow, steps }).success).toBe(false)
})
