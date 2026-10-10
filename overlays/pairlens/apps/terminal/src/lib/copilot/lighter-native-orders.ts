import { z } from 'zod'
import { recordTradeSubmission } from './trade-submissions'
import { assistantOrderAccount, assistantProposalMode } from './order-account'
import { quantTradeFetch } from '@/lib/plugins/quanttrade-session'
import { useCredentialsStore } from '@/stores/credentials-store'

const decimal = z
  .string()
  .max(40)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
const positive = decimal.refine(
  (value) => /[1-9]/.test(value),
  'Must be positive',
)
const legSchema = z
  .object({
    side: z.enum(['buy', 'sell']),
    type: z.enum([
      'market',
      'limit',
      'sl-market',
      'sl-limit',
      'tp-market',
      'tp-limit',
      'twap',
    ]),
    amount: decimal,
    price: positive,
    triggerPrice: positive.optional(),
    reduceOnly: z.boolean(),
    timeInForce: z.enum(['ioc', 'gtt', 'post-only']),
    expiry: z.number().int().positive().optional(),
    durationSeconds: z.number().int().min(300).max(2592000).optional(),
  })
  .strict()
const planFields = {
  symbol: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[A-Za-z0-9:_.]+-[A-Za-z0-9:_.]+$/),
  grouping: z.enum(['single', 'oto', 'oco', 'otoco']),
  legs: z.array(legSchema).min(1).max(3),
  leverage: z.number().int().min(1).max(125).optional(),
  marginMode: z.enum(['cross', 'isolated']).optional(),
  positionSize: positive.optional(),
}
export const lighterNativeOrderInputSchema = z
  .object({
    ...planFields,
    credentialId: z.string().min(1).optional(),
    mode: z.enum(['live', 'paper']).optional(),
  })
  .strict()
const proposalSchema = z
  .object({
    ...planFields,
    requestId: z.string().uuid(),
    proposedAt: z.number().int().nonnegative(),
    credentialId: z.string().min(1),
    connectionRevision: z.string().regex(/^[a-f0-9]{64}$/),
    accountName: z.string().min(1),
    accountLabel: z.string().optional(),
    mode: z.literal('live'),
    venue: z.literal('lighter'),
    marketType: z.literal('perpetual'),
  })
  .strict()
