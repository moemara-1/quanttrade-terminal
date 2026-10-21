import { afterEach, expect, test } from 'bun:test'
import { getTradingAgentDraft, setTradingAgentDraft, subscribeTradingAgentDraft, takeTradingAgentDraft } from '../trading-agent-draft'

afterEach(() => { takeTradingAgentDraft() })
test('agent review drafts are cloned, observable and consumed without persisting or executing', () => {
  let updates = 0
  const unsubscribe = subscribeTradingAgentDraft(() => { updates++ })
  const value = { requestId: 'draft', config: { name: 'Reviewed agent' }, missingFields: ['leverage'] }
  setTradingAgentDraft(value)
  value.config.name = 'mutated'
  expect(getTradingAgentDraft()?.config.name).toBe('Reviewed agent')
  const read = getTradingAgentDraft()!
  read.missingFields.length = 0
  expect(takeTradingAgentDraft()?.missingFields).toEqual(['leverage'])
  expect(getTradingAgentDraft()).toBeNull()
  expect(updates).toBe(2)
  unsubscribe()
})
