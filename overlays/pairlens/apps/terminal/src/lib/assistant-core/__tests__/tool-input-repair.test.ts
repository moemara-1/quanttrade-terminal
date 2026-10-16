import { expect, test } from 'bun:test'
import { InvalidToolInputError, streamText, tool } from 'ai'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { positionPlanInputSchema } from '../../copilot/advanced-position-plan'
import { repairPositionPlanToolCall } from '../tool-input-repair'

const input = {
  kind: 'scale',
  market: 'lighter',
  pair: 'GRASS-USDC',
  side: 'buy',
  totalSize: '100.0',
  maxTotalNotional: '100',
  lowerPrice: '0.60',
  upperPrice: '0.66',
  count: '4',
  leverage: '5',
  marginMode: 'cross',
  takeProfits: '[{"price":"0.7350","percent":"100"}]',
}
function repair(value: unknown, toolName = 'prepare_position_plan') {
  const toolInput = JSON.stringify(value)
  return repairPositionPlanToolCall({
    system: undefined,
    messages: [],
    tools: {},
    inputSchema: async () => ({}),
    error: new InvalidToolInputError({
      toolInput,
      toolName,
      cause: new Error('invalid'),
    }),
    toolCall: {
      type: 'tool-call',
      toolCallId: 'original-id',
      toolName,
      input: toolInput,
    },
  })
}
test('repairs the observed stringified plan without changing exact decimal strings or identity', async () => {
  const result = await repair(input)
  expect(result?.toolCallId).toBe('original-id')
  expect(result?.toolName).toBe('prepare_position_plan')
  const parsed = positionPlanInputSchema.parse(JSON.parse(result!.input))
  expect(parsed.leverage).toBe(5)
  expect(parsed.kind === 'scale' && parsed.count).toBe(4)
  expect(parsed.totalSize).toBe('100.0')
  expect(parsed.takeProfits).toEqual([{ price: '0.7350', percent: 100 }])
})
test.each([
  '',
  ' ',
  'false',
  'Infinity',
  'NaN',
  '0x10',
  '4.5',
  '4.000000000000000001',
  '41',
  '04',
])('does not guess invalid count %s', async (count) => {
  expect(await repair({ ...input, count })).toBeNull()
})
test('rejects invalid arrays, unknown properties and non-string decimal prices', async () => {
  for (const patch of [
    { takeProfits: '{"price":"1","percent":100}' },
    { takeProfits: '[{"price":0.735,"percent":100}]' },
    { takeProfits: '[{"price":"0.735","percent":true}]' },
    { takeProfits: '[{"price":"0.735","percent":100,"extra":true}]' },
    { extra: true },
    { lowerPrice: 0.6 },
    { count: false },
  ])
    expect(await repair({ ...input, ...patch })).toBeNull()
})
test('never repairs unknown tools or already valid input', async () => {
  expect(await repair(input, 'place_order')).toBeNull()
  expect(
    await repair({
      ...input,
      count: 4,
      leverage: 5,
      takeProfits: [{ price: '0.7350', percent: 100 }],
    }),
  ).toBeNull()
})

test('SDK revalidates repaired input and prepares exactly one approval card', async () => {
  let preparations = 0
  let repairs = 0
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: 'original-id',
            toolName: 'prepare_position_plan',
            input: JSON.stringify(input),
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
    }),
  })
  const result = streamText({
    model,
    prompt: 'prepare only',
    maxRetries: 0,
    experimental_repairToolCall: async (options) => {
      repairs++
      return repairPositionPlanToolCall(options)
    },
    tools: {
      prepare_position_plan: tool({
        inputSchema: positionPlanInputSchema,
        execute: async (args) => {
          preparations++
          expect(args.leverage).toBe(5)
          return { status: 'awaiting_confirmation' }
        },
      }),
    },
  })
  await result.consumeStream()
  expect(preparations).toBe(1)
  expect(repairs).toBe(1)
  expect((await result.toolResults)[0]?.toolCallId).toBe('original-id')
})
