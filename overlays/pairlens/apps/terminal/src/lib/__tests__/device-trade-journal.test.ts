import { expect, test } from 'bun:test'
import {
  DEVICE_TRADE_JOURNAL_KEY,
  createDeviceTradeJournal,
} from '../device-trade-journal'

function fixture() {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
  return { values, storage, journal: createDeviceTradeJournal(() => storage) }
}
const trade = {
  market: 'lighter',
  pairKey: 'GRAM-USDC-USDC',
  side: 'buy' as const,
  price: 1.4,
  quantity: 100,
  notes: 'Manual observation',
  tags: ['review'],
}

test('device journal survives a new reader without implying exchange fills', () => {
  const { journal, storage } = fixture()
  const entry = journal.add(trade)
  expect(entry).toMatchObject(trade)
  expect(entry.id).toBeString()
  expect(entry.createdAt).toBeGreaterThan(0)
  expect(createDeviceTradeJournal(() => storage).read()).toEqual([entry])
})
test('device journal filters market and pair before applying limit, newest first', () => {
  const { journal } = fixture()
  journal.add(trade)
  const latest = journal.add({ ...trade, quantity: 101 })
  journal.add({ ...trade, market: 'hyperliquid' })
  journal.add({ ...trade, pairKey: 'PRL-USDC-USDC' })
  expect(
    journal.read({ market: 'lighter', pairKey: 'gram-usdc-usdc', limit: 1 }),
  ).toEqual([latest])
  expect(journal.read({ market: 'binance' })).toEqual([])
  expect(() => journal.read({ limit: 0 })).toThrow()
})
test('corrupt journal stays unavailable and cannot be overwritten as empty', () => {
  const { journal, values } = fixture()
  values.set(DEVICE_TRADE_JOURNAL_KEY, 'not JSON')
  expect(() => journal.read()).toThrow('could not be read')
  expect(() => journal.add(trade)).toThrow('could not be read')
  expect(values.get(DEVICE_TRADE_JOURNAL_KEY)).toBe('not JSON')
})
test('invalid stored records and invalid trade values are rejected', () => {
  const { journal, values } = fixture()
  expect(() => journal.add({ ...trade, quantity: -1 })).toThrow()
  values.set(
    DEVICE_TRADE_JOURNAL_KEY,
    JSON.stringify([{ ...trade, id: 'a', createdAt: 1, price: 'oops' }]),
  )
  expect(() => journal.read()).toThrow('could not be read')
})
test('unavailable or full storage never acknowledges a successful journal write', () => {
  const journal = createDeviceTradeJournal(() => ({
    getItem: () => null,
    setItem: () => {
      throw new Error('quota')
    },
  }))
  expect(() => journal.add(trade)).toThrow('not saved')
  expect(() =>
    createDeviceTradeJournal(() => {
      throw new Error('blocked')
    }).read(),
  ).toThrow('could not be read')
  expect(() =>
    createDeviceTradeJournal(() => ({
      getItem: () => null,
      setItem: () => undefined,
    })).add(trade),
  ).toThrow('not saved')
})
