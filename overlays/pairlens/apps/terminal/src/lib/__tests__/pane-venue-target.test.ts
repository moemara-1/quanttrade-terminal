import { expect, test } from 'bun:test'
import { panePairForVenueSwitch } from '@/lib/pane-venue-target'

test('dashboard and pinned pane switch writes native pair and venue together', () => {
  const pair = { pairKey: 'BTC-USDT-USDT', market: 'binance-futures' }
  expect(
    panePairForVenueSwitch(pair, 'hyperliquid', {
      ref: { cls: 'perp', market: 'hyperliquid', id: 'BTC-USDC-USDC' },
    }),
  ).toEqual({ pairKey: 'BTC-USDC-USDC', market: 'hyperliquid' })
  expect(panePairForVenueSwitch(pair, 'hyperliquid')).toBeNull()
  expect(panePairForVenueSwitch(pair, 'lighter', { ref: null })).toBeNull()
  expect(
    panePairForVenueSwitch(pair, 'lighter', {
      ref: { cls: 'perp', market: 'hyperliquid', id: 'BTC-USDC-USDC' },
    }),
  ).toBeNull()
})
test('reverse bridge hop never guesses cold CEX listing and CEX-to-CEX keeps existing key', () => {
  expect(
    panePairForVenueSwitch(
      { pairKey: 'BTC-USDC-USDC', market: 'lighter' },
      'bybit-futures',
    ),
  ).toBeNull()
  expect(
    panePairForVenueSwitch(
      { pairKey: 'BTC-USDC-USDC', market: 'lighter' },
      'bybit-futures',
      { ref: { cls: 'perp', market: 'bybit-futures', id: 'BTC-USDT-USDT' } },
    ),
  ).toEqual({ pairKey: 'BTC-USDT-USDT', market: 'bybit-futures' })
  expect(
    panePairForVenueSwitch(
      { pairKey: 'BTC-USDT-USDT', market: 'binance-futures' },
      'bybit-futures',
    ),
  ).toEqual({ pairKey: 'BTC-USDT-USDT', market: 'bybit-futures' })
})

test('a stale destination for a different base cannot change the selected asset', () => {
  expect(
    panePairForVenueSwitch(
      { pairKey: 'BTC-USDT-USDT', market: 'binance-futures' },
      'hyperliquid',
      { ref: { cls: 'perp', market: 'hyperliquid', id: 'ETH-USDC-USDC' } },
    ),
  ).toBeNull()
})
