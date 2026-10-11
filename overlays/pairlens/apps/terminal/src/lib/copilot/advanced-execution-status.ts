import { z } from 'zod'
import { prepareAdvancedExecution } from './advanced-execution-orders'
import { assistantOrderAccount } from './order-account'
import type { AdvancedExecutionApproval } from './advanced-execution-orders'
import { quantTradeFetch } from '@/lib/plugins/quanttrade-session'

type Plan = AdvancedExecutionApproval['proposal']
type Credentials = Parameters<typeof prepareAdvancedExecution>[1]
type Request = (url: string, init?: RequestInit) => Promise<Response>
const identity = z.object({
  accountName: z.string(),
  connectionRevisions: z.record(z.string(), z.string().nullable()),
  venueModes: z.record(z.string(), z.string()),
})
async function pinnedAccount(
  plan: Plan,
  credentials: Credentials,
  request: Request,
) {
  assistantOrderAccount(credentials, plan.venue, 'live', plan.credentialId)
  const response = await quantTradeFetch(
    '/_quanttrade/api/status',
    {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    },
    request,
  )
  if (!response.ok)
    throw Error('Unable to verify reviewed account; status remains unknown.')
  const parsed = identity.safeParse(await response.json())
  if (
    !parsed.success ||
    parsed.data.accountName !== plan.accountName ||
    parsed.data.connectionRevisions[plan.venue] !== plan.connectionRevision ||
    parsed.data.venueModes[plan.venue] !== 'live'
  )
    throw Error(
      'Reviewed account or connection changed. Reconnect the original account before reading or canceling this plan.',
    )
}
export async function readAdvancedExecutionStatus(
  plan: Plan,
  evidence: string | null,
  credentials: Credentials,
  request: Request = fetch,
) {
  await pinnedAccount(plan, credentials, request)
  if (plan.kind === 'chase' || plan.kind === 'chase-cancel') {
    const runId = plan.kind === 'chase' ? plan.requestId : plan.runId
    const response = await quantTradeFetch(
      '/_quanttrade/api/chase-plans',
      {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      },
      request,
    )
    if (!response.ok)
      throw Error('Unable to read owned Chase run; status remains unknown.')
    const runs = z
      .object({ runs: z.array(z.unknown()) })
      .parse(await response.json()).runs
    const run = z
      .object({
        id: z.string(),
        plan: z.object({
          accountName: z.string(),
          connectionRevision: z.string(),
          venue: z.string(),
          symbol: z.string(),
          credentialId: z.string(),
        }),
        status: z.enum(['active', 'paused', 'completed', 'cancelled']),
        filledSize: z.string(),
        spent: z.string(),
        attempts: z.array(z.unknown()),
        stopRequested: z.boolean(),
        error: z.string().optional(),
      })
      .parse(
        runs.find(
          (value) =>
            z.object({ id: z.string() }).safeParse(value).data?.id === runId,
        ),
      )
    if (
      run.plan.accountName !== plan.accountName ||
      run.plan.connectionRevision !== plan.connectionRevision ||
      run.plan.venue !== plan.venue ||
      run.plan.symbol !== plan.symbol ||
      run.plan.credentialId !== plan.credentialId
    )
      throw Error('Owned run identity does not match this reviewed plan.')
    await pinnedAccount(plan, credentials, request)
    return {
      kind: 'chase' as const,
      status: run.status,
      filledSize: run.filledSize,
      submittedNotional: run.spent,
      attempts: run.attempts.length,
      cancellationRequested: run.stopRequested,
      ...(run.error ? { error: run.error } : {}),
    }
  }
  if (plan.kind !== 'hyperliquid-twap')
    throw Error(
      'Cancellation acceptance is not execution evidence. Refresh the original TWAP card.',
    )
  const twapId = z
    .string()
    .regex(/^[1-9]\d*$/)
    .parse(evidence)
  const response = await quantTradeFetch(
    '/_quanttrade/api/terminal/hyperliquid-twap-evidence',
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: plan.symbol,
        twapId,
        side: plan.side,
        size: plan.size,
        accountName: plan.accountName,
        connectionRevision: plan.connectionRevision,
        requestId: plan.requestId,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    },
    request,
  )
  if (!response.ok)
    throw Error(
      'Native TWAP evidence unavailable; execution status remains unknown.',
    )
  const result: unknown = await response.json()
  await pinnedAccount(plan, credentials, request)
  return { kind: 'native-twap' as const, evidence: result }
}
export async function prepareAdvancedCancellation(
  plan: Plan,
  evidence: string | null,
  credentials: Credentials,
  request: Request = fetch,
) {
  await pinnedAccount(plan, credentials, request)
  const input =
    plan.kind === 'chase'
      ? {
          kind: 'chase-cancel',
          venue: plan.venue,
          symbol: plan.symbol,
          runId: plan.requestId,
          credentialId: plan.credentialId,
          mode: 'live',
        }
      : plan.kind === 'hyperliquid-twap'
        ? {
            kind: 'hyperliquid-twap-cancel',
            symbol: plan.symbol,
            twapId: z
              .string()
              .regex(/^[1-9]\d*$/)
              .parse(evidence),
            credentialId: plan.credentialId,
            mode: 'live',
          }
        : null
  if (!input)
    throw Error('Use the original entry card to prepare cancellation.')
  const cancellation = await prepareAdvancedExecution(
    input,
    credentials,
    request,
  )
  if (
    cancellation.accountName !== plan.accountName ||
    cancellation.connectionRevision !== plan.connectionRevision
  )
    throw Error(
      'Reviewed account changed during cancellation preparation. Nothing submitted.',
    )
  return cancellation
}
