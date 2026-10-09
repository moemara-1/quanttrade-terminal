import { expect, test } from 'bun:test'
import { workflowOcoReview } from '../workflow-review'

test('Hyperliquid review identifies the attached grouping and pre-submission reference price', () => {
  const copy = workflowOcoReview('hyperliquid')
  expect(copy).toContain('entry and paired TP/SL together')
  expect(copy).toContain('two matching 100%')
  expect(copy).toContain('entry limit price or a fresh quote')
  expect(copy).not.toContain('entry is submitted separately')
})
test('Lighter review identifies post-fill exits and the protection gap', () => {
  const copy = workflowOcoReview('lighter')
  expect(copy).toContain('entry fill is confirmed')
  expect(copy).toContain('actual parent fill')
  expect(copy).toContain('not protected until')
})
test('spot does not inherit perpetual native OCO promises', () => {
  expect(workflowOcoReview('hyperliquid-spot')).toContain('spot OCO is unavailable')
  expect(workflowOcoReview('lighter-spot')).toContain('spot OCO is unavailable')
})
