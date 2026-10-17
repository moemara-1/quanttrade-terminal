import { z } from 'zod';
import type { OptionBlockTrade, OptionOverview, OptionsSnapshot, OptionTapeCoverage, ScannerSource } from '../shared/scanners.ts';

type Currency='BTC'|'ETH';
const numeric=z.number().finite().nonnegative();
const instrumentPattern=/^(BTC|ETH)-(\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2})-(\d+(?:\.\d+)?)-(C|P)$/;
const instrument=z.string().regex(instrumentPattern).refine(value=>{const match=instrumentPattern.exec(value);return match!==null&&Number.isFinite(Number(match[3]))&&Number(match[3])>0;});
const tradeSchema=z.object({trade_id:z.string().min(1),timestamp:numeric.int().positive(),instrument_name:instrument,direction:z.enum(['buy','sell']),amount:numeric.positive(),price:numeric,index_price:z.unknown().optional(),iv:z.unknown().optional(),block_trade_id:z.unknown().optional(),block_trade_leg_count:z.unknown().optional()});
const summarySchema=z.object({instrument_name:instrument,open_interest:numeric,volume:numeric,creation_timestamp:numeric.int().positive().optional()});
const tapeSchema=z.object({result:z.object({trades:z.array(z.unknown()),has_more:z.boolean()})});
const summariesSchema=z.object({result:z.array(z.unknown())});
const optionalNumber=(value:unknown,positive=false):number|null=>typeof value==='number'&&Number.isFinite(value)&&(positive?value>0:value>=0)?value:null;
interface Loaded {source:ScannerSource;trades:OptionBlockTrade[];overview:OptionOverview[];coverage:OptionTapeCoverage[]}

