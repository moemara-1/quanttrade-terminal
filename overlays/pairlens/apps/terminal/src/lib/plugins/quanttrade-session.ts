import { z } from 'zod'

export type BridgeFetcher = (
  url: string,
  init?: RequestInit,
) => Promise<Response>
export type QuantTradeVenue =
  | 'hyperliquid'
  | 'lighter'
  | 'hyperliquid-spot'
  | 'lighter-spot'
export function quantTradeBaseVenue(
  market: QuantTradeVenue,
): 'hyperliquid' | 'lighter' {
  return market.startsWith('hyperliquid') ? 'hyperliquid' : 'lighter'
}
export function isQuantTradeVenue(market: string): market is QuantTradeVenue {
  return (
    market === 'hyperliquid' ||
    market === 'lighter' ||
    market === 'hyperliquid-spot' ||
    market === 'lighter-spot'
  )
}

const browserFetch: BridgeFetcher = (url, init) => fetch(url, init)
const renewals = new WeakMap<BridgeFetcher, Promise<boolean>>()

/** Retry only authentication rejections, which happen before any trading handler. */
export async function quantTradeFetch(
  url: string,
  init?: RequestInit,
  fetcher: BridgeFetcher = browserFetch,
): Promise<Response> {
  const response = await fetcher(url, init)
  if (
    response.status !== 401 ||
    !url.startsWith('/_quanttrade/api/') ||
    url.startsWith('/_quanttrade/api/public/') ||
    url === '/_quanttrade/api/session' ||
    new Headers(init?.headers).has('Authorization') ||
    init?.signal?.aborted
  )
    return response
  let renewal = renewals.get(fetcher)
  if (!renewal) {
    renewal = (async () => {
      try {
        const session = await fetcher('/_quanttrade/api/session', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        if (!session.ok) return false
        return z.object({ ok: z.literal(true) }).safeParse(await session.json())
          .success
      } catch {
        return false
      }
    })()
    renewals.set(fetcher, renewal)
    void renewal.finally(() => {
      renewals.delete(fetcher)
    })
  }
  if (!(await renewal) || init?.signal?.aborted) return response
  return fetcher(url, init)
}

export async function bridgeRequest(
  path: string,
  body?: unknown,
  fetcher: BridgeFetcher = browserFetch,
  method = body === undefined ? 'GET' : 'POST',
): Promise<unknown> {
  const verifyingConnection =
    (path === '/connections' && method === 'POST') ||
    (/^\/connections\/(hyperliquid|lighter)$/.test(path) && method === 'DELETE')
  let response: Response
  try {
    response = await quantTradeFetch(
      `/_quanttrade/api${path}`,
      {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(verifyingConnection ? 225000 : 30000),
        headers:
          body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      fetcher,
    )
  } catch (error) {
    if (
      verifyingConnection &&
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name)
    )
      throw new Error(
        'Connection update took too long. Refresh Accounts to check status before trying again.',
      )
    throw error
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error(
      `QuantTrade returned an invalid response (${response.status}). Check exchange status before retrying a trading action.`,
    )
  }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(data)
    throw new Error(
      error.success
        ? error.data.error
        : `QuantTrade request failed (${response.status})`,
    )
  }
  return data
}

export async function connectBrowserSession(
  fetcher?: BridgeFetcher,
): Promise<void> {
  z.object({ ok: z.literal(true) }).parse(
    await bridgeRequest('/session', {}, fetcher),
  )
}
