import { z } from 'zod';

// Research uses public exchange data only. These URLs and info types are an
// explicit allowlist, never a caller-supplied proxy destination or write API.
const HL = 'https://api.hyperliquid.xyz/info';
const LIGHTER = 'https://mainnet.zklighter.elliot.ai';
const integer = (min:number,max:number) => z.union([z.number(),z.string().regex(/^\d+$/)]).transform(Number).pipe(z.number().int().min(min).max(max));
const common = { limit:integer(1,100).optional().default(100) };
const wallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const coin = z.string().min(1).max(64).regex(/^(?:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?|@\d+)$/);
const dates = {startTime:integer(0,8_640_000_000_000_000),endTime:integer(0,8_640_000_000_000_000)};
const hl = {venue:z.literal('hyperliquid'),...common};
const lighter = {venue:z.literal('lighter'),...common};
const marketId = integer(0,32767);
const requestSchema = z.union([
  z.object({...hl,action:z.literal('market-stats'),coin:coin.optional()}).strict(),
  z.object({...hl,action:z.literal('funding-history'),coin,...dates}).strict(),
  z.object({...hl,action:z.literal('predicted-funding')}).strict(),
  ...(['account-state','spot-balances','open-orders','order-history','fills','user-fees','rate-limits'] as const).map(action=>z.object({...hl,action:z.literal(action),wallet}).strict()),
  z.object({...hl,action:z.literal('order-status'),wallet,orderId:integer(1,Number.MAX_SAFE_INTEGER)}).strict(),
  z.object({...lighter,action:z.literal('funding-rates'),marketId:marketId.optional()}).strict(),
  z.object({...lighter,action:z.literal('funding-history'),marketId,...dates,resolution:z.enum(['1h','1d']).optional().default('1h')}).strict(),
  z.object({...lighter,action:z.literal('market-stats'),marketId}).strict(),
  z.object({...lighter,action:z.literal('exchange-stats')}).strict(),
  z.object({...lighter,action:z.literal('recent-trades'),marketId}).strict(),
]).superRefine((request,ctx)=>{
  if ('startTime' in request && (request.endTime<request.startTime || request.endTime-request.startTime>31*86400_000 || request.endTime>Date.now()+60_000)) {
    ctx.addIssue({code:'custom',path:['endTime'],message:'Dates must be ordered, cover at most 31 days and not be in the future'});
  }
});
type ResearchRequest=z.infer<typeof requestSchema>;
type ObjectValue=Record<string,unknown>;
const objectSchema=z.record(z.string(),z.unknown());
const records=z.array(objectSchema);
export interface ResearchResult {venue:'hyperliquid'|'lighter';action:string;observedAt:number;data:unknown;truncated:boolean}

function requiredObject(value:unknown,fields:string[]):ObjectValue {
  const parsed=objectSchema.parse(value);
  if(fields.some(field=>!(field in parsed))) throw new Error('Public research response is malformed');
  return parsed;
}
// Cap every nested collection rather than only the top-level result. This
// keeps a single account or metadata response from expanding the terminal UI.
function bounded(value:unknown,limit:number):{data:unknown;truncated:boolean} {
  let truncated=false, nodes=0;
  function visit(input:unknown,depth:number):unknown {
    if(++nodes>20_000 || depth>15) throw new Error('Public research response is too complex');
    if(Array.isArray(input)) {
      if(input.length>limit) truncated=true;
      return input.slice(0,limit).map(item=>visit(item,depth+1));
    }
    if(input!==null && typeof input==='object') return Object.fromEntries(Object.entries(input).map(([key,item])=>[key,visit(item,depth+1)]));
    return input;
  }
  return {data:visit(value,0),truncated};
}

