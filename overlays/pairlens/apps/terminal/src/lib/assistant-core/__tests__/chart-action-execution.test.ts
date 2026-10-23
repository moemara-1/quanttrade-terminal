import { expect, test } from 'bun:test'
import { z } from 'zod'
import {
  bindAssistantChartActions,
  executeAssistantChartAction,
} from '../chart-action-execution'
import { getScreenshot } from '../screenshot-store'
import type { ChartServiceHandle } from '../chart-service'
import type { FastFinancialChartRef } from '@pairlens/fast-financial-charts/types'
import { buildChartTools } from '@/lib/copilot/chart-tools'

function fixture(
  options: {
    reject?: boolean
    omitWrite?: boolean
    enginePair?: string
    engineTimeframe?: string
    unpublished?: boolean
    publishedMarket?: string
  } = {},
) {
  const drawings: Array<{ id: string; type: string; price?: number }> = []
  let executions = 0
  let chartType = 'candles'
  let pendingChartType = ''
  const engine = {
    getSnapshot: () => ({
      timeframe: options.engineTimeframe ?? '1h',
      chartType,
      priceScaleMode: 'normal',
      indicators: [],
      drawings: drawings.slice(),
      viewport: { startIndex: 0, endIndex: 10 },
    }),
    executeCommand: (command: {
      type: string
      payload: Record<string, unknown>
    }) => {
      executions++
      if (options.reject) return { ok: false, error: 'Rejected drawing' }
      if (command.type === 'addDrawing') {
        const drawing = { ...command.payload, id: 'new-level' }
        if (!options.omitWrite)
          drawings.push(drawing as { id: string; type: string; price?: number })
        return { ok: true, result: drawing }
      }
      if (command.type === 'takeScreenshot')
        return {
          ok: true,
          result: { dataUrl: 'data:image/png;base64,fixture' },
        }
      return { ok: true }
    },
    data: () => [],
    seriesOrder: () => [options.enginePair ?? 'DASH-USDC'],
  } as unknown as FastFinancialChartRef
  const handle: ChartServiceHandle = {
    chartRef: { current: engine },
    market: 'hyperliquid',
    pair: 'DASH-USDC',
    timeframe: '1h',
    getSnapshot: () =>
      options.unpublished
        ? null
        : {
            market: options.publishedMarket ?? handle.market,
            pair: handle.pair,
            timeframe: handle.timeframe,
          },
    addIndicator: () => {},
    removeIndicator: () => {},
    removeAllIndicators: () => {},
    chartActions: {
      setChartType: (next: string) => {
        pendingChartType = next
      },
    } as unknown as ChartServiceHandle['chartActions'],
  }
  let current: ChartServiceHandle | null = handle
  const deps = {
    getChart: () => current,
    getFocus: () => ({
      market: 'hyperliquid',
      pair: 'DASH-USDC',
      timeframe: '1h',
    }),
  }
  return {
    handle,
    deps,
    drawings,
    executions: () => executions,
    pendingChartType: () => pendingChartType,
    setCurrent: (next: ChartServiceHandle | null) => {
      current = next
    },
    setChartType: (next: string) => {
      chartType = next
    },
  }
}

test('missing and crashed charts cannot acknowledge chart writes', () => {
  const f = fixture()
  f.setCurrent(null)
  expect(
    executeAssistantChartAction('draw_horizontal_line', { price: 50 }, f.deps)
      .status,
  ).toBe('unavailable')
  f.setCurrent(f.handle)
  f.handle.chartRef.current = null
  expect(
    executeAssistantChartAction('draw_horizontal_line', { price: 50 }, f.deps)
      .status,
  ).toBe('unavailable')
  expect(f.executions()).toBe(0)
})

test('wrong actual chart or explicit expected target is blocked before writing', () => {
  const f = fixture()
  f.handle.pair = 'PUFFER-USDT'
  expect(
    executeAssistantChartAction('draw_horizontal_line', { price: 50 }, f.deps)
      .status,
  ).toBe('target-mismatch')
  f.handle.pair = 'DASH-USDC'
  expect(
    executeAssistantChartAction(
      'draw_horizontal_line',
      { price: 50, chartTarget: { market: 'lighter', pair: 'DASH-USDC' } },
      f.deps,
    ).status,
  ).toBe('target-mismatch')
  expect(f.executions()).toBe(0)
})

