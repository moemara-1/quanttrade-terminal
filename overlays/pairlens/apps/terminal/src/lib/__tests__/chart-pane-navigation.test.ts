import { expect, test } from 'bun:test'
import {
  followBoard,
  paneStreamMarket,
  writePaneTimeframe,
} from '@/lib/chart-pane-navigation'

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
