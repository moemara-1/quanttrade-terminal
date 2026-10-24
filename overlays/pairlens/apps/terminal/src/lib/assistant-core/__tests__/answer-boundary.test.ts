import { expect, test } from 'bun:test'
import { stepCountIs, streamText, tool } from 'ai'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { z } from 'zod'
import {
  ANSWER_BOUNDARY_GUIDE,
  assistantAnswerBoundary,
  createAssistantToolAdmission,
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

test('wide distinct audits reserve an answer before round budget and honor elapsed research time', () => {
  const wide = Array.from({ length: 8 }, (_, round) => ({
    toolCalls: Array.from({ length: 7 }, (_call, index) => ({
      toolName: 'get_exchange_snapshot',
      input: { venue: round, index },
    })),
  }))
  expect(assistantAnswerBoundary(wide)).toBe('call-budget')
  expect(assistantAnswerBoundary(wide, 27)).toBe('call-budget')
  expect(assistantAnswerBoundary([read()], 10, { elapsedMs: 120000 })).toBe(
    'time-budget',
  )
})

test('a hung read becomes unavailable, aborts its signal, and prevents subsequent actions', async () => {
  let finalizing = false
  let readSignal: AbortSignal | undefined
  let writes = 0
  const tools = guardAssistantTools(
    {
      get_exchange_snapshot: tool({
        inputSchema: z.object({}),
        execute: (_input, options) => {
          readSignal = options.abortSignal
          return new Promise(() => undefined)
        },
      }),
      prepare_position_plan: tool({
        inputSchema: z.object({}),
        execute: async () => {
          writes++
          return { status: 'awaiting_confirmation' }
        },
      }),
    },
    () => finalizing,
    {
      readTimeoutMs: 5,
      onReadTimeout: () => {
        finalizing = true
      },
    },
  )
  const options = { toolCallId: 'hung', messages: [] }
  const result = await Promise.race([
    tools.get_exchange_snapshot.execute!({}, options),
    new Promise((resolve) =>
      setTimeout(() => resolve({ status: 'still-hung' }), 50),
    ),
  ])
  expect(result).toMatchObject({
    status: 'unavailable',
    reason: 'read-timeout',
  })
  expect(readSignal?.aborted).toBe(true)
  expect(await tools.prepare_position_plan.execute!({}, options)).toMatchObject(
    { status: 'blocked' },
  )
  expect(writes).toBe(0)
})

test('boundary stream finish without finish-step still produces a scoped audit answer', async () => {
  const chunks = await Array.fromAsync(
    new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'start-step' })
        controller.enqueue({ type: 'finish', finishReason: 'stop' })
        controller.close()
      },
    }).pipeThrough(ensureAssistantBoundaryAnswer(() => true)),
  )
  expect(JSON.stringify(chunks)).toContain('incomplete')
  expect(JSON.stringify(chunks)).not.toContain('requested position')
  expect(chunks.filter((chunk) => chunk.type === 'text-start')).toHaveLength(1)
})

test.each([
  [false, 7],
  [true, 1],
  [false, 100],
] as const)(
  'SDK reaches a text answer after wide fanout or a hung read: %s',
  async (hung, fanout) => {
    let finalizing = false
    let timedOut = false
    let calls = 0
    let modelCalls = 0
    const tools = guardAssistantTools(
      {
        get_exchange_snapshot: tool({
          inputSchema: z.object({ scope: z.number() }),
          execute: async () => {
            calls++
            return hung ? await new Promise(() => undefined) : { status: 'ok' }
          },
        }),
      },
      () => finalizing || timedOut,
      {
        readTimeoutMs: 5,
        onCallLimit: () => {
          timedOut = true
        },
        onReadTimeout: () => {
          timedOut = true
        },
      },
    )
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        modelCalls++
        const final = options.toolChoice?.type === 'none'
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
                        'Audit complete within available evidence; timed out reads remain unknown.',
                    },
                    { type: 'text-end' as const, id: 'answer' },
                  ]
                : Array.from({ length: fanout }, (_, i) => ({
                    type: 'tool-call' as const,
                    toolCallId: `${modelCalls}-${i}`,
                    toolName: 'get_exchange_snapshot',
                    input: JSON.stringify({ scope: modelCalls * 10 + i }),
                  }))),
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
      prompt: 'Audit connected venues without changing anything.',
      tools,
      maxRetries: 0,
      prepareStep: ({ steps }) => {
        finalizing ||= timedOut || assistantAnswerBoundary(steps) !== undefined
        return finalizing ? { toolChoice: 'none', activeTools: [] } : {}
      },
      stopWhen: [() => finalizing, stepCountIs(11)],
    })
    expect(await result.text).toContain('Audit complete')
    expect(calls).toBe(hung ? 1 : 48)
    expect(modelCalls).toBe(hung || fanout === 100 ? 2 : 8)
  },
)

