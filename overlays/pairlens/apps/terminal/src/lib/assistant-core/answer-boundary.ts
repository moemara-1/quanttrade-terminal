import type { ToolSet, UIMessageChunk } from 'ai'

type ToolStep = {
  toolCalls: ReadonlyArray<{ toolName: string; input?: unknown }>
}

// Compare structured arguments, not their serialization order. This is transient
// turn state only; account data and arguments are never logged or persisted.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    )
  return value
}

/** Reserve a text-only model step; a hard stop after tool calls yields no answer. */
export function assistantAnswerBoundary(
  steps: ReadonlyArray<ToolStep>,
  toolStepBudget = 10,
): 'repeated-read' | 'step-budget' | undefined {
  if (steps.length >= toolStepBudget) return 'step-budget'
  const counts = new Map<string, number>()
  for (const step of steps.slice(-6)) {
    // Navigation and editing change the meaning of implicit-context reads.
    // Ordering within a parallel mixed batch is unknown, so don't count it.
    if (step.toolCalls.some(({ toolName }) => !isRead(toolName))) {
      counts.clear()
      continue
    }
    // Several identical calls in one batch count once. A later round may
    // legitimately refresh a quote after reading a different account.
    const signatures = new Set(
      step.toolCalls
        .filter(({ toolName }) => isRead(toolName))
        .map(
          ({ toolName, input }) =>
            `${toolName}:${JSON.stringify(canonical(input))}`,
        ),
    )
    for (const signature of signatures) {
      const count = (counts.get(signature) ?? 0) + 1
      counts.set(signature, count)
      if (count >= 3) return 'repeated-read'
    }
  }
  return undefined
}

const isRead = (name: string) =>
  /^(get|read|search|list|compare|scan)_/.test(name)

/** Provider toolChoice is advisory; enforce the answer boundary at execution too. */
export function guardAssistantTools(
  tools: ToolSet,
  isFinalizing: () => boolean,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute
      if (!execute) return [name, definition]
      const guarded: ToolSet[string] = {
        ...definition,
        execute: (input, options) =>
          isFinalizing()
            ? Promise.resolve({
                status: 'blocked',
                error:
                  'Assistant answer boundary reached. This tool was not executed; earlier outcomes remain unchanged or unknown.',
              })
            : execute(input, options),
      }
      return [name, guarded]
    }),
  )
}

/** Even a provider that ignores text-only mode must not leave a tool-only answer. */
export function ensureAssistantBoundaryAnswer(isFinalizing: () => boolean) {
  let finalStep = false
  let text = false
  let blockedTool = false
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (chunk.type === 'start-step') {
        finalStep = isFinalizing()
        text = false
        blockedTool = false
      }
      // Client-forwarded tools can act on input-available alone. Suppress final
      // tool events too, so they cannot navigate, schedule work or show approvals.
      if (finalStep && chunk.type.startsWith('tool-')) {
        blockedTool = true
        return
      }
      if (chunk.type === 'text-delta' && chunk.delta.trim()) text = true
      if (chunk.type === 'finish-step' && finalStep && (!text || blockedTool)) {
        const id = 'assistant-answer-boundary'
        controller.enqueue({ type: 'text-start', id })
        controller.enqueue({
          type: 'text-delta',
          id,
          delta:
            'I stopped the repeated tool calls, but the model did not produce a final assessment. The results above may be incomplete; I cannot verify the requested position or protection from this response. Earlier tool actions may have completed. Check order and run status before repeating a trade request.',
        })
        controller.enqueue({ type: 'text-end', id })
      }
      controller.enqueue(chunk)
    },
  })
}

export const ANSWER_BOUNDARY_GUIDE =
  'The tool research boundary has been reached. Give the user a final answer now using only verified results already available. State the exact account/venue and read scope when known. Explicitly separate verified facts from missing, unavailable, stale or omitted evidence. Unknown protection is not no protection; submission is not fill confirmation. Do not invent current balances, orders, fills or completed actions. Do not claim you will keep monitoring, retry, or execute later. No more tools or trade actions are available this turn. If a material fact remains unknown, say what could not be verified and the specific focused follow-up needed. Do not ask the user to approve or repeat a trade whose submission outcome is uncertain.'
