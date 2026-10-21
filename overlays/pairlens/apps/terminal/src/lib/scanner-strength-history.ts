import { z } from 'zod'

const venue = z.enum(['lighter', 'hyperliquid'])
const windowSchema = z.enum(['1d', '7d', '30d'])
const inputSchema = z
  .object({
    venue,
    symbols: z
      .array(
        z
          .string()
          .min(3)
          .max(128)
          .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*-[A-Za-z0-9_.]+$/),
      )
      .min(1)
      .max(8)
      .refine((rows) => new Set(rows).size === rows.length),
    window: windowSchema,
  })
  .strict()
const timestamp = z.number().safe().int().nonnegative()
export const scannerStrengthHistorySchema = z.object({
  asOf: timestamp,
  window: windowSchema,
  windowStart: timestamp,
  windowEnd: timestamp,
  benchmarkSymbol: z.literal('BTC-USDC').nullable(),
  series: z
    .array(
      z.object({
        venue,
        symbol: z.string().min(3),
        base: z.string().min(1),
        status: z.enum(['ok', 'partial', 'error']),
        points: z
          .array(
            z.object({
              time: timestamp,
              changePct: z.number().finite(),
              relativeStrengthPp: z.number().finite().nullable(),
            }),
          )
          .max(169),
        message: z.string().nullable(),
      }),
    )
    .min(1)
    .max(8),
})
export type ScannerStrengthHistoryInput = z.infer<typeof inputSchema>
export type ScannerStrengthHistorySnapshot = z.infer<
  typeof scannerStrengthHistorySchema
>
export async function fetchScannerStrengthHistory(
  raw: ScannerStrengthHistoryInput,
  signal?: AbortSignal,
): Promise<ScannerStrengthHistorySnapshot> {
  const input = inputSchema.parse(raw),
    query = new URLSearchParams({
      venue: input.venue,
      symbols: input.symbols.join(','),
      window: input.window,
    })
  const response = await fetch(
    `/_quanttrade/api/public/scanners/strength-history?${query}`,
    {
      credentials: 'same-origin',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
        : AbortSignal.timeout(90000),
    },
  )
  if (!response.ok)
    throw Error(`Strength history unavailable (HTTP ${response.status})`)
  let result: ScannerStrengthHistorySnapshot
  try {
    result = scannerStrengthHistorySchema.parse(await response.json())
  } catch {
    throw Error('Invalid strength history response')
  }
  if (
    result.window !== input.window ||
    result.series.length !== input.symbols.length ||
    result.series.some(
      (row, i) =>
        row.venue !== input.venue ||
        row.symbol !== input.symbols[i] ||
        !row.symbol.startsWith(`${row.base}-`),
    )
  )
    throw Error('Strength history identity mismatch')
  const now = Date.now(),
    step = input.window === '30d' ? 86400000 : 3600000,
    count = input.window === '1d' ? 25 : input.window === '7d' ? 169 : 31
  if (result.asOf < now - 120000 || result.asOf > now + 5000)
    throw Error('Strength history is stale')
  if (
    result.windowEnd !== Math.floor(result.asOf / step) * step ||
    result.windowStart !== result.windowEnd - (count - 1) * step
  )
    throw Error('Invalid strength history window')
  if (
    result.series.some(
      (row) =>
        row.points.some(
          (p, i) =>
            p.time < result.windowStart ||
            p.time > result.windowEnd ||
            (p.time - result.windowStart) % step !== 0 ||
            (i > 0 && p.time <= row.points[i - 1].time),
        ) ||
        (row.status === 'ok' &&
          (row.points.length !== count || row.points[0].changePct !== 0)),
    )
  )
    throw Error('Invalid strength history coverage')
  return result
}
