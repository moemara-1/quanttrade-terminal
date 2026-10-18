import { z } from 'zod'

const venue = z.enum(['lighter', 'hyperliquid'])
const amount = z.number().finite()
const timestamp = amount.int().nonnegative()
const nullableAmount = amount.nullable()
const status = z.enum(['ok', 'partial', 'error'])
export const scannerDetailSchema = z.object({
  asOf: timestamp,
  base: z.string().min(1).max(64),
  windowStart: timestamp,
  windowEnd: timestamp,
  refreshAfterMs: amount.positive(),
  venues: z
    .array(
      z.object({
        venue,
        symbol: z.string().min(1),
        currentFundingHourly: nullableAmount,
        projected24hFunding: nullableAmount,
        funding: z.object({
          status,
          samples: z.array(z.object({ time: timestamp, rate: amount })).max(48),
          sampleCount: amount.int().nonnegative(),
          expectedSamples: amount.int().positive(),
          observedSum: nullableAmount,
          actual24h: nullableAmount,
          message: z.string().nullable(),
        }),
        price: z.object({
          status,
          points: z
            .array(
              z.object({
                time: timestamp,
                close: amount.positive(),
                changePct: amount,
                btcChangePct: nullableAmount,
                relativeStrengthPp: nullableAmount,
              }),
            )
            .max(1000),
          message: z.string().nullable(),
        }),
      }),
    )
    .max(2),
})
export type ScannerDetailSnapshot = z.infer<typeof scannerDetailSchema>

export async function fetchScannerDetail(
  base: string,
  selectedVenue: 'all' | 'lighter' | 'hyperliquid' = 'all',
  signal?: AbortSignal,
): Promise<ScannerDetailSnapshot> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(base))
    throw new Error('Invalid scanner asset')
  z.enum(['all', 'lighter', 'hyperliquid']).parse(selectedVenue)
  const query = new URLSearchParams({ base, venue: selectedVenue })
  const response = await fetch(
    `/_quanttrade/api/public/scanners/detail?${query}`,
    {
      credentials: 'same-origin',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
        : AbortSignal.timeout(45000),
    },
  )
  if (!response.ok)
    throw new Error(`Scanner detail unavailable (HTTP ${response.status})`)
  let result: ScannerDetailSnapshot
  try {
    result = scannerDetailSchema.parse(await response.json())
  } catch {
    throw new Error('Invalid scanner detail response')
  }
  if (
    result.base !== base ||
    result.venues.some(
      (row) =>
        (selectedVenue !== 'all' && row.venue !== selectedVenue) ||
        row.symbol !== `${base}-USDC`,
    )
  )
    throw new Error('Scanner detail identity mismatch')
  return result
}
