import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import {
  assertAttendedTrading,
  requiresAttendedTrading,
} from '../attended-trading'

describe('QuantTrade attended execution', () => {
  test('both target venues refuse unattended paper and live execution', () => {
    for (const market of [
      'hyperliquid',
      'lighter',
      'HYPERLIQUID',
      'hyperliquid-spot',
      'lighter-spot',
    ]) {
      expect(requiresAttendedTrading(market)).toBe(true)
      expect(() => assertAttendedTrading(market, false)).toThrow('confirmation')
      expect(() => assertAttendedTrading(market, true)).not.toThrow()
    }
  })
  test('other venues keep their existing automation policy', () => {
    expect(requiresAttendedTrading('binance')).toBe(false)
    expect(() => assertAttendedTrading('binance', false)).not.toThrow()
  })
  test('only the attended wrapper carries the private authorization marker', () => {
    const source = readFileSync(
      new URL('../market-data-provider.tsx', import.meta.url),
      'utf8',
    )
    expect(source).toContain('authorization === attendedAuthorization.current')
    expect(source).toContain(
      'placeOrderGuarded(params, attendedAuthorization.current)',
    )
    expect(source).toContain('placeUnattendedOrder: placeOrderGuarded')
    expect(source).toContain('placeOrder: placeOrderGuarded')
  })
  test('card rejects auto execution independently of saved consent', () => {
    const source = readFileSync(
      new URL(
        '../../components/copilot/copilot-order-card.tsx',
        import.meta.url,
      ),
      'utf8',
    )
    expect(source).toContain('if (attendedOnly && opts?.auto) return')
    expect(source).toContain('if (attendedOnly) return')
    expect(source).toContain('{!attendedOnly && (')
  })
})
