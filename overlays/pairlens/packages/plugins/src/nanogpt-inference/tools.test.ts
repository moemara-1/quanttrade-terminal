import { afterEach, expect, test } from 'bun:test'
import {
  executeNanogptTool,
  fetchNanogptModels,
  mapNanogptSearch,
  nanogptWebSearch,
} from './tools'

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})
function fixture(
  body: unknown,
  status = 200,
  inspect?: (url: string, init?: RequestInit) => void,
) {
  globalThis.fetch = Object.assign(
    async (url: string | URL | Request, init?: RequestInit) => {
      inspect?.(String(url), init)
      return Response.json(body, { status })
    },
    { preconnect: original.preconnect },
  )
}
test('model catalog keeps model IDs, prices and explicit tool support', async () => {
  fixture({
    data: [
      {
        id: 'one',
        name: 'One',
        capabilities: { tool_calling: true },
        pricing: { prompt: 1, completion: 2 },
      },
      { id: 'two', capabilities: { tool_calling: false } },
    ],
  })
  expect((await fetchNanogptModels()).length).toBe(2)
  expect(
    await executeNanogptTool(
      { action: 'models', toolsOnly: true, limit: 1 },
      '',
    ),
  ).toMatchObject({ total: 1, models: [{ id: 'one' }] })
})
test('web research reuses same key and returns URL/title/excerpt contract', async () => {
  fixture(
    {
      data: [
        { url: 'https://example.com', name: 'Article', content: 'Source text' },
        { url: 'javascript:bad', content: 'Unsafe' },
      ],
    },
    200,
    (url, init) => {
      expect(url).toBe('https://nano-gpt.com/api/v1/data/web/search')
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'Bearer shared-key',
      )
      expect(JSON.parse(String(init?.body))).toMatchObject({
        query: 'market news',
        outputType: 'searchResults',
        depth: 'standard',
      })
    },
  )
  expect(
    await nanogptWebSearch(
      { objective: 'market news', max_results: 2 },
      'shared-key',
    ),
  ).toEqual({
    results: [
      {
        url: 'https://example.com',
        title: 'Article',
        excerpt: 'Source text',
        publishDate: null,
      },
    ],
  })
  expect(() => mapNanogptSearch({ error: 'bad' })).toThrow()
})
test('balance uses documented POST and excludes deposit address and unknown fields', async () => {
  fixture(
    {
      usd_balance: '12.30',
      nano_balance: '0',
      nanoDepositAddress: 'private',
      apiKey: 'key',
    },
    200,
    (url, init) => {
      expect(url).toBe('https://nano-gpt.com/api/check-balance')
      expect(init?.method).toBe('POST')
    },
  )
  expect(await executeNanogptTool({ action: 'balance' }, 'key')).toEqual({
    usd_balance: '12.30',
    nano_balance: '0',
  })
})
test('usage dates and research URLs fail before network requests', async () => {
  let calls = 0
  fixture({}, 200, () => {
    calls++
  })
  for (const p of [
    { action: 'withdraw' },
    { action: 'usage', from: '2026-01-01' },
    { action: 'usage', from: '2026-02-30', to: '2026-03-01' },
    { action: 'scrape', urls: ['https://localhost/a'] },
    { action: 'scrape', urls: ['https://127.0.0.1'] },
    { action: 'scrape', urls: ['https://user:password@example.com'] },
    { action: 'scrape', urls: ['https://example.com:8888'] },
  ]) {
    await expect(executeNanogptTool(p, 'test-key')).rejects.toThrow()
  }
  expect(calls).toBe(0)
})
test('provider errors and successful responses cannot leak stored key', async () => {
  fixture({ apiKey: 'secret-value', message: 'secret-value' }, 401)
  await expect(
    executeNanogptTool({ action: 'usage' }, 'secret-value'),
  ).rejects.toThrow('HTTP 401')
  fixture({ apiKey: 'secret-value', value: 2 })
  expect(
    JSON.stringify(
      await executeNanogptTool({ action: 'usage' }, 'secret-value'),
    ),
  ).not.toContain('secret-value')
})
test('scrapes return bounded markdown without raw HTML or secret fields', async () => {
  fixture({
    results: [
      {
        url: 'https://example.com/',
        success: true,
        title: 'Article',
        markdown: 'Body',
        content: '<script>bad</script>',
        apiKey: 'secret',
      },
    ],
    summary: { processed: 1 },
  })
  expect(
    await executeNanogptTool(
      { action: 'scrape', urls: ['https://example.com'] },
      'secret',
    ),
  ).toEqual({
    results: [
      {
        url: 'https://example.com/',
        success: true,
        title: 'Article',
        markdown: 'Body',
      },
    ],
    summary: { processed: 1 },
  })
})

test('oversize stream is canceled and invalid JSON never echoes provider body', async () => {
  let canceled = false
  globalThis.fetch = Object.assign(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(2_000_001))
          },
          cancel() {
            canceled = true
          },
        }),
      ),
    { preconnect: original.preconnect },
  )
  await expect(executeNanogptTool({ action: 'usage' }, 'key')).rejects.toThrow(
    'supported size',
  )
  expect(canceled).toBe(true)
  globalThis.fetch = Object.assign(
    async () => new Response('secret-value broken json'),
    { preconnect: original.preconnect },
  )
  await expect(
    executeNanogptTool({ action: 'usage' }, 'secret-value'),
  ).rejects.toThrow('invalid JSON')
})
