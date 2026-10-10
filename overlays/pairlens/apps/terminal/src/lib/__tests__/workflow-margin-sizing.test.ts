import { describe, expect, test } from 'bun:test'

import { sizeWorkflowFromMargin } from '../trading/workflow-margin-sizing'

const trigger = { id: 'root', type: 'trigger', data: {} }
const buy = (id: string, size = 100) => ({
  id,
  type: 'market-order',
  data: { side: 'inherit', sizeMode: 'percent', size },
})
const edge = (source: string, target: string) => ({ source, target })
const calculate = (
  steps: Array<{ id: string; type: string; data: Record<string, unknown> }>,
  edges: Array<{ source: string; target: string }>,
  overrides = {},
) =>
  sizeWorkflowFromMargin({
    graph: { steps, edges },
    margin: '200',
    leverage: 5,
    markPrice: '2',
    sizeDecimals: 3,
    side: 'buy',
    ...overrides,
  })

describe('workflow total margin sizing', () => {
  test('workflow exit budget uses weighted entry prices rather than the last entry price', () => {
    const limit = { id: 'b', type: 'limit-order', data: { side: 'inherit', sizeMode: 'percent', size: 100, priceMode: 'absolute', priceValue: 4 } }
    const exit = { id: 'tp', type: 'take-profit', data: { sizeScope: 'workflow', triggerMode: 'percent', triggerValue: 10, sizePercent: 100, orderType: 'market' } }
    const result = calculate([trigger, buy('a'), limit, exit], [edge('root', 'a'), edge('a', 'b'), edge('b', 'tp')])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.maxTotalNotional).toBe('2310')
  })
  test('workflow protection sizes all four entries without any preexisting position input', () => {
    const exits = ['stop-loss', 'take-profit'].map((type) => ({ id: type, type, data: { sizeScope: 'workflow', triggerMode: 'percent', triggerValue: 10, sizePercent: 100, orderType: 'market' } }))
    const entries = ['a', 'b', 'c', 'd'].map((id) => buy(id))
    const result = calculate([trigger, ...entries, ...exits], [edge('root', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), ...exits.map((exit) => edge('d', exit.id))])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.inputSize).toBe('125')
      expect(result.totalEntryQuote).toBe('1000')
      expect(result.maxTotalNotional).toBe('3410')
    }
    expect(calculate([trigger, ...entries, ...exits], [edge('root', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), ...exits.map((exit) => edge('a', exit.id))]).ok).toBe(false)
  })
  test('validates each slice against exchange minimums', () => {
    expect(calculate([trigger, buy('a', 1)], [edge('root', 'a')], { minSize: '600' }).ok).toBe(false)
    expect(calculate([trigger, buy('a')], [edge('root', 'a')], { minNotional: '1001' }).ok).toBe(false)
  })
  test('adds configured execution allowance before future price headroom', () => {
    const result = calculate([trigger, buy('a')], [edge('root', 'a')], {
      maxPriceDeviationBps: 2000,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.maxTotalNotional).toBe('1320')
  })
  test('rejects exits following exits instead of guessing fill-dependent inherited sizes', () => {
    const exit = (id: string) => ({
      id,
      type: 'take-profit',
      data: {
        triggerMode: 'percent',
        triggerValue: 5,
        sizePercent: 50,
        orderType: 'market',
      },
    })
    expect(
      calculate(
        [trigger, buy('a'), exit('x'), exit('y')],
        [edge('root', 'a'), edge('a', 'x'), edge('x', 'y')],
      ).ok,
    ).toBe(false)
  })
  test('counts three delayed buys, never trigger as a fourth buy', () => {
    const result = calculate(
      [trigger, buy('a'), buy('b'), buy('c')],
      [edge('root', 'a'), edge('a', 'b'), edge('b', 'c')],
    )
    expect(result).toEqual({
      ok: true,
      inputSize: '166.666',
      totalEntryQuote: '999.996',
      estimatedMargin: '199.9992',
      maxTotalNotional: '1100',
      entryCount: 3,
      priceHeadroomPercent: 10,
    })
  })
  test('serial percentages compound inherited rounded size', () => {
    const result = calculate(
      [trigger, buy('a', 50), buy('b', 50)],
      [edge('root', 'a'), edge('a', 'b')],
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.inputSize).toBe('666.666')
      expect(result.totalEntryQuote).toBe('999.998')
    }
  })
  test('includes both OCO exits with conservative trigger price and price headroom', () => {
    const exits = ['stop-loss', 'take-profit'].map((type, i) => ({
      id: type,
      type,
      data: {
        triggerMode: 'percent',
        triggerValue: i ? 10 : 5,
        sizePercent: 100,
        orderType: 'market',
      },
    }))
    const result = calculate(
      [trigger, buy('a'), ...exits],
      [edge('root', 'a'), ...exits.map((node) => edge('a', node.id))],
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.maxTotalNotional).toBe('3410')
  })
  test('prices absolute and offset limits conservatively', () => {
    const order = {
      id: 'a',
      type: 'limit-order',
      data: {
        side: 'inherit',
        sizeMode: 'percent',
        size: 100,
        priceMode: 'offset-percent',
        priceValue: 50,
      },
    }
    const result = calculate([trigger, order], [edge('root', 'a')])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.inputSize).toBe('333.333')
      expect(result.totalEntryQuote).toBe('999.999')
      expect(result.maxTotalNotional).toBe('1100')
    }
  })
  test('rounding that erases an entry fails instead of returning a runnable plan', () => {
    expect(
      calculate([trigger, buy('a')], [edge('root', 'a')], {
        margin: '0.00001',
        sizeDecimals: 0,
      }).ok,
    ).toBe(false)
  })
  test('rejects unsupported conditional, fixed, joining and opposite orders', () => {
    const graphs = [
      [trigger, { id: 'a', type: 'condition', data: {} }],
      [
        trigger,
        {
          ...buy('a'),
          data: { side: 'inherit', sizeMode: 'absolute', size: 5 },
        },
      ],
      [
        trigger,
        {
          ...buy('a'),
          data: { side: 'opposite', sizeMode: 'percent', size: 100 },
        },
      ],
    ]
    for (const steps of graphs)
      expect(calculate(steps, [edge('root', 'a')]).ok).toBe(false)
    expect(
      calculate(
        [trigger, buy('a'), buy('b'), buy('c')],
        [edge('root', 'a'), edge('root', 'b'), edge('a', 'c'), edge('b', 'c')],
      ).ok,
    ).toBe(false)
  })
  test('rejects orphan, cycle, duplicate IDs and entries after exits', () => {
    expect(calculate([trigger, buy('a')], []).ok).toBe(false)
    expect(
      calculate([trigger, buy('a')], [edge('root', 'a'), edge('a', 'root')]).ok,
    ).toBe(false)
    expect(calculate([trigger, buy('root')], []).ok).toBe(false)
    const exit = {
      id: 'exit',
      type: 'take-profit',
      data: {
        triggerMode: 'percent',
        triggerValue: 5,
        sizePercent: 100,
        orderType: 'market',
      },
    }
    expect(
      calculate(
        [trigger, exit, buy('a')],
        [edge('root', 'exit'), edge('exit', 'a')],
      ).ok,
    ).toBe(false)
  })
  test('bounds numeric inputs and graph size', () => {
    for (const margin of [
      '',
      'Infinity',
      '1e999999',
      '-1',
      '0',
      '9'.repeat(41),
    ])
      expect(
        calculate([trigger, buy('a')], [edge('root', 'a')], { margin }).ok,
      ).toBe(false)
    for (const leverage of [0, 1.5, Infinity, 100000])
      expect(
        calculate([trigger, buy('a')], [edge('root', 'a')], { leverage }).ok,
      ).toBe(false)
    expect(
      calculate([trigger, buy('a', Infinity)], [edge('root', 'a')]).ok,
    ).toBe(false)
    expect(
      calculate([trigger, buy('a')], [edge('root', 'a')], { markPrice: '0' })
        .ok,
    ).toBe(false)
    expect(
      calculate([trigger, buy('a')], [edge('root', 'a')], { sizeDecimals: 101 })
        .ok,
    ).toBe(false)
  })
})