export class VenueResearch {
  private readonly cache=new Map<string,{expires:number;result:Promise<ResearchResult>}>();
  constructor(private readonly request:typeof fetch=fetch) {}
  async execute(raw:unknown):Promise<ResearchResult> {
    const input=requestSchema.parse(raw);
    const key=JSON.stringify(input),now=Date.now();
    let cached=this.cache.get(key);
    if(!cached || cached.expires<=now) {
      if(this.cache.size>=128) this.cache.delete(this.cache.keys().next().value ?? '');
      const result=this.load(input).catch((error:unknown)=>{this.cache.delete(key);throw error;});
      cached={expires:now+3000,result};this.cache.set(key,cached);
    }
    return structuredClone(await cached.result);
  }
  private async json(url:string,body?:unknown):Promise<unknown> {
    const response=await this.request(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10_000),redirect:'error'});
    if(!response.ok) throw new Error(`Public research feed returned HTTP ${response.status}`);
    if(!response.body) throw new Error('Public research response is empty');
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    try {
      while(true) {
        const part=await reader.read();if(part.done) break;
        size+=part.value.byteLength;
        if(size>2_000_000) {await reader.cancel();throw new Error('Public research response is too large');}
        chunks.push(part.value);
      }
    } finally {reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }
  private async load(input:ResearchRequest):Promise<ResearchResult> {
    const data=input.venue==='hyperliquid'?await this.hyperliquid(input):await this.lighter(input);
    return {venue:input.venue,action:input.action,observedAt:Date.now(),...bounded(data,input.limit)};
  }
  private async hyperliquid(input:Extract<ResearchRequest,{venue:'hyperliquid'}>):Promise<unknown> {
    if(input.action==='market-stats') {
      const [meta,contexts]=z.tuple([z.object({universe:records}).passthrough(),records]).parse(await this.json(HL,{type:'metaAndAssetCtxs'}));
      if(meta.universe.length!==contexts.length) throw new Error('Public market metadata is inconsistent');
      if(input.coin) {
        const index=meta.universe.findIndex(asset=>asset.name===input.coin);
        if(index<0) throw new Error('Unknown Hyperliquid perpetual coin');
        return {asset:meta.universe[index],context:contexts[index]};
      }
      return {metadata:meta,contexts};
    }
    if(input.action==='funding-history') return records.parse(await this.json(HL,{type:'fundingHistory',coin:input.coin,startTime:input.startTime,endTime:input.endTime}));
    if(input.action==='predicted-funding') return z.array(z.tuple([z.string(),z.array(z.tuple([z.string(),objectSchema.nullable()]))])).parse(await this.json(HL,{type:'predictedFundings'}));
    const types={'account-state':'clearinghouseState','spot-balances':'spotClearinghouseState','open-orders':'frontendOpenOrders','order-history':'historicalOrders','fills':'userFills','user-fees':'userFees','rate-limits':'userRateLimit','order-status':'orderStatus'} as const;
    const body:ObjectValue={type:types[input.action],user:input.wallet};
    if(input.action==='order-status') body.oid=input.orderId;
    const response=await this.json(HL,body);
    if(['open-orders','order-history','fills'].includes(input.action)) return records.parse(response);
    const fields:Record<string,string[]>={'account-state':['assetPositions','marginSummary'],'spot-balances':['balances'],'user-fees':['feeSchedule','userCrossRate'],'rate-limits':['cumVlm','nRequestsUsed','nRequestsCap'],'order-status':['status']};
    return requiredObject(response,fields[input.action] ?? []);
  }
  private async lighter(input:Extract<ResearchRequest,{venue:'lighter'}>):Promise<unknown> {
    const paths={'funding-rates':'funding-rates','funding-history':'fundings','market-stats':'orderBookDetails','exchange-stats':'exchangeStats','recent-trades':'recentTrades'} as const;
    const url=new URL(`${LIGHTER}/api/v1/${paths[input.action]}`);
    if('marketId' in input && input.marketId!==undefined && input.action!=='funding-rates') url.searchParams.set('market_id',String(input.marketId));
    if(input.action==='recent-trades') url.searchParams.set('limit',String(input.limit));
    if(input.action==='funding-history') {
      url.searchParams.set('resolution',input.resolution);
      url.searchParams.set('start_timestamp',String(Math.floor(input.startTime/1000)));
      url.searchParams.set('end_timestamp',String(Math.floor(input.endTime/1000)));
      url.searchParams.set('count_back',String(input.limit));
    }
    const result=requiredObject(await this.json(url.href),['code']);
    if(result.code!==200) throw new Error('Lighter rejected the public research request');
    if(input.action==='market-stats') {
      const perps=records.parse(result.order_book_details),spots=records.parse(result.spot_order_book_details);
      const market=[...perps,...spots].find(entry=>entry.market_id===input.marketId);
      if(!market) throw new Error('Unknown Lighter market ID');
      return market;
    }
    if(input.action==='exchange-stats') {
      requiredObject(result,['order_book_stats','daily_usd_volume','daily_trades_count']);records.parse(result.order_book_stats);return result;
    }
    const field=input.action==='funding-history'?'fundings':input.action==='funding-rates'?'funding_rates':'trades';
    const items=records.parse(result[field]);
    return input.action==='funding-rates' && input.marketId!==undefined?items.filter(item=>item.market_id===input.marketId):items;
  }
}
