import Decimal from 'decimal.js';
import { z } from 'zod';
import type { BookLevel, Candle, Market, MarketType, OrderBook, Venue } from '../shared/types.ts';

const numberValue = z.union([z.number(), z.string().min(1)]).transform(Number).refine(Number.isFinite);
const positive = numberValue.refine((n) => n > 0);
const nonnegative = numberValue.refine((n) => n >= 0);
const hlContext = z.object({ markPx: positive, prevDayPx: positive, dayNtlVlm: nonnegative, funding: numberValue, openInterest: nonnegative });
const hlMeta = z.tuple([z.object({ universe: z.array(z.object({ name: z.string(), szDecimals: z.number().int().min(0).max(6), maxLeverage:z.number().int().positive().nullable().optional(), isDelisted: z.boolean().optional() })) }), z.array(z.unknown())]);
const hlSpotMeta=z.tuple([z.object({tokens:z.array(z.object({name:z.string(),index:z.number().int().nonnegative(),szDecimals:z.number().int().min(0).max(8)})),universe:z.array(z.object({name:z.string(),index:z.number().int().nonnegative(),tokens:z.tuple([z.number().int().nonnegative(),z.number().int().nonnegative()]),isDelisted:z.boolean().optional()}))}),z.array(z.unknown())]);
const spotContext=z.object({markPx:positive,prevDayPx:positive,dayNtlVlm:nonnegative,coin:z.string()});
const lighterSpotAsset=z.object({symbol:z.string(),market_id:z.number().int(),status:z.string(),market_type:z.literal('spot'),supported_size_decimals:z.number().int().min(0).max(18),supported_price_decimals:z.number().int().min(0).max(18),min_base_amount:positive,min_quote_amount:nonnegative,last_trade_price:positive,daily_price_change:numberValue,daily_quote_token_volume:nonnegative,is_frozen:z.boolean().optional()});
const lighterAsset = z.object({
  symbol: z.string(), market_id: z.number().int(), status: z.string(), market_type: z.string(),
  supported_size_decimals: z.number().int().min(0).max(18), supported_price_decimals: z.number().int().min(0).max(18),
  min_base_amount: positive, min_quote_amount: nonnegative, mark_price: numberValue,
  daily_price_change: numberValue, daily_quote_token_volume: nonnegative, open_interest: nonnegative,
  min_initial_margin_fraction:z.number().int().min(1).max(10000).optional(),
  is_frozen: z.boolean().optional(), market_config: z.object({ force_reduce_only: z.boolean().optional() }).optional(),
});
const lighterMeta = z.object({code:z.literal(200),order_book_details:z.array(z.unknown())});
const candleSchema = z.object({ t: positive, o: positive, h: positive, l: positive, c: positive, v: nonnegative });
const INTERVALS: Record<string, number> = { '1m':60, '5m':300, '15m':900, '1h':3600, '4h':14400, '1d':86400 };
const LIGHTER = 'https://mainnet.zklighter.elliot.ai';
const HYPERLIQUID = 'https://api.hyperliquid.xyz/info';
export interface MarketService {
  list(venue: Venue, marketType?: MarketType): Promise<Market[]>;
  candles(venue: Venue, symbol: string, interval: string, marketType?: MarketType, endTs?: number, limit?: number): Promise<Candle[]>;
  book(venue: Venue, symbol: string, marketType?: MarketType): Promise<OrderBook>;
}

