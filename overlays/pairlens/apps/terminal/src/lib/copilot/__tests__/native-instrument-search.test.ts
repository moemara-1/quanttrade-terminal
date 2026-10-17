import { afterEach, expect, test } from 'bun:test'
import { searchNativeInstruments } from '../native-instrument-search'

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})
test('native search reads both catalogs and preserves exact contract identity and ambiguous names', async () => {
  globalThis.fetch = (async (url: unknown) => {
    const venue = new URL(String(url), 'https://test').searchParams.get('venue')
    return Response.json(
      venue === 'lighter'
        ? [
            { venue, base: 'PRL', symbol: 'PRL-USDC', name: 'Pearl' },
            { venue, base: 'PEARL', symbol: 'PEARL-USDC', name: 'Pearl' },
          ]
        : [],
    )
  }) as typeof fetch
  const result = await searchNativeInstruments('pearl')
  expect(result.instruments.map((row) => row.symbol)).toEqual([
    'PRL-USDC-USDC',
    'PEARL-USDC-USDC',
  ])
  expect(result.sources.every((row) => row.status === 'ok')).toBe(true)
  expect(result.note).toContain('not interchangeable')
})
test('ticker search does not invent PRL to PEARL alias and venue failures remain unknown', async () => {
  globalThis.fetch = (async (url: unknown) =>
    String(url).includes('hyperliquid')
      ? new Response('', { status: 503 })
      : Response.json([
          { venue: 'lighter', base: 'PRL', symbol: 'PRL-USDC' },
        ])) as typeof fetch
  const result = await searchNativeInstruments('pearl')
  expect(result.instruments).toEqual([])
  expect(
    result.sources.find((row) => row.market === 'hyperliquid')?.status,
  ).toBe('unavailable')
})
test('curated full names discover native candidates without rewriting identifiers', async () => {
  globalThis.fetch = (async () =>
    Response.json([
      { venue: 'lighter', base: 'ADA', symbol: 'ADA-USDC' },
    ])) as typeof fetch
  const result = await searchNativeInstruments('cardano', 'lighter')
  expect(result.instruments[0]?.symbol).toBe('ADA-USDC-USDC')
  expect(result.instruments[0]?.nameMatchSource).toBe('curated-name-hint')
})
