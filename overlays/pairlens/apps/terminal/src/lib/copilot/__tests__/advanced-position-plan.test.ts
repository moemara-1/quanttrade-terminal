import { readFileSync } from 'node:fs'
import { expect, test } from 'bun:test'
import { compilePositionPlan } from '../advanced-position-plan'

const market = {
  sizeDecimals: 2,
  priceDecimals: 4,
  minSize: '0.01',
  minNotional: '1',
  maxLeverage: 3,
}
const scope = {
  market: 'lighter',
  pair: 'PRL-USDC-USDC',
  side: 'buy',
  totalSize: '12',
  maxTotalNotional: '100',
  leverage: 3,
  marginMode: 'cross',
}

test('the signer/runner integration fixture exactly matches the assistant compiler', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        '../../../../../../../../tests/fixtures/iceberg-position-plan.json',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  expect(
    JSON.parse(JSON.stringify(compilePositionPlan(fixture.raw, market))),
  ).toEqual(fixture.compiled)
})

test('scale prepares every exact limit in one immutable plan without an implicit entry', () => {
  const result = compilePositionPlan(
    { ...scope, kind: 'scale', count: 3, lowerPrice: '1.3', upperPrice: '1.5' },
    market,
  )
  expect(
    result.workflow.graph.steps
      .filter((node) => node.type === 'limit-order')
      .map((node) => node.data),
  ).toEqual([
    {
      side: 'inherit',
      sizeMode: 'absolute',
      size: 4,
      priceMode: 'absolute',
      priceValue: 1.3,
    },
    {
      side: 'inherit',
      sizeMode: 'absolute',
      size: 4,
      priceMode: 'absolute',
      priceValue: 1.4,
    },
    {
      side: 'inherit',
      sizeMode: 'absolute',
      size: 4,
      priceMode: 'absolute',
      priceValue: 1.5,
    },
  ])
  expect(result.workflow.graph.edges.map((edge) => edge.source)).toEqual([
    'trigger',
    'trigger',
    'trigger',
  ])
})

test('iceberg exposes only the reviewed display size and waits for each fill', () => {
  const result = compilePositionPlan(
    { ...scope, kind: 'iceberg', displaySize: '5', limitPrice: '1.4' },
    market,
  )
  expect(
    result.workflow.graph.steps
      .filter((node) => node.type === 'limit-order')
      .map((node) => node.data.size),
  ).toEqual([5, 5, 2])
  expect(
    result.workflow.graph.edges.map((edge) => [edge.source, edge.target]),
  ).toEqual([
    ['trigger', 'entry-1'],
    ['entry-1', 'entry-2'],
    ['entry-2', 'entry-3'],
  ])
})

test('allocations never round above the reviewed total', () => {
  const result = compilePositionPlan(
    {
      ...scope,
      totalSize: '12.01',
      kind: 'scale',
      count: 3,
      lowerPrice: '1.3',
      upperPrice: '1.5',
    },
    market,
  )
  expect(
    result.workflow.graph.steps
      .filter((node) => node.type === 'limit-order')
      .map((node) => node.data.size),
  ).toEqual([4.01, 4, 4])
})

test('multiple targets receive paired native SL coverage and all entry dependencies', () => {
  const result = compilePositionPlan(
    {
      ...scope,
      kind: 'iceberg',
      displaySize: '6',
      limitPrice: '1.4',
      stopLoss: '1.2',
      takeProfits: [
        { price: '1.5', percent: 40 },
        { price: '1.6', percent: 60 },
      ],
    },
    market,
  )
  expect(result.workflow.graph.oco).toBe(true)
  expect(
    result.workflow.graph.steps
      .filter((node) => node.type === 'limit-order')
      .map((node) => node.data.size),
  ).toEqual([2.4, 3.6, 2.4, 3.6])
  expect(
    result.workflow.graph.steps.filter((node) => node.type === 'stop-loss'),
  ).toHaveLength(4)
  expect(
    result.workflow.graph.edges
      .filter((edge) => edge.target === 'entry-2-1')
      .map((edge) => edge.source),
  ).toEqual(['entry-1-1', 'entry-1-2'])
})

test('invalid precision, partial TP coverage, minima and inadequate gross cap cannot prepare', () => {
  const base = {
    ...scope,
    kind: 'scale',
    count: 3,
    lowerPrice: '1.3',
    upperPrice: '1.5',
  }
  for (const patch of [
    { leverage: 5 },
    { totalSize: '12.001' },
    { maxTotalNotional: '1' },
    { totalSize: '0.03' },
    { stopLoss: '1.6' },
    { takeProfits: [{ price: '1.6', percent: 40 }] },
  ]) {
    expect(() => compilePositionPlan({ ...base, ...patch }, market)).toThrow()
  }
})

test('managed TWAP reviews every timed market slice and includes an explicit immediate entry', () => {
  const result = compilePositionPlan(
    {
      ...scope,
      market: 'hyperliquid',
      kind: 'twap',
      count: 3,
      intervalSeconds: 30,
    },
    { ...market, price: '1.4' },
  )
  expect(result.type).toBe('market')
  expect(result.exactPrice).toBeUndefined()
  expect(
    result.workflow.graph.steps
      .filter((node) => node.type === 'market-order')
      .map((node) => node.data.size),
  ).toEqual([4, 4, 4])
  expect(
    result.workflow.graph.steps
      .filter((node) => node.type === 'wait')
      .map((node) => node.data.duration),
  ).toEqual([30, 60])
  expect(result.reason).toContain('managed')
})
