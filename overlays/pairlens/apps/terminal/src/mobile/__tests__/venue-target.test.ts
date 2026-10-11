import { expect, test } from 'bun:test'
import { mobileVenueTarget } from '@/mobile/lib/venue-target'

const ref = {
  cls: 'perp' as const,
  market: 'binance-futures',
  id: 'BTC-USDT-USDT',
}
test('mobile CEX to bridge switching carries native listed pair', () => {
  expect(
    mobileVenueTarget(ref, 'hyperliquid', ['crypto-perp'], {
      cls: 'perp',
      market: 'hyperliquid',
      id: 'BTC-USDC-USDC',
    }),
  ).toEqual({ cls: 'perp', market: 'hyperliquid', id: 'BTC-USDC-USDC' })
})
test('mobile bridge switching refuses checking, unavailable and stale asset targets', () => {
  expect(mobileVenueTarget(ref, 'lighter', ['crypto-perp'])).toBeNull()
  expect(mobileVenueTarget(ref, 'lighter', ['crypto-perp'], null)).toBeNull()
  expect(
    mobileVenueTarget(ref, 'lighter', ['crypto-perp'], {
      cls: 'perp',
      market: 'lighter',
      id: 'ETH-USDC-USDC',
    }),
  ).toBeNull()
})
test('mobile cross-class switch uses native bridge target and keeps ordinary CEX IDs', () => {
  const spot = { cls: 'spot' as const, market: 'binance', id: 'BTC-USDT' }
  expect(
    mobileVenueTarget(spot, 'lighter', ['crypto-perp'], {
      cls: 'perp',
      market: 'lighter',
      id: 'BTC-USDC-USDC',
    }),
  ).toEqual({ cls: 'perp', market: 'lighter', id: 'BTC-USDC-USDC' })
  expect(mobileVenueTarget(ref, 'bybit-futures', ['crypto-perp'])).toEqual({
    ...ref,
    market: 'bybit-futures',
  })
})
