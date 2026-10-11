import { expect, test } from 'bun:test'
import { bridgeRequest, quantTradeFetch } from './quanttrade-session'

test('expired hosted cookie renews once before replaying the exact rejected request', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const request = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return calls.length === 1
      ? Response.json({ error: 'Unauthorized' }, { status: 401 })
      : Response.json({ ok: true })
  }
  const init = {
    method: 'POST',
    body: '{"requestId":"stable"}',
    credentials: 'same-origin' as const,
  }
  expect(
    (
      await quantTradeFetch(
        '/_quanttrade/api/terminal/operations',
        init,
        request,
      )
    ).ok,
  ).toBe(true)
  expect(calls.map((c) => c.url)).toEqual([
    '/_quanttrade/api/terminal/operations',
    '/_quanttrade/api/session',
    '/_quanttrade/api/terminal/operations',
  ])
  expect(calls[2]?.init).toBe(init)
})

test('local bearer failures and public feeds never fall back to hosted authority', async () => {
  for (const [url, init] of [
    [
      '/_quanttrade/api/status',
      { headers: { Authorization: 'Bearer invalid' } },
    ],
    ['/_quanttrade/api/public/markets', {}],
  ] as const) {
    let calls = 0
    const request = async () => {
      calls++
      return new Response(null, { status: 401 })
    }
    expect((await quantTradeFetch(url, init, request)).status).toBe(401)
    expect(calls).toBe(1)
  }
})

test('failed renewal returns original rejection without replay or login loop', async () => {
  let calls = 0
  const request = async () => {
    calls++
    return Response.json({ error: 'Sign in' }, { status: 401 })
  }
  expect(
    (await quantTradeFetch('/_quanttrade/api/status', {}, request)).status,
  ).toBe(401)
  expect(calls).toBe(2)
})

test('concurrent private requests share renewal and never retry the second rejection', async () => {
  let sessions = 0
  const request = async (url: string) => {
    if (url.endsWith('/session')) {
      sessions++
      await Promise.resolve()
      return Response.json({ ok: true })
    }
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const responses = await Promise.all([
    quantTradeFetch('/_quanttrade/api/status', {}, request),
    quantTradeFetch('/_quanttrade/api/connections', {}, request),
  ])
  expect(sessions).toBe(1)
  expect(responses.map((r) => r.status)).toEqual([401, 401])
})

test('uncertain operation responses and network failures are never replayed', async () => {
  let calls = 0
  const request = async () => {
    calls++
    return Response.json({ status: 'unknown' }, { status: 503 })
  }
  expect(
    (await quantTradeFetch('/_quanttrade/api/terminal/operations', {}, request))
      .status,
  ).toBe(503)
  expect(calls).toBe(1)
  await expect(
    quantTradeFetch('/_quanttrade/api/terminal/operations', {}, async () => {
      throw new Error('network')
    }),
  ).rejects.toThrow('network')
})

test('non-JSON gateway failure is actionable and never replays a possibly submitted action', async () => {
 let calls = 0
 const request = async () => { calls++; return new Response('<html>proxy failure</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }) }
 await expect(bridgeRequest('/terminal/orders', { clientOrderId: 'reviewed' }, request)).rejects.toThrow('QuantTrade returned an invalid response (502). Check exchange status before retrying a trading action.')
 expect(calls).toBe(1)
})

test('successful non-JSON bridge response never masquerades as a connected account', async () => {
 await expect(bridgeRequest('/connections', undefined, async () => new Response('<html>Sign in</html>'))).rejects.toThrow('QuantTrade returned an invalid response (200)')
})
