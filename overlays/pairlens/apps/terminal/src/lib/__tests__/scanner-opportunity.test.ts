import { expect, test } from 'bun:test'
import {
  comparisonForStrategy,
  fundingCarryPerThousand,
  projectedFundingRate,
} from '../scanner-opportunity'
import type { ScannerSnapshot } from '../scanners'

const market = (
  venue: 'lighter' | 'hyperliquid',
  price: number,
  fundingHourly: number,
) => ({
  venue,
  symbol: 'BTC-USDC',
  base: 'BTC',
  price,
  change24h: 0,
  volume24h: 1e6,
  fundingHourly,
  openInterestBase: null,
  openInterestUsd: null,
  relativeStrength24h: 0,
  oiToVolume: null,
  observedAt: 1,
})
const comparison: ScannerSnapshot['comparisons'][number] = {
  base: 'BTC',
  hyperliquid: market('hyperliquid', 100, 0.0001),
  lighter: market('lighter', 99, 0.0003),
  fundingGapHourly: 0.0002,
  longVenue: 'hyperliquid',
  shortVenue: 'lighter',
  markGapPct: 1,
  lowerMarkVenue: 'lighter',
  higherMarkVenue: 'hyperliquid',
}
test('mark gap direction can have negative funding carry', () => {
  const row = comparisonForStrategy(comparison, 'mark')
  expect(row.longVenue).toBe('lighter')
  expect(row.shortVenue).toBe('hyperliquid')
  expect(row.fundingGapHourly).toBeCloseTo(-0.0002)
  expect(comparison.longVenue).toBe('hyperliquid')
})
test('funding direction preserves signed carry and rejects unknown direction', () => {
  expect(
    comparisonForStrategy(comparison, 'funding').fundingGapHourly,
  ).toBeCloseTo(0.0002)
  expect(
    comparisonForStrategy(
      { ...comparison, lowerMarkVenue: null, higherMarkVenue: null },
      'mark',
    ).fundingGapHourly,
  ).toBeNull()
})
test('8h and APR are explicitly constant-rate projections, preserving signs and missing data', () => {
  expect(projectedFundingRate(-0.0001, '8h')).toBeCloseTo(-0.0008)
  expect(projectedFundingRate(0.0001, 'apr')).toBeCloseTo(0.876)
  expect(projectedFundingRate(0, 'hourly')).toBe(0)
  expect(projectedFundingRate(null, 'apr')).toBeNull()
})

test('gross carry illustrations preserve negative carry and never convert missing history to zero', () => {
  expect(fundingCarryPerThousand(0.0003, 0.0001, 24)).toBeCloseTo(-4.8)
  expect(fundingCarryPerThousand(0.002, 0.003, 1)).toBeCloseTo(1)
  expect(fundingCarryPerThousand(null, 0.003, 1)).toBeNull()
  expect(fundingCarryPerThousand(0, 0, 24)).toBe(0)
})
