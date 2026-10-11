import { z } from 'zod'
import { quantTradeFetch } from '@/lib/plugins/quanttrade-session'

export const nativeTwapPolicyStatusSchema = z.object({
  accountName: z.string().min(1),
  connectionRevisions: z.record(z.string(), z.string().nullable()),
  venueModes: z.record(z.string(), z.string()),
  nativeTwapRiskAllowed: z.boolean().default(false),
})
export type NativeTwapPolicyStatus = z.infer<
  typeof nativeTwapPolicyStatusSchema
>
type Request = (url: string, init?: RequestInit) => Promise<Response>
export async function readNativeTwapPolicy(
  request: Request = fetch,
  signal?: AbortSignal,
) {
  const response = await quantTradeFetch(
    '/_quanttrade/api/status',
    {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    },
    request,
  )
  if (!response.ok) throw new Error('Unable to verify native TWAP permission.')
  const status = nativeTwapPolicyStatusSchema.parse(await response.json())
  if (
    status.venueModes.hyperliquid !== 'live' ||
    !/^[a-f0-9]{64}$/.test(status.connectionRevisions.hyperliquid ?? '')
  )
    throw new Error('Connect the live Hyperliquid account first.')
  return status
}
export async function changeNativeTwapPolicy(
  reviewed: NativeTwapPolicyStatus,
  enabled: boolean,
  request: Request = fetch,
  signal?: AbortSignal,
) {
  const current = await readNativeTwapPolicy(request, signal)
  if (
    current.accountName !== reviewed.accountName ||
    current.connectionRevisions.hyperliquid !==
      reviewed.connectionRevisions.hyperliquid
  )
    throw new Error(
      'Account or credentials changed. Review the permission again.',
    )
  signal?.throwIfAborted()
  const payload = {
    requestId: crypto.randomUUID(),
    proposedAt: Date.now(),
    accountName: reviewed.accountName,
    connectionRevision: reviewed.connectionRevisions.hyperliquid,
    mode: 'live',
    venue: 'hyperliquid',
    enabled,
    acceptFixedSlippageBps: 300,
  }
  const response = await quantTradeFetch(
    '/_quanttrade/api/terminal/native-twap-policy',
    {
      method: 'PUT',
      credentials: 'same-origin',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    request,
  )
  if (!response.ok)
    throw new Error(
      'Permission change was not confirmed. Refresh before retrying.',
    )
  const result = z
    .object({
      enabled: z.boolean(),
      accountName: z.string(),
      connectionRevision: z.string(),
    })
    .parse(await response.json())
  if (
    result.accountName !== reviewed.accountName ||
    result.connectionRevision !== reviewed.connectionRevisions.hyperliquid ||
    result.enabled !== enabled
  )
    throw new Error('Permission response does not match the reviewed account.')
  return result
}
