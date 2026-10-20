import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import {
  bridgeRequest,
  isQuantTradeVenue,
  quantTradeBaseVenue,
} from '@/lib/plugins/quanttrade-session'
import { contractLeverageLimit } from '@/lib/trading-scope'

const marketsSchema = z.array(
  z.object({
    symbol: z.string(),
    maxLeverage: z.number().nullable().optional(),
    onlyIsolated:z.boolean().optional(),
    marginModes:z.array(z.enum(['cross','isolated'])).optional(),
    sizeDecimals: z.number().nullable().optional(),
    priceDecimals: z.number().nullable().optional(),
    minSize: z.string().nullable().optional(),
    minNotional: z.string().nullable().optional(),
  }),
)

/** Contract metadata is public and keyed by venue; no account or previous pair fallback. */
export function useContractLimits(market: string, pair: string) {
  const native = isQuantTradeVenue(market)
  const marketType = market.endsWith('-spot') ? 'spot' : 'perpetual'
  const venue = native ? quantTradeBaseVenue(market) : null
  const query = useQuery({
    queryKey: ['contract-limits', venue, marketType],
    enabled: native,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
    queryFn: async () =>
      marketsSchema.parse(
        await bridgeRequest(
          `/public/markets?venue=${venue}&marketType=${marketType}`,
        ),
      ),
  })
  if (!native || query.isError || !query.data) return null
  const symbol = /^.+-([A-Za-z0-9_.]+)-\1$/.test(pair)?pair.slice(0,pair.lastIndexOf('-')):pair
  return query.data.find((row) => row.symbol === symbol) ?? null
}
export function useContractLeverage(
  market: string,
  pair: string,
  fallback?: number,
): number | null {
  const row = useContractLimits(market, pair)
  if (!isQuantTradeVenue(market)) return fallback ?? 1
  if (market.endsWith('-spot')) return 1
  return row ? contractLeverageLimit([row], pair) : null
}
