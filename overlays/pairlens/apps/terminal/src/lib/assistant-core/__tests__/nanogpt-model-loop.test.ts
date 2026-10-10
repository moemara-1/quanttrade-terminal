import { afterEach, expect, test } from 'bun:test'
import { stepCountIs, streamText, tool } from 'ai'
import { z } from 'zod'
import { createNanogptInferencePlugin, nanogptInferenceManifest } from '@pairlens/plugins/all'
import type { LanguageModel } from 'ai'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('NanoGPT DeepSeek thinking streams tools and preserves reasoning on the next step', async () => {
  const modelId = 'deepseek/deepseek-v4-flash:thinking'
  const plugin = createNanogptInferencePlugin(nanogptInferenceManifest)
  await plugin.initialize?.({ apiKey: 'offline-fixture-key', model: modelId })
  const requests: Array<Record<string, unknown>> = []
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe('https://api.nano-gpt.com/api/v1/chat/completions')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    requests.push(body)
    expect(body.model).toBe(modelId)
    expect(body.stream).toBe(true)
    const choices = requests.length === 1
      ? [{ delta: { reasoning_content: 'Checking time.', tool_calls: [{ index: 0, id: 'clock-1', type: 'function', function: { name: 'read_clock', arguments: '{}' } }] }, finish_reason: 'tool_calls', index: 0 }]
      : [{ delta: { content: 'Ready.' }, finish_reason: 'stop', index: 0 }]
    return new Response(`data: ${JSON.stringify({ id: 'fixture', model: modelId, choices })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }, { preconnect: originalFetch.preconnect })
  const model = await plugin.getLanguageModel?.()
  if (!model) throw new Error('Missing NanoGPT language model')
  const result = streamText({ model: model as LanguageModel, prompt: 'test', maxRetries: 0, stopWhen: stepCountIs(2), tools: {
    read_clock: tool({ inputSchema: z.object({}), execute: async () => ({ time: '12:00' }) }),
  } })
  expect(await result.text).toBe('Ready.')
  expect(requests).toHaveLength(2)
  expect(JSON.stringify(requests[1]?.messages)).toContain('reasoning_content')
  expect(JSON.stringify(requests[1]?.messages)).toContain('Checking time.')
})
