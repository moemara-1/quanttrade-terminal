import type { MarketRef } from '@pairlens/shared/market-ref'
import { isQuantTradeVenue } from '@/lib/venue-instrument'
/** The pair and venue are one address; never retain a foreign quote on a bridge hop. */
export function panePairForVenueSwitch(
  pair: { pairKey: string; market: string },
  market: string,
  target?: { ref: MarketRef | null },
): { pairKey: string; market: string } | null {
  if (pair.market === market) return pair
  if (isQuantTradeVenue(pair.market) || isQuantTradeVenue(market)) {
    if (target?.ref?.id.split('-')[0] !== pair.pairKey.split('-')[0])
      return null
    return target?.ref?.market === market
      ? { pairKey: target.ref.id, market }
      : null
  }
  return { pairKey: pair.pairKey, market }
}
