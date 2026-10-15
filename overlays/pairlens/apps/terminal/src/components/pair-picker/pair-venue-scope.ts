import { isQuantTradeVenue } from '@/lib/venue-instrument'

/** Native instruments must be listed by the selected venue, never rebound from a generic row. */
export function rowsForSelectedVenue<T extends { market?: string }>(
  rows: ReadonlyArray<T>,
  market?: string,
): Array<T> {
  return rows.filter(
    (row) => !market || !isQuantTradeVenue(market) || row.market === market,
  )
}
