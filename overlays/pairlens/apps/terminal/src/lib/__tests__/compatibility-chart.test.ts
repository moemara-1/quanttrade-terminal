import { expect, test } from 'bun:test'
import {
  CompatibilityChartController,
  compatibilityDrawing,
  isGraphicsUnavailable,
} from '@/lib/compatibility-chart'

const bars = Array.from({ length: 240 }, (_, index) => ({
  ts: 1700000040000 + index * 60000,
  open: index + 10,
  high: index + 12,
  low: index + 9,
  close: index + 11,
  volume: 20,
}))
function chart() {
  const controller = new CompatibilityChartController('1m')
  controller.configure([{ id: 'ETH-USDC', bars }], '1m')
  controller.resize(870, 424)
  return controller
}
test('fallback geometry roundtrips and viewport pans/zooms', () => {
  const controller = chart()
  expect(
    controller.coordinateToPrice(controller.priceToCoordinate(150)),
  ).toBeCloseTo(150)
  const ts = bars[180].ts
  expect(controller.coordinateToTime(controller.timeToCoordinate(ts))).toBe(ts)
  const before = controller.getSnapshot().viewport
  controller.pan(-10)
  expect(controller.getSnapshot().viewport.endIndex).toBe(before.endIndex - 10)
  controller.zoom(0.5)
  const after = controller.getSnapshot().viewport
  expect(after.endIndex - after.startIndex).toBeCloseTo(
    (before.endIndex - before.startIndex) / 2,
  )
})
test('fallback draws supported geometry and rejects unrenderable commands', () => {
  const controller = chart()
  expect(
    controller.executeCommand({
      type: 'addDrawing',
      payload: {
        id: 'support',
        type: 'hline',
        price: 150,
        color: '#fff',
        lineWidth: 1,
        visible: true,
      },
    }).ok,
  ).toBe(true)
  expect(controller.getSnapshot().drawings[0]).toMatchObject({
    id: 'support',
    price: 150,
  })
  expect(
    controller.executeCommand({
      type: 'setQuoteLines',
      payload: { bid: 1, ask: 2 },
    }).ok,
  ).toBe(false)
  expect(
    controller.executeCommand({
      type: 'addIndicator',
      payload: { type: 'sma' },
    }).ok,
  ).toBe(false)
  expect(compatibilityDrawing({ id: 'bad', type: 'hline', price: NaN })).toBe(
    false,
  )
  controller.configure([{ id: 'ETH-USDC', bars }], '1m')
  expect(controller.getSnapshot().drawings).toHaveLength(1)
  controller.configure([{ id: 'DASH-USDC', bars }], '1m')
  expect(controller.seriesOrder()).toEqual(['DASH-USDC'])
  expect(controller.getSnapshot().drawings).toEqual([])
})
test('live updates and subscription cleanup', () => {
  const controller = chart()
  let notifications = 0
  const stop = controller.listen(() => notifications++)
  controller.applyTick({
    seriesId: 'ETH-USDC',
    ts: bars.at(-1)!.ts,
    price: 300,
  })
  expect(controller.data().at(-1)?.close).toBe(300)
  expect(notifications).toBe(1)
  stop()
  controller.appendBar({
    seriesId: 'ETH-USDC',
    bar: { ...bars[0], ts: bars.at(-1)!.ts + 60000 },
  })
  expect(controller.data()).toHaveLength(241)
  expect(notifications).toBe(1)
})
test('only GPU failures select fallback', () => {
  expect(
    isGraphicsUnavailable(
      new Error('WebGL2 is required for FastFinancialChart'),
    ),
  ).toBe(true)
  expect(isGraphicsUnavailable(new Error('invalid drawing'))).toBe(false)
})

test('ticker buckets, volume deltas and live edge follow match candle stream semantics', () => {
  const controller = chart()
  const last = bars.at(-1)!
  const size = controller.data().length
  controller.applyTick({
    seriesId: 'ETH-USDC',
    ts: last.ts + 15000,
    price: 400,
    volume: 3,
  })
  expect(controller.data()).toHaveLength(size)
  expect(controller.data().at(-1)?.volume).toBe(last.volume + 3)
  const edge = controller.getSnapshot().viewport.endIndex
  controller.applyTick({
    seriesId: 'ETH-USDC',
    ts: last.ts + 60000,
    price: 401,
  })
  expect(controller.data()).toHaveLength(size + 1)
  expect(controller.getSnapshot().viewport.endIndex).toBe(edge + 1)
  controller.pan(-30)
  const historical = controller.getSnapshot().viewport
  controller.applyTick({
    seriesId: 'ETH-USDC',
    ts: last.ts + 120000,
    price: 402,
  })
  expect(controller.getSnapshot().viewport).toEqual(historical)
  controller.applyTick({
    seriesId: 'ETH-USDC',
    ts: bars[100].ts + 1000,
    price: 999,
    volume: 2,
  })
  expect(controller.data()[100].close).toBe(999)
})
test('restoring unsupported saved drawings retains them after new supported writes', () => {
  const controller = chart()
  const saved = {
    id: 'old-ray',
    type: 'ray' as const,
    color: '#fff',
    lineWidth: 1,
    visible: true,
    points: [
      { ts: bars[0].ts, price: 5 },
      { ts: bars[1].ts, price: 6 },
    ] as [{ ts: number; price: number }, { ts: number; price: number }],
  }
  expect(
    controller.executeCommand({
      type: 'setDrawings',
      payload: { drawings: [saved] },
    }).ok,
  ).toBe(true)
  controller.executeCommand({
    type: 'addDrawing',
    payload: {
      id: 'new',
      type: 'hline',
      price: 10,
      color: '#fff',
      lineWidth: 1,
      visible: true,
    },
  })
  expect(controller.getSnapshot().drawings).toContainEqual(saved)
  expect(controller.getSnapshot().drawings).toHaveLength(2)
  expect(controller.timeToCoordinate(bars[100].ts + 30000)).toBeGreaterThan(
    controller.timeToCoordinate(bars[100].ts),
  )
})
