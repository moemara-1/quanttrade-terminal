import { expect, test } from 'bun:test'
import { RetryError } from 'ai'
import {
  describeAssistantError,
  encodeAssistantError,
} from '../assistant-error'

test('an incomplete atomic step is not mislabeled as a broken connection', () => {
  const error = { name: 'NanoGPTServerError', statusCode: 502, failureReason: 'incomplete-step' }
  expect(encodeAssistantError(error, 'nanogpt-inference')).toBe('[QT_AI:response-incomplete:502]')
  const described = describeAssistantError(error, 'nanogpt-inference')
  expect(described.message).toContain('No tools from that incomplete step were run')
  expect(described.message).toContain('Earlier steps may have completed')
})

test.each([
  [401, 'session', 'Sign in to QuantTrade'],
  [403, 'session', 'Sign in to QuantTrade'],
  [404, 'response-expired', 'expired'],
  [429, 'server-capacity', 'QuantTrade server'],
] as const)(
  'server relay HTTP %s is not a provider key/model failure',
  (statusCode, code, message) => {
    const error = {
      name: 'NanoGPTServerError',
      statusCode,
      message: 'private secret',
    }
    const described = describeAssistantError(error, 'nanogpt-inference')
    expect(described.code).toBe(code)
    expect(described.message).toContain(message)
    expect(described.message).not.toContain('private secret')
    expect(describeAssistantError(encodeAssistantError(error)).code).toBe(code)
  },
)

test('missing hosted inference directs the user to a connected provider', () => {
  expect(
    describeAssistantError(
      new Error('hosted AI requires an App Server (standalone mode)'),
      'pairlens-intelligence',
    ).code,
  ).toBe('connect-provider')
})
for (const [status, code] of [
  [401, 'credentials'],
  [403, 'credentials'],
  [402, 'balance'],
  [404, 'model'],
  [429, 'rate-limit'],
] as const) {
  test(`classifies provider HTTP ${status}`, () => {
    expect(
      describeAssistantError(
        { statusCode: status, message: 'private request body' },
        'nanogpt-inference',
      ).code,
    ).toBe(code)
  })
}
test('reads nested status without exposing response data', () => {
  const result = describeAssistantError(
    { cause: { status: 401 }, message: 'Bearer sk-private-secret' },
    'nanogpt-inference',
  )
  expect(result.code).toBe('credentials')
  expect(result.message).not.toContain('sk-private-secret')
  expect(result.message).toContain('NanoGPT')
})
test('network and tool compatibility failures have actionable fixed copy', () => {
  expect(describeAssistantError(new TypeError('Failed to fetch')).code).toBe(
    'network',
  )
  expect(
    describeAssistantError(new Error('This model does not support tools')).code,
  ).toBe('tools')
})
test('unknown errors and provider IDs cannot inject secrets or response bodies', () => {
  const result = describeAssistantError(
    new Error('key=secret server response <script>'),
    'provider-secret-token',
  )
  expect(result.code).toBe('unknown')
  expect(result.message).not.toContain('secret')
  expect(result.message).not.toContain('script')
})
test('cyclic causes do not recurse forever', () => {
  const error: { message: string; cause?: unknown } = { message: 'unknown' }
  error.cause = error
  expect(describeAssistantError(error).code).toBe('unknown')
})

test('relay interruptions remain distinct from provider outages through the wire', () => {
  const error = {
    name: 'NanoGPTServerError',
    statusCode: 502,
    failureReason: 'upstream-stream',
  }
  const encoded = encodeAssistantError(error, 'nanogpt-inference')
  expect(encoded).toBe('[QT_AI:server-interrupted:502]')
  const result = describeAssistantError(new Error(encoded), 'nanogpt-inference')
  expect(result.code).toBe('server-interrupted')
  expect(result.message).toContain('Earlier tool actions may have completed')
  expect(result.message).not.toContain('temporarily unavailable')
})

test('SDK retry exhaustion preserves the final provider status without exposing payloads', () => {
  const error = new RetryError({
    message: 'Failed after 3 attempts. Last error: private request',
    reason: 'maxRetriesExceeded',
    errors: [
      { statusCode: 401, message: 'old attempt secret' },
      { statusCode: 503, message: '' },
      { statusCode: 503, message: '' },
    ],
  })
  expect(encodeAssistantError(error, 'nanogpt-inference')).toBe(
    '[QT_AI:unavailable:503]',
  )
  const described = describeAssistantError(error, 'nanogpt-inference')
  expect(described.message).not.toContain('private')
  expect(described.message).not.toContain('secret')
})

