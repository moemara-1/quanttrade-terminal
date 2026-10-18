import { afterEach, expect, test } from 'bun:test'
import { fetchScannerDetail } from '../scanner-detail'

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})
const snapshot = {
  asOf: Date.now(),
  base: 'BTC',
  windowStart: Date.now() - 86400000,
  windowEnd: Date.now(),
  refreshAfterMs: 30000,
  venues: [],
}
test('detail requests are bounded and preserve exact native base and selected venue', async () => {
  globalThis.fetch = (async (url, options) => {
    expect(String(url)).toBe(
      '/_quanttrade/api/public/scanners/detail?base=kPEPE&venue=lighter',
    )
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    return Response.json({ ...snapshot, base: 'kPEPE' })
  }) as typeof fetch
  expect((await fetchScannerDetail('kPEPE', 'lighter')).base).toBe('kPEPE')
})
test('detail rejects invalid destinations before making a request', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return Response.json(snapshot)
  }) as typeof fetch
  await expect(fetchScannerDetail('../wallet', 'all')).rejects.toThrow()
  expect(calls).toBe(0)
})
test('detail failures do not expose HTML or manufacture empty history', async () => {
  globalThis.fetch = (async () =>
    new Response('<html>private upstream failure</html>', {
      status: 503,
    })) as typeof fetch
  await expect(fetchScannerDetail('BTC')).rejects.toThrow('503')
  globalThis.fetch = (async () =>
    new Response('<html>bad gateway</html>', { status: 200 })) as typeof fetch
  await expect(fetchScannerDetail('BTC')).rejects.toThrow(
    'Invalid scanner detail response',
  )
})
test('detail rejects identity substitutions', async () => {
  globalThis.fetch = (async () =>
    Response.json({ ...snapshot, base: 'ETH' })) as typeof fetch
  await expect(fetchScannerDetail('BTC')).rejects.toThrow('identity')
})
test('detail rejects malformed history rather than replacing it with a chart', async () => {
  globalThis.fetch = (async () =>
    Response.json({
      ...snapshot,
      venues: [
        {
          venue: 'lighter',
          symbol: 'BTC-USDC',
          currentFundingHourly: 0,
          projected24hFunding: 0,
          funding: {
            status: 'ok',
            samples: [{ time: Date.now(), rate: 'bad' }],
            sampleCount: 1,
            expectedSamples: 24,
            observedSum: 0,
            actual24h: 0,
            message: null,
          },
          price: { status: 'error', points: [], message: 'Unavailable' },
        },
      ],
    })) as typeof fetch
  await expect(fetchScannerDetail('BTC')).rejects.toThrow(
    'Invalid scanner detail response',
  )
})
