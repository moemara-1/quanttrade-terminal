import { expect, test } from 'bun:test'
import { streamText, tool } from 'ai'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { z } from 'zod'
import {
  repeatedPreparationFailure,
  tradePreparationReady,
} from '../trade-preparation-stop'

test('bounds repeated invalid preparation calls without blocking one correction', () => {
  const failed = {
    toolCalls: [{ toolName: 'prepare_position_plan', invalid: true }],
  }
  expect(repeatedPreparationFailure({ steps: [failed] })).toBe(false)
  expect(repeatedPreparationFailure({ steps: [failed, failed] })).toBe(true)
  expect(
    repeatedPreparationFailure({
      steps: [failed, { toolCalls: [{ toolName: 'prepare_position_plan' }] }],
    }),
  ).toBe(false)
  expect(
    repeatedPreparationFailure({
      steps: [
        { toolCalls: [{ toolName: 'get_candles', invalid: true }] },
        failed,
      ],
    }),
  ).toBe(false)
})

test.each([true, false])(
  'stops at a ready trade card and permits invalid repair: %s',
  async (readyFirst) => {
    let calls = 0
    let preparations = 0
    const model = new MockLanguageModelV3({
      doStream: async () => {
        calls++
        if (calls > 2) throw new Error('Unexpected followup after ready card')
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: `trade-${calls}`,
                toolName: 'prepare_lighter_native_order',
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
    const result = streamText({
      model,
      prompt: 'Prepare my trade',
      stopWhen: tradePreparationReady,
      maxRetries: 0,
      tools: {
        prepare_lighter_native_order: tool({
          inputSchema: z.object({}),
          execute: async () => {
            preparations++
            return {
              status:
                readyFirst || preparations === 2
                  ? 'awaiting_confirmation'
                  : 'invalid',
            }
          },
        }),
      },
    })
    await result.consumeStream()
    expect(calls).toBe(readyFirst ? 1 : 2)
    expect(preparations).toBe(calls)
  },
)

test('ignores unrelated tools with the same status and malformed results', () => {
  expect(
    tradePreparationReady({
      steps: [
        {
          toolResults: [
            {
              toolName: 'create_script',
              output: { status: 'awaiting_confirmation' },
            },
          ],
        },
      ],
    }),
  ).toBe(false)
  expect(
    tradePreparationReady({
      steps: [{ toolResults: [{ toolName: 'place_order', output: null }] }],
    }),
  ).toBe(false)
})
