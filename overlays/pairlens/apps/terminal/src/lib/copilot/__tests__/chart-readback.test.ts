import { expect, test } from 'bun:test'
import { buildChartTools } from '../chart-tools'

test('missing chart reads are unavailable, never empty drawings or indicators', async () => {
  const tools = buildChartTools({ getChartSnapshot: () => null })
  const options = { toolCallId: 'read', messages: [] }
  expect(await tools.get_chart_drawings.execute?.({}, options)).toMatchObject({ available: false, drawings: null })
  expect(await tools.get_chart_indicators.execute?.({}, options)).toMatchObject({ available: false, indicators: null })
})

test('verified chart reads carry the actual chart identity and geometry', async () => {
  const tools = buildChartTools({ getChartSnapshot: () => ({ market: 'lighter', pair: 'DASH-USDC-USDC', timeframe: '1h', drawings: [{ id: 'level', type: 'hline', price: 100 }], indicators: [] }) })
  const options = { toolCallId: 'read', messages: [] }
  const expected = { available: true, target: { market: 'lighter', pair: 'DASH-USDC-USDC', timeframe: '1h' } }
  expect(await tools.get_chart_state.execute?.({}, options)).toMatchObject(expected)
  expect(await tools.get_chart_drawings.execute?.({}, options)).toMatchObject({ ...expected, drawings: [{ id: 'level', type: 'hline', price: 100 }] })
})
