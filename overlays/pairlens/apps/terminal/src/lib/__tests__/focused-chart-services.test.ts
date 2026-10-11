import { expect, test } from 'bun:test'
import { FocusedChartServices } from '@/lib/assistant-core/focused-chart-services'

test('assistant follows focused chart and falls back when it closes', () => {
  const active: Array<string | null> = []
  const registry = new FocusedChartServices<string>()
  const publish = (chart: string) => {
    active.push(chart)
    return () => active.push(null)
  }
  const gram = registry.register('GRAM', publish)
  const strk = registry.register('STRK', publish)
  expect(active.at(-1)).toBe('STRK')
  gram.activate()
  expect(active.at(-1)).toBe('GRAM')
  strk.dispose()
  expect(active.at(-1)).toBe('GRAM')
  const next = registry.register('STRK', publish)
  gram.activate()
  gram.dispose()
  expect(active.at(-1)).toBe('STRK')
  next.dispose()
  expect(active.at(-1)).toBeNull()
})
