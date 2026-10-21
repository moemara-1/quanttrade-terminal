import { convertToModelMessages, getToolName, isToolUIPart } from 'ai'
import type { ModelMessage, UIMessage } from 'ai'

export const ASSISTANT_HISTORY_LIMIT = 80_000
const RESULT_LIMIT = 32_000
const OMISSION_NOTICE =
  'Some earlier conversation or tool data was omitted to fit the model context. Older user constraints and trade parameters may be absent. Omitted data is unknown, not an empty account, no orders, execution success, or approval. Re-read current account/order/run state and clarify missing required parameters. Never reconstruct or execute an omitted plan, or retry an uncertain submission.'
const size = (value: unknown) => JSON.stringify(value).length

export function boundAssistantModelHistory(messages: Array<ModelMessage>) {
  let omitted = messages.some(
    (message) =>
      message.role === 'system' && message.content === OMISSION_NOTICE,
  )
  const normalized = messages
    .filter(
      (message) =>
        message.role !== 'system' || message.content !== OMISSION_NOTICE,
    )
    .map((message): ModelMessage => {
      if (message.role === 'tool')
        return {
          ...message,
          content: message.content.map((part) => {
            if (
              part.type !== 'tool-result' ||
              size(part.output) <= RESULT_LIMIT
            )
              return part
            omitted = true
            return {
              ...part,
              output: {
                type: 'error-text' as const,
                value:
                  'Tool result omitted because it exceeds the context budget. The complete result is unavailable here; account balances, positions, orders and outcomes are unknown. Obtain a focused fresh read before making a decision. This is not an empty result or execution failure.',
              },
            }
          }),
        }
      if (message.role !== 'assistant') return message
      if (typeof message.content === 'string') {
        if (size(message.content) <= RESULT_LIMIT) return message
        omitted = true
        return {
          ...message,
          content:
            '[Earlier assistant text omitted; its claims and trade parameters must not be reconstructed.]',
        }
      }
      return {
        ...message,
        content: message.content.map((part) => {
          if (
            (part.type !== 'text' && part.type !== 'reasoning') ||
            size(part.text) <= RESULT_LIMIT
          )
            return part
          omitted = true
          return {
            ...part,
            text: '[Earlier assistant text omitted; its claims and trade parameters must not be reconstructed.]',
          }
        }),
      }
    })
  // Each assistant message travels with all immediately following results.
  // Removing one side alone would cause another invalid provider request.
  const groups: Array<Array<ModelMessage>> = []
  for (const message of normalized) {
    const previous = groups.at(-1)
    if (message.role === 'tool' && previous?.[0]?.role === 'assistant')
      previous.push(message)
    else groups.push([message])
  }
  const required = new Set<number>()
  let latestUser = -1
  groups.forEach((group, index) => {
    if (group[0]?.role === 'system') required.add(index)
    if (group[0]?.role === 'user') latestUser = index
  })
  if (latestUser >= 0) required.add(latestUser)
  if (groups.length) required.add(groups.length - 1)
  const notice: ModelMessage = { role: 'system', content: OMISSION_NOTICE }
  const collect = (selected: Set<number>) =>
    groups.flatMap((group, index) => (selected.has(index) ? group : []))
  if (size([notice, ...collect(required)]) > ASSISTANT_HISTORY_LIMIT) {
    throw new Error(
      'Latest assistant context exceeds the safe request budget. [QT_AI:request-context:none]',
    )
  }
  const selected = new Set(required)
  for (let index = groups.length - 1; index >= 0; index--) {
    if (selected.has(index)) continue
    const candidate = new Set([...selected, index])
    if (size([notice, ...collect(candidate)]) > ASSISTANT_HISTORY_LIMIT) break
    selected.add(index)
  }
  omitted ||= selected.size !== groups.length
  const bounded = collect(selected)
  return omitted ? [notice, ...bounded] : bounded
}

/** Repair only the provider view. The original cards and their approvals stay intact. */
export async function assistantModelHistory(messages: Array<UIMessage>) {
  return boundAssistantModelHistory(
    await convertToModelMessages(
      messages.map((message) => ({
        ...message,
        parts: message.parts.map((part): UIMessage['parts'][number] => {
          if (
            !isToolUIPart(part) ||
            ![
              'input-streaming',
              'input-available',
              'approval-requested',
              'approval-responded',
            ].includes(part.state)
          )
            return part
          // A disconnected or abandoned call has no result to pair with it.
          // Sending it as tool_calls poisons every subsequent provider request.
          // Never fabricate a successful result, denial or user authorization.
          const approval =
            part.state === 'approval-responded'
              ? `An approval response (${part.approval.approved ? 'approved' : 'denied'}) was recorded, but no execution result is recorded. This does not authorize replay.`
              : 'This is not approval or proof of execution.'
          return {
            type: 'text',
            text: `[Tool ${getToolName(part)} (${part.toolCallId}) is unresolved (${part.state}). ${approval} Its outcome is unknown. Do not retry or claim success from this record; read current order/run status before preparing a fresh action. Any required confirmation is still required.]`,
          }
        }),
      })),
    ),
  )
}
