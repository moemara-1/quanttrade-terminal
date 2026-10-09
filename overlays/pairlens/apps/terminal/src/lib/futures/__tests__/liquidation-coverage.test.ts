import { expect, test } from 'bun:test'
import { liquidationCoverageStart } from '../liquidation-clusters'

const now = Date.parse('2026-10-09T00:00:00Z')
test('a new collector never claims requested 72-hour backfill', () => {
  expect(
    liquidationCoverageStart(
      { trackedSince: now - 60000, fetchedAt: new Date(now).toISOString() },
      72,
    ),
  ).toBe(now - 60000)
})
test('a mature collector uses the requested window boundary', () => {
  expect(
    liquidationCoverageStart(
      {
        trackedSince: now - 72 * 3600000,
        fetchedAt: new Date(now).toISOString(),
      },
      1,
    ),
  ).toBe(now - 3600000)
})
test('missing or malformed coverage stays unknown', () => {
  expect(liquidationCoverageStart(null, 24)).toBeNull()
  expect(
    liquidationCoverageStart({ trackedSince: 0, fetchedAt: 'invalid' }, 24),
  ).toBeNull()
})
