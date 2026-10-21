import Decimal from 'decimal.js';
import { z } from 'zod';
import type { MarketService } from './markets.ts';
import type { Candle } from '../shared/types.ts';
import type { ScannerStrengthHistoryInput, ScannerStrengthHistorySnapshot, ScannerStrengthSeries } from '../shared/scanner-strength-history.ts';
const HOUR=3600000,DAY=24*HOUR;
const inputSchema=z.object({venue:z.enum(['lighter','hyperliquid']),symbols:z.array(z.string().min(3).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*-[A-Za-z0-9_.]+$/)).min(1).max(8).refine(a=>new Set(a).size===a.length),window:z.enum(['1d','7d','30d'])}).strict();
async function bounded<T>(promise:Promise<T>,ms=22000):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Public history deadline exceeded')),ms);})]);}finally{if(timer)clearTimeout(timer);}}
function clean(rows:Candle[],start:number,end:number,step:number):Map<number,number>{
 const result=new Map<number,number>(),duplicates=new Set<number>();
 for(const row of rows){const time=row.time*1000+step;if(!Number.isSafeInteger(time)||time<start||time>end||(time-start)%step!==0||!Number.isFinite(row.close)||row.close<=0)continue;if(result.has(time))duplicates.add(time);result.set(time,row.close);}
 for(const time of duplicates)result.delete(time);
 return new Map([...result].sort((a,b)=>a[0]-b[0]));
}
/** Public completed candles only; selected symbols are resolved from the exact venue catalog. */
export class ScannerStrengthHistory{
 private readonly cache=new Map<string,{expires:number;value:Promise<ScannerStrengthHistorySnapshot>}>();private active=0;
 constructor(private readonly markets:Pick<MarketService,'list'|'candles'>,private readonly clock:()=>number=Date.now){}
 async get(raw:ScannerStrengthHistoryInput):Promise<ScannerStrengthHistorySnapshot>{
  const input=inputSchema.parse(raw),key=JSON.stringify(input);let cached=this.cache.get(key);
  if(!cached||cached.expires<=this.clock()){
   if(this.active>=2)throw Error('Strength history is busy; retry shortly');
   if(this.cache.size>=32)this.cache.delete(this.cache.keys().next().value??'');
   this.active++;const value=this.load(input).finally(()=>{this.active--;});cached={expires:this.clock()+60000,value};this.cache.set(key,cached);
   void value.catch(()=>{if(this.cache.get(key)?.value===value)this.cache.delete(key);});
  }
  return structuredClone(await cached.value);
 }
 private async load(input:ScannerStrengthHistoryInput):Promise<ScannerStrengthHistorySnapshot>{
  const asOf=this.clock(),step=input.window==='30d'?DAY:HOUR,count=input.window==='1d'?25:input.window==='7d'?169:31;
  const windowEnd=Math.floor(asOf/step)*step,windowStart=windowEnd-(count-1)*step;
  const failed=(symbol:string,base=symbol.slice(0,symbol.lastIndexOf('-'))||symbol):ScannerStrengthSeries=>({venue:input.venue,symbol,base,status:'error',points:[],message:'Selected market history is unavailable.'});
  let catalog;try{catalog=await bounded(this.markets.list(input.venue,'perpetual'));}catch{return{asOf,window:input.window,windowStart,windowEnd,benchmarkSymbol:null,series:input.symbols.map(s=>failed(s))};}
  const selected=input.symbols.map(symbol=>{const matches=catalog.filter(r=>r.venue===input.venue&&r.marketType!=='spot'&&r.symbol===symbol&&r.symbol===`${r.base}-${r.quote??'USDC'}`&&Number.isSafeInteger(r.updatedAt)&&r.updatedAt>=asOf-120000&&r.updatedAt<=asOf+5000);return matches.length===1?matches[0]:null;});
  const btc=catalog.filter(r=>r.venue===input.venue&&r.marketType!=='spot'&&r.base==='BTC'&&r.symbol==='BTC-USDC'&&(r.quote??'USDC')==='USDC'&&Number.isSafeInteger(r.updatedAt)&&r.updatedAt>=asOf-120000&&r.updatedAt<=asOf+5000);
  const benchmarkSymbol=selected.some(r=>r&&(r.quote??'USDC')==='USDC')&&btc.length===1?'BTC-USDC':null;
  const interval=input.window==='30d'?'1d':'1h';
  const read=async(symbol:string)=>clean(await bounded(this.markets.candles(input.venue,symbol,interval,'perpetual',windowEnd,count),12000),windowStart,windowEnd,step);
  let benchmark=new Map<number,number>();if(benchmarkSymbol){try{benchmark=await read(benchmarkSymbol);}catch{benchmark=new Map();}}
  const series:ScannerStrengthSeries[]=new Array(input.symbols.length);let next=0;
  await Promise.all(Array.from({length:Math.min(2,input.symbols.length)},async()=>{
   while(next<input.symbols.length){const index=next++,symbol=input.symbols[index],market=selected[index];if(!market){series[index]=failed(symbol);continue;}
    try{
     const rows=symbol===benchmarkSymbol?benchmark:await read(symbol),baseline=rows.get(windowStart);
     if(baseline===undefined){series[index]={...failed(symbol,market.base),status:'partial',message:'The opening observation is missing; returns for this window are unavailable.'};continue;}
     const benchmarkBaseline=benchmark.get(windowStart),eligible=(market.quote??'USDC')==='USDC';
     const points=[...rows].flatMap(([time,close])=>{const changePct=new Decimal(close).div(baseline).minus(1).mul(100).toNumber();let relativeStrengthPp:number|null=null;const btcClose=benchmark.get(time);if(eligible&&benchmarkBaseline!==undefined&&btcClose!==undefined){const excess=new Decimal(changePct).minus(new Decimal(btcClose).div(benchmarkBaseline).minus(1).mul(100)).toNumber();if(Number.isFinite(excess))relativeStrengthPp=excess;}return Number.isFinite(changePct)?[{time,changePct,relativeStrengthPp}]:[];});
     const complete=points.length===count&&points.every((p,i)=>p.time===windowStart+i*step)&&(!eligible||points.every(p=>p.relativeStrengthPp!==null));
     series[index]={venue:input.venue,symbol,base:market.base,status:complete?'ok':'partial',points,message:complete?null:'Completed price or same-venue BTC observations are missing; gaps are not interpolated.'};
    }catch{series[index]=failed(symbol,market.base);}
   }
  }));
  return{asOf,window:input.window,windowStart,windowEnd,benchmarkSymbol,series};
 }
}
