import { z } from 'zod'
import { approvedWorkflowSchema } from './trading-tools'
import type { CopilotOrderRequest, OrderOutcome } from '@/components/copilot/copilot-order-card'
import { quantTradeFetch } from '@/lib/plugins/quanttrade-session'

/** This endpoint registers an immutable plan only after the chat card's human gate. */
export async function submitReviewedWorkflow(request: CopilotOrderRequest, mode: 'paper' | 'live'): Promise<OrderOutcome> {
  const workflow = approvedWorkflowSchema.parse(request.workflow)
  if (!request.clientOrderId || !request.proposedAt || request.mode !== mode || !request.credentialId)
    throw new Error('Workflow needs a fresh reviewed account, mode and approval ID.')
  if (request.proposedAt > Date.now() || Date.now() - request.proposedAt > 180000)
    throw new Error('Workflow approval expired; prepare a fresh plan.')
  if (!['lighter', 'lighter-spot', 'hyperliquid', 'hyperliquid-spot'].includes(request.market))
    throw new Error('This venue does not support approved server workflows.')
  const statusResponse = await quantTradeFetch('/_quanttrade/api/status', { credentials: 'same-origin' })
  if (!statusResponse.ok) throw new Error(`Cannot verify workflow execution account (HTTP ${statusResponse.status}).`)
  const status = z.object({ accountName: z.string().min(1) }).parse(await statusResponse.json())
  const marketType = request.market.endsWith('-spot') ? 'spot' : 'perpetual'
  const venue = request.market.startsWith('lighter') ? 'lighter' : 'hyperliquid'
  const symbol = marketType === 'perpetual' ? request.pair.replace(/-USDC-USDC$/, '-USDC') : request.pair
  const response = await quantTradeFetch('/_quanttrade/api/workflow-runs', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientOrderId: request.clientOrderId, proposedAt: request.proposedAt,
      plan: { name: workflow.name, mode, accountName: status.accountName, maxTotalNotional: workflow.maxTotalNotional,
        steps: workflow.steps.map(({ delaySeconds, exactSize, exactPrice, ...controls }) => ({ delaySeconds, order: {
          ...controls, venue, marketType, symbol, size: exactSize,
          ...(exactPrice ? { price: exactPrice } : {}), rationale: request.reason || workflow.name,
        } })),
      },
    }), signal: AbortSignal.timeout(35000),
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    const failure = z.object({ error: z.string() }).safeParse(body)
    throw new Error(failure.success ? failure.data.error : `Workflow registration unverified (HTTP ${response.status}); check runs before preparing another plan.`)
  }
  const run = z.object({ id: z.string(), status: z.enum(['active', 'completed', 'paused', 'cancelled']) }).parse(body)
  if (run.status !== 'active' && run.status !== 'completed') throw new Error(`Workflow ${run.id} is ${run.status}; no retry started.`)
  return { success: true, orderId: run.id }
}
