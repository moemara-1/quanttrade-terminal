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
  research: {
    elapsedMs?: number
    callBudget?: number
    timeBudgetMs?: number
  } = {},
): 'repeated-read' | 'step-budget' | 'call-budget' | 'time-budget' | undefined {
  if (
    steps.reduce((count, step) => count + step.toolCalls.length, 0) >=
    (research.callBudget ?? 48)
  )
    return 'call-budget'
  if ((research.elapsedMs ?? 0) >= (research.timeBudgetMs ?? 120000))
    return 'time-budget'
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
  /^(get|read|search|list|compare|scan)_/.test(name) ||
  name === 'web_search' ||
  name === 'deep_research'

/** Share admission between execution and UI forwarding; provider events can race. */
export function createAssistantToolAdmission(
  isClosed: () => boolean,
  onLimit: () => void,
  limit = 48,
) {
  const accepted = new Set<string>()
  const blocked = new Set<string>()
  return {
    admit(id: string) {
      if (accepted.has(id)) return true
      if (blocked.has(id)) return false
      if (isClosed() || accepted.size >= limit) {
        blocked.add(id)
        onLimit()
        return false
      }
      accepted.add(id)
      return true
    },
    blocked(id: string) {
      return blocked.has(id)
    },
  }
}
type ToolAdmission = ReturnType<typeof createAssistantToolAdmission>

/** Provider toolChoice is advisory; enforce the answer boundary at execution too. */
export function guardAssistantTools(
  tools: ToolSet,
  isFinalizing: () => boolean,
  limits: {
    readTimeoutMs?: number
    onReadTimeout?: () => void
    onCallLimit?: () => void
    maxToolCalls?: number
    admission?: ToolAdmission
  } = {},
): ToolSet {
  let admitted = 0
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute
      if (!execute) return [name, definition]
      const guarded: ToolSet[string] = {
        ...definition,
        execute: (input, options) => {
          if (isFinalizing())
            return Promise.resolve({
              status: 'blocked',
              error:
                'Assistant answer boundary reached. This tool was not executed; earlier outcomes remain unchanged or unknown.',
            })
          // Admission is synchronous, before any await, so a single parallel
          // fanout cannot bypass the next-step research boundary.
          if (
            limits.admission
              ? !limits.admission.admit(options.toolCallId)
              : admitted >= (limits.maxToolCalls ?? 48)
          ) {
            limits.onCallLimit?.()
            return Promise.resolve({
              status: 'blocked',
              reason: 'call-budget',
              error:
                'Research call budget reached. This tool was not executed. Give a final assessment using collected results.',
            })
          }
          admitted++
          // Never race a mutation or approval against a timer: a timed-out
          // submission could still complete and must not become retryable.
          if (!isRead(name)) return execute(input, options)
          const controller = new AbortController()
          const signal = options.abortSignal
            ? AbortSignal.any([options.abortSignal, controller.signal])
            : controller.signal
          return new Promise((resolve, reject) => {
            let settled = false
            const cleanup = () => {
              clearTimeout(timer)
              signal.removeEventListener('abort', aborted)
            }
            const aborted = () => {
              if (settled) return
              settled = true
              cleanup()
              reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
            }
            const timer = setTimeout(() => {
              if (settled) return
              settled = true
              cleanup()
              limits.onReadTimeout?.()
              controller.abort()
              resolve({
                status: 'unavailable',
                reason: 'read-timeout',
                error:
                  'This read exceeded its deadline. Its result is unknown, not empty. Use the verified results already collected; do not repeat it this turn.',
              })
            }, limits.readTimeoutMs ?? 30000)
            signal.addEventListener('abort', aborted, { once: true })
            if (signal.aborted) {
              aborted()
              return
            }
            Promise.resolve()
              .then(() =>
                settled
                  ? undefined
                  : execute(input, { ...options, abortSignal: signal }),
              )
              .then(
                (value) => {
                  if (!settled) {
                    settled = true
                    cleanup()
                    resolve(value)
                  }
                },
                (error) => {
                  if (!settled) {
                    settled = true
                    cleanup()
                    reject(error)
                  }
                },
              )
          })
        },
      }
      return [name, guarded]
    }),
  )
}

