// Only fixed, actionable text may reach the UI. Provider errors can contain
// credentials, request headers and response bodies; none are rendered here.
import { formatBillingErrorMessage, parseBillingErrorCode } from '@pairlens/shared/billing-types'

export type AssistantErrorCode =
  | 'connect-provider'
  | 'credentials'
  | 'balance'
  | 'model'
  | 'rate-limit'
  | 'network'
  | 'tools'
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
  let status: number | undefined
  let current = error
  const seen = new Set<unknown>()
  for (let depth = 0; depth < 4 && current && !seen.has(current); depth++) {
    seen.add(current)
    if (typeof current === 'string') {
      messages.push(current)
      break
    }
    if (typeof current !== 'object') break
    const details = current as Record<string, unknown>
    if ('message' in current && typeof current.message === 'string')
      messages.push(current.message)
    for (const field of ['statusCode', 'status'] as const) {
      if (typeof details[field] === 'number')
        status ??= details[field]
    }
    current = 'cause' in current ? current.cause : undefined
  }
  const text = messages.join(' ').toLowerCase()
  const wire = /\[qt_ai:([a-z-]+):(\d{3}|none)\]/.exec(text)
  if (wire?.[2] !== undefined && wire[2] !== 'none') status ??= Number(wire[2])
  const encoded = wire?.[1]
  const result = (code: AssistantErrorCode, message: string) => ({
    code,
    message,
    ...(status !== undefined && Number.isInteger(status) && status >= 400 && status <= 599 ? { status } : {}),
  })
  if (
    encoded === 'connect-provider' || /no ai provider|does not expose a model|app server|standalone mode/.test(
      text,
    )
  ) {
    return result(
      'connect-provider',
      'Connect and enable an AI provider with your API key in Plugins. This deployment does not include hosted AI.',
    )
  }
  if (
    encoded === 'credentials' || status === 401 ||
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
    encoded === 'balance' || status === 402 ||
    /insufficient (balance|credits)|payment required/.test(text)
  ) {
    return result(
      'balance',
      `${provider} requires available credits. Check your provider balance, then try again.`,
    )
  }
  if (
    encoded === 'model' || status === 404 ||
    /model (not found|does not exist|unavailable)|unknown model/.test(text)
  ) {
    return result(
      'model',
      `${provider} could not use the selected model. Choose an available model in Plugins.`,
    )
  }
  if (encoded === 'rate-limit' || status === 429 || /rate limit|too many requests/.test(text)) {
    return result(
      'rate-limit',
      `${provider} is rate limiting requests. Wait briefly, then retry.`,
    )
  }
  if (
    encoded === 'tools' || /does not support (tools|tool calling|function calling)|tool.{0,30}(unsupported|not supported)|unsupported.{0,30}tool/.test(
      text,
    )
  ) {
    return result(
      'tools',
      `${provider}'s selected model does not support assistant tools. Choose a model with tool calling in Plugins.`,
    )
  }
  if (
    encoded === 'network' || /failed to fetch|networkerror|network error|cors|load failed|fetch failed/.test(
      text,
    )
  ) {
    return result(
      'network',
      `Could not reach ${provider}. Check your connection and browser network restrictions, then retry.`,
    )
  }
  if (encoded === 'request' || status === 400 || status === 422) {
    return result('request', `${provider} rejected the model request. Check the selected model and its settings in Plugins. The diagnostic code below identifies this request failure.`)
  }
  if (encoded === 'unavailable' || (status !== undefined && status >= 500)) {
    return result('unavailable', `${provider} is temporarily unavailable. Retry when the provider recovers.`)
  }
  return result(
    'unknown',
    `${provider} could not complete this request. Check the selected model and provider availability in Plugins, then retry.`,
  )
}

/** Preserve only classified information across the AI SDK's string-only error stream. */
export function encodeAssistantError(error: unknown, providerId?: string): string {
  const billing = parseBillingErrorCode(error instanceof Error ? error.message : undefined)
  if (billing) return formatBillingErrorMessage(billing, '')
  const safe = describeAssistantError(error, providerId)
  return `[QT_AI:${safe.code}:${safe.status ?? 'none'}]`
}
