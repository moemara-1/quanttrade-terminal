import { afterEach, expect, test } from 'bun:test'
import { createNanogptInferencePlugin, nanogptInferenceManifest } from './index'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
const request = {
  capability: 'ai:inference',
  params: { messages: [{ role: 'user', content: 'Prepare a draft' }] },
}
test('blank keys cannot activate NanoGPT', async () => {
  const plugin = createNanogptInferencePlugin(nanogptInferenceManifest)
  await expect(plugin.initialize?.({ apiKey: ' ' })).rejects.toThrow(
    'API key required',
  )
})
test('requests use the NanoGPT API host, configured model and key', async () => {
  const plugin = createNanogptInferencePlugin(nanogptInferenceManifest)
  await plugin.initialize?.({
    apiKey: ' test-key ',
    model: 'user-selected-model',
  })
  globalThis.fetch = Object.assign(
    async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        'https://api.nano-gpt.com/api/v1/chat/completions',
      )
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'Bearer test-key',
      )
      expect(JSON.parse(String(init?.body)).model).toBe('user-selected-model')
      return Response.json({
        choices: [{ message: { content: 'Draft' } }],
        model: 'user-selected-model',
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      })
    },
    { preconnect: originalFetch.preconnect },
  )
  expect(await plugin.execute(request)).toEqual({
    content: 'Draft',
    model: 'user-selected-model',
    usage: { promptTokens: 3, completionTokens: 2 },
  })
})
test('provider error bodies cannot expose secrets', async () => {
  const plugin = createNanogptInferencePlugin(nanogptInferenceManifest)
  await plugin.initialize?.({ apiKey: 'private-value' })
  globalThis.fetch = Object.assign(
    async () => new Response('private-value', { status: 401 }),
    { preconnect: originalFetch.preconnect },
  )
  expect(JSON.stringify(await plugin.execute(request))).not.toContain(
    'private-value',
  )
})
test('NanoGPT SSE emits content and completion', async () => {
  const plugin = createNanogptInferencePlugin(nanogptInferenceManifest)
  await plugin.initialize?.({ apiKey: 'test-key', model: 'selected' })
  globalThis.fetch = Object.assign(
    async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Accept')).toBe('text/event-stream')
      expect(JSON.parse(String(init?.body)).stream).toBe(true)
      return new Response(
        'data: {"model":"selected","choices":[{"delta":{"content":"Draft"}}]}\n\ndata: [DONE]\n\n',
      )
    },
    { preconnect: originalFetch.preconnect },
  )
  const events: Array<unknown> = []
  await new Promise<void>((resolve, reject) => {
    plugin.subscribe?.(request, (event: unknown) => {
      events.push(event)
      if (typeof event === 'object' && event && 'type' in event) {
        if (event.type === 'finish') resolve()
        if (event.type === 'error') reject(new Error('Unexpected SSE error'))
      }
    })
  })
  expect(events).toEqual([
    { type: 'text-delta', text: 'Draft' },
    { type: 'finish', model: 'selected' },
  ])
})
