import { expect, test } from 'bun:test'
import { workflowGraphReviewError, workflowOcoReview } from '../workflow-review'

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

test('trigger-connected Lighter exits do not promise to protect future entry fills', () => {
  const graph = { steps: [{ id: 'trigger', type: 'trigger' }, { id: 'entry', type: 'market-order' }, { id: 'sl', type: 'stop-loss' }], edges: [{ source: 'trigger', target: 'entry' }, { source: 'trigger', target: 'sl' }], oco: true }
  const copy = workflowOcoReview('lighter', graph)
  expect(copy).toContain('before the scheduled entries')
  expect(copy).toContain('existing position')
  expect(copy).not.toContain('actual parent fill')
  const unpaired = workflowOcoReview('lighter', { ...graph, oco: false })
  expect(unpaired).toContain('independent')
  expect(unpaired).toContain('before the scheduled entries')
})

test('entry ancestry through waits preserves post-fill review', () => {
  const graph = { steps: [{ id: 'entry', type: 'market-order' }, { id: 'wait', type: 'wait' }, { id: 'sl', type: 'stop-loss' }], edges: [{ source: 'entry', target: 'wait' }, { source: 'wait', target: 'sl' }], oco: true }
  expect(workflowOcoReview('lighter', graph)).toContain('actual parent fill')
})

test('unchecked pairing describes independent protective orders', () => {
  const copy = workflowOcoReview('lighter', { steps: [], edges: [], oco: false })
  expect(copy).toContain('independent')
  expect(copy).toContain('does not cancel')
})

const trigger = { id: 'trigger', type: 'trigger', data: {} }
const entry = { id: 'entry', type: 'market-order', data: { side: 'inherit', sizeMode: 'percent', size: 100 } }
const exits = [{ id: 'sl', type: 'stop-loss', data: { triggerMode: 'percent', triggerValue: 3, sizePercent: 100, orderType: 'market' } }, { id: 'tp', type: 'take-profit', data: { triggerMode: 'percent', triggerValue: 5, sizePercent: 100, orderType: 'market' } }]
test('review surfaces malformed node configuration before running', () => {
  expect(workflowGraphReviewError('lighter', { steps: [trigger, { ...entry, data: { ...entry.data, size: 0 } }], edges: [{ id: 'e', source: 'trigger', target: 'entry' }] })).toContain('Invalid market-order')
})
test('review detects unreachable nodes and cycles', () => {
  expect(workflowGraphReviewError('lighter', { steps: [trigger, entry], edges: [] })).toContain('unreachable')
  expect(workflowGraphReviewError('lighter', { steps: [trigger, entry], edges: [{ id: 'e', source: 'trigger', target: 'entry' }, { id: 'loop', source: 'entry', target: 'entry' }] })).toContain('cycle')
})
test('existing-position OCO is allowed on Lighter and rejected on Hyperliquid', () => {
  const graph = { oco: true, steps: [trigger, entry, ...exits], edges: [entry, ...exits].map((node) => ({ id: node.id, source: 'trigger', target: node.id })) }
  expect(workflowGraphReviewError('lighter', graph)).toBeUndefined()
  expect(workflowGraphReviewError('hyperliquid', graph)).toContain('entry')
})
test('review rejects spot protective orders and mismatched native siblings', () => {
  const graph = { oco: true, steps: [trigger, entry, ...exits], edges: [{ id: 'entry', source: 'trigger', target: 'entry' }, { id: 'sl', source: 'entry', target: 'sl' }, { id: 'tp', source: 'trigger', target: 'tp' }] }
  expect(workflowGraphReviewError('lighter', graph)).toContain('matching')
  expect(workflowGraphReviewError('lighter-spot', { ...graph, oco: false })).toContain('Spot protective')
})

test('workflow scope requires every entry ancestor and matching OCO scope', () => {
  const second = { ...entry, id: 'second' }
  const scoped = exits.map((node) => ({ ...node, data: { ...node.data, sizeScope: 'workflow' } }))
  const graph = { oco: true, steps: [trigger, entry, second, ...scoped], edges: [{ id: 'first', source: 'trigger', target: 'entry' }, { id: 'second', source: 'entry', target: 'second' }, ...scoped.map((node) => ({ id: node.id, source: 'second', target: node.id }))] }
  expect(workflowGraphReviewError('lighter', graph)).toBeUndefined()
  expect(workflowGraphReviewError('hyperliquid', graph)).toContain('own entry')
  expect(workflowGraphReviewError('lighter', { ...graph, edges: graph.edges.map((edge) => edge.target === 'sl' ? { ...edge, source: 'entry' } : edge) })).toContain('every workflow entry')
  expect(workflowGraphReviewError('lighter', { ...graph, steps: [...graph.steps.filter((node) => node.id !== 'tp'), { ...scoped[1], data: { ...scoped[1].data, sizeScope: 'parent' } }] })).toContain('matching')
  expect(workflowOcoReview('lighter', graph)).toContain('verified workflow entry fills')
  expect(workflowOcoReview('lighter', graph)).toContain('existing position')
})
