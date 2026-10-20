import { z } from 'zod'
import { queryInstruments } from '@pairlens/plugins/catalog'

const catalog = z.array(
  z.object({
    venue: z.string(),
    symbol: z.string().min(1),
    base: z.string().min(1),
    quote:z.string().optional(),
    name: z.string().optional(),
    marketId: z.number().int().optional(),
  }),
)
const names: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  dogecoin: 'DOGE',
  ripple: 'XRP',
  hyperliquid: 'HYPE',
}
export function nativeCatalogCoverage(response:Response){
  const complete=response.headers.get('X-QuantTrade-Catalog-Complete')!=='false'
  let failedDexs:Array<string>=[]
  const header=response.headers.get('X-QuantTrade-Failed-Dexs')
  if(header&&header.length<=4096){try{const parsed=z.array(z.string().max(64)).max(100).safeParse(JSON.parse(header));if(parsed.success)failedDexs=parsed.data}catch{failedDexs=[]}}
  return {complete,failedDexs}
}
export async function searchNativeInstruments(query: string, requestedMarket?: string) {
  const markets = requestedMarket ? [requestedMarket] : ['lighter', 'hyperliquid']
  const raw = query.trim().toLowerCase()
  const nameHints = new Set(
    queryInstruments('crypto', { q: raw, limit: 1000, assetClass: 'crypto' })
      .items.filter((item) => item.name.toLowerCase().includes(raw))
      .map((item) => item.base.toUpperCase()),
  )
  const compact = raw.replace(/[\s/]+/g, '-').toUpperCase()
  const baseQuery = compact.replace(
    /-(USDT|USDC|USDH|USD)(?:-(USDT|USDC|USDH|USD))?$/,
    '',
  )
  const sources = await Promise.all(
    markets.map(async (market) => {
      const venue = market.replace(/-spot$/, '')
      const marketType = market.endsWith('-spot') ? 'spot' : 'perpetual'
      try {
        const response = await fetch(
          `/_quanttrade/api/public/markets?venue=${venue}&marketType=${marketType}`,
          {
            credentials: 'same-origin',
            redirect: 'error',
            signal: AbortSignal.timeout(25000),
          },
        )
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const rows = catalog
          .parse(await response.json())
          .filter((row) => row.venue === venue)
        const instruments = rows
          .filter(
            (row) =>
              row.base.toUpperCase() === (names[raw] ?? baseQuery) ||
              (!raw.includes(':')&&row.base.split(':').at(-1)?.toUpperCase()===baseQuery)||
              row.base.toLowerCase().includes(raw) ||
              row.symbol.toLowerCase().includes(raw) ||
              nameHints.has(row.base.toUpperCase()) ||
              Boolean(row.name?.toLowerCase().includes(raw)),
          )
          .map((row) => ({
            id: `${market}:${row.symbol}${marketType === 'perpetual' ? '-'+(row.quote??row.symbol.split('-').at(-1)) : ''}`,
            market,
            symbol: row.symbol + (marketType === 'perpetual' ? '-'+(row.quote??row.symbol.split('-').at(-1)) : ''),
            quote:row.quote??row.symbol.split('-').at(-1),
            base: row.base,
            name: row.name ?? `${row.base} ${marketType}`,
            nameMatchSource: row.name
              ? 'venue'
              : nameHints.has(row.base.toUpperCase())
                ? 'curated-name-hint'
                : null,
            assetClass: marketType === 'perpetual' ? 'crypto-perp' : 'crypto',
            ...(row.marketId === undefined ? {} : { marketId: row.marketId }),
          }))
        return {
          market,
          status: 'ok' as const,
          ...nativeCatalogCoverage(response),
          catalogCount: rows.length,
          instruments,
        }
      } catch {
        return {
          market,
          status: 'unavailable' as const,
          catalogCount: null,
          instruments: [],
        }
      }
    }),
  )
  return {
    instruments: sources.flatMap((source) => source.instruments),
    sources: sources.map(({ instruments: _, ...source }) => source),
    note: 'Names are discovery hints, not interchangeable execution identifiers. Select an exact returned market and symbol; zero matches or partial coverage do not prove absence from a venue.',
  }
}
