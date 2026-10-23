import { expect, test } from 'bun:test'
import { stepCountIs, streamText, tool } from 'ai'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { z } from 'zod'
import {
  ANSWER_BOUNDARY_GUIDE,
  assistantAnswerBoundary,
  ensureAssistantBoundaryAnswer,
  guardAssistantTools,
} from '../answer-boundary'
import { boundAssistantModelHistory } from '../model-history'

const read = (input: unknown = { symbol: 'ZEC' }) => ({
  toolCalls: [{ toolName: 'get_exchange_snapshot', input }],
})

test('repeated account reads finalize while allowing one correction and changed scope', () => {
  expect(assistantAnswerBoundary([read(), read()])).toBeUndefined()
  expect(assistantAnswerBoundary([read(), read(), read()])).toBe(
    'repeated-read',
  )
  expect(
    assistantAnswerBoundary([
      read({ a: 1, b: 2 }),
      read({ b: 2, a: 1 }),
      read({ a: 1, b: 2 }),
    ]),
  ).toBe('repeated-read')
  expect(
    assistantAnswerBoundary([
      read(),
      read({ symbol: 'BTC' }),
      read({ symbol: 'ETH' }),
    ]),
  ).toBeUndefined()
})

test('counts repeated reads across interleaved steps without confusing trade operations with reads', () => {
  const write = {
    toolCalls: [{ toolName: 'prepare_position_plan', input: {} }],
  }
  expect(
    assistantAnswerBoundary([read(), write, read(), write, read()]),
  ).toBeUndefined()
  expect(
    assistantAnswerBoundary([
      read(),
      read({ symbol: 'BTC' }),
      read(),
      read({ symbol: 'ETH' }),
      read(),
    ]),
  ).toBe('repeated-read')
  expect(assistantAnswerBoundary([write, write, write])).toBeUndefined()
  expect(
    assistantAnswerBoundary(
      Array.from({ length: 10 }, (_, i) => read({ page: i })),
    ),
  ).toBe('step-budget')
  expect(
    assistantAnswerBoundary(
      Array.from({ length: 10 }, (_, i) => read({ page: i })),
      27,
    ),
  ).toBeUndefined()
})

test.each([false, true])(
  'real SDK forces a final answer for repeated or rotating reads: %s',
  async (rotating) => {
    let reads = 0
    let finalSteps = 0
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        const final = options.toolChoice?.type === 'none'
        if (final) {
          finalSteps++
          expect(JSON.stringify(options.prompt)).toContain('unavailable')
          expect(JSON.stringify(options.prompt)).toContain(
            'Unknown protection is not no protection',
          )
        }
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              ...(final
                ? [
                    { type: 'text-start' as const, id: 'answer' },
                    {
                      type: 'text-delta' as const,
                      id: 'answer',
                      delta:
                        'ZEC protection is unknown because the venue read failed. No orders changed.',
                    },
                    { type: 'text-end' as const, id: 'answer' },
                  ]
                : [
                    {
                      type: 'tool-call' as const,
                      toolCallId: `read-${reads}`,
                      toolName: 'get_exchange_snapshot',
                      input: JSON.stringify(rotating ? { scope: reads } : {}),
                    },
                  ]),
              {
                type: 'finish',
                finishReason: {
                  unified: final ? 'stop' : 'tool-calls',
                  raw: final ? 'stop' : 'tool_calls',
                },
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: 1,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              },
            ],
          }),
        }
      },
    })
    const result = streamText({
      model,
      prompt: 'Check my ZEC protection. Do not change anything.',
      maxRetries: 0,
      stopWhen: stepCountIs(11),
      prepareStep: ({ steps, messages }) => {
        const boundary = assistantAnswerBoundary(steps)
        return {
          system: [],
          messages: boundAssistantModelHistory([
            {
              role: 'system',
              content: boundary ? ANSWER_BOUNDARY_GUIDE : 'Read status only.',
            },
            ...messages,
          ]),
          ...(boundary ? { toolChoice: 'none' as const, activeTools: [] } : {}),
        }
      },
      tools: {
        get_exchange_snapshot: tool({
          inputSchema: z.object({ scope: z.number().optional() }),
          execute: async () => {
            reads++
            return { status: 'unavailable' }
          },
        }),
      },
    })
    expect(await result.text).toContain('protection is unknown')
    expect(reads).toBe(rotating ? 10 : 3)
    expect(finalSteps).toBe(1)
  },
)

test.each(['prepare_position_plan', 'ask_user'])(
  'noncompliant final tool %s is blocked and yields an honest visible answer',
  async (finalTool) => {
    let finalizing = false
    let reads = 0
    let mutations = 0
    let modelCalls = 0
    const model = new MockLanguageModelV3({
      doStream: async () => {
        modelCalls++
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: `call-${modelCalls}`,
                toolName: finalizing ? finalTool : 'get_exchange_snapshot',
                input: '{}',
              },
              {
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: 1,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              },
            ],
          }),
        }
      },
    })
    const tools = guardAssistantTools(
      {
        ask_user: tool({ inputSchema: z.object({}) }),
        get_exchange_snapshot: tool({
          inputSchema: z.object({}),
          execute: async () => {
            reads++
            return { status: 'unavailable' }
          },
        }),
        prepare_position_plan: tool({
          inputSchema: z.object({}),
          execute: async () => {
            mutations++
            return { status: 'awaiting_confirmation' }
          },
        }),
      },
      () => finalizing,
    )
    const result = streamText({
      model,
      prompt: 'Check protection only.',
      tools,
      maxRetries: 0,
      prepareStep: ({ steps }) => {
        finalizing ||= assistantAnswerBoundary(steps) !== undefined
        return finalizing ? { toolChoice: 'none', activeTools: [] } : {}
      },
      stopWhen: [stepCountIs(11), () => finalizing],
    })
    const chunks = await Array.fromAsync(
      result
        .toUIMessageStream()
        .pipeThrough(ensureAssistantBoundaryAnswer(() => finalizing)),
    )
    expect(reads).toBe(3)
    expect(modelCalls).toBe(4)
    expect(mutations).toBe(0)
    expect(JSON.stringify(chunks)).not.toContain(finalTool)
    expect(
      chunks.filter(
        (chunk) =>
          chunk.type === 'text-delta' &&
          chunk.delta.includes('model did not produce a final assessment'),
      ),
    ).toHaveLength(1)
  },
)
