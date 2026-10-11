import { z } from 'zod'
import DecimalBase from 'decimal.js'
import { prepareAdvancedExecution } from './advanced-execution-orders'
import { assistantOrderAccount } from './order-account'
import type { AdvancedExecutionApproval } from './advanced-execution-orders'
import { quantTradeFetch } from '@/lib/plugins/quanttrade-session'

type Plan = AdvancedExecutionApproval['proposal']
type Credentials = Parameters<typeof prepareAdvancedExecution>[1]
type Request = (url: string, init?: RequestInit) => Promise<Response>
const Decimal = DecimalBase.clone({ precision: 100 })
const quantity = z
  .string()
  .max(80)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
export const advancedProtectionStatusInputSchema = z
  .object({
    requestId: z.string().uuid(),
    credentialId: z.string().min(1),
    accountName: z.string().min(1),
    connectionRevision: z.string().regex(/^[a-f0-9]{64}$/),
    venue: z.enum(['lighter', 'hyperliquid']),
    symbol: z.string().min(3).max(100),
    side: z.enum(['buy', 'sell']),
    size: quantity.refine((value) => new Decimal(value).gt(0)),
  })
  .strict()
type ProtectionScope = z.infer<typeof advancedProtectionStatusInputSchema>
const identity = z.object({
  accountName: z.string(),
  connectionRevisions: z.record(z.string(), z.string().nullable()),
  venueModes: z.record(z.string(), z.string()),
})
async function pinnedAccount(
  plan: Pick<
    Plan,
    'credentialId' | 'venue' | 'accountName' | 'connectionRevision'
  >,
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
export async function readAdvancedProtectionStatus(
  raw: unknown,
  credentials: Credentials,
  request: Request = fetch,
) {
  const scope = advancedProtectionStatusInputSchema.parse(raw)
  await pinnedAccount(scope, credentials, request)
  const result = await readOwnedProtection(scope, request)
  await pinnedAccount(scope, credentials, request)
  return result
}
async function readOwnedProtection(plan: ProtectionScope, request: Request) {
  const response = await quantTradeFetch(
    `/_quanttrade/api/advanced-protection?requestId=${encodeURIComponent(plan.requestId)}`,
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
    throw Error(
      'Bundled protection status is unavailable. Do not assume exits are active.',
    )
  const run = z
    .object({
      run: z.object({
        id: z.string(),
        input: z.object({
          accountName: z.string(),
          connectionRevision: z.string(),
          venue: z.string(),
          symbol: z.string(),
          side: z.string(),
          size: z.string(),
        }),
        status: z.enum([
          'prepared',
          'active',
          'waiting-evidence',
          'paused',
          'stopping-entry',
          'completed',
        ]),
        protectedSize: z.string(),
        spent: z.string(),
        fills: z.array(z.object({ size: quantity })),
        groups: z.array(
          z.object({
            size: quantity,
            retired: z.boolean().optional(),
            exits: z
              .array(
                z.object({
                  id: z.string().optional(),
                  phase: z.enum([
                    'submitting',
                    'open',
                    'cancelling',
                    'settled',
                  ]),
                  filledSize: quantity,
                }),
              )
              .length(2),
          }),
        ),
        entryStopped: z.boolean(),
        entrySettled: z.boolean(),
        error: z.string().optional(),
      }),
    })
    .parse(await response.json()).run
  if (
    run.id !== plan.requestId ||
    run.input.accountName !== plan.accountName ||
    run.input.connectionRevision !== plan.connectionRevision ||
    run.input.venue !== plan.venue ||
    run.input.symbol !== plan.symbol ||
    run.input.side !== plan.side ||
    run.input.size !== plan.size
  )
    throw Error(
      'Protection run does not match the reviewed entry. Status remains unverified.',
    )
  const verifiedEntrySize = run.fills.reduce(
    (sum, fill) => sum.plus(fill.size),
    new Decimal(0),
  )
  let closed = new Decimal(0),
    coverage = new Decimal(0)
  for (const group of run.groups) {
    const fills = group.exits.reduce(
      (sum, exit) => sum.plus(exit.filledSize),
      new Decimal(0),
    )
    if (fills.gt(group.size))
      throw Error(
        'Protection exit fills exceed their reviewed allocation. Status remains unverified.',
      )
    closed = closed.plus(fills)
    if (
      !group.retired &&
      group.exits.every((exit) => exit.phase === 'open' && Boolean(exit.id))
    )
      coverage = coverage.plus(new Decimal(group.size).minus(fills))
  }
  if (
    verifiedEntrySize.gt(plan.size) ||
    closed.plus(coverage).gt(verifiedEntrySize)
  )
    throw Error(
      'Protection coverage exceeds verified entry quantity. Status remains unverified.',
    )
  return {
    status: run.status,
    acceptedExitCoverageSize: coverage.toFixed(),
    verifiedClosedSize: closed.toFixed(),
    uncoveredVerifiedEntrySize: verifiedEntrySize
      .minus(closed)
      .minus(coverage)
      .toFixed(),
    coverageMeaning:
      'Remaining allocation with accepted paired exit identities; not proof exits are currently active or filled.',
    submittedExitNotional: run.spent,
    groups: run.groups.length,
    entryStopped: run.entryStopped,
    entrySettled: run.entrySettled,
    ...(run.error ? { error: run.error } : {}),
  }
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
    const protection =
      plan.kind === 'chase' && plan.protection
        ? await readOwnedProtection(plan, request)
        : undefined
    await pinnedAccount(plan, credentials, request)
    return {
      kind: 'chase' as const,
      status: run.status,
      filledSize: run.filledSize,
      submittedNotional: run.spent,
      attempts: run.attempts.length,
      cancellationRequested: run.stopRequested,
      ...(protection ? { protection } : {}),
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
  const protection = plan.protection
    ? await readOwnedProtection(plan, request)
    : undefined
  await pinnedAccount(plan, credentials, request)
  return {
    kind: 'native-twap' as const,
    evidence: result,
    ...(protection ? { protection } : {}),
  }
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
