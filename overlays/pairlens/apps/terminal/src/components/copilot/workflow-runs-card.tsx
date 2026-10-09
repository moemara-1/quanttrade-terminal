import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@pairlens/ui/components/ui/button'
import { quantTradeFetch } from '@/lib/plugins/quanttrade-session'

const runsSchema = z.array(z.object({ id: z.string(), status: z.string(), error: z.string().optional(), plan: z.object({ name: z.string(), mode: z.enum(['paper', 'live']) }), states: z.array(z.object({ status: z.string(), orderId: z.string().optional(), error: z.string().optional() })) }))
/** Read evidence and explicit cancellation remain available after a page reload. */
export function WorkflowRunsCard({ runs }: { runs: unknown }) {
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  const parsed = runsSchema.safeParse(runs)
  if (!parsed.success) return <p>Workflow results could not be verified.</p>
  if (!parsed.data.length) return <p>No confirmed server workflows. Saved definitions do not start orders.</p>
  return <div>{parsed.data.map((run) => <div key={run.id}>
    <p>{run.plan.name} · {run.plan.mode} · {run.status} · {run.id}</p>
    <ol>{run.states.map((step, index) => <li key={index}>{index + 1}. {step.status}{step.orderId ? ` · ${step.orderId}` : ''}{step.error ? ` · ${step.error}` : ''}</li>)}</ol>
    {run.error && <p>{run.error}</p>}
    {run.status === 'active' && <Button variant="outline" size="sm" onClick={async () => {
      try {
        const response = await quantTradeFetch(`/_quanttrade/api/workflow-runs/${encodeURIComponent(run.id)}/cancel`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        if (!response.ok) throw new Error(`Stop unverified (HTTP ${response.status}). Check runs again.`)
        setFeedback((previous) => ({ ...previous, [run.id]: 'Future steps cancelled; existing exchange orders and positions are unchanged.' }))
      } catch (cause) { setFeedback((previous) => ({ ...previous, [run.id]: cause instanceof Error ? cause.message : 'Stop unverified.' })) }
    }}>Stop future workflow steps</Button>}
    {feedback[run.id] && <p>{feedback[run.id]}</p>}
  </div>)}</div>
}
