import { describe, expect, test } from 'bun:test'
import { workflowBudgetError } from '../workflow-ticket'

describe('explicit workflow exposure budget', () => {
  test('blank input directs the trader to the currency-denominated field', () => {
    expect(workflowBudgetError(' ', 'USDC')).toContain('budget field above')
    expect(workflowBudgetError('', 'USDC')).toContain('USDC')
  })
  test('rejects invalid and nonfinite caps before submission', () => {
    for (const value of ['0', '-1', 'NaN', 'Infinity', '1e999', '1,000', '1e3', ' 100 ', '.5', '01', '1'.repeat(41)]) {
      expect(workflowBudgetError(value, 'USDC')).not.toBeNull()
    }
  })
  test('accepts an explicitly entered positive decimal cap without changing it', () => {
    expect(workflowBudgetError('432.63', 'USDC')).toBeNull()
  })
})


