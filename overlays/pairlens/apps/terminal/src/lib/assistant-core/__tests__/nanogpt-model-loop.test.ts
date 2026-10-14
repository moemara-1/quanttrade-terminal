import { afterEach, expect, test } from 'bun:test'
import { stepCountIs, streamText, tool } from 'ai'
import { z } from 'zod'
import {
  createNanogptInferencePlugin,
  nanogptInferenceManifest,
} from '@pairlens/plugins/all'
import type { LanguageModel } from 'ai'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

test.each(['reasoning', 'reasoning_content'])(
  'NanoGPT DeepSeek thinking streams %s and preserves it on the tool followup',
  async (reasoningField) => {
    const modelId = 'deepseek/deepseek-v4-flash-0731:thinking'
    const plugin = createNanogptInferencePlugin(nanogptInferenceManifest)
    await plugin.initialize?.({ apiKey: 'offline-fixture-key', model: modelId })
    const requests: Array<Record<string, unknown>> = []
    globalThis.fetch = Object.assign(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe(
          'https://api.nano-gpt.com/api/v1/chat/completions',
        )
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        requests.push(body)
        expect(body.model).toBe(modelId)
        expect(body.stream).toBe(true)
        const choices =
          requests.length === 1
            ? [
                {
                  delta: {
                    [reasoningField]: 'Checking time.',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'clock-1',
                        type: 'function',
                        function: { name: 'read_clock', arguments: '{}' },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                  index: 0,
                },
              ]
            : [
                {
                  delta: { content: 'Ready.' },
                  finish_reason: 'stop',
                  index: 0,
                },
              ]
        return new Response(
          `data: ${JSON.stringify({ id: 'fixture', model: modelId, choices })}\n\ndata: [DONE]\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      },
      { preconnect: originalFetch.preconnect },
    )
    const model = await plugin.getLanguageModel?.()
    if (!model) throw new Error('Missing NanoGPT language model')
    const result = streamText({
      model: model as LanguageModel,
      prompt: 'test',
      maxRetries: 0,
      stopWhen: stepCountIs(2),
      tools: {
        read_clock: tool({
          inputSchema: z.object({}),
          execute: async () => ({ time: '12:00' }),
        }),
      },
    })
    expect(await result.text).toBe('Ready.')
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(requests[1]?.messages)).toContain('reasoning_content')
    expect(JSON.stringify(requests[1]?.messages)).toContain('Checking time.')
  },
)

test.each([
  {
    model: 'deepseek/deepseek-v4-flash-0731:thinking',
    withTools: true,
    expected: '',
  },
  {
    model: 'deepseek/deepseek-v4-flash-0731:thinking',
    withTools: false,
    expected: undefined,
  },
  { model: 'minimax/minimax-m2.7', withTools: true, expected: undefined },
])(
  'NanoGPT reasoning history compatibility is scoped to $model with tools=$withTools',
  async ({ model: modelId, withTools, expected }) => {
    const plugin = createNanogptInferencePlugin(nanogptInferenceManifest)
    await plugin.initialize?.({
      apiKey: 'offline-fixture-key',
      model: modelId,
    })
    globalThis.fetch = Object.assign(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<Record<string, unknown>>
        }
        const assistants = body.messages.filter(
          (message) => message.role === 'assistant',
        )
        expect(assistants).toHaveLength(2)
        expect(assistants[0]?.reasoning_content).toBe('Original reasoning.')
        expect(assistants[1]?.reasoning_content).toBe(expected)
        return new Response(
          'data: {"id":"fixture","choices":[{"delta":{"content":"OK"},"finish_reason":"stop","index":0}]}\n\ndata: [DONE]\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      },
      { preconnect: originalFetch.preconnect },
    )
    const model = await plugin.getLanguageModel?.()
    if (!model) throw new Error('Missing NanoGPT language model')
    const result = streamText({
      model: model as LanguageModel,
      maxRetries: 0,
      messages: [
        { role: 'user', content: 'First question' },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'Original reasoning.' },
            { type: 'text', text: 'First answer' },
          ],
        },
        { role: 'user', content: 'Second question' },
        { role: 'assistant', content: 'Historical text-only answer' },
        { role: 'user', content: 'Check now' },
      ],
      tools: withTools
        ? {
            read_clock: tool({
              inputSchema: z.object({}),
              execute: async () => ({ time: '12:00' }),
            }),
          }
        : undefined,
    })
    expect(await result.text).toBe('OK')
  },
)