test('known wrapper fields and cyclic retry arrays retain the latest nested status', () => {
  const error: { errors: Array<unknown>; originalError?: unknown } = {
    errors: [],
  }
  error.errors.push(
    error,
    { statusCode: 401 },
    {
      originalError: {
        cause: { status: 503, message: 'private response body' },
      },
    },
  )
  expect(describeAssistantError(error).status).toBe(503)
  expect(describeAssistantError(error).code).toBe('unavailable')
  expect(describeAssistantError(error).message).not.toContain('private')
})

test('unknown error fields are never treated as nested diagnostic errors', () => {
  expect(describeAssistantError({ responseBody: { status: 401 } }).code).toBe(
    'unknown',
  )
})

test('stream errors retain HTTP status while discarding request bodies and credentials', () => {
  const encoded = encodeAssistantError(
    { statusCode: 400, message: 'private-key request payload' },
    'nanogpt-inference',
  )
  expect(encoded).toBe('[QT_AI:request:400]')
  const decoded = describeAssistantError(
    new Error(encoded),
    'nanogpt-inference',
  )
  expect(decoded.code).toBe('request')
  expect(decoded.status).toBe(400)
  expect(decoded.message).not.toContain('private-key')
})

test('network classification survives the string-only stream', () => {
  const decoded = describeAssistantError(
    new Error(encodeAssistantError(new TypeError('Failed to fetch'))),
  )
  expect(decoded.code).toBe('network')
})

test('existing typed billing notices survive without raw provider text', () => {
  expect(
    encodeAssistantError(
      new Error(
        '[pairlens-billing:intelligence_credits_exhausted] private payload',
      ),
    ),
  ).toBe('[pairlens-billing:intelligence_credits_exhausted] ')
})

test('invalid tool arguments are distinct from provider failures and never leak payloads', () => {
  const error = {
    name: 'AI_InvalidToolInputError',
    message: 'private trade payload',
    cause: { name: 'AI_TypeValidationError' },
  }
  const encoded = encodeAssistantError(error, 'nanogpt-inference')
  expect(encoded).toBe('[QT_AI:tool-input:none]')
  expect(describeAssistantError(new Error(encoded)).code).toBe('tool-input')
  expect(describeAssistantError(error).message).not.toContain('private')
})

test('provider timeouts are distinguished from generic network failures', () => {
  expect(
    describeAssistantError({ name: 'TimeoutError', message: 'private request' })
      .code,
  ).toBe('timeout')
  expect(describeAssistantError(new Error('[QT_AI:timeout:none]')).code).toBe(
    'timeout',
  )
})

test('network failures do not blame browser settings without evidence or recommend a blind retry', () => {
  const { message } = describeAssistantError(
    new TypeError('Failed to fetch'),
    'nanogpt-inference',
  )
  expect(message).not.toContain('browser network restrictions')
  expect(message).toContain('check order and run status')
})

test.each([
  ['context-length', 'request-context'],
  ['tool-history', 'request-history'],
  ['reasoning-history', 'request-history'],
  ['parameter', 'request-parameter'],
])('safe rejection %s survives SDK wrappers and stream encoding', (category, code) => {
  const error = {statusCode: 400, responseBody: JSON.stringify({providerRejection: category, error: 'secret-payload'})}
  const encoded = encodeAssistantError(error, 'nanogpt-inference')
  expect(encoded).toBe(`[QT_AI:${code}:400]`)
  const decoded = describeAssistantError(new Error(encoded), 'nanogpt-inference')
  expect(decoded.code).toBe(code)
  expect(decoded.message).not.toContain('secret-payload')
  expect(decoded.message).not.toContain('Check the selected model')
})

test('untrusted rejection categories never become user-facing text', () => {
  const safe = describeAssistantError({statusCode:400,responseBody:JSON.stringify({providerRejection:'secret-key'})}, 'nanogpt-inference')
  expect(safe.code).toBe('request')
  expect(safe.message).not.toContain('secret-key')
})
