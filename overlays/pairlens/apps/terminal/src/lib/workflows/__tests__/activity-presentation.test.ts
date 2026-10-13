import { describe, expect, test } from 'bun:test'
import { matchesActivityFilter } from '../activity-presentation'

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
