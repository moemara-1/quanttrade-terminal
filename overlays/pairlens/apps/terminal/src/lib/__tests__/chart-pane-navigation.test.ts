import { expect, test } from 'bun:test'
import { resolveVenueInstrument } from '@/lib/venue-instrument'
import { panePairForVenueSwitch } from '@/lib/pane-venue-target'
import {
  chartSnapshotReady,
  followBoard,
  paneInstrumentRef,
  paneStreamMarket,
  writePaneInstrument,
  writePaneTimeframe,
} from '@/lib/chart-pane-navigation'

test('legacy two-part native perpetual pins resolve recovery against perpetual listings', () => {
  expect(
    paneInstrumentRef({ pairKey: 'PUFFER-USDT', market: 'lighter' }),
  ).toEqual({ cls: 'perp', market: 'lighter', id: 'PUFFER-USDT-USDT' })
  expect(
    paneInstrumentRef({ pairKey: 'BTC-USDC', market: 'hyperliquid' }),
  ).toEqual({ cls: 'perp', market: 'hyperliquid', id: 'BTC-USDC-USDC' })
  expect(
    paneInstrumentRef({ pairKey: 'BTC-USDC', market: 'lighter-spot' }),
  ).toEqual({ cls: 'spot', market: 'lighter-spot', id: 'BTC-USDC' })
  expect(
    paneInstrumentRef({
      pairKey: 'PUFFER-USDT-USDT',
      market: 'binance-futures',
    }),
  ).toEqual({ cls: 'perp', market: 'binance-futures', id: 'PUFFER-USDT-USDT' })
})

test('an explicit assistant switch updates only the active pane owner, atomically preserving native venue and symbol', () => {
  const commands: Array<unknown> = []
  const pane = {
    pairSource: 'override' as const,
    setPaneOverride: (slot: string, value: unknown) =>
      commands.push({ slot, value }),
    setVariableValue: (value: unknown) => commands.push({ variable: value }),
  }
  const target = {
    cls: 'perp' as const,
    market: 'lighter',
    id: 'DASH-USDC-USDC',
  }
  expect(writePaneInstrument(target, pane)).toBe(true)
  expect(commands).toEqual([
    {
      slot: 'active-pair',
      value: { pairKey: 'DASH-USDC-USDC', market: 'lighter' },
    },
  ])
  commands.length = 0
  expect(writePaneInstrument(target, { ...pane, pairSource: 'variable' })).toBe(
    true,
  )
  expect(commands).toEqual([
    { variable: { pairKey: 'DASH-USDC-USDC', market: 'lighter' } },
  ])
  commands.length = 0
  expect(writePaneInstrument(target, { ...pane, pairSource: 'global' })).toBe(
    false,
  )
  expect(writePaneInstrument(target, null)).toBe(false)
  expect(commands).toEqual([])
})

test('an invalid native pin can recover onto an exact listed Binance perpetual without clearing unrelated pins', () => {
  const pin = { pairKey: 'PUFFER-USDT', market: 'lighter' }
  const ref = resolveVenueInstrument(
    paneInstrumentRef(pin),
    'binance-futures',
    [
      {
        market: 'binance-futures',
        symbol: 'PUFFER-USDT-USDT',
        base: 'PUFFER',
        quote: 'USDT',
        settle: 'USDT',
        kind: 'cex-derivative',
        contract: 'perp',
        linear: true,
      },
    ],
  )
  expect(panePairForVenueSwitch(pin, 'binance-futures', { ref })).toEqual({
    pairKey: 'PUFFER-USDT-USDT',
    market: 'binance-futures',
  })
  expect(
    panePairForVenueSwitch(pin, 'binance-futures', { ref: null }),
  ).toBeNull()
})

test('follow board clears both hidden binding and visible pin', () => {
  const commands: Array<string> = []
  followBoard({
    clearPaneOverride: (slot) => commands.push(`override:${slot}`),
    clearPaneBinding: (slot) => commands.push(`binding:${slot}`),
  })
  expect(commands).toEqual(['override:active-pair', 'binding:active-pair'])
})
test('global panes with a timeframe override still stream the global venue', () => {
  expect(paneStreamMarket({ market: 'lighter' })).toBe('lighter')
  expect(paneStreamMarket({ market: 'hyperliquid' })).toBe('hyperliquid')
})

test('bound timeframe toolbar writes variable, while an explicit override retains precedence', () => {
  const writes: Array<string> = []
  const pane = {
    override: undefined as string | undefined,
    variable: 'interval',
    setOverride: (value: string) => writes.push(`pin:${value}`),
    setVariable: (name: string, value: string) =>
      writes.push(`${name}:${value}`),
  }
  writePaneTimeframe('4h', pane)
  writePaneTimeframe('1d', { ...pane, override: '1h' })
  expect(writes).toEqual(['interval:4h', 'pin:1d'])
})

test('snapshot readiness rejects old engine and same-pair venue transition until new stream snapshot', () => {
  const ready = {
    hasSnapshot: true,
    noData: false,
    pair: 'ETH-USDC',
    timeframe: '1h',
    enginePair: 'ETH-USDC',
    engineTimeframe: '1h',
  }
  expect(chartSnapshotReady(ready)).toBe(true)
  expect(chartSnapshotReady({ ...ready, hasSnapshot: false })).toBe(false)
  expect(chartSnapshotReady({ ...ready, enginePair: 'PUFFER-USDT' })).toBe(
    false,
  )
  expect(chartSnapshotReady({ ...ready, engineTimeframe: '15m' })).toBe(false)
  expect(chartSnapshotReady({ ...ready, noData: true })).toBe(false)
})
