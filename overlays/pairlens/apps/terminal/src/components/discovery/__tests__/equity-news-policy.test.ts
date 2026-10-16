import { describe, expect, test } from 'bun:test'

import { equityNewsTopics } from '../equity-news-policy'

describe('equities discovery wire', () => {
  test('All selects genuine markets coverage without requiring a ticker mention', () => {
    expect(equityNewsTopics('all')).toBe('financial_markets')
  })

  test('Earnings requires the markets wire and the earnings topic together', () => {
    expect(equityNewsTopics('assets')).toBe('financial_markets,earnings')
  })

  test('Macro remains a cross-asset economy feed', () => {
    expect(equityNewsTopics('macro')).toBe('economy_macro')
  })
})
