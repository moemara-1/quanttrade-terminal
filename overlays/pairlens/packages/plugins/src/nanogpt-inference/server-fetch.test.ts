import { afterEach, expect, test } from 'bun:test'
import { fetchNanogptOnServer } from './server-fetch'

const originalFetch = globalThis.fetch
const url = 'https://api.nano-gpt.com/api/v1/chat/completions'
const id = '5a0200dd-7758-47b8-9444-857f6ee159e1'
const init = {
  method: 'POST',
  headers: { Authorization: 'Bearer fixture-secret' },
  body: JSON.stringify({ stream: true, model: 'fixture', messages: [] }),
}
afterEach(() => {
  globalThis.fetch = originalFetch
})
function install(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
) {
  globalThis.fetch = Object.assign(
    (input: string | URL | Request, options?: RequestInit) =>
      handler(String(input), options),
    { preconnect: originalFetch.preconnect },
  )
}

test('retries a lost creation acknowledgment with identical idempotency body', async () => {
  const bodies: Array<unknown> = []
  install(async (_path, options) => {
    if (options?.method === 'POST') {
      bodies.push(options.body)
      if (bodies.length === 1) throw new TypeError('network')
      return Response.json({ id }, { status: 201 })
    }
    return new Response('OK')
  })
  expect(await (await fetchNanogptOnServer(url, init)).text()).toBe('OK')
  expect(bodies).toHaveLength(2)
  expect(bodies[0]).toBe(bodies[1])
})

test('resumes raw byte offset after interrupted multibyte stream without recreating job', async () => {
  const paths: Array<string> = []
  let posts = 0
  install(async (path, options) => {
    if (options?.method === 'POST') {
      posts++
      return Response.json({ id }, { status: 201 })
    }
    paths.push(path)
    if (paths.length === 1) {
      let reads = 0
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (reads++ === 0) controller.enqueue(new TextEncoder().encode('€'))
            else controller.error(new TypeError('fixture-secret'))
          },
        }),
      )
    }
    return new Response('done')
  })
  expect(await (await fetchNanogptOnServer(url, init)).text()).toBe('€done')
  expect(posts).toBe(1)
  expect(paths[1]).toEndWith('?offset=3')
})

test('passes provider HTTP error without retry', async () => {
  let gets = 0
  install(async (_path, options) =>
    options?.method === 'POST'
      ? Response.json({ id }, { status: 201 })
      : (gets++,
        new Response('bad model', {
          status: 400,
          headers: { 'x-quanttrade-ai-upstream': '1' },
        })),
  )
  const response = await fetchNanogptOnServer(url, init)
  expect(response.status).toBe(400)
  expect(await response.text()).toBe('bad model')
  expect(gets).toBe(1)
})

test('bounds startup network failures and sanitizes error', async () => {
  let posts = 0
  install(async () => {
    posts++
    throw new TypeError('fixture-secret')
  })
  await expect(fetchNanogptOnServer(url, init)).rejects.toThrow(
    'NanoGPT server connection failed',
  )
  expect(posts).toBe(3)
})

test('rejects other targets and nonstream payload before fetch', async () => {
  install(async () => {
    throw new Error('must not fetch')
  })
  await expect(
    fetchNanogptOnServer('https://evil.invalid', init),
  ).rejects.toThrow('Invalid NanoGPT server request')
  await expect(
    fetchNanogptOnServer(url, { ...init, body: '{}' }),
  ).rejects.toThrow('Invalid NanoGPT server request')
})

test('explicit abort cancels active reader and deletes job', async () => {
  const controller = new AbortController()
  let canceled = false
  let deleted = false
  install(async (_path, options) => {
    if (options?.method === 'POST')
      return Response.json({ id }, { status: 201 })
    if (options?.method === 'DELETE') {
      deleted = options.keepalive === true
      return new Response(null, { status: 204 })
    }
    return new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          canceled = true
        },
      }),
    )
  })
  const response = await fetchNanogptOnServer(url, {
    ...init,
    signal: controller.signal,
  })
  const pending = response.text()
  controller.abort()
  await expect(pending).rejects.toThrow()
  expect(canceled).toBe(true)
  expect(deleted).toBe(true)
})

