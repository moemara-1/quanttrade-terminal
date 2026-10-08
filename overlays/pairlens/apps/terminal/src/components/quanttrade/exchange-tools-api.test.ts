import { expect, test } from 'bun:test'
import {
  OperationKeys,
  nativeOrderId,
  nativeSnapshotSchema,
  parseNativeSnapshot,
  requireOperationAccepted,
} from './exchange-tools-api'

test('native IDs never confuse client IDs with exchange order IDs', () => {
  expect(nativeOrderId('lighter', { client_order_index: 123 })).toBeNull()
  expect(nativeOrderId('lighter', { order_index: '123' })).toBe('123')
  expect(nativeOrderId('hyperliquid', { oid: 456 })).toBe('456')
  expect(nativeOrderId('hyperliquid', { oid: 9007199254740992 })).toBeNull()
})
test('uncertain identical operations retain their original request key', () => {
  const keys = new OperationKeys()
  const payload = { action: 'margin', amount: '1' }
  expect(keys.key(payload)).toBe(keys.key(payload))
  expect(keys.key({ ...payload, amount: '2' })).not.toBe(keys.key(payload))
})
test('malformed snapshot cannot invent empty orders', () => {
  expect(nativeSnapshotSchema.safeParse({ open_orders: [] }).success).toBe(
    false,
  )
})
test('explicitly normalized native Lighter indexes are accepted without treating client indexes as exchange IDs', () => {
  expect(
    nativeOrderId('lighter', {
      exchange_order_id: '77',
      client_order_index: 9,
    }),
  ).toBe('77')
  expect(
    nativeSnapshotSchema.safeParse({
      connector_name: 'lighter',
      trading_pair: 'BTC-USDC',
      open_orders: [],
      order_history: [],
      fills: [],
      account: {},
      fills_next_start_time: null,
    }).success,
  ).toBe(true)
})

test('unknown exchange outcomes are never presented as accepted', () => {
  expect(() =>
    requireOperationAccepted({
      status: 'unknown',
      result: { error: 'Inspect exchange' },
    }),
  ).toThrow('Inspect exchange')
  expect(() =>
    requireOperationAccepted({ status: 'accepted', result: {} }),
  ).not.toThrow()
})

test('account snapshots cannot cross spot/perpetual or selected venue scope', () => {
  const snapshot = {
    connector_name: 'hyperliquid_perpetual',
    trading_pair: 'BTC-USD',
    open_orders: [],
    order_history: [],
    fills: [],
    account: {},
  }
  expect(
    parseNativeSnapshot(snapshot, 'hyperliquid', 'perpetual', 'BTC-USDC')
      .trading_pair,
  ).toBe('BTC-USD')
  expect(() =>
    parseNativeSnapshot(snapshot, 'hyperliquid', 'spot', 'BTC-USDC'),
  ).toThrow('selected account market')
  expect(() =>
    parseNativeSnapshot(snapshot, 'lighter', 'perpetual', 'BTC-USDC'),
  ).toThrow('selected account market')
})

test('a confirmed completed operation permits a new intentional operation with the same values', () => {
  const keys = new OperationKeys()
  const payload = { action: 'margin', amount: '100' }
  const old = keys.key(payload)
  keys.complete(payload)
  expect(keys.key(payload)).not.toBe(old)
})