export type LighterNativeOrderProposal = z.infer<typeof proposalSchema>
type Credential = { id: string; market: string; mode: string; label: string }
type Request = (url: string, init?: RequestInit) => Promise<Response>
const statusSchema = z.object({
  accountName: z.string().min(1),
  connectionRevisions: z.object({
    lighter: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  venueModes: z.object({ lighter: z.literal('live') }),
})
const conditional = (type: string) =>
  type.startsWith('tp-') || type.startsWith('sl-')
function validatePlan(
  plan:
    | z.infer<typeof proposalSchema>
    | z.infer<typeof lighterNativeOrderInputSchema>,
) {
  if ((plan.leverage !== undefined) !== (plan.marginMode !== undefined))
    throw new Error('Choose leverage and margin mode together.')
  if (
    plan.legs.length !== { single: 1, oto: 2, oco: 2, otoco: 3 }[plan.grouping]
  )
    throw new Error('Native grouping has the wrong number of legs.')
  for (const [index, leg] of plan.legs.entries()) {
    if (conditional(leg.type) !== (leg.triggerPrice !== undefined))
      throw new Error(
        'Conditional orders require a trigger price; regular orders cannot have one.',
      )
    if ((leg.type === 'twap') !== (leg.durationSeconds !== undefined))
      throw new Error(
        'TWAP requires a reviewed duration; other order types cannot have one.',
      )
    if (leg.type === 'twap' && plan.grouping !== 'single')
      throw new Error('Native TWAP cannot be grouped with child orders.')
    if (
      leg.timeInForce === 'post-only' &&
      !['limit', 'sl-limit', 'tp-limit'].includes(leg.type)
    )
      throw new Error('Post-only requires a limit order.')
    if (!/[1-9]/.test(leg.amount)) {
      const linked = ['oto', 'otoco'].includes(plan.grouping) && index > 0
      if (
        !conditional(leg.type) ||
        !leg.reduceOnly ||
        (!linked && !(plan.grouping === 'oco' && plan.positionSize))
      )
        throw new Error(
          'Zero amount requires explicit entry-linked protection or a reviewed position size for position OCO.',
        )
    }
  }
  if (['oto', 'otoco'].includes(plan.grouping)) {
    const [entry, ...children] = plan.legs
    if (
      !['market', 'limit'].includes(entry.type) ||
      entry.reduceOnly ||
      children.some(
        (leg) =>
          !conditional(leg.type) || !leg.reduceOnly || leg.side === entry.side,
      )
    )
      throw new Error(
        'Entry groups require an opening entry and opposite-side reduce-only conditional children.',
      )
  }
  if (plan.grouping === 'oco' || plan.grouping === 'otoco') {
    const exits = plan.grouping === 'oco' ? plan.legs : plan.legs.slice(1)
    if (
      !exits.every((leg) => conditional(leg.type) && leg.reduceOnly) ||
      exits[0].side !== exits[1].side ||
      exits[0].type.startsWith('tp-') === exits[1].type.startsWith('tp-')
    )
      throw new Error(
        'OCO requires opposite TP/SL types closing the same position side.',
      )
  }
  if (plan.positionSize && plan.grouping !== 'oco')
    throw new Error('Reviewed position size is only used for position OCO.')
}
export function parseLighterNativeOrder(
  raw: unknown,
): LighterNativeOrderProposal {
  const proposal = proposalSchema.parse(raw)
  validatePlan(proposal)
  return proposal
}
async function verifiedStatus(
  request: Request,
  accountName?: string,
  connectionRevision?: string,
) {
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
    throw new Error(
      'Unable to verify the hosted live account. Nothing was submitted.',
    )
  const status = statusSchema.parse(await response.json())
  if (accountName && status.accountName !== accountName)
    throw new Error(
      'The hosted account changed. Prepare a new native proposal.',
    )
  if (
    connectionRevision &&
    status.connectionRevisions.lighter !== connectionRevision
  )
    throw new Error(
      'The Lighter credentials changed after review. Prepare a new native proposal.',
    )
  return status
}
/** Preparation performs account reads only; no trading endpoint is called. */
export async function prepareLighterNativeOrder(
  raw: unknown,
  credentials: ReadonlyArray<Credential>,
  request: Request = (url, init) => fetch(url, init),
  now: () => number = Date.now,
): Promise<LighterNativeOrderProposal> {
  const input = lighterNativeOrderInputSchema.parse(raw)
  validatePlan(input)
  const mode = assistantProposalMode(
    credentials,
    'lighter',
    input.mode,
    input.credentialId,
  )
  if (mode !== 'live')
    throw new Error(
      'Native Lighter orders require a live account. Paper simulation is not a native exchange order.',
    )
  const account = assistantOrderAccount(
    credentials,
    'lighter',
    mode,
    input.credentialId,
  )
  if (!account) throw new Error('Connect the exact live Lighter account first.')
  const status = await verifiedStatus(request)
  const { mode: unusedMode, credentialId: unusedId, ...plan } = input
  return parseLighterNativeOrder({
    ...plan,
    requestId: crypto.randomUUID(),
    proposedAt: now(),
    mode,
    venue: 'lighter',
    marketType: 'perpetual',
    credentialId: account.id,
    connectionRevision: status.connectionRevisions.lighter,
    accountName: status.accountName,
    accountLabel: account.label,
  })
}
const evidenceSchema = z.object({
  grouping: z.enum(['single', 'oto', 'oco', 'otoco']),
  connector_name: z.literal('lighter_perpetual'),
  trading_pair: z.string().min(3),
  status: z.literal('accepted'),
  tx_hash: z.string().min(1),
  client_order_ids: z.array(z.string().regex(/^[1-9]\d*$/)).min(1),
})
export class LighterNativeOrderApproval {
  readonly proposal: LighterNativeOrderProposal
  status: 'idle' | 'pending' | 'accepted' | 'blocked' | 'unknown' = 'idle'
  error: string | null = null
  evidence: { txHash?: string; orderIds?: Array<string> } | null = null
  constructor(
    raw: unknown,
    private readonly credentials: () => ReadonlyArray<Credential> = () =>
      useCredentialsStore.getState().credentials,
    private readonly request: Request = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {
    this.proposal = parseLighterNativeOrder(raw)
  }
  async approve(): Promise<LighterNativeOrderApproval['status']> {
    if (this.status !== 'idle') return this.status
    this.status = 'pending'
    let posted = false
    try {
      const age = this.now() - this.proposal.proposedAt
      if (age < 0 || age > 180000)
        throw new Error('This proposal expired. Prepare a fresh native order.')
      assistantOrderAccount(
        this.credentials(),
        'lighter',
        'live',
        this.proposal.credentialId,
      )
      await verifiedStatus(
        this.request,
        this.proposal.accountName,
        this.proposal.connectionRevision,
      )
      // Check again after the asynchronous read, before crossing the execution boundary.
      assistantOrderAccount(
        this.credentials(),
        'lighter',
        'live',
        this.proposal.credentialId,
      )
      if (this.now() - this.proposal.proposedAt > 180000)
        throw new Error('This proposal expired. Prepare a fresh native order.')
      this.record('submitting')
      posted = true
      const response = await this.request(
        '/_quanttrade/api/terminal/lighter-native-orders',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.proposal),
          signal: AbortSignal.timeout(35000),
          redirect: 'error',
        },
      )
      const body: unknown = await response.json()
      const rejection = z
        .object({
          error: z.string().min(1).max(1000),
          submissionAttempted: z.literal(false),
        })
        .safeParse(body)
      if (!response.ok && rejection.success) {
        this.status = 'blocked'
        this.error = Array.from(rejection.data.error, (char) =>
          char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char,
        )
          .join('')
          .trim()
        this.record('blocked')
        return this.status
      }
      const envelope = z
        .object({ status: z.literal('accepted'), result: evidenceSchema })
        .safeParse(body)
      if (
        !response.ok ||
        !envelope.success ||
        envelope.data.result.grouping !== this.proposal.grouping ||
        envelope.data.result.trading_pair !== this.proposal.symbol ||
        envelope.data.result.client_order_ids.length !==
          this.proposal.legs.length ||
        new Set(envelope.data.result.client_order_ids).size !==
          this.proposal.legs.length
      )
        throw new Error(
          'Native submission was not verified. Inspect Lighter before preparing another order.',
        )
      this.evidence = {
        ...(envelope.data.result.tx_hash
          ? { txHash: envelope.data.result.tx_hash }
          : {}),
        ...(envelope.data.result.client_order_ids
          ? { orderIds: envelope.data.result.client_order_ids }
          : {}),
      }
      this.status = 'accepted'
      this.record('submitted')
    } catch (cause) {
      this.status = posted ? 'unknown' : 'blocked'
      this.error = posted
        ? 'Submission outcome is uncertain. Check Lighter orders and fills; this request will not be retried.'
        : cause instanceof Error
          ? cause.message
          : 'The reviewed live account could not be verified. Nothing was submitted.'
    }
    if (this.status === 'unknown' || this.status === 'blocked')
      this.record(this.status === 'unknown' ? 'unverified' : 'blocked')
    return this.status
  }
  private record(
    status: 'submitting' | 'submitted' | 'unverified' | 'blocked',
  ): void {
    recordTradeSubmission({
      clientOrderId: this.proposal.requestId,
      market: 'lighter',
      pair: this.proposal.symbol,
      mode: 'live',
      credentialId: this.proposal.credentialId,
      recordedAt: this.now(),
      status,
      ...(this.error ? { error: this.error } : {}),
      ...(status === 'submitted' && this.evidence
        ? {
            nativeClientOrderIds: this.evidence.orderIds,
            txHash: this.evidence.txHash,
          }
        : {}),
    })
  }
}
