// Only fixed, actionable text may reach the UI. Provider errors can contain
// credentials, request headers and response bodies; none are rendered here.
import {
  formatBillingErrorMessage,
  parseBillingErrorCode,
} from '@pairlens/shared/billing-types'

export type AssistantErrorCode =
  | 'connect-provider'
  | 'credentials'
  | 'balance'
  | 'model'
  | 'rate-limit'
  | 'network'
  | 'session'
  | 'response-expired'
  | 'server-capacity'
  | 'server-interrupted'
  | 'response-incomplete'
  | 'timeout'
  | 'tool-input'
  | 'tools'
  | 'request-context'
  | 'request-history'
  | 'request-parameter'
  | 'request'
  | 'unavailable'
  | 'unknown'

const PROVIDER_LABELS: Record<string, string> = {
  'nanogpt-inference': 'NanoGPT',
  'openai-inference': 'OpenAI',
  'anthropic-inference': 'Anthropic',
  'groq-inference': 'Groq',
  'deepseek-inference': 'DeepSeek',
  'openrouter-inference': 'OpenRouter',
}

export function describeAssistantError(
  error: unknown,
  providerId?: string,
): { code: AssistantErrorCode; message: string; status?: number } {
  const provider =
    (providerId && PROVIDER_LABELS[providerId]) || 'Your AI provider'
  const messages: Array<string> = []
  const names: Array<string> = []
  let status: number | undefined
  let incompleteStep = false
  let rejection: string | undefined
  const pending: Array<{ error: unknown; depth: number }> = [
    { error, depth: 0 },
  ]
  const seen = new Set<unknown>()
  // RetryError keeps its final failure in lastError, not cause. Only inspect
  // known wrapper fields, preferring that final attempt over earlier errors.
  for (let inspected = 0; inspected < 32 && pending.length > 0; inspected++) {
    const next = pending.pop()!
    const current = next.error
    if (!current || seen.has(current) || next.depth > 8) continue
    seen.add(current)
    if (typeof current === 'string') {
      messages.push(current)
      continue
    }
    if (typeof current !== 'object') continue
    const details = current as Record<string, unknown>
    // Read only the relay's fixed enum; never render raw provider bodies.
    if (typeof details.responseBody === 'string' && details.responseBody.length <= 16384) {
      try {
        const body: unknown = JSON.parse(details.responseBody)
        if (body && typeof body === 'object' && 'providerRejection' in body &&
          typeof body.providerRejection === 'string' &&
          ['context-length', 'tool-history', 'reasoning-history', 'parameter', 'model', 'balance', 'rate-limit'].includes(body.providerRejection)) {
          rejection ??= body.providerRejection
        }
      } catch { /* Non-JSON provider bodies carry no trusted diagnostic. */ }
    }
    incompleteStep ||= details.failureReason === 'incomplete-step'
    if (typeof details.name === 'string') names.push(details.name)
    if ('message' in current && typeof current.message === 'string')
      messages.push(current.message)
    for (const field of ['statusCode', 'status'] as const) {
      if (typeof details[field] === 'number') status ??= details[field]
    }
    const enqueue = (nested: unknown) => {
      if (nested !== undefined)
        pending.push({ error: nested, depth: next.depth + 1 })
    }
    if (details.lastError === undefined && Array.isArray(details.errors)) {
      for (const nested of details.errors.slice(-8)) enqueue(nested)
    }
    enqueue(details.originalError)
    enqueue(details.cause)
    enqueue(details.lastError)
  }
  const text = messages.join(' ').toLowerCase()
  const wire = /\[qt_ai:([a-z-]+):(\d{3}|none)\]/.exec(text)
  if (wire?.[2] !== undefined && wire[2] !== 'none') status ??= Number(wire[2])
  const encoded = wire?.[1]
  const result = (code: AssistantErrorCode, message: string) => ({
    code,
    message,
    ...(status !== undefined &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
      ? { status }
      : {}),
  })
  const serverRelay = names.includes('NanoGPTServerError')
  if (encoded === 'response-incomplete' || (serverRelay && incompleteStep)) {
    return result(
      'response-incomplete',
      `${provider} stopped before completing this step. No tools from that incomplete step were run. Earlier steps may have completed; check orders and runs before asking for a fresh plan.`,
    )
  }
  if (
    encoded === 'session' ||
    (serverRelay && (status === 401 || status === 403))
  ) {
    return result(
      'session',
      'Sign in to QuantTrade to reconnect the server-backed assistant. Earlier tool actions may have completed; check order and run status before repeating a trade request.',
    )
  }
  if (encoded === 'response-expired' || (serverRelay && status === 404)) {
    return result(
      'response-expired',
      'The saved assistant response expired or the QuantTrade server restarted. No request was replayed. Check order and run status before starting a fresh trade request.',
    )
  }
  if (encoded === 'server-capacity' || (serverRelay && status === 429)) {
    return result(
      'server-capacity',
      'The QuantTrade server has reached an assistant capacity or request-rate limit. Wait briefly before continuing. Earlier tool actions may have completed; check order and run status before repeating a trade request.',
    )
  }
  if (
    encoded === 'server-interrupted' ||
    (serverRelay && status !== undefined && status >= 500)
  ) {
    return result(
      'server-interrupted',
      'The QuantTrade server connection to the assistant was interrupted. Earlier tool actions may have completed; check order and run status before repeating a trade request.',
    )
  }
  if (encoded === 'tool-input' || names.includes('AI_InvalidToolInputError')) {
    return result(
      'tool-input',
      'The model supplied invalid tool arguments. This tool call was rejected before execution. Ask the assistant to correct the proposal; check order and run status before repeating a trade request.',
    )
  }
  if (encoded === 'timeout' || names.includes('TimeoutError')) {
    return result(
      'timeout',
      `${provider} timed out before completing the response. Earlier tool actions may have completed; check order and run status before repeating a trade request.`,
    )
  }
  if (
    encoded === 'connect-provider' ||
    /no ai provider|does not expose a model|app server|standalone mode/.test(
      text,
    )
  ) {
    return result(
      'connect-provider',
      'Connect and enable an AI provider with your API key in Plugins. This deployment does not include hosted AI.',
    )
  }
  if (
    encoded === 'credentials' ||
    status === 401 ||
    status === 403 ||
    /invalid api.?key|incorrect api.?key|unauthorized|authentication failed/.test(
      text,
    )
  ) {
    return result(
      'credentials',
      `${provider} rejected the API credentials. Check the key in Plugins, then try again.`,
    )
  }
  if (
    encoded === 'balance' || rejection === 'balance' ||
    status === 402 ||
    /insufficient (balance|credits)|payment required/.test(text)
  ) {
    return result(
      'balance',
      `${provider} requires available credits. Check your provider balance, then try again.`,
    )
  }
  if (
    encoded === 'model' || rejection === 'model' ||
    status === 404 ||
    /model (not found|does not exist|unavailable)|unknown model/.test(text)
  ) {
    return result(
      'model',
      `${provider} could not use the selected model. Choose an available model in Plugins.`,
    )
  }
  if (
    encoded === 'rate-limit' || rejection === 'rate-limit' ||
    status === 429 ||
    /rate limit|too many requests/.test(text)
  ) {
    return result(
      'rate-limit',
      `${provider} is rate limiting requests. Wait briefly, then retry.`,
    )
  }
  if (
    encoded === 'tools' ||
    /does not support (tools|tool calling|function calling)|tool.{0,30}(unsupported|not supported)|unsupported.{0,30}tool/.test(
      text,
    )
  ) {
    return result(
      'tools',
      `${provider}'s selected model does not support assistant tools. Choose a model with tool calling in Plugins.`,
    )
  }
  if (
    encoded === 'network' ||
    /failed to fetch|networkerror|network error|cors|load failed|fetch failed/.test(
      text,
    )
  ) {
    return result(
      'network',
      `The connection to ${provider} failed or was interrupted. The cause is not yet known. Earlier tool actions may have completed; check order and run status before repeating a trade request.`,
    )
  }
  if (encoded === 'request-context' || rejection === 'context-length') {
    return result('request-context', `${provider} cannot fit this conversation into the selected model's context. Start a new chat for further analysis. Earlier orders and runs remain unchanged; inspect their status before preparing another trade.`)
  }
  if (encoded === 'request-history' || rejection === 'tool-history' || rejection === 'reasoning-history') {
    return result('request-history', `${provider} rejected the conversation's tool history. No tools from this rejected step ran. Earlier actions may have completed; inspect orders and runs before continuing in a new chat.`)
  }
  if (encoded === 'request-parameter' || rejection === 'parameter') {
    return result('request-parameter', `${provider} rejected a request setting. This is a request compatibility error; earlier tool actions may have completed. Check orders and runs before repeating a trade request.`)
  }
  if (encoded === 'request' || status === 400 || status === 422) {
    return result(
      'request',
      `${provider} rejected the model request. Check the selected model and its settings in Plugins. The diagnostic code below identifies this request failure.`,
    )
  }
  if (encoded === 'unavailable' || (status !== undefined && status >= 500)) {
    return result(
      'unavailable',
      `${provider} is temporarily unavailable. Retry when the provider recovers.`,
    )
  }
  return result(
    'unknown',
    `${provider} could not complete this request. Check the selected model and provider availability in Plugins, then retry.`,
  )
}

/** Preserve only classified information across the AI SDK's string-only error stream. */
export function encodeAssistantError(
  error: unknown,
  providerId?: string,
): string {
  const billing = parseBillingErrorCode(
    error instanceof Error ? error.message : undefined,
  )
  if (billing) return formatBillingErrorMessage(billing, '')
  const safe = describeAssistantError(error, providerId)
  return `[QT_AI:${safe.code}:${safe.status ?? 'none'}]`
}
