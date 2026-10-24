import { afterEach, expect, test } from 'bun:test'
import {
  createNanogptInferencePlugin,
  nanogptInferenceManifest,
} from '@pairlens/plugins/all'
import { synthesizeFinalAssessment } from '../final-assessment'
import type { LanguageModel } from 'ai'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

test('final assessment uses the real server-backed NanoGPT streaming contract', async () => {
  const plugin = createNanogptInferencePlugin(nanogptInferenceManifest)
  await plugin.initialize?.({
    apiKey: 'offline-key',
    model: 'deepseek/deepseek-v4.1-flash-1017:thinking',
    serverBacked: true,
  })
  let starts = 0
  globalThis.fetch = Object.assign(
    async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url).startsWith('/_quanttrade/api/ai/nanogpt/jobs')).toBe(
        true,
      )
      if (init?.method === 'POST') {
        starts++
        const body = JSON.parse(String(init.body))
        expect(body.request.stream).toBe(true)
        expect(body.request.tools).toBeUndefined()
        for (const message of body.request.messages)
          if (
            message.role === 'assistant' &&
            typeof message.reasoning_content !== 'string'
          )
            return Response.json(
              { error: 'offline fixture rejected reasoning history' },
              { status: 400 },
            )
        return Response.json({ id: body.requestId }, { status: 201 })
      }
      return new Response(
        'data: {"id":"fixture","choices":[{"delta":{"content":"ZORA assessment from collected evidence."},"finish_reason":"stop","index":0}]}\n\ndata: [DONE]\n\n',
        {
          headers: {
            'content-type': 'text/event-stream',
            'x-quanttrade-ai-upstream': '1',
          },
        },
      )
    },
    originalFetch,
  )
  const model = await plugin.getLanguageModel?.()
  expect(
    await synthesizeFinalAssessment(model as LanguageModel, [
      { role: 'user', content: 'Thoughts about ZORA?' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'news',
            toolName: 'get_news',
            input: { symbol: 'ZORA' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'news',
            toolName: 'get_news',
            output: { type: 'json', value: { status: 'available' } },
          },
        ],
      },
    ]),
  ).toBe('ZORA assessment from collected evidence.')
  expect(starts).toBe(1)
})
