import { afterEach, expect, test } from 'bun:test'
import { fetchNanogptWithRecovery } from './network-recovery'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockFetch(handler: typeof fetch) {
  globalThis.fetch = handler
}

test('recovers one raw browser startup failure with the same request', async () => {
  let calls = 0
  const init = { method: 'POST', body: 'unchanged' }
  mockFetch(
    Object.assign(
      async (_url: string | URL | Request, options?: RequestInit) => {
        calls++
        expect(options).toBe(init)
        if (calls === 1) throw new TypeError('Failed to fetch')
        return new Response('OK')
      },
      { preconnect: originalFetch.preconnect },
    ),
  )
  expect(
    await (
      await fetchNanogptWithRecovery('https://fixture.invalid', init)
    ).text(),
  ).toBe('OK')
  expect(calls).toBe(2)
})

test('persistent browser failure is bounded at two attempts', async () => {
  let calls = 0
  mockFetch(
    Object.assign(
      async () => {
        calls++
        throw new TypeError('Failed to fetch')
      },
      { preconnect: originalFetch.preconnect },
    ),
  )
  await expect(
    fetchNanogptWithRecovery('https://fixture.invalid'),
  ).rejects.toThrow('Failed to fetch')
  expect(calls).toBe(2)
})

test('abort during recovery cancels the second attempt', async () => {
  let calls = 0
  const controller = new AbortController()
  mockFetch(
    Object.assign(
      async () => {
        calls++
        queueMicrotask(() => controller.abort())
        throw new TypeError('Failed to fetch')
      },
      { preconnect: originalFetch.preconnect },
    ),
  )
  await expect(
    fetchNanogptWithRecovery('https://fixture.invalid', {
      signal: controller.signal,
    }),
  ).rejects.toThrow()
  expect(calls).toBe(1)
})

test.each([400, 401, 429, 503])(
  'HTTP %i remains the SDK responsibility',
  async (status) => {
    let calls = 0
    mockFetch(
      Object.assign(
        async () => {
          calls++
          return new Response('error', { status })
        },
        { preconnect: originalFetch.preconnect },
      ),
    )
    expect(
      (await fetchNanogptWithRecovery('https://fixture.invalid')).status,
    ).toBe(status)
    expect(calls).toBe(1)
  },
)

test('SDK-recognized errors with cause do not compound its retry budget', async () => {
  let calls = 0
  mockFetch(
    Object.assign(
      async () => {
        calls++
        throw new TypeError('Failed to fetch', { cause: new Error('upstream') })
      },
      { preconnect: originalFetch.preconnect },
    ),
  )
  await expect(
    fetchNanogptWithRecovery('https://fixture.invalid'),
  ).rejects.toThrow()
  expect(calls).toBe(1)
})

test('response body interruption never replays the request', async () => {
  let calls = 0
  mockFetch(
    Object.assign(
      async () => {
        calls++
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError('Failed to fetch'))
            },
          }),
        )
      },
      { preconnect: originalFetch.preconnect },
    ),
  )
  const response = await fetchNanogptWithRecovery('https://fixture.invalid')
  await expect(response.text()).rejects.toThrow('Failed to fetch')
  expect(calls).toBe(1)
})

test('an already aborted request never reaches fetch', async () => {
  let calls = 0
  mockFetch(
    Object.assign(
      async () => {
        calls++
        return new Response('unexpected')
      },
      { preconnect: originalFetch.preconnect },
    ),
  )
  const controller = new AbortController()
  controller.abort()
  await expect(
    fetchNanogptWithRecovery('https://fixture.invalid', {
      signal: controller.signal,
    }),
  ).rejects.toThrow()
  expect(calls).toBe(0)
})

test('unrelated TypeError is not retried', async () => {
  let calls = 0
  mockFetch(
    Object.assign(
      async () => {
        calls++
        throw new TypeError('Invalid request configuration')
      },
      { preconnect: originalFetch.preconnect },
    ),
  )
  await expect(
    fetchNanogptWithRecovery('https://fixture.invalid'),
  ).rejects.toThrow('Invalid request configuration')
  expect(calls).toBe(1)
})
