import { z } from 'zod'

export const nativeSnapshotSchema = z.object({
  connector_name: z.string(),
  trading_pair: z.string(),
  open_orders: z.array(z.record(z.string(), z.unknown())),
  order_history: z.array(z.record(z.string(), z.unknown())),
  fills: z.array(z.record(z.string(), z.unknown())),
  account: z.record(z.string(), z.unknown()),
  history_next_cursor: z.string().nullable().optional(),
  fills_next_cursor: z.string().nullable().optional(),
  fills_next_start_time: z.number().int().nonnegative().nullable().optional(),
  fills_may_have_more: z.boolean().optional(),
})
export type NativeSnapshot = z.infer<typeof nativeSnapshotSchema>
export function nativeOrderId(
  venue: string,
  row: Record<string, unknown>,
): string | null {
  const value =
    venue === 'hyperliquid'
      ? row.oid
      : (row.exchange_order_id ?? row.order_index)
  return (typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0) ||
    (typeof value === 'string' && /^[1-9]\d*$/.test(value))
    ? String(value)
    : null
}
export function nativeField(
  row: Record<string, unknown>,
  keys: Array<string>,
): string {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === 'string' || typeof v === 'number') return String(v)
  }
  return '—'
}
export class OperationKeys {
  private keys = new Map<string, string>()
  complete(payload: Record<string, unknown>): void {
    this.keys.delete(JSON.stringify(payload))
  }
  key(payload: Record<string, unknown>): string {
    const fingerprint = JSON.stringify(payload)
    let key = this.keys.get(fingerprint)
    if (!key) {
      key = crypto.randomUUID()
      this.keys.set(fingerprint, key)
    }
    return key
  }
}

export function requireOperationAccepted(value: unknown): void {
  const result = z
    .object({ status: z.enum(['accepted', 'unknown']), result: z.unknown() })
    .parse(value)
  if (result.status !== 'accepted') {
    const detail = z.object({ error: z.string() }).safeParse(result.result)
    throw new Error(
      detail.success
        ? detail.data.error
        : 'Exchange outcome is uncertain. Refresh account state before further action.',
    )
  }
}

export function parseNativeSnapshot(
  value: unknown,
  venue: 'hyperliquid' | 'lighter',
  marketType: 'spot' | 'perpetual',
  symbol: string,
): NativeSnapshot {
  const result = nativeSnapshotSchema.parse(value)
  const connector = marketType === 'spot' ? venue : `${venue}_perpetual`
  const pair =
    venue === 'hyperliquid' && marketType === 'perpetual'
      ? symbol.replace(/-USDC$/, '-USD')
      : symbol
  if (result.connector_name !== connector || result.trading_pair !== pair)
    throw new Error(
      'Exchange snapshot does not match the selected account market',
    )
  return result
}
