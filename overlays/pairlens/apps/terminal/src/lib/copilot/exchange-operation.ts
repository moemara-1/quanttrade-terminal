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
    .regex(/^[A-Za-z0-9:_.]+-[A-Za-z0-9:_.]+$/),
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
      amount: decimal,
      price: decimal,
      timeInForce: z.enum(['Gtc', 'Alo']).optional(),
    })
    .strict(),
  z
    .object({ ...scope, action: z.literal('cancel'), exchangeOrderId: orderId })
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
  const input = exchangeOperationInputSchema.parse(raw)
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
