import { expect, test } from 'bun:test'
import { stepCountIs, streamText, tool } from 'ai'
import { z } from 'zod'
import {
  createNanogptInferencePlugin,
  nanogptInferenceManifest,
} from '@pairlens/plugins/all'
import {
  ASSISTANT_HISTORY_LIMIT,
  assistantModelHistory,
  boundAssistantModelHistory,
} from '../model-history'
import type { LanguageModel, ModelMessage, UIMessage } from 'ai'

const pending = (toolName: string, id: string): UIMessage['parts'][number] => ({
  type: 'dynamic-tool',
  toolName,
  toolCallId: id,
  state: 'input-available',
  input: { question: 'Which setup?' },
})
const user = (text: string): UIMessage => ({
  id: 'user',
  role: 'user',
  parts: [{ type: 'text', text }],
})

test('an abandoned question followed by a typed turn cannot emit an unmatched tool call', async () => {
  const history = await assistantModelHistory([
    { id: 'ask', role: 'assistant', parts: [pending('ask_user', 'ask-1')] },
    user('Are you sure this is the best risk/reward?'),
  ])
  expect(JSON.stringify(history)).not.toContain('"type":"tool-call"')
  expect(JSON.stringify(history)).toContain('unresolved')
  expect(JSON.stringify(history)).toContain('Are you sure')
})

test('restored mixed history preserves actual results and marks unknown execution without approving or replaying', async () => {
  const thread: Array<UIMessage> = [
    {
      id: 'mixed',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'get_orders',
          toolCallId: 'read-1',
          state: 'output-available',
          input: {},
          output: { orders: ['verified-order'] },
        },
        pending('prepare_trade', 'trade-1'),
        {
          type: 'dynamic-tool',
          toolName: 'get_status',
          toolCallId: 'failed-1',
          state: 'output-error',
          input: {},
          errorText: 'Read unavailable',
        },
      ],
    },
    user('Check status only'),
  ]
  const before = JSON.stringify(thread)
  const history = await assistantModelHistory(thread)
  const serialized = JSON.stringify(history)
  expect(serialized).toContain('verified-order')
  expect(serialized).toContain('Read unavailable')
  expect(serialized).toContain('unresolved')
  expect(serialized).toContain('not approval')
  expect(serialized).toContain('Do not retry')
  const calls = history.flatMap((message) =>
    message.role === 'assistant' && Array.isArray(message.content)
      ? message.content.filter((part) => part.type === 'tool-call')
      : [],
  )
  expect(calls).toHaveLength(2)
  expect(JSON.stringify(thread)).toBe(before)
})

test('a typed question answer already settled as a tool result remains a real tool exchange', async () => {
  const history = await assistantModelHistory([
    {
      id: 'answered',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'ask_user',
          toolCallId: 'ask-1',
          state: 'output-available',
          input: { question: 'Which setup?' },
          output: { answer: 'Check all candidates first' },
        },
      ],
    },
  ])
  expect(history.map((message) => message.role)).toEqual(['assistant', 'tool'])
  expect(JSON.stringify(history)).toContain('Check all candidates first')
  expect(JSON.stringify(history)).not.toContain('unresolved')
})

test('interrupted arguments and a restored approval request remain unknown rather than executable history', async () => {
  const thread: Array<UIMessage> = [
    {
      id: 'interrupted',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'prepare_trade',
          toolCallId: 'partial',
          state: 'input-streaming',
          input: { symbol: 'ZEC' },
        },
        {
          type: 'dynamic-tool',
          toolName: 'execute_trade',
          toolCallId: 'approve',
          state: 'approval-requested',
          input: {},
          approval: { id: 'approval-1' },
        },
      ],
    },
    user('Do not place anything. What is pending?'),
  ]
  const history = await assistantModelHistory(thread)
  const serialized = JSON.stringify(history)
  expect(serialized).not.toContain('"type":"tool-call"')
  expect(serialized).not.toContain('"type":"tool-approval-response"')
  expect(serialized).toContain('Any required confirmation is still required')
  expect(serialized).toContain('input-streaming')
  expect(serialized).toContain('approval-requested')
  expect(thread[0].parts[1]).toHaveProperty('approval.id', 'approval-1')
})

