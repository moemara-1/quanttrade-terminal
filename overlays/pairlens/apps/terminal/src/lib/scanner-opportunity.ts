import type { ScannerSnapshot } from './scanners'

export type ArbitrageStrategy = 'funding' | 'mark'
export type FundingRateUnit = 'hourly' | '8h' | 'apr'
type Comparison = ScannerSnapshot['comparisons'][number]
export function comparisonForStrategy(
  comparison: Comparison,
  strategy: ArbitrageStrategy,
): Comparison {
  const longVenue =
    strategy === 'mark' ? comparison.lowerMarkVenue : comparison.longVenue
  const shortVenue =
    strategy === 'mark' ? comparison.higherMarkVenue : comparison.shortVenue
  const rates = {
    hyperliquid: comparison.hyperliquid.fundingHourly,
    lighter: comparison.lighter.fundingHourly,
  }
  const longRate = longVenue ? rates[longVenue] : null,
    shortRate = shortVenue ? rates[shortVenue] : null
  return {
    ...comparison,
    longVenue,
    shortVenue,
    fundingGapHourly:
      longRate === null || shortRate === null ? null : shortRate - longRate,
  }
}
export function projectedFundingRate(
  rate: number | null,
  unit: FundingRateUnit,
): number | null {
  return rate === null
    ? null
    : rate * (unit === '8h' ? 8 : unit === 'apr' ? 24 * 365 : 1)
}
export function fundingCarryPerThousand(
  longRate: number | null,
  shortRate: number | null,
  hours: 1 | 24,
): number | null {
  return longRate === null || shortRate === null
    ? null
    : (shortRate - longRate) * hours * 1000
}
