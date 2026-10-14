import { z } from 'zod'
import type { WorkflowDSL } from '@pairlens/workflow-engine/types'
import type {
  ActivityIdentity,
  ActivityRow,
  ActivitySection,
} from './live-activity'
import { validateExchangeOperation } from '@/lib/copilot/exchange-operation'
import { quantTradeFetch } from '@/lib/plugins/quanttrade-session'
import { useWorkflowStore } from '@/stores/workflow-store'

type Request = (url: string, init?: RequestInit) => Promise<Response>
type Status = 'idle' | 'pending' | 'accepted' | 'blocked' | 'unknown'
const MAX_SNAPSHOT_AGE = 30000
function requireFresh(
  row: ActivityRow,
  section: ActivitySection,
  identity: ActivityIdentity | null,
  now: number,
) {
  if (
    !section.updatedAt ||
    section.stale ||
    section.error ||
    now < section.updatedAt ||
    now - section.updatedAt > MAX_SNAPSHOT_AGE ||
    !section.items.some((item) => item.id === row.id && item.kind === row.kind)
  )
    throw Error(
      'Refresh activity before reviewing this action; a fresh snapshot is required.',
    )
  if (
    !identity ||
    row.scopeMismatch ||
    row.accountName !== identity.accountName ||
    row.mode !== identity.venueModes[row.venue] ||
    (row.mode === 'live' &&
      (!row.connectionRevision ||
        row.connectionRevision !== identity.connectionRevisions[row.venue]))
  )
    throw Error(
      'This account or connection is historical. Refresh and review the current account.',
    )
}
/** The constructor only records a review. approve is the sole mutation boundary. */
export class ActivityApproval {
  status: Status = 'idle'
  error: string | null = null
  constructor(
    readonly proposal: Record<string, unknown>,
    private readonly path: string,
    private readonly preparedAt: number,
    private readonly now: () => number,
    private readonly request: Request,
    private readonly responseKind: 'operation' | 'run',
    private readonly expectedStatus?: string,
    private readonly expectedRunId?: string,
  ) {}
  async approve(): Promise<Status> {
    if (this.status !== 'idle') return this.status
    if (this.now() < this.preparedAt || this.now() - this.preparedAt > 180000) {
      this.status = 'blocked'
      this.error = 'Review expired. Refresh activity and prepare a new review.'
      return this.status
    }
    this.status = 'pending'
    try {
      const response = await quantTradeFetch(
        this.path,
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.proposal),
          signal: AbortSignal.timeout(30000),
        },
        this.request,
      )
      if (!response.ok) {
        this.status = [400, 401, 403, 404, 409, 422, 429].includes(
          response.status,
        )
          ? 'blocked'
          : 'unknown'
        this.error =
          this.status === 'blocked'
            ? `Action rejected (${response.status}). Refresh and review again; nothing is retried automatically.`
            : 'Outcome is uncertain. Refresh exchange and run state; this action will not be retried.'
        return this.status
      }
      const result: unknown = await response.json()
      if (this.responseKind === 'operation')
        z.object({ status: z.literal('accepted'), result: z.unknown() }).parse(
          result,
        )
      else {
        const run = z
          .object({
            id: z.string(),
            fingerprint: z.string(),
            status: z.string(),
          })
          .parse(result)
        if (
          run.fingerprint !== this.proposal.fingerprint ||
          run.id !== this.expectedRunId ||
          run.status !== this.expectedStatus
        )
          throw Error('Run change could not be verified')
      }
      this.status = 'accepted'
    } catch (cause) {
      this.status = 'unknown'
      this.error = `Outcome is uncertain. Refresh exchange and run state; this action will not be retried. ${cause instanceof Error ? cause.message : ''}`
    }
    return this.status
  }
}
export function prepareActivityOrderAction(
  row: ActivityRow,
  section: ActivitySection,
  identity: ActivityIdentity | null,
  action: 'cancel' | 'amend',
  changes?: { amount: string; price: string },
  now: () => number = Date.now,
  request: Request = fetch,
): ActivityApproval {
  const proposedAt = now()
  requireFresh(row, section, identity, proposedAt)
  if (row.kind !== 'order' || row.status !== 'open' || row.mode !== 'live')
    throw Error('Only a current open exchange order can be managed.')
  if (action === 'amend' && row.name.toLowerCase() !== 'limit')
    throw Error(
      'Only ordinary limit orders support this edit. Conditional and TWAP orders require their native controls.',
    )
  if (action === 'amend' && row.venue === 'lighter' && !row.totalSize)
    throw Error(
      'The original total quantity is unavailable. Refresh before editing this Lighter order.',
    )
  const input = validateExchangeOperation({
    action,
    venue: row.venue,
    marketType: row.marketType,
    symbol: row.symbol,
    exchangeOrderId: row.id,
    accountName: row.accountName,
    connectionRevision: row.connectionRevision,
    proposedAt,
    ...(action === 'amend' ? changes : {}),
  })
  return new ActivityApproval(
    { ...input, requestId: crypto.randomUUID(), mode: 'live' },
    '/_quanttrade/api/terminal/operations',
    proposedAt,
    now,
    request,
    'operation',
  )
}
export function prepareActivityRunAction(
  row: ActivityRow,
  section: ActivitySection,
  identity: ActivityIdentity | null,
  action: 'pause' | 'stop',
  now: () => number = Date.now,
  request: Request = fetch,
): ActivityApproval {
  const proposedAt = now()
  requireFresh(row, section, identity, proposedAt)
  if (
    row.kind !== 'workflow' ||
    !row.fingerprint ||
    !/^[a-f0-9]{64}$/.test(row.fingerprint) ||
    (action === 'pause'
      ? row.status !== 'active'
      : !['active', 'paused'].includes(row.status))
  )
    throw Error(
      'This run cannot perform the requested change. Refresh its current state.',
    )
  return new ActivityApproval(
    { fingerprint: row.fingerprint },
    `/_quanttrade/api/workflow-runs/${encodeURIComponent(row.id)}/${action === 'pause' ? 'pause' : 'cancel'}`,
    proposedAt,
    now,
    request,
    'run',
    action === 'pause' ? 'paused' : 'cancelled',
    row.id,
  )
}
/** Copy the immutable definition, not execution state. No server request or order is made. */
export function buildActivityWorkflowDraft(
  row: ActivityRow,
  now = Date.now(),
): WorkflowDSL {
  if (row.kind !== 'workflow' || !row.graph || !row.graph.steps.length)
    throw Error(
      'This run has no editable graph definition. Scheduled-order plans cannot be edited as graphs.',
    )
  const graph = structuredClone(row.graph)
  return {
    version: 1,
    id: crypto.randomUUID(),
    name: `Copy of ${row.name}`,
    description: `Fresh definition copied from run ${row.id}; it does not resume or alter that run. Review all sizing and protection before a fresh confirmation.${graph.oco ? ' Original uses OCO: enable native OCO when reviewing the new trade.' : ''}`,
    createdAt: now,
    updatedAt: now,
    steps: graph.steps.map((step, index) => ({
      ...step,
      position: step.position ?? { x: 250, y: 50 + index * 120 },
    })),
    edges: graph.edges,
  }
}
export function copyActivityWorkflowDraft(row: ActivityRow): string {
  const store = useWorkflowStore.getState()
  store.load()
  if (useWorkflowStore.getState().hasPendingChanges())
    throw Error(
      'Save or discard your current Builder edits before making a copy.',
    )
  const workflow = buildActivityWorkflowDraft(row)
  // Use the store's persisted editing lifecycle rather than writing its storage directly.
  const id = store.createWorkflow(workflow.name)
  store.startEditing(id)
  const draft = useWorkflowStore.getState().draft
  if (!draft) throw Error('The editable copy could not be created.')
  useWorkflowStore.setState({
    draft: {
      ...draft,
      baseSnapshot: {
        ...draft.baseSnapshot,
        description: workflow.description,
      },
    },
  })
  store.setSteps(workflow.steps)
  store.setEdges(workflow.edges)
  store.commitDraft()
  store.selectWorkflow(id)
  return id
}