test('stale engine data cannot masquerade as a newly switched handle', () => {
  for (const options of [
    { enginePair: 'PUFFER-USDT' },
    { engineTimeframe: '15m' },
  ]) {
    const f = fixture(options)
    expect(
      executeAssistantChartAction(
        'draw_horizontal_line',
        { price: 50 },
        f.deps,
      ),
    ).toMatchObject({ status: 'target-mismatch', verified: false })
    expect(f.executions()).toBe(0)
  }
})

test('unready venue streams and mismatched published identities block writes', () => {
  const unready = fixture({ unpublished: true })
  expect(
    executeAssistantChartAction(
      'draw_horizontal_line',
      { price: 50 },
      unready.deps,
    ),
  ).toMatchObject({ status: 'unavailable', verified: false })
  expect(unready.executions()).toBe(0)
  const stale = fixture({ publishedMarket: 'lighter' })
  expect(
    executeAssistantChartAction(
      'draw_horizontal_line',
      { price: 50 },
      stale.deps,
    ),
  ).toMatchObject({ status: 'target-mismatch', verified: false })
  expect(stale.executions()).toBe(0)
})

test('an engine rejection remains failed and unverified acceptance remains requested', () => {
  const rejected = fixture({ reject: true })
  expect(
    executeAssistantChartAction(
      'draw_horizontal_line',
      { price: 50 },
      rejected.deps,
    ),
  ).toMatchObject({ status: 'failed', verified: false })
  const omitted = fixture({ omitWrite: true })
  expect(
    executeAssistantChartAction(
      'draw_horizontal_line',
      { price: 50 },
      omitted.deps,
    ),
  ).toMatchObject({ status: 'requested', verified: false })
})

test('non-finite coordinates cannot poison the chart engine', () => {
  const f = fixture()
  expect(
    executeAssistantChartAction(
      'draw_horizontal_line',
      { price: Infinity },
      f.deps,
    ),
  ).toMatchObject({ status: 'failed', verified: false })
  expect(f.executions()).toBe(0)
})

test('drawing writes execute exactly once and return exact target and readback geometry', () => {
  const f = fixture()
  const result = executeAssistantChartAction(
    'draw_horizontal_line',
    { price: 50 },
    f.deps,
  )
  expect(result).toMatchObject({
    status: 'applied',
    verified: true,
    target: { market: 'hyperliquid', pair: 'DASH-USDC', timeframe: '1h' },
    drawing: { id: 'new-level', type: 'hline', price: 50 },
  })
  expect(f.executions()).toBe(1)
})

test('React chart settings are requested until readback reflects them', () => {
  const f = fixture()
  expect(
    executeAssistantChartAction(
      'set_chart_type',
      { chartType: 'line' },
      f.deps,
    ),
  ).toMatchObject({ status: 'requested', verified: false })
  expect(f.pendingChartType()).toBe('line')
})

test('screenshots stay in the image store and never enter model context', () => {
  const f = fixture()
  const result = executeAssistantChartAction(
    'take_screenshot',
    {},
    f.deps,
    'shot-1',
  )
  expect(result).toMatchObject({ status: 'applied', verified: true })
  expect(getScreenshot('shot-1')).toBe('data:image/png;base64,fixture')
  expect(JSON.stringify(result)).not.toContain('base64')
})

test('bound schemas accept explicit targets and run the single verified chart path', async () => {
  const f = fixture()
  const tools = bindAssistantChartActions(
    buildChartTools({} as Parameters<typeof buildChartTools>[0]),
    f.deps,
  )
  const definition = tools.draw_horizontal_line
  expect(definition.inputSchema).toBeInstanceOf(z.ZodObject)
  expect(
    await definition.execute?.(
      { price: 50, chartTarget: { market: 'hyperliquid', pair: 'DASH-USDC' } },
      { toolCallId: 'one', messages: [] },
    ),
  ).toMatchObject({ status: 'applied', verified: true })
  expect(f.executions()).toBe(1)
})
