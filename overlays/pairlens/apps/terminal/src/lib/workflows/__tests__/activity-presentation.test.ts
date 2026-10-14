import { describe, expect, test } from 'bun:test'
import {
  groupActivityMarkets,
  matchesActivityFilter,
  positiveActivityValue,
  visibleActivityRows,
} from '../activity-presentation'
import type { ActivityRow } from '../live-activity'

const row = (changes: Partial<ActivityRow> = {}): ActivityRow => ({
  id: '1',
  kind: 'order',
  name: 'limit',
  venue: 'lighter',
  symbol: 'PUMP-USDC',
  marketType: 'perpetual',
  accountName: 'desk',
  mode: 'live',
  status: 'open',
  steps: [],
  scopeMismatch: false,
  ...changes,
})

describe('activity management presentation', () => {
  test('current excludes historical and finished runs but keeps paused current plans', () => {
    const rows = [
      row(),
      row({ id: '2', status: 'completed' }),
      row({ id: '3', scopeMismatch: true }),
      row({ id: '4', status: 'paused' }),
    ]
    expect(
      visibleActivityRows(rows, 'current', '', 'all').map((value) => value.id),
    ).toEqual(['1', '4'])
    expect(visibleActivityRows(rows, 'history', '', 'all')).toHaveLength(4)
  })
  test('search and venue operate together without hiding diagnostics', () => {
    const rows = [
      row(),
      row({
        id: '2',
        venue: 'hyperliquid',
        name: 'PUMP plan',
        error: 'Paused',
      }),
    ]
    expect(
      visibleActivityRows(rows, 'current', 'pump', 'hyperliquid').map(
        (value) => value.id,
      ),
    ).toEqual(['2'])
    expect(
      visibleActivityRows(rows, 'current', 'DESK', 'lighter'),
    ).toHaveLength(1)
  })
  test('groups instruments by exact venue, account, mode and market type', () => {
    const groups = groupActivityMarkets([
      row(),
      row({ id: '2' }),
      row({ id: '3', venue: 'hyperliquid' }),
    ])
    expect(groups.map((group) => group.rows.length)).toEqual([1, 2])
  })
  test('keeps market group order stable across exchange response ordering', () => {
    const rows = [
      row(),
      row({ id: '2', symbol: 'GRASS-USDC' }),
      row({ id: '3', venue: 'hyperliquid' }),
    ]
    expect(groupActivityMarkets(rows).map((group) => group.key)).toEqual(
      groupActivityMarkets([...rows].reverse()).map((group) => group.key),
    )
  })
  test('zero and unavailable trigger prices are absent', () => {
    expect(positiveActivityValue('0.000000')).toBeUndefined()
    expect(positiveActivityValue(undefined)).toBeUndefined()
    expect(positiveActivityValue('0.68000')).toBe('0.68000')
  })
})

describe('activity filters', () => {
  test('keeps waiting fills and submitted orders visible as pending', () => {
    for (const status of ['waiting-fill', 'submitted', 'open', 'active'])
      expect(matchesActivityFilter(status, 'pending')).toBe(true)
    expect(matchesActivityFilter('completed', 'pending')).toBe(false)
  })
  test('surfaces paused, uncertain and failed outcomes', () => {
    for (const status of ['paused', 'unverified', 'failed'])
      expect(matchesActivityFilter(status, 'attention')).toBe(true)
    expect(matchesActivityFilter('active', 'attention', 'Read failed')).toBe(
      true,
    )
  })
  test('does not label submitted protective orders completed', () => {
    expect(matchesActivityFilter('submitted', 'finished')).toBe(false)
    expect(matchesActivityFilter('completed', 'finished')).toBe(true)
    expect(matchesActivityFilter('accepted', 'pending')).toBe(false)
  })
})
