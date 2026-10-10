import { z } from 'zod'

const stateSchema = z.object({
  status: z.enum(['pending', 'waiting', 'waiting-fill', 'submitting', 'executed', 'skipped', 'failed', 'unverified', 'submitted', 'simulated']),
  nodeId: z.string().optional(), orderId: z.string().optional(), error: z.string().optional(),
})
const runSchema = z.object({
  id: z.string(), status: z.enum(['active', 'completed', 'paused', 'cancelled']), error: z.string().optional(),
  plan: z.object({ mode: z.enum(['paper', 'live']), graph: z.object({ steps: z.array(z.object({ id: z.string(), type: z.string() })) }).optional() }),
  states: z.array(stateSchema),
})

/** Exact-ID evidence only. Protective acknowledgment must never be labelled a fill. */
export function workflowRunStatus(body: unknown, id: string): { summary: string; details: Array<string> } {
  if (!Array.isArray(body)) throw new Error('Workflow execution results could not be verified.')
  const matches = body.filter((item) => z.object({ id: z.literal(id) }).safeParse(item).success)
  if (matches.length !== 1) throw new Error('This workflow run was not found uniquely; execution is unverified.')
  const parsed = runSchema.safeParse(matches[0])
  if (!parsed.success) throw new Error('Workflow execution results could not be verified.')
  const run = parsed.data
  const nodes = run.plan.graph?.steps
  if (nodes && (nodes.length !== run.states.length || new Set(nodes.map((node) => node.id)).size !== nodes.length || new Set(run.states.map((state) => state.nodeId)).size !== run.states.length || run.states.some((state) => !state.nodeId || !nodes.some((node) => node.id === state.nodeId))))
    throw new Error('Workflow node outcomes could not be verified.')
  const entries = run.states.filter((state) => {
    const type = nodes?.find((node) => node.id === state.nodeId)?.type
    return nodes ? type === 'market-order' || type === 'limit-order' : true
  })
  const filled = nodes && run.plan.mode === 'live' ? entries.filter((state) => state.status === 'executed').length : 0
  const pending = entries.filter((state) => ['pending', 'waiting', 'waiting-fill', 'submitting'].includes(state.status)).length
  const details = run.states.map((state, index) => {
    const type = nodes?.find((node) => node.id === state.nodeId)?.type
    const label = state.nodeId ?? `Order ${index + 1}`
    const status = state.status === 'executed'
      ? type === 'take-profit' || type === 'stop-loss' ? 'protective submission recorded; fill not verified'
        : type === 'market-order' || type === 'limit-order' ? run.plan.mode === 'live' ? 'entry filled' : 'paper simulation recorded'
          : 'step completed; no order submitted'
      : state.status === 'submitted' ? 'submission recorded; fill not verified' : state.status
    return `${label}: ${status}${state.orderId ? ` · exchange order ${state.orderId}` : ''}${state.error ? ` · ${state.error}` : ''}`
  })
  return { summary: `${run.status} · ${filled} entry fills verified · ${pending} entries pending${run.error ? ` · ${run.error}` : ''}`, details }
}
