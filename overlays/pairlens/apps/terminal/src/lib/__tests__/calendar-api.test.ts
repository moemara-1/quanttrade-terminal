import { afterEach, describe, expect, it } from 'bun:test'

import { EquityFundamentalsUnavailableError, api } from '../api'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('standalone hosted calendar transport', () => {
  it('loads earnings, IPOs and macro schedules from the same-origin bridge', async () => {
    const requests: Array<string> = []
    const response = { entries: [], fetchedAt: '2026-10-12T00:00:00Z' }
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(String(input))
        expect(init?.credentials).toBe('same-origin')
        return Response.json(response)
      },
      { preconnect: originalFetch.preconnect },
    )
    expect(
      await api.getEarningsCalendar({
        days: 7,
        start: '2026-10-12',
        symbols: ['AAPL', 'MSFT'],
      }),
    ).toEqual(response)
    expect(await api.getIpoCalendar({ days: 30 })).toEqual(response)
    expect(await api.getEconomicCalendar(14)).toEqual(response)
    expect(requests).toEqual([
      '/api/earnings-calendar?days=7&start=2026-10-12&symbols=AAPL%2CMSFT',
      '/api/ipo-calendar?days=30',
      '/api/economic-calendar?days=14',
    ])
  })

  it.each([
    [404, undefined, 'not_configured'],
    [429, undefined, 'rate_limited'],
    [503, 'upstream_error', 'upstream_error'],
    [503, 'not_configured', 'not_configured'],
  ])(
    'preserves provider refusal for HTTP %s / %s',
    async (status, reason, expected) => {
      globalThis.fetch = Object.assign(
        async () => Response.json({ reason }, { status }),
        { preconnect: originalFetch.preconnect },
      )
      try {
        await api.getEconomicCalendar()
        throw new Error('Expected calendar failure')
      } catch (error) {
        expect(error).toBeInstanceOf(EquityFundamentalsUnavailableError)
        expect((error as EquityFundamentalsUnavailableError).reason).toBe(
          expected,
        )
      }
    },
  )

  it('does not enable unsupported standalone company and insider providers', async () => {
    let requests = 0
    globalThis.fetch = Object.assign(
      async () => {
        requests++
        return Response.json({})
      },
      { preconnect: originalFetch.preconnect },
    )
    await expect(api.getCompanyOverview('AAPL')).rejects.toMatchObject({
      reason: 'not_configured',
    })
    await expect(api.getInsiderTransactions('AAPL')).rejects.toMatchObject({
      reason: 'not_configured',
    })
    expect(requests).toBe(0)
  })
})