test('job authorization errors are terminal and do not recreate provider work', async () => {
  let calls = 0
  install(async (_path, options) => {
    calls++
    return options?.method === 'POST'
      ? Response.json({ id }, { status: 201 })
      : new Response('fixture-secret', { status: 401 })
  })
  await expect(fetchNanogptOnServer(url, init)).rejects.toMatchObject({
    statusCode: 401,
    message: 'NanoGPT server session requires sign-in',
  })
  expect(calls).toBe(2)
})

test('lost creation JSON is retried using exactly the same job request', async () => {
  const bodies: Array<unknown> = []
  install(async (_path, options) => {
    if (options?.method === 'POST') {
      bodies.push(options.body)
      return bodies.length === 1
        ? new Response('{')
        : Response.json({ id }, { status: 201 })
    }
    return new Response('ready')
  })
  expect(await (await fetchNanogptOnServer(url, init)).text()).toBe('ready')
  expect(bodies).toHaveLength(2)
  expect(bodies[0]).toBe(bodies[1])
})

test.each([401, 429])(
  'creation HTTP %i is classified without retries',
  async (status) => {
    let calls = 0
    install(async () => {
      calls++
      return new Response('fixture-secret', { status })
    })
    await expect(fetchNanogptOnServer(url, init)).rejects.toMatchObject({
      statusCode: status,
    })
    expect(calls).toBe(1)
  },
)

test('repeated stream failures are bounded without leaking provider errors', async () => {
  let gets = 0
  let posts = 0
  install(async (_path, options) => {
    if (options?.method === 'POST') {
      posts++
      return Response.json({ id }, { status: 201 })
    }
    gets++
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error('fixture-secret'))
        },
      }),
    )
  })
  const response = await fetchNanogptOnServer(url, init)
  await expect(response.text()).rejects.toThrow(
    'NanoGPT server connection failed',
  )
  expect(posts).toBe(1)
  expect(gets).toBe(3)
})

test('aborting pending job polling deletes job and prevents another read', async () => {
  const controller = new AbortController()
  let gets = 0
  let deleted = false
  install(async (_path, options) => {
    if (options?.method === 'POST')
      return Response.json({ id }, { status: 201 })
    if (options?.method === 'DELETE') {
      deleted = true
      return new Response(null, { status: 204 })
    }
    gets++
    queueMicrotask(() => controller.abort())
    return new Response(null, { status: 202 })
  })
  await expect(
    fetchNanogptOnServer(url, { ...init, signal: controller.signal }),
  ).rejects.toThrow('NanoGPT request canceled')
  expect(deleted).toBe(true)
  expect(gets).toBe(1)
})

test('waits for server headers without creating another job', async () => {
  let posts = 0
  let gets = 0
  install(async (_path, options) => {
    if (options?.method === 'POST') {
      posts++
      return Response.json({ id }, { status: 201 })
    }
    gets++
    return gets === 1
      ? new Response(null, { status: 202 })
      : new Response('ready')
  })
  expect(await (await fetchNanogptOnServer(url, init)).text()).toBe('ready')
  expect(posts).toBe(1)
  expect(gets).toBe(2)
})

test('does not consume job bytes before the response caller reads', async () => {
  let reads = 0
  install(async (_path, options) => {
    if (options?.method === 'POST')
      return Response.json({ id }, { status: 201 })
    return new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            reads++
            controller.enqueue(new TextEncoder().encode('ready'))
            controller.close()
          },
        },
        { highWaterMark: 0 },
      ),
    )
  })
  const response = await fetchNanogptOnServer(url, init)
  expect(reads).toBe(0)
  expect(await response.text()).toBe('ready')
  expect(reads).toBe(1)
})