/** Public, bounded BTC/ETH inverse option observations; never infers trader intent. */
export class OptionsScanner {
  private cached:{expires:number;promise:Promise<OptionsSnapshot>}|null=null;
  constructor(private readonly request:typeof fetch=fetch,private readonly clock:()=>number=Date.now) {}
  async get():Promise<OptionsSnapshot> {
    if(!this.cached||this.cached.expires<=this.clock()) {
      this.cached={expires:this.clock()+30_000,promise:this.load()};
    }
    return structuredClone(await this.cached.promise);
  }
  private async json(url:URL):Promise<unknown> {
    const response=await this.request(url,{signal:AbortSignal.timeout(10_000),redirect:'error'});
    if(!response.ok||!response.body)throw new Error('Options source unavailable');
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    try {
      while(true) {
        const part=await reader.read();if(part.done)break;
        size+=part.value.byteLength;
        if(size>2_000_000){await reader.cancel();throw new Error('Options source response too large');}
        chunks.push(part.value);
      }
    }finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }
  private async load():Promise<OptionsSnapshot> {
    const results=await Promise.all((['BTC','ETH'] as const).flatMap(currency=>(['trades','summary'] as const).map(kind=>this.source(currency,kind))));
    // Preserve a stable source order independent of request completion.
    const order=['deribit-btc-trades','deribit-eth-trades','deribit-btc-summary','deribit-eth-summary'];
    return {sources:results.map(r=>r.source).sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id)),trades:results.flatMap(r=>r.trades).sort((a,b)=>b.timestamp-a.timestamp||a.id.localeCompare(b.id)).slice(0,60),overview:results.flatMap(r=>r.overview),coverage:results.flatMap(r=>r.coverage)};
  }
  private async source(currency:Currency,kind:'trades'|'summary'):Promise<Loaded> {
    const id=`deribit-${currency.toLowerCase()}-${kind}`;
    const url=new URL(`https://www.deribit.com/api/v2/public/${kind==='trades'?'get_last_trades_by_currency':'get_book_summary_by_currency'}`);
    url.searchParams.set('currency',currency);url.searchParams.set('kind','option');
    if(kind==='trades'){url.searchParams.set('count','1000');url.searchParams.set('sorting','desc');}
    try {
      const raw=await this.json(url),now=this.clock();
      if(kind==='summary') {
        const rows=summariesSchema.parse(raw).result;
        const contracts=new Map<string,z.infer<typeof summarySchema>>();
        for(const row of rows){const parsed=summarySchema.safeParse(row);if(parsed.success&&(parsed.data.creation_timestamp===undefined||(parsed.data.creation_timestamp>=now-120_000&&parsed.data.creation_timestamp<=now+60_000))&&parsed.data.instrument_name.startsWith(`${currency}-`))contracts.set(parsed.data.instrument_name,parsed.data);}
        if(rows.length&&!contracts.size)throw new Error('Malformed options source');
        let callOpenInterest=0,putOpenInterest=0,callVolume24h=0,putVolume24h=0;
        for(const row of contracts.values())if(row.instrument_name.endsWith('-C')){callOpenInterest+=row.open_interest;callVolume24h+=row.volume;}else{putOpenInterest+=row.open_interest;putVolume24h+=row.volume;}
        if(![callOpenInterest,putOpenInterest,callVolume24h,putVolume24h].every(Number.isFinite))throw new Error('Invalid options totals');
        const excluded=rows.length-contracts.size;
        return {source:{id,status:'ok',observedAt:now,count:contracts.size,message:excluded?`${excluded} stale, invalid or duplicate option contracts excluded.`:null},trades:[],coverage:[],overview:[{currency,observedAt:now,contracts:contracts.size,callOpenInterest,putOpenInterest,callVolume24h,putVolume24h,putCallVolumeRatio:excluded===0&&callVolume24h>0&&Number.isFinite(putVolume24h/callVolume24h)?putVolume24h/callVolume24h:null}]};
      }
      const tape=tapeSchema.parse(raw).result;
      const rows=new Map<string,z.infer<typeof tradeSchema>>();
      for(const row of tape.trades){const parsed=tradeSchema.safeParse(row);if(parsed.success&&parsed.data.timestamp<=now+60_000&&parsed.data.instrument_name.startsWith(`${currency}-`))rows.set(parsed.data.trade_id,parsed.data);}
      if(tape.trades.length&&!rows.size)throw new Error('Malformed options source');
      const trades:OptionBlockTrade[]=[];let oldestTimestamp:number|null=null,newestTimestamp:number|null=null;
      for(const row of rows.values()) {
        oldestTimestamp=oldestTimestamp===null?row.timestamp:Math.min(oldestTimestamp,row.timestamp);newestTimestamp=newestTimestamp===null?row.timestamp:Math.max(newestTimestamp,row.timestamp);
        if(typeof row.block_trade_id!=='string'||!row.block_trade_id.trim())continue;
        const match=instrumentPattern.exec(row.instrument_name);if(!match)continue;
        const strike=Number(match[3]);if(!Number.isFinite(strike)||strike<=0)continue;
        const indexPrice=optionalNumber(row.index_price,true),premium=indexPrice===null?null:row.price*row.amount*indexPrice;
        const legCount=optionalNumber(row.block_trade_leg_count,true);
        trades.push({id:`${currency}:${row.trade_id}`,blockId:row.block_trade_id,instrument:row.instrument_name,currency,timestamp:row.timestamp,side:row.direction,amount:row.amount,price:row.price,premiumUsd:premium!==null&&Number.isFinite(premium)?premium:null,indexPrice,iv:optionalNumber(row.iv),optionType:match[4]==='C'?'call':'put',strike,expiry:match[2],legCount:legCount!==null&&Number.isInteger(legCount)?legCount:null});
      }
      const excluded=tape.trades.length-rows.size;
      return {source:{id,status:'ok',observedAt:now,count:rows.size,message:excluded?`${excluded} invalid or duplicate tape rows excluded.`:null},trades,overview:[],coverage:[{currency,sampledTrades:rows.size,hasMore:tape.has_more,oldestTimestamp,newestTimestamp}]};
    }catch {
      return {source:{id,status:'error',observedAt:null,count:0,message:'Deribit public options data is temporarily unavailable.'},trades:[],overview:[],coverage:[]};
    }
  }
}
