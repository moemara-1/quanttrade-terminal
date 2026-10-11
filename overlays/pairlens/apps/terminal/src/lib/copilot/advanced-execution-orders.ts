import { z } from 'zod'
import { recordTradeSubmission } from './trade-submissions'
import { assistantOrderAccount, assistantProposalMode } from './order-account'
import { quantTradeFetch } from '@/lib/plugins/quanttrade-session'
import { useCredentialsStore } from '@/stores/credentials-store'

const positive = z
  .string()
  .max(40)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .refine((value) => /[1-9]/.test(value), 'Must be positive')
const common = {
  credentialId: z.string().min(1).optional(),
  mode: z.literal('live').optional(),
  symbol: z.string().min(3).max(100),
  side: z.enum(['buy', 'sell']),
  size: positive,
  reduceOnly: z.boolean().default(false),
  leverage: z.number().int().min(1).max(125).optional(),
  marginMode: z.enum(['cross', 'isolated']).optional(),
}
const twap = z
  .object({
    ...common,
    kind: z.literal('hyperliquid-twap'),
    action: z.literal('create').default('create'),
    durationMinutes: z.number().int().min(5).max(10080),
    randomize: z.boolean().default(false),
    acceptNativeRisk: z.literal(true),
    referenceNotionalBudget: positive,
  })
  .strict()
const chase = z
  .object({
    ...common,
    kind: z.literal('chase'),
    venue: z.enum(['lighter', 'hyperliquid']),
    lowerPrice: positive,
    upperPrice: positive,
    durationSeconds: z.number().int().min(30).max(86400),
    intervalSeconds: z.number().int().min(10).max(300),
    maxAttempts: z.number().int().min(1).max(100),
    maxTotalNotional: positive,
    postOnly: z.boolean().default(true),
  })
  .strict()
const cancel = z
  .object({
    kind: z.literal('hyperliquid-twap-cancel'),
    action: z.literal('cancel').default('cancel'),
    symbol: z
      .string()
      .max(100)
      .regex(/^[A-Za-z0-9:_.]+-USDC$/),
    twapId: z.string().regex(/^[1-9]\d*$/),
    credentialId: z.string().min(1).optional(),
    mode: z.literal('live').optional(),
  })
  .strict()
const chaseCancel = z
  .object({
    kind: z.literal('chase-cancel'),
    venue: z.enum(['lighter', 'hyperliquid']),
    symbol: z
      .string()
      .max(100)
      .regex(/^[A-Za-z0-9:_.]+-USDC$/),
    runId: z.string().uuid(),
    credentialId: z.string().min(1).optional(),
    mode: z.literal('live').optional(),
  })
  .strict()
