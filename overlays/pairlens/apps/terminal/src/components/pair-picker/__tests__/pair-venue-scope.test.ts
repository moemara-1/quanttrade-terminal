import { expect, test } from 'bun:test'
import { rowsForSelectedVenue } from '../pair-venue-scope'

test('native picker refuses generic and foreign rows instead of rebinding them', () => {
  const generic = { symbol: 'PUFFER-USDT' }
  const lighter = { symbol: 'GRAM-USDC-USDC', market: 'lighter' }
  const hyperliquid = { symbol: 'GRAM-USDC-USDC', market: 'hyperliquid' }
  expect(
    rowsForSelectedVenue([generic, lighter, hyperliquid], 'lighter'),
  ).toEqual([lighter])
  expect(rowsForSelectedVenue([generic, lighter], 'lighter-spot')).toEqual([])
})

test('unscoped and ordinary CEX pickers preserve their existing results', () => {
  const rows = [
    { symbol: 'PUFFER-USDT' },
    { symbol: 'GRAM-USDC-USDC', market: 'lighter' },
  ]
  expect(rowsForSelectedVenue(rows)).toEqual(rows)
  expect(rowsForSelectedVenue(rows, 'binance-futures')).toEqual(rows)
})