export class PublicMarkets implements MarketService {
  private readonly cache = new Map<string, { expires: number; promise: Promise<unknown> }>();
  private readonly lighterIds = new Map<string, number>();
  private readonly spotCoins = new Map<string, string>();
  constructor(private readonly request: typeof fetch = fetch) {}
  private async cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const current = this.cache.get(key);
    if (current && current.expires > Date.now()) return current.promise as Promise<T>;
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value ?? '');
    const promise = load().catch((error: unknown) => { this.cache.delete(key); throw error; });
    this.cache.set(key, { expires: Date.now() + ttl, promise });
    return promise;
  }
  private async json(url: string, body?: unknown): Promise<unknown> {
    const response = await this.request(url, { method: body ? 'POST' : 'GET', headers: body ? {'Content-Type':'application/json'} : {},
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Public market feed returned HTTP ${response.status}`);
    return response.json();
  }
  async list(venue: Venue, marketType:MarketType='perpetual'): Promise<Market[]> {
    return this.cached(`markets:${venue}:${marketType}`, 5000, async () => {
      if (marketType==='spot') return this.spotList(venue);
      if (venue === 'hyperliquid') {
        const [meta, contexts] = hlMeta.parse(await this.json(HYPERLIQUID, {type:'metaAndAssetCtxs'}));
        if (meta.universe.length !== contexts.length) throw new Error('Hyperliquid market metadata is inconsistent');
        return meta.universe.flatMap((asset, i): Market[] => {
          if (asset.isDelisted) return [];
          const context = hlContext.parse(contexts[i]);
          return [{venue, symbol:`${asset.name}-USDC`, base:asset.name, price:String(context.markPx),
            change24h: new Decimal(context.markPx).div(context.prevDayPx).minus(1).mul(100).toNumber(),
            volume24h:String(context.dayNtlVlm), fundingRate:context.funding, openInterest:String(context.openInterest),
            maxLeverage:asset.maxLeverage??null, sizeDecimals:asset.szDecimals, priceDecimals:6-asset.szDecimals, minSize:new Decimal(10).pow(-asset.szDecimals).toFixed(),
            minNotional:'10', updatedAt:Date.now()}];
        }).sort((a,b) => Number(b.volume24h)-Number(a.volume24h));
      }
      const response = lighterMeta.parse(await this.json(`${LIGHTER}/api/v1/orderBookDetails?filter=perp`));
      const assets=response.order_book_details.flatMap((raw)=>{
        const parsed=lighterAsset.safeParse(raw);
        // A malformed contract cannot be quoted or traded. Do not fabricate missing precision/minimums.
        return parsed.success?[parsed.data]:[];
      });
      if (response.order_book_details.length>0 && assets.length===0) throw new Error('Lighter feed contains no valid contracts');
      const funding = await this.cached('lighter:funding', 60_000, async () => {
        try {
          const rates = z.object({code:z.literal(200),funding_rates:z.array(z.object({market_id:z.number().int(),exchange:z.string(),rate:numberValue}))}).parse(await this.json(`${LIGHTER}/api/v1/funding-rates`));
          return new Map(rates.funding_rates.filter(row=>row.exchange==='lighter').map(row=>[row.market_id,row.rate/8]));
        } catch (error) {
          // Funding failure must not hide tradable contracts; unknown rates remain null.
          console.warn('Lighter funding feed unavailable:', error instanceof Error ? error.message : 'invalid response');
          return new Map<number,number>();
        }
      });
      return assets.flatMap((asset): Market[] => {
        if (asset.status !== 'active' || asset.market_type !== 'perp' || asset.mark_price <= 0 || asset.is_frozen || asset.market_config?.force_reduce_only) return [];
        const symbol = `${asset.symbol}-USDC`;
        this.lighterIds.set(`perpetual:${symbol}`, asset.market_id);
        return [{venue,marketId:asset.market_id,symbol,base:asset.symbol,price:String(asset.mark_price),change24h:asset.daily_price_change,
          volume24h:String(asset.daily_quote_token_volume),fundingRate:funding.get(asset.market_id)??null,openInterest:String(asset.open_interest),
          maxLeverage:asset.min_initial_margin_fraction?new Decimal(10000).div(asset.min_initial_margin_fraction).floor().toNumber():null, sizeDecimals:asset.supported_size_decimals,priceDecimals:asset.supported_price_decimals,
          minSize:String(asset.min_base_amount),minNotional:String(asset.min_quote_amount),updatedAt:Date.now()}];
      }).sort((a,b) => Number(b.volume24h)-Number(a.volume24h));
    });
  }
  private async spotList(venue:Venue):Promise<Market[]> {
    if (venue==='hyperliquid') {
      const [meta,rawContexts]=hlSpotMeta.parse(await this.json(HYPERLIQUID,{type:'spotMetaAndAssetCtxs'}));
      const tokens=new Map(meta.tokens.map(token=>[token.index,token]));
      const contexts=new Map(rawContexts.flatMap(raw=>{const parsed=spotContext.safeParse(raw);return parsed.success?[[parsed.data.coin,parsed.data] as const]:[];}));
      const pairs=meta.universe.flatMap(asset=>{
        const base=tokens.get(asset.tokens[0]),quote=tokens.get(asset.tokens[1]),context=contexts.get(asset.name);
        if (asset.isDelisted || !base || !quote || !context) return [];
        const baseName=base.name.replaceAll(' ','').toUpperCase(),quoteName=quote.name.replaceAll(' ','').toUpperCase();
        if (!/^[A-Z0-9:_]+$/.test(baseName) || !/^[A-Z0-9:_]+$/.test(quoteName)) return [];
        return [{asset,base,quoteName,baseName,context,symbol:`${baseName}-${quoteName}`}];
      });
      // Hummingbot cannot safely resolve duplicate token-name pairs either.
      const counts=new Map<string,number>();for(const pair of pairs) counts.set(pair.symbol,(counts.get(pair.symbol)??0)+1);
      return pairs.flatMap(({asset,base,quoteName,baseName,context,symbol}):Market[]=>{
        if (counts.get(symbol)!==1) return [];
        this.spotCoins.set(symbol,asset.name);
        return [{venue,marketType:'spot',symbol,base:baseName,quote:quoteName,price:String(context.markPx),change24h:new Decimal(context.markPx).div(context.prevDayPx).minus(1).mul(100).toNumber(),volume24h:String(context.dayNtlVlm),fundingRate:null,openInterest:null,maxLeverage:1,sizeDecimals:base.szDecimals,priceDecimals:8-base.szDecimals,minSize:new Decimal(10).pow(-base.szDecimals).toFixed(),minNotional:'10',updatedAt:Date.now()}];
      }).sort((a,b)=>Number(b.volume24h)-Number(a.volume24h));
    }
    const response=z.object({code:z.literal(200),spot_order_book_details:z.array(z.unknown())}).parse(await this.json(`${LIGHTER}/api/v1/orderBookDetails?filter=spot`));
    return response.spot_order_book_details.flatMap((raw):Market[]=>{
      const parsed=lighterSpotAsset.safeParse(raw);if(!parsed.success)return [];
      const asset=parsed.data;if(asset.status!=='active'||asset.is_frozen)return [];
      const parts=asset.symbol.toUpperCase().split('/');if(parts.length!==2||parts.some(p=>!/^[A-Z0-9:_]+$/.test(p)))return [];
      const [base,quote]=parts;const symbol=`${base}-${quote}`;this.lighterIds.set(`spot:${symbol}`,asset.market_id);
      return [{venue,marketType:'spot',symbol,base,quote,price:String(asset.last_trade_price),change24h:asset.daily_price_change,volume24h:String(asset.daily_quote_token_volume),fundingRate:null,openInterest:null,maxLeverage:1, sizeDecimals:asset.supported_size_decimals,priceDecimals:asset.supported_price_decimals,minSize:String(asset.min_base_amount),minNotional:String(asset.min_quote_amount),updatedAt:Date.now()}];
    }).sort((a,b)=>Number(b.volume24h)-Number(a.volume24h));
  }
  private async market(venue: Venue, symbol: string, marketType:MarketType): Promise<Market> {
    const market = (await this.list(venue,marketType)).find((item) => item.symbol === symbol);
    if (!market) throw new Error('Unknown market');
    return market;
  }
  async candles(venue: Venue, symbol: string, interval: string, marketType:MarketType='perpetual', endTs?:number, limit=240): Promise<Candle[]> {
    if (!Object.hasOwn(INTERVALS, interval)) throw new Error('Unsupported candle interval');
    if(endTs!==undefined && (!Number.isSafeInteger(endTs)||endTs<0||endTs>Date.now()+5000)) throw new Error('Invalid candle history boundary');
    if(!Number.isInteger(limit)||limit<1||limit>1000) throw new Error('Invalid candle history limit');
    return this.cached(`candles:${venue}:${marketType}:${symbol}:${interval}:${endTs??'latest'}:${limit}`, 15_000, async () => {
      const market = await this.market(venue, symbol,marketType);
      const end = endTs??Date.now(), start = Math.max(0,end - INTERVALS[interval] * 1000 * limit);
      const raw = venue === 'hyperliquid'
        ? await this.json(HYPERLIQUID, {type:'candleSnapshot',req:{coin:marketType==='spot'?this.spotCoins.get(symbol):market.base,interval,startTime:start,endTime:end}})
        : z.object({code:z.literal(200),c:z.array(z.unknown())}).parse(await this.json(`${LIGHTER}/api/v1/candles?${new URLSearchParams({market_id:String(this.lighterIds.get(`${marketType}:${symbol}`)),resolution:interval,start_timestamp:String(start),end_timestamp:String(end),count_back:String(limit)})}`)).c;
      const candles = z.array(candleSchema).parse(raw).filter(c=>endTs===undefined||c.t<endTs).map((c): Candle => ({time:Math.floor(c.t/1000),open:c.o,high:c.h,low:c.l,close:c.c,volume:c.v}));
      if (candles.some((c) => c.low > Math.min(c.open,c.close) || c.high < Math.max(c.open,c.close))) throw new Error('Invalid candle range in market feed');
      return [...new Map(candles.map((c) => [c.time,c])).values()].filter(c=>endTs===undefined||c.time*1000<endTs).sort((a,b) => a.time-b.time).slice(-limit);
    });
  }
  async book(venue: Venue, symbol: string, marketType:MarketType='perpetual'): Promise<OrderBook> {
    return this.cached(`book:${venue}:${marketType}:${symbol}`, 2000, async () => {
      const market = await this.market(venue,symbol,marketType);
      if (venue === 'hyperliquid') {
        const level = z.object({px:positive,sz:nonnegative});
        const raw = z.object({levels:z.tuple([z.array(level),z.array(level)]),time:positive}).parse(await this.json(HYPERLIQUID,{type:'l2Book',coin:marketType==='spot'?this.spotCoins.get(symbol):market.base}));
        return {bids:raw.levels[0].slice(0,20).map((r)=>({price:String(r.px),size:String(r.sz)})),asks:raw.levels[1].slice(0,20).map((r)=>({price:String(r.px),size:String(r.sz)})),updatedAt:raw.time};
      }
      const level = z.object({price:positive,remaining_base_amount:nonnegative});
      const raw = z.object({code:z.literal(200),bids:z.array(level),asks:z.array(level)}).parse(await this.json(`${LIGHTER}/api/v1/orderBookOrders?market_id=${this.lighterIds.get(`${marketType}:${symbol}`)}&limit=100`));
      function aggregate(rows: z.infer<typeof level>[], descending: boolean): BookLevel[] {
        const levels = new Map<string,Decimal>();
        for (const row of rows) levels.set(String(row.price),(levels.get(String(row.price)) ?? new Decimal(0)).plus(row.remaining_base_amount));
        return [...levels].filter(([,size])=>size.gt(0)).map(([price,size])=>({price,size:size.toFixed()}))
          .sort((a,b)=>(Number(a.price)-Number(b.price))*(descending?-1:1)).slice(0,20);
      }
      return {bids:aggregate(raw.bids,true),asks:aggregate(raw.asks,false),updatedAt:Date.now()};
    });
  }
}