test.each([true, false])(
  'a recorded approval=%s without execution evidence cannot be replayed from restored history',
  async (approved) => {
    const history = await assistantModelHistory([
      {
        id: 'approval',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'execute_trade',
            toolCallId: 'trade-1',
            state: 'approval-responded',
            input: {},
            approval: { id: 'approval-1', approved },
          },
        ],
      },
      user('Check status only'),
    ])
    const serialized = JSON.stringify(history)
    expect(serialized).not.toContain('"type":"tool-call"')
    expect(serialized).not.toContain('"type":"tool-approval-response"')
    expect(serialized).toContain(approved ? 'approved' : 'denied')
    expect(serialized).toContain('no execution result is recorded')
    expect(serialized).toContain('does not authorize replay')
  },
)

test('135-message history is bounded with intact tool exchanges and latest instructions', () => {
  const messages: Array<ModelMessage> = [
    { role: 'system', content: 'Required safety constraints' },
  ]
  for (let i = 0; i < 44; i++)
    messages.push(
      { role: 'user', content: `Historical request ${i}` },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: `read-${i}`,
            toolName: 'read_orders',
            input: {},
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: `read-${i}`,
            toolName: 'read_orders',
            output: { type: 'json', value: { rows: 'x'.repeat(6000) } },
          },
        ],
      },
    )
  messages.push(
    { role: 'user', content: 'Do not trade. Explain risk/reward.' },
    { role: 'assistant', content: 'Current answer' },
  )
  const original = JSON.stringify(messages)
  const bounded = boundAssistantModelHistory(messages)
  expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(
    ASSISTANT_HISTORY_LIMIT,
  )
  expect(JSON.stringify(bounded)).toContain('Required safety constraints')
  expect(JSON.stringify(bounded)).toContain(
    'Do not trade. Explain risk/reward.',
  )
  expect(JSON.stringify(bounded)).toContain('Older user constraints')
  expect(JSON.stringify(messages)).toBe(original)
  const calls: Array<string> = [],
    results: Array<string> = []
  for (const message of bounded)
    if (Array.isArray(message.content))
      for (const part of message.content) {
        if (part.type === 'tool-call') calls.push(part.toolCallId)
        if (part.type === 'tool-result') results.push(part.toolCallId)
      }
  expect(calls).toEqual(results)
  expect(boundAssistantModelHistory(bounded)).toEqual(bounded)
})

test('a giant current account result becomes unavailable, never a partial or apparently empty account', () => {
  const messages: Array<ModelMessage> = [
    { role: 'user', content: 'Check my account only' },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'account',
          toolName: 'read_account',
          input: { account: 'exact-account' },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'account',
          toolName: 'read_account',
          output: {
            type: 'json',
            value: {
              positions: ['private-position'.repeat(20_000)],
              balance: 500,
            },
          },
        },
      ],
    },
  ]
  const bounded = boundAssistantModelHistory(messages)
  const serialized = JSON.stringify(bounded)
  expect(serialized.length).toBeLessThanOrEqual(ASSISTANT_HISTORY_LIMIT)
  expect(serialized).toContain('result omitted')
  expect(serialized).toContain('unknown')
  expect(serialized).not.toContain('private-position')
  expect(serialized).toContain('exact-account')
  expect(serialized).toContain('"toolCallId":"account"')
})

test('an oversized latest user request fails explicitly instead of deleting instructions', () => {
  expect(() =>
    boundAssistantModelHistory([
      { role: 'user', content: 'important'.repeat(20_000) },
    ]),
  ).toThrow('Latest assistant context exceeds')
})

