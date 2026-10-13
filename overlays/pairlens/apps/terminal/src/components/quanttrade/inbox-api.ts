import { z } from 'zod'
import { quantTradeFetch } from '@/lib/plugins/quanttrade-session'

const modeSchema = z.enum(['paper', 'live'])
export const inboxStatusSchema = z.object({
  mode: modeSchema,
  venueModes: z.record(z.string(), modeSchema).optional(),
  halted: z.boolean(),
  executionConfigured: z.boolean(),
  accountName: z.string(),
  maxOrderNotional: z.string().nullable(),
  dailyNotionalLimit: z.string().nullable(),
  dailyNotionalUsed: z.string(),
})
export const inboxProposalSchema = z.object({
  id: z.string().uuid(),
  accountName: z.string(),
  source: z.enum(['manual', 'agent']),
  mode: modeSchema,
  status: z.enum([
    'pending',
    'rejected',
    'expired',
    'submitting',
    'submitted',
    'unknown',
    'paper-filled',
    'paper-open',
    'cancel-requested',
    'cancelled',
  ]),
  order: z.object({
    venue: z.enum(['hyperliquid', 'lighter']),
    symbol: z.string(),
    side: z.enum(['buy', 'sell']),
    type: z.enum(['limit', 'market']),
    size: z.string(),
    price: z.string().optional(),
    rationale: z.string(),
    marketType: z.enum(['perpetual', 'spot']).optional(),
    leverage: z.number().int().optional(),
    marginMode: z.enum(['cross', 'isolated']).optional(),
    reduceOnly: z.boolean().optional(),
    postOnly: z.boolean().optional(),
    trigger: z
      .object({ triggerPrice: z.string(), triggerType: z.enum(['sl', 'tp']) })
      .optional(),
  }),
  referencePrice: z.string(),
  estimatedNotional: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  error: z.string().optional(),
  orderId: z.string().optional(),
})
export type InboxProposal = z.infer<typeof inboxProposalSchema>
export type InboxStatus = z.infer<typeof inboxStatusSchema>

export async function inboxRequest(
  token: string,
  path: string,
  action = false,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await quantTradeFetch(`/_quanttrade/api${path}`, {
    method: action ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(action ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(action ? { body: '{}' } : {}),
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body)
    throw new Error(
      error.success
        ? error.data.error
        : `Bridge request failed (${response.status})`,
    )
  }
  return body
}

export function canApproveProposal(
  proposal: InboxProposal,
  status: InboxStatus,
  now: number,
): boolean {
  return (
    proposal.status === 'pending' &&
    proposal.expiresAt > now &&
    !status.halted &&
    proposal.mode ===
      (status.venueModes?.[proposal.order.venue] ?? status.mode) &&
    proposal.accountName === status.accountName &&
    (proposal.mode === 'paper' || status.executionConfigured)
  )
}

export function canCancelProposal(
  proposal: InboxProposal,
  status: InboxStatus,
): boolean {
  if (
    proposal.mode !==
      (status.venueModes?.[proposal.order.venue] ?? status.mode) ||
    proposal.accountName !== status.accountName
  )
    return false
  if (proposal.mode === 'paper' && proposal.status === 'paper-open') return true
  return (
    proposal.mode === 'live' &&
    proposal.status === 'submitted' &&
    !!proposal.orderId &&
    status.executionConfigured
  )
}
