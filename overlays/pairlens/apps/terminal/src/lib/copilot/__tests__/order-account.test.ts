import { expect, test } from 'bun:test'
import { assistantOrderAccount } from '../order-account'

test('AI execution resolves the exact venue and mode without another account balance', () => {
  const credentials = [
    { id: 'paper', market: 'lighter', mode: 'paper' },
    { id: 'other', market: 'hyperliquid', mode: 'live' },
    { id: 'live', market: 'lighter', mode: 'live' },
  ]
  expect(assistantOrderAccount(credentials, 'lighter', 'live')?.id).toBe('live')
  expect(assistantOrderAccount(credentials, 'binance', 'live')).toBeUndefined()
})

test('AI execution refuses ambiguous live accounts instead of picking the first', () => {
  const credentials = [
    { id: 'one', market: 'binance', mode: 'live' },
    { id: 'two', market: 'binance', mode: 'live' },
  ]
  expect(() => assistantOrderAccount(credentials, 'binance', 'live')).toThrow('Multiple live accounts')
})
