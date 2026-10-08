import { expect, test } from 'bun:test'
import {
  filterNanogptModels,
  nanogptPriceLabel,
  nanogptToolLabel,
  withCatalogCancellation,
} from './nanogpt-model-picker-data'

const models = [
  {
    id: 'vendor/ALPHA',
    name: 'Reasoning Alpha',
    capabilities: { tool_calling: true },
  },
  {
    id: 'vendor/beta',
    name: 'Chat Model',
    capabilities: { tool_calling: false },
  },
  { id: 'vendor/unknown' },
]
test('catalog search matches model IDs and display names without changing their IDs', () => {
  expect(filterNanogptModels(models, 'alpha', false).items[0]?.id).toBe(
    'vendor/ALPHA',
  )
  expect(filterNanogptModels(models, ' chat ', false).items[0]?.id).toBe(
    'vendor/beta',
  )
})
test('tools-only filter includes explicit support and never advertises unknown support', () => {
  expect(filterNanogptModels(models, '', true).items.map((m) => m.id)).toEqual([
    'vendor/ALPHA',
  ])
  expect(nanogptToolLabel(models[2])).toBe('Tool support not reported')
})
test('large catalogs report total matches while rendering a bounded page', () => {
  const rows = Array.from({ length: 632 }, (_, i) => ({ id: `model/${i}` }))
  const found = filterNanogptModels(rows, '', false)
  expect(found.total).toBe(632)
  expect(found.items.length).toBe(40)
})
test('pricing uses reported currency and units, preserves zero, and never assumes USD', () => {
  expect(
    nanogptPriceLabel({
      prompt: 0,
      completion: 1.26,
      currency: 'USD',
      unit: 'per_million_tokens',
    }),
  ).toBe('Input 0 · Output 1.26 USD / 1M tokens')
  expect(nanogptPriceLabel({ prompt: null })).toBe('Pricing not reported')
  expect(nanogptPriceLabel({ prompt: 0.5 })).toBe(
    'Input 0.5 · Output not reported · currency and unit not reported',
  )
})

test('catalog transport respects provider timeout and component cancellation', async () => {
  let combined: AbortSignal | null | undefined
  const transport: typeof fetch = async (_input, init) => {
    combined = init?.signal
    return Response.json({ data: [] })
  }
  const provider = new AbortController(),
    timeout = new AbortController()
  await withCatalogCancellation(provider.signal, transport)(
    'https://api.nano-gpt.com/api/v1/models',
    { signal: timeout.signal },
  )
  expect(combined?.aborted).toBe(false)
  provider.abort()
  expect(combined?.aborted).toBe(true)
  const second = new AbortController(),
    secondTimeout = new AbortController()
  await withCatalogCancellation(second.signal, transport)(
    'https://api.nano-gpt.com/api/v1/models',
    { signal: secondTimeout.signal },
  )
  secondTimeout.abort()
  expect(combined?.aborted).toBe(true)
})