export const advancedExecutionInputSchema = z.discriminatedUnion('kind', [
  twap,
  chase,
  cancel,
  chaseCancel,
])
const identity = {
  requestId: z.string().uuid(),
  proposedAt: z.number().int().nonnegative(),
  credentialId: z.string().min(1),
  accountName: z.string().min(1),
  accountLabel: z.string().optional(),
  connectionRevision: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.literal('live'),
  marketType: z.literal('perpetual'),
}
const proposalSchema = z.discriminatedUnion('kind', [
  twap.extend({ ...identity, venue: z.literal('hyperliquid') }),
  chase.extend(identity),
  cancel.extend({ ...identity, venue: z.literal('hyperliquid') }),
  chaseCancel.extend(identity),
])
type Proposal = z.infer<typeof proposalSchema>
type Credential = { id: string; market: string; mode: string; label: string }
type Request = (url: string, init?: RequestInit) => Promise<Response>
const statusSchema = z.object({
  accountName: z.string().min(1),
  connectionRevisions: z.record(z.string(), z.string().nullable()),
  venueModes: z.record(z.string(), z.string()),
  maxPriceDeviationBps: z.number().optional(),
  nativeTwapRiskAllowed: z.boolean().optional(),
})
async function readStatus(request: Request, venue: string) {
  const response = await quantTradeFetch(
    '/_quanttrade/api/status',
    {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    },
    request,
  )
  if (!response.ok)
    throw new Error('Unable to verify live account. Nothing submitted.')
  const parsed = statusSchema.safeParse(await response.json())
  if (
    !parsed.success ||
    !/^[a-f0-9]{64}$/.test(parsed.data.connectionRevisions[venue] ?? '') ||
    parsed.data.venueModes[venue] !== 'live'
  )
    throw new Error(
      'Reconnect the live exchange in Connect Exchange; nothing submitted.',
    )
  return parsed.data
}
export async function prepareAdvancedExecution(
  raw: unknown,
  credentials: ReadonlyArray<Credential>,
  request: Request = fetch,
  now = Date.now,
): Promise<Proposal> {
  const input = advancedExecutionInputSchema.parse(raw)
  if (
    input.kind !== 'hyperliquid-twap-cancel' &&
    input.kind !== 'chase-cancel' &&
    (input.leverage !== undefined) !== (input.marginMode !== undefined)
  )
    throw new Error('Choose leverage and margin mode together.')
  const venue =
    input.kind === 'chase' || input.kind === 'chase-cancel'
      ? input.venue
      : 'hyperliquid'
  const mode = assistantProposalMode(
    credentials,
    venue,
    input.mode,
    input.credentialId,
  )
  if (mode !== 'live')
    throw new Error('This advanced exchange plan requires a live account.')
  const account = assistantOrderAccount(
    credentials,
    venue,
    mode,
    input.credentialId,
  )
  if (!account) throw new Error('Connect the exact live account first.')
  const status = await readStatus(request, venue)
  if (
    input.kind === 'hyperliquid-twap' &&
    status.nativeTwapRiskAllowed !== true &&
    (status.maxPriceDeviationBps ?? 0) < 300
  )
    throw new Error(
      'Native Hyperliquid TWAP requires permission for at least 3% slice slippage. Review Allow native TWAP 3% in Manage position and orders, or use managed TWAP. Nothing submitted.',
    )
  return proposalSchema.parse({
    ...input,
    venue,
    ...identityValues(
      account.id,
      account.label,
      status.accountName,
      status.connectionRevisions[venue],
      now(),
    ),
  })
}
function identityValues(
  credentialId: string,
  accountLabel: string,
  accountName: string,
  connectionRevision: string | null,
  proposedAt: number,
) {
  return {
    credentialId,
    accountLabel,
    accountName,
    connectionRevision,
    proposedAt,
    requestId: crypto.randomUUID(),
    mode: 'live',
    marketType: 'perpetual',
  }
}
export class AdvancedExecutionApproval {
  readonly proposal: Proposal
  status:
    | 'idle'
    | 'pending'
    | 'accepted'
    | 'registered'
    | 'blocked'
    | 'unknown' = 'idle'
  error: string | null = null
  evidence: string | null = null
  constructor(
    raw: unknown,
    private readonly credentials: () => ReadonlyArray<Credential> = () =>
      useCredentialsStore.getState().credentials,
    private readonly request: Request = fetch,
    private readonly now = Date.now,
  ) {
    this.proposal = proposalSchema.parse(raw)
  }
  async approve(): Promise<AdvancedExecutionApproval['status']> {
    if (this.status !== 'idle') return this.status
    this.status = 'pending'
    let posted = false
    try {
      const plan = this.proposal
      const status = await readStatus(this.request, plan.venue)
      assistantOrderAccount(
        this.credentials(),
        plan.venue,
        'live',
        plan.credentialId,
      )
      if (
        status.accountName !== plan.accountName ||
        status.connectionRevisions[plan.venue] !== plan.connectionRevision
      )
        throw new Error(
          'Reviewed exchange account changed. Prepare a fresh plan.',
        )
      if (this.now() < plan.proposedAt || this.now() - plan.proposedAt > 180000)
        throw new Error('Proposal expired. Prepare a fresh plan.')
      const { kind, accountLabel: _label, ...payload } = plan
      this.record('submitting')
      posted = true
      const response = await quantTradeFetch(
        `/_quanttrade/api/terminal/${kind === 'chase' ? 'chase-plans' : kind === 'chase-cancel' ? 'chase-cancel' : 'hyperliquid-twap'}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(35000),
          redirect: 'error',
        },
        this.request,
      )
      const body: unknown = await response.json()
      const rejected = z
        .object({ error: z.string(), submissionAttempted: z.literal(false) })
        .safeParse(body)
      if (!response.ok && rejected.success) {
        this.status = 'blocked'
        this.error = rejected.data.error
        this.record('blocked')
        return this.status
      }
      if (kind === 'chase-cancel' && plan.kind === 'chase-cancel') {
        const accepted = z
          .object({
            status: z.literal('cancellation-requested'),
            run: z.object({
              id: z.string(),
              status: z.enum(['active', 'paused', 'completed', 'cancelled']),
            }),
          })
          .safeParse(body)
        if (
          !response.ok ||
          !accepted.success ||
          accepted.data.run.id !== plan.runId
        )
          throw new Error(
            'Chase cancellation request uncertain; inspect the owned run before retry.',
          )
        this.status = 'registered'
        this.evidence = `${accepted.data.run.id} · cancellation requested · ${accepted.data.run.status}`
      } else if (kind === 'chase') {
        const accepted = z
          .object({
            status: z.literal('registered'),
            run: z.object({
              id: z.string(),
              status: z.enum(['active', 'paused', 'completed', 'cancelled']),
            }),
          })
          .safeParse(body)
        if (
          !response.ok ||
          !accepted.success ||
          accepted.data.run.id !== plan.requestId
        )
          throw new Error(
            'Chase registration outcome uncertain; inspect runs before another submission.',
          )
        this.status = 'registered'
        this.evidence = `${accepted.data.run.id} · ${accepted.data.run.status}`
      } else {
        const accepted = z
          .object({
            status: z.literal('accepted'),
            result: z.object({
              status: z.literal('accepted'),
              connector_name: z.literal('hyperliquid_perpetual'),
              twap_id: z.string().regex(/^[1-9]\d*$/),
              trading_pair: z.string(),
            }),
          })
          .safeParse(body)
        if (
          !response.ok ||
          !accepted.success ||
          accepted.data.result.trading_pair !==
            plan.symbol.replace(/-USDC$/, '-USD')
        )
          throw new Error(
            'Native TWAP acceptance uncertain; inspect Hyperliquid before another submission.',
          )
        if (
          plan.kind === 'hyperliquid-twap-cancel' &&
          accepted.data.result.twap_id !== plan.twapId
        )
          throw new Error(
            'Cancellation acknowledgment identity mismatch; inspect the venue.',
          )
        this.status = 'accepted'
        this.evidence = accepted.data.result.twap_id
      }
    } catch (cause) {
      this.status = posted ? 'unknown' : 'blocked'
      this.error =
        cause instanceof Error
          ? cause.message
          : 'Unable to verify advanced plan.'
      if (posted)
        this.error = `Submission outcome is uncertain. Inspect the venue and owned run before another trade; this request will not be retried. ${this.error}`
    }
    this.record(
      this.status === 'accepted' || this.status === 'registered'
        ? 'submitted'
        : this.status === 'unknown'
          ? 'unverified'
          : 'blocked',
    )
    return this.status
  }
  private record(
    status: 'submitting' | 'submitted' | 'unverified' | 'blocked',
  ) {
    recordTradeSubmission({
      clientOrderId: this.proposal.requestId,
      market: this.proposal.venue,
      pair: this.proposal.symbol,
      credentialId: this.proposal.credentialId,
      mode: 'live',
      status,
      recordedAt: this.now(),
      ...(this.error ? { error: this.error } : {}),
      ...(this.evidence ? { orderId: this.evidence } : {}),
    })
  }
}