test('caller cancellation aborts a read without classifying cancellation as timeout', async () => {
  const cancel = new AbortController()
  let timedOut = false
  let signal: AbortSignal | undefined
  const tools = guardAssistantTools(
    {
      get_exchange_snapshot: tool({
        inputSchema: z.object({}),
        execute: (_input, options) => {
          signal = options.abortSignal
          return new Promise(() => undefined)
        },
      }),
    },
    () => false,
    {
      readTimeoutMs: 1000,
      onReadTimeout: () => {
        timedOut = true
      },
    },
  )
  const pending = tools.get_exchange_snapshot.execute!(
    {},
    { toolCallId: 'cancel', messages: [], abortSignal: cancel.signal },
  )
  await Promise.resolve()
  cancel.abort(new Error('User stopped'))
  expect(Promise.resolve(pending)).rejects.toThrow('User stopped')
  expect(signal?.aborted).toBe(true)
  expect(timedOut).toBe(false)
})

test('a delayed mutation is never timed out or retried by the read guard', async () => {
  let timeouts = 0
  let writes = 0
  const tools = guardAssistantTools(
    {
      prepare_position_plan: tool({
        inputSchema: z.object({}),
        execute: async () => {
          writes++
          await new Promise((resolve) => setTimeout(resolve, 15))
          return { status: 'awaiting_confirmation' }
        },
      }),
    },
    () => false,
    {
      readTimeoutMs: 1,
      onReadTimeout: () => {
        timeouts++
      },
    },
  )
  expect(
    await tools.prepare_position_plan.execute!(
      {},
      { toolCallId: 'write', messages: [] },
    ),
  ).toMatchObject({ status: 'awaiting_confirmation' })
  expect(writes).toBe(1)
  expect(timeouts).toBe(0)
})

test('failed synthesis lists returned and failed reads without claiming account outcomes', async () => {
  let finalizing = false
  const chunks = await Array.fromAsync(
    new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'start-step' })
        controller.enqueue({
          type: 'tool-input-available',
          toolCallId: 'good',
          toolName: 'get_news',
          input: {},
        })
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'good',
          output: { status: 'ok', articles: [] },
        })
        controller.enqueue({
          type: 'tool-input-available',
          toolCallId: 'bad',
          toolName: 'get_exchange_snapshot',
          input: {},
        })
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'bad',
          output: { status: 'unavailable' },
        })
        finalizing = true
        controller.enqueue({ type: 'finish', finishReason: 'stop' })
        controller.close()
      },
    }).pipeThrough(ensureAssistantBoundaryAnswer(() => finalizing)),
  )
  const text = chunks
    .filter((chunk) => chunk.type === 'text-delta')
    .map((chunk) => chunk.delta)
    .join('')
  expect(text).toContain('get_news')
  expect(text).toContain('Unavailable or failed reads: get_exchange_snapshot')
  expect(text).toContain('not independently validated')
  expect(text).not.toContain('no orders')
})

test.each(['web_search', 'deep_research'])(
  'read deadline covers actual %s tools',
  async (name) => {
    const tools = guardAssistantTools(
      {
        [name]: tool({
          inputSchema: z.object({}),
          execute: () => new Promise(() => undefined),
        }),
      },
      () => false,
      { readTimeoutMs: 5 },
    )
    const result = await Promise.race([
      tools[name].execute!({}, { toolCallId: name, messages: [] }),
      new Promise((resolve) =>
        setTimeout(() => resolve({ status: 'still-hung' }), 50),
      ),
    ])
    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'read-timeout',
    })
  },
)

test('shared admission blocks excess client-forwarded inputs while preserving admitted read results', async () => {
  let finalizing = false
  let exhausted = false
  let reads = 0
  let forwards = 0
  const admission = createAssistantToolAdmission(
    () => finalizing || exhausted,
    () => {
      exhausted = true
    },
  )
  const tools = guardAssistantTools(
    {
      get_exchange_snapshot: tool({
        inputSchema: z.object({}),
        execute: async () => {
          reads++
          return { status: 'ok' }
        },
      }),
      switch_pair: tool({
        inputSchema: z.object({}),
        execute: async () => {
          forwards++
          return 'Requested switch'
        },
      }),
    },
    () => finalizing || exhausted,
    { admission },
  )
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      const final = options.toolChoice?.type === 'none'
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
                    delta: 'Audit bounded; omitted reads remain unknown.',
                  },
                  { type: 'text-end' as const, id: 'answer' },
                ]
              : [
                  ...Array.from({ length: 100 }, (_, i) => ({
                    type: 'tool-call' as const,
                    toolCallId: `read-${i}`,
                    toolName: 'get_exchange_snapshot',
                    input: '{}',
                  })),
                  {
                    type: 'tool-call' as const,
                    toolCallId: 'switch',
                    toolName: 'switch_pair',
                    input: '{}',
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
    prompt: 'Audit',
    tools,
    maxRetries: 0,
    prepareStep: () => {
      finalizing ||= exhausted
      return finalizing ? { toolChoice: 'none', activeTools: [] } : {}
    },
    stopWhen: [() => finalizing, stepCountIs(3)],
  })
  const chunks = await Array.fromAsync(
    result
      .toUIMessageStream()
      .pipeThrough(ensureAssistantBoundaryAnswer(() => finalizing, admission)),
  )
  expect(reads).toBe(48)
  expect(forwards).toBe(0)
  expect(
    chunks.filter((chunk) => chunk.type === 'tool-input-available'),
  ).toHaveLength(48)
  expect(
    chunks.filter((chunk) => chunk.type === 'tool-output-available'),
  ).toHaveLength(48)
  expect(JSON.stringify(chunks)).not.toContain('switch_pair')
  expect(JSON.stringify(chunks)).toContain('Audit bounded')
})