/** Even a provider that ignores text-only mode must not leave a tool-only answer. */
export function ensureAssistantBoundaryAnswer(
  isFinalizing: () => boolean,
  admission?: ToolAdmission,
  recoverFinalText?: () => Promise<string>,
  abortSignal?: AbortSignal,
) {
  let finalStep = false
  let text = false
  let blockedTool = false
  let fallback = false
  let terminalError = false
  let sourceReturned = false
  const toolNames = new Map<string, string>()
  const completedTools = new Set<string>()
  const presentationTools = new Set([
    'switch_pair',
    'switch_market',
    'set_timeframe',
    'highlight_ui',
  ])
  const returned = new Set<string>()
  const unavailable = new Set<string>()
  const fallbackText =
    'This audit is incomplete: the research limit was reached and the model did not produce a final assessment. Use only verified tool results above; failed, timed-out or omitted reads are unknown, not empty. Earlier tool actions may have completed. Check order and run status before repeating a trade request.'
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    async transform(chunk, controller) {
      if (chunk.type === 'error' || chunk.type === 'abort') terminalError = true
      if (chunk.type === 'source-url' || chunk.type === 'source-document')
        sourceReturned = true
      if (
        (chunk.type === 'tool-input-start' ||
          chunk.type === 'tool-input-available') &&
        admission &&
        !admission.admit(chunk.toolCallId)
      ) {
        if (isFinalizing()) blockedTool = true
        return
      }
      if (
        chunk.type.startsWith('tool-') &&
        'toolCallId' in chunk &&
        typeof chunk.toolCallId === 'string' &&
        admission?.blocked(chunk.toolCallId)
      ) {
        if (isFinalizing()) blockedTool = true
        return
      }
      if (chunk.type === 'tool-input-available')
        toolNames.set(chunk.toolCallId, chunk.toolName)
      if (
        chunk.type === 'tool-output-available' ||
        chunk.type === 'tool-output-error'
      ) {
        completedTools.add(chunk.toolCallId)
        const name = toolNames.get(chunk.toolCallId)
        if (name && isRead(name)) {
          const output =
            chunk.type === 'tool-output-available' ? chunk.output : undefined
          const failed =
            chunk.type === 'tool-output-error' ||
            (output !== null &&
              typeof output === 'object' &&
              (('status' in output &&
                ['unavailable', 'failed', 'error', 'blocked'].includes(
                  String(output.status),
                )) ||
                ('error' in output && !!output.error)))
          ;(failed ? unavailable : returned).add(name)
        }
      }
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
      const missingResearchAnswer =
        chunk.type === 'finish' &&
        !abortSignal?.aborted &&
        !terminalError &&
        !text &&
        (sourceReturned || toolNames.size > 0) &&
        [...toolNames.entries()].every(
          ([id, name]) =>
            isRead(name) ||
            (presentationTools.has(name) && completedTools.has(id)),
        )
      if (
        ((chunk.type === 'finish' && isFinalizing()) ||
          missingResearchAnswer) &&
        (!text || blockedTool) &&
        !fallback
      ) {
        fallback = true
        let recovered = ''
        if (missingResearchAnswer && recoverFinalText) {
          try {
            recovered = (await recoverFinalText()).trim()
          } catch {
            recovered =
              '' /* The bounded provider attempt failed; emit the explicit fallback below. */
          }
        }
        if (abortSignal?.aborted) {
          controller.enqueue(chunk)
          return
        }
        const id = 'assistant-answer-boundary'
        controller.enqueue({ type: 'text-start', id })
        controller.enqueue({
          type: 'text-delta',
          id,
          delta:
            recovered ||
            (isFinalizing()
              ? fallbackText
              : 'The model ended without a final assessment after the research calls. Sources alone are not an analysis. No conclusion was verified from this response; failed or omitted reads remain unknown.') +
              (returned.size
                ? `\n\nReads with returned results (not independently validated): ${[...returned].slice(0, 16).join(', ')}.`
                : '') +
              (unavailable.size
                ? `\n\nUnavailable or failed reads: ${[...unavailable].slice(0, 16).join(', ')}.`
                : ''),
        })
        controller.enqueue({ type: 'text-end', id })
      }
      controller.enqueue(chunk)
    },
  })
}

export const ANSWER_BOUNDARY_GUIDE =
  'The tool research boundary has been reached. Give the user a final answer now using only verified results already available. State the exact account/venue and read scope when known. Explicitly separate verified facts from missing, unavailable, stale or omitted evidence. Unknown protection is not no protection; submission is not fill confirmation. Do not invent current balances, orders, fills or completed actions. Do not claim you will keep monitoring, retry, or execute later. No more tools or trade actions are available this turn. If a material fact remains unknown, say what could not be verified and the specific focused follow-up needed. Do not ask the user to approve or repeat a trade whose submission outcome is uncertain.'