test('real SDK prepareStep caps accumulated tool results together with the system prompt exactly once', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<Record<string, unknown>> = []
  let executions = 0
  const plugin = createNanogptInferencePlugin(nanogptInferenceManifest)
  await plugin.initialize?.({
    apiKey: 'offline-context-fixture',
    model: 'fixture',
  })
  globalThis.fetch = Object.assign(
    async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)))
      const delta =
        requests.length === 1
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: 'fresh-read',
                  type: 'function',
                  function: { name: 'read_fixture', arguments: '{}' },
                },
              ],
            }
          : { content: 'OK' }
      return new Response(
        `data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      )
    },
    { preconnect: originalFetch.preconnect },
  )
  try {
    const model = await plugin.getLanguageModel?.()
    const system = `REQUIRED-CONSTRAINT-${'s'.repeat(25_000)}`
    const messages: Array<ModelMessage> = []
    for (let index = 0; index < 60; index++)
      messages.push(
        { role: 'user', content: `old-${index}` },
        { role: 'assistant', content: 'old'.repeat(1000) },
      )
    messages.push({ role: 'user', content: 'Read fixture only. Do not trade.' })
    const result = streamText({
      model: model as LanguageModel,
      system,
      messages,
      maxRetries: 0,
      stopWhen: stepCountIs(2),
      prepareStep: ({ messages: stepMessages }) => ({
        system: [],
        messages: boundAssistantModelHistory([
          { role: 'system', content: system },
          ...stepMessages,
        ]),
      }),
      tools: {
        read_fixture: tool({
          inputSchema: z.object({}),
          execute: async () => {
            executions++
            return { fixture: 'huge'.repeat(30_000) }
          },
        }),
      },
    })
    expect(await result.text).toBe('OK')
    expect(executions).toBe(1)
    expect(requests).toHaveLength(2)
    for (const request of requests) {
      const serialized = JSON.stringify(request.messages)
      expect(serialized.length).toBeLessThanOrEqual(ASSISTANT_HISTORY_LIMIT)
      expect(serialized.match(/REQUIRED-CONSTRAINT-/g)).toHaveLength(1)
      expect(serialized).toContain('Read fixture only. Do not trade.')
    }
    expect(JSON.stringify(requests[1].messages)).toContain('result omitted')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('default research instructions and a bounded brief fit the existing history limit', async () => {
  const { buildAssistantSystemPrompt } = await import('../assistant-brain')
  const { WORKFLOW_GUIDE, NOTIFICATION_GUIDE } = await import('../guides')
  const system = buildAssistantSystemPrompt({guides:[WORKFLOW_GUIDE,NOTIFICATION_GUIDE],screen:'screen context '.repeat(100)})
  const messages = [
    {role:'system' as const,content:system},
    ...Array.from({length:120},()=>({role:'user' as const,content:'Earlier research '.repeat(100)})),
    {role:'user' as const,content:'Research one Lighter candidate without placing trades.'},
    {role:'assistant' as const,content:[{type:'tool-call' as const,toolCallId:'brief',toolName:'get_trade_research_brief',input:{venue:'lighter'}}]},
    {role:'tool' as const,content:[{type:'tool-result' as const,toolCallId:'brief',toolName:'get_trade_research_brief',output:{type:'text' as const,value:'verified compact metrics '.repeat(450)}}]},
  ]
  const bounded = boundAssistantModelHistory(messages)
  expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(ASSISTANT_HISTORY_LIMIT)
  expect(JSON.stringify(bounded)).toContain('verified compact metrics')
  expect(JSON.stringify(bounded)).toContain('Default entry research')
  expect(JSON.stringify(bounded)).toContain('Research one Lighter candidate')
})

test('compacts a mandatory parallel tool batch against the remaining system budget', () => {
  const history: Array<ModelMessage> = [
    { role: 'system', content: 's'.repeat(48_000) },
    { role: 'user', content: 'Check the candidates before preparing anything' },
    { role: 'assistant', content: [0, 1, 2].map((id) => ({ type: 'tool-call' as const, toolCallId: `read-${id}`, toolName: 'read_market', input: {} })) },
    { role: 'tool', content: [0, 1, 2].map((id) => ({ type: 'tool-result' as const, toolCallId: `read-${id}`, toolName: 'read_market', output: { type: 'text' as const, value: 'x'.repeat(25_000) } })) },
  ]
  const original = JSON.stringify(history)
  const result = boundAssistantModelHistory(history)
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(ASSISTANT_HISTORY_LIMIT)
  expect(JSON.stringify(result)).toContain('unknown')
  expect(JSON.stringify(result)).toContain('read-2')
  expect(JSON.stringify(history)).toBe(original)
})

test('large earlier tool batch cannot erase the question behind a retry', () => {
  const calls = Array.from({ length: 6 }, (_, i) => ({
    type: 'tool-call' as const,
    toolCallId: `read-${i}`,
    toolName: 'get_news',
    input: { symbol: 'ZORA' },
  }))
  const history: Array<ModelMessage> = [
    { role: 'user', content: 'Thoughts about ZORA?' },
    { role: 'assistant', content: calls },
    {
      role: 'tool',
      content: calls.map((call) => ({
        type: 'tool-result' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { type: 'text' as const, value: 'x'.repeat(15000) },
      })),
    },
    { role: 'user', content: 'trey again' },
  ]
  const before = JSON.stringify(history)
  const bounded = boundAssistantModelHistory(history)
  expect(JSON.stringify(bounded)).toContain('Thoughts about ZORA?')
  expect(JSON.stringify(bounded)).toContain('trey again')
  expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(
    ASSISTANT_HISTORY_LIMIT,
  )
  expect(JSON.stringify(history)).toBe(before)
})
