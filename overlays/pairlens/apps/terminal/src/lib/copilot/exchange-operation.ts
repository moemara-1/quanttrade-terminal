import { z } from 'zod'
import { quantTradeFetch } from '@/lib/plugins/quanttrade-session'
import { requireOperationAccepted } from '@/components/quanttrade/exchange-tools-api'

const decimal = z
  .string()
  .max(40)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .refine((value) => /[1-9]/.test(value), 'Must be positive')
const scope = {
  venue: z.enum(['hyperliquid', 'lighter']),
  marketType: z.enum(['perpetual', 'spot']),
  symbol: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[A-Za-z0-9:_.]+-[A-Za-z0-9:_.]+(?:-USDC)?$/),
}
const orderId = z
  .string()
  .max(30)
  .regex(/^[1-9]\d*$/)
export const exchangeOperationInputSchema = z.discriminatedUnion('action', [
  z
    .object({
      ...scope,
      action: z.literal('leverage'),
      leverage: z.number().int().min(1).max(125),
      marginMode: z.enum(['cross', 'isolated']),
    })
    .strict(),
  z
    .object({
      ...scope,
      action: z.literal('margin'),
      amount: decimal,
      direction: z.enum(['add', 'remove']),
    })
    .strict(),
  z
    .object({
      ...scope,
      action: z.literal('amend'),
      exchangeOrderId: orderId,
      accountName: z.string().min(1).optional(),
      connectionRevision: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      proposedAt: z.number().int().positive().optional(),
      amount: decimal,
      price: decimal,
      timeInForce: z.enum(['Gtc', 'Alo']).optional(),
    })
    .strict(),
  z
    .object({
      ...scope,
      action: z.literal('cancel'),
      exchangeOrderId: orderId,
      accountName: z.string().min(1).optional(),
      connectionRevision: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      proposedAt: z.number().int().positive().optional(),
    })
    .strict(),
])
export type ExchangeOperationInput = z.infer<
  typeof exchangeOperationInputSchema
>
export type ExchangeOperationProposal = ExchangeOperationInput & {
  requestId: string
  mode: 'live'
}
export function validateExchangeOperation(
  raw: unknown,
): ExchangeOperationInput {
  const normalized =
    typeof raw === 'object' &&
    raw !== null &&
    'symbol' in raw &&
    'marketType' in raw &&
    raw.marketType === 'perpetual' &&
    typeof raw.symbol === 'string'
      ? { ...raw, symbol: raw.symbol.replace(/-USDC-USDC$/, '-USDC') }
      : raw
  const input = exchangeOperationInputSchema.parse(normalized)
  if (!/^[A-Za-z0-9:_.]+-[A-Za-z0-9:_.]+$/.test(input.symbol))
    throw new Error('Use the exact exchange instrument symbol')
  if (
    input.marketType === 'spot' &&
    (input.action === 'leverage' || input.action === 'margin')
  )
    throw new Error('Leverage and margin controls require perpetual markets')
  if (
    input.action === 'margin' &&
    (input.amount.split('.')[1]?.length ?? 0) > 6
  )
    throw new Error('Margin supports at most six decimal places')
  if (
    input.venue === 'lighter' &&
    input.action === 'amend' &&
    input.timeInForce !== undefined
  )
    throw new Error('Lighter amendments preserve existing time in force')
  return input
}
export function parseExchangeOperationProposal(
  raw: unknown,
): ExchangeOperationProposal {
  const envelope = z
    .object({ requestId: z.string().uuid(), mode: z.literal('live') })
    .passthrough()
    .parse(raw)
  const { requestId, mode, ...input } = envelope
  return { ...validateExchangeOperation(input), requestId, mode }
}
type Request = (url: string, init?: RequestInit) => Promise<Response>
/** Created during render, but sends nothing until the user explicitly approves. */
export class ExchangeOperationApproval {
  readonly proposal: ExchangeOperationProposal
  status: 'idle' | 'pending' | 'accepted' | 'unknown' = 'idle'
  error: string | null = null
  constructor(
    raw: unknown,
    private readonly request: Request = (url, init) => fetch(url, init),
  ) {
    this.proposal = parseExchangeOperationProposal(raw)
  }
  async approve(): Promise<ExchangeOperationApproval['status']> {
    if (this.status !== 'idle') return this.status
    this.status = 'pending'
    try {
      const response = await quantTradeFetch(
        '/_quanttrade/api/terminal/operations',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.proposal),
          signal: AbortSignal.timeout(30000),
          redirect: 'error',
        },
        this.request,
      )
      if (!response.ok)
        throw new Error(
          'Exchange operation was not confirmed. Inspect exchange state before another action.',
        )
      requireOperationAccepted(await response.json())
      this.status = 'accepted'
    } catch {
      this.status = 'unknown'
      this.error =
        'Outcome is uncertain. Inspect the exchange; this request will not be resubmitted.'
    }
    return this.status
  }
}

/** Read-only preparation; cancellation is bound to the exact current live connection. */
export async function prepareExchangeOperation(raw: unknown) {
  try {
    let operation = validateExchangeOperation(raw)
    if (operation.action === 'cancel') {
      const response = await quantTradeFetch('/_quanttrade/api/status', {
        credentials: 'same-origin',
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      })
      if (!response.ok)
        throw new Error(
          'Current exchange account could not be verified. Nothing was cancelled.',
        )
      const status = z
        .object({
          accountName: z.string().min(1),
          venueModes: z.record(z.string()),
          connectionRevisions: z.record(z.string().nullable()),
        })
        .parse(await response.json())
      const revision = status.connectionRevisions[operation.venue]
      if (
        status.venueModes[operation.venue] !== 'live' ||
        !revision ||
        !/^[a-f0-9]{64}$/.test(revision)
      )
        throw new Error(
          'A verified live exchange connection is required. Nothing was cancelled.',
        )
      if (
        (operation.accountName &&
          operation.accountName !== status.accountName) ||
        (operation.connectionRevision &&
          operation.connectionRevision !== revision)
      )
        throw new Error(
          'The reviewed exchange account changed. Read fresh exchange orders before preparing cancellation.',
        )
      operation = {
        ...operation,
        accountName: status.accountName,
        connectionRevision: revision,
        proposedAt: Date.now(),
      }
    }
    return {
      status: 'awaiting_confirmation',
      operation: {
        ...operation,
        requestId: crypto.randomUUID(),
        mode: 'live' as const,
      },
      message:
        'Review and approve this exact operation. Cancelling protective stops leaves positions unprotected. Nothing was submitted.',
    }
  } catch (cause) {
    return {
      status: 'invalid',
      error:
        cause instanceof Error
          ? cause.message
          : 'The operation could not be prepared. Nothing was submitted.',
    }
  }
}
