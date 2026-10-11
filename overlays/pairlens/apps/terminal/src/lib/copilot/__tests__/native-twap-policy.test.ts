import { expect, test } from 'bun:test'
import { changeNativeTwapPolicy } from '../native-twap-policy'

const status = {
  accountName: 'desk',
  connectionRevisions: { hyperliquid: 'a'.repeat(64) },
  venueModes: { hyperliquid: 'live' },
  nativeTwapRiskAllowed: false,
}
test('policy requires unchanged live account and only changes native permission', async () => {
  let payload: unknown
  const result = await changeNativeTwapPolicy(
    status,
    true,
    async (url, init) => {
      if (url.endsWith('/status')) return Response.json(status)
      payload = JSON.parse(String(init?.body))
      return Response.json({
        enabled: true,
        accountName: 'desk',
        connectionRevision: 'a'.repeat(64),
      })
    },
  )
  expect(result.enabled).toBe(true)
  expect(payload).toMatchObject({
    enabled: true,
    acceptFixedSlippageBps: 300,
    mode: 'live',
    venue: 'hyperliquid',
    accountName: 'desk',
    connectionRevision: 'a'.repeat(64),
  })
  expect(payload).not.toHaveProperty('maxPriceDeviationBps')
})
test('changed credentials block policy mutation', async () => {
  let calls = 0
  await expect(
    changeNativeTwapPolicy(status, true, async () => {
      calls++
      return Response.json({
        ...status,
        connectionRevisions: { hyperliquid: 'b'.repeat(64) },
      })
    }),
  ).rejects.toThrow('changed')
  expect(calls).toBe(1)
})
test('session renewal retains the exact policy request identity', async () => {
  const bodies: Array<string> = []
  await changeNativeTwapPolicy(status, false, async (url, init) => {
    if (url.endsWith('/status')) return Response.json(status)
    if (url.endsWith('/session')) return Response.json({ ok: true })
    bodies.push(String(init?.body))
    if (bodies.length === 1) return new Response('', { status: 401 })
    return Response.json({
      enabled: false,
      accountName: 'desk',
      connectionRevision: 'a'.repeat(64),
    })
  })
  expect(bodies).toHaveLength(2)
  expect(bodies[0]).toBe(bodies[1])
})
