import { z } from 'zod'
import { quantTradeFetch } from './plugins/quanttrade-session'
import type { TickerOverviewResponse } from '@pairlens/shared/instrument-types'

const root = 'https://api.coingecko.com/api/v3'
const timeoutMs = 6_000
const cacheMs = 5 * 60_000
const currentMs = 15 * 60_000
// A ticker alone is not unique. Only explicit canonical identities bypass search.
const canonicalIds: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  ZEC: 'zcash',
  TIA: 'celestia',
  HYPE: 'hyperliquid',
  DOGE: 'dogecoin',
  XRP: 'ripple',
  BNB: 'binancecoin',
  XMR: 'monero',
}
const identity = z.object({
  id: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9-]+$/),
  symbol: z.string().min(1).max(100),
})
const profile = identity.extend({
  name: z.string().min(1).max(200),
  description: z.object({ en: z.string().optional() }).optional(),
  categories: z.array(z.string()).optional(),
  genesis_date: z.string().nullable().optional(),
  last_updated: z.string().nullable().optional(),
  links: z
    .object({
      homepage: z.array(z.string()).optional(),
      blockchain_site: z.array(z.string()).optional(),
      repos_url: z
        .object({ github: z.array(z.string()).optional() })
        .optional(),
    })
    .optional(),
  image: z
    .object({ small: z.string().optional(), large: z.string().optional() })
    .optional(),
  market_data: z
    .object({
      circulating_supply: z
        .number()
        .finite()
        .nonnegative()
        .nullable()
        .optional(),
      total_supply: z.number().finite().nonnegative().nullable().optional(),
      max_supply: z.number().finite().nonnegative().nullable().optional(),
      market_cap: z
        .object({
          usd: z.number().finite().nonnegative().nullable().optional(),
        })
        .optional(),
      last_updated: z.string().nullable().optional(),
    })
    .optional(),
})
const urls = (values?: Array<string>) =>
  (values ?? [])
    .filter((value) => /^https:\/\//i.test(value) && value.length <= 2000)
    .slice(0, 5)
const timestamp = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null

export type AssetOverviewResponse = TickerOverviewResponse & {
  source: 'App Server' | 'CoinGecko'
  providerUpdatedAt: string | null
  freshness: 'current' | 'stale' | 'unknown'
  supply: {
    circulating: number | null
    total: number | null
    max: number | null
    asOf: string | null
  } | null
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
type Primary = () => Promise<TickerOverviewResponse>

/** One bounded public snapshot per asset, shared by Pair Info and assistant reads. */
export function createAssetOverviewReader(
  fetcher: Fetcher = fetch,
  now = Date.now,
) {
  const cache = new Map<
    string,
    { expires: number; value: AssetOverviewResponse }
  >()
  const pending = new Map<string, Promise<AssetOverviewResponse>>()
  const json = async (path: string): Promise<unknown> => {
    const response = await fetcher(`${root}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error('Public asset overview is unavailable')
    return response.json()
  }
  const load = async (
    symbol: string,
    assetClass: 'crypto' | 'stocks',
    primary?: Primary,
  ): Promise<AssetOverviewResponse> => {
    if (primary) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([
          primary(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Asset overview timed out')),
              timeoutMs,
            )
          }),
        ])
        return {
          ...result,
          source: 'App Server',
          providerUpdatedAt: null,
          freshness: 'unknown',
          supply: null,
        }
      } catch {
        // Do not substitute a crypto namesake for missing equity fundamentals.
        if (assetClass !== 'crypto')
          throw new Error('Equity asset overview is unavailable')
      } finally {
        clearTimeout(timer)
      }
    }
    if (assetClass !== 'crypto')
      throw new Error(
        'Equity asset overview is unavailable; crypto profiles are not a substitute',
      )
    let id = canonicalIds[symbol]
    if (!id) {
      const search = z
        .object({ coins: z.array(identity).max(1000) })
        .parse(await json(`/search?query=${encodeURIComponent(symbol)}`))
      const matches = search.coins.filter(
        (coin) => coin.symbol.toUpperCase() === symbol,
      )
      if (matches.length !== 1)
        throw new Error(
          'Asset identity is unavailable or ambiguous; specify the exact project',
        )
      id = matches[0].id
    }
    const coin = profile.parse(
      await json(
        `/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
      ),
    )
    if (coin.id !== id || coin.symbol.toUpperCase() !== symbol)
      throw new Error(
        'Asset overview identity does not match the requested asset',
      )
    const data = coin.market_data
    const asOf = timestamp(data?.last_updated ?? coin.last_updated)
    const age = asOf ? now() - Date.parse(asOf) : null
    const freshness =
      age === null
        ? 'unknown'
        : age >= -60_000 && age <= currentMs
          ? 'current'
          : 'stale'
    const current = freshness === 'current'
    const website = urls(coin.links?.homepage)
    const supply = {
      circulating: current ? (data?.circulating_supply ?? null) : null,
      total: current ? (data?.total_supply ?? null) : null,
      max: current ? (data?.max_supply ?? null) : null,
      asOf,
    }
    return {
      source: 'CoinGecko',
      fetchedAt: new Date(now()).toISOString(),
      providerUpdatedAt: asOf,
      freshness,
      supply,
      overview: {
        ticker: `X:${symbol}USD`,
        name: coin.name,
        description:
          coin.description?.en?.replace(/<[^>]*>/g, '').slice(0, 2000) ?? null,
        homepageUrl: website[0] ?? null,
        market: 'crypto',
        currencyName: symbol,
        active: true,
        type: 'cryptocurrency',
        marketCap: current ? (data?.market_cap?.usd ?? null) : null,
        iconUrl: urls([coin.image?.small ?? ''])[0] ?? null,
        logoUrl: urls([coin.image?.large ?? ''])[0] ?? null,
        primaryExchange: null,
        sicCode: null,
        sicDescription: null,
        totalEmployees: null,
        listDate: null,
        sharesOutstanding: null,
        tags: coin.categories?.slice(0, 20) ?? null,
        dateLaunched: coin.genesis_date ?? null,
        urls: {
          website,
          twitter: [],
          reddit: [],
          sourceCode: urls(coin.links?.repos_url?.github),
          explorer: urls(coin.links?.blockchain_site),
        },
        raw: {
          source: 'CoinGecko',
          coinId: coin.id,
          sourceUrl: `https://www.coingecko.com/en/coins/${coin.id}`,
          providerUpdatedAt: asOf,
          freshness,
          supply,
          note: 'Provider profile and supply snapshot only; not venue listing, account or executable order evidence. Missing or stale market figures remain unknown.',
        },
      },
    }
  }
  return async (
    ticker: string,
    assetClass: 'crypto' | 'stocks' = 'crypto',
    primary?: Primary,
  ): Promise<AssetOverviewResponse> => {
    const symbol = ticker
      .trim()
      .toUpperCase()
      .replace(/^X:(.+)USD$/, '$1')
    if (!/^[A-Z0-9][A-Z0-9.]{0,29}$/.test(symbol))
      throw new Error('Use an exact base ticker for the asset overview')
    const key = `${assetClass}:${symbol}`
    const cached = cache.get(key)
    if (cached && cached.expires > now()) return cached.value
    const existing = pending.get(key)
    if (existing) return existing
    const request = load(symbol, assetClass, primary)
      .then((value) => {
        if (cache.size >= 64) cache.delete(cache.keys().next().value!)
        cache.set(key, {
          expires:
            value.freshness === 'current' && value.providerUpdatedAt
              ? Math.min(
                  now() + cacheMs,
                  Date.parse(value.providerUpdatedAt) + currentMs,
                )
              : now() + cacheMs,
          value,
        })
        return value
      })
      .finally(() => pending.delete(key))
    pending.set(key, request)
    return request
  }
}

/** Hosted terminals read public metadata through their existing server session. */
export function assetOverviewFetch(
  url: string,
  init?: RequestInit,
  hosted = typeof location !== 'undefined' &&
    location.protocol === 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname),
) {
  if (!hosted) return fetch(url, init)
  const parsed = new URL(url)
  const params =
    parsed.pathname === '/api/v3/search'
      ? new URLSearchParams({
          action: 'search',
          query: parsed.searchParams.get('query') ?? '',
        })
      : new URLSearchParams({
          action: 'profile',
          id: parsed.pathname.replace('/api/v3/coins/', ''),
        })
  return quantTradeFetch(`/_quanttrade/api/asset-profile?${params}`, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
  })
}

export const readAssetOverview = createAssetOverviewReader(assetOverviewFetch)
