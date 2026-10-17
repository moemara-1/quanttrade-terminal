import Decimal from 'decimal.js';
import type { MarketService } from './markets.ts';
import type { Market, Venue } from '../shared/types.ts';
import type { OptionsSnapshot, ScannerComparison, ScannerMarket, ScannerSnapshot, ScannerSource } from '../shared/scanners.ts';

const TTL=30_000;
const venues:Venue[]=['hyperliquid','lighter'];
const finiteOrNull=(value:number):number|null=>Number.isFinite(value)?value:null;
const numeric=(value:unknown):number|null=>{
 if(typeof value!=='string'&&typeof value!=='number')return null;
 if(typeof value==='string'&&!value.trim())return null;
 try{const number=new Decimal(value).toNumber();return Number.isFinite(number)?number:null;}catch{return null;}
};
function normalize(venue:Venue,rows:Market[],now:number):ScannerMarket[]{
 const valid:ScannerMarket[]=[];
 for(const row of rows){
  if(row.venue!==venue||row.marketType==='spot'||row.symbol!==`${row.base}-USDC`||!row.base||row.base.length>64)continue;
  if(!Number.isSafeInteger(row.updatedAt)||row.updatedAt<now-120_000||row.updatedAt>now+5_000)continue;
  const price=numeric(row.price),volume=numeric(row.volume24h),change=numeric(row.change24h);
  if(price===null||price<=0||volume===null||volume<0||change===null||change < -100)continue;
  const funding=numeric(row.fundingRate),oi=numeric(row.openInterest);
  const oiBase=oi!==null&&oi>=0?oi:null;
  const oiUsd=oiBase===null?null:new Decimal(oiBase).mul(price).toNumber();
  if(oiUsd!==null&&!Number.isFinite(oiUsd))continue;
  valid.push({venue,symbol:row.symbol,base:row.base,price,change24h:change,volume24h:volume,
   fundingHourly:funding,openInterestBase:oiBase,openInterestUsd:oiUsd,relativeStrength24h:null,
   oiToVolume:oiUsd!==null&&volume>0?finiteOrNull(new Decimal(oiUsd).div(volume).toNumber()):null,observedAt:row.updatedAt});
 }
 // Repeated base names cannot establish that both feeds represent one asset.
 const counts=new Map<string,number>();for(const row of valid)counts.set(row.base,(counts.get(row.base)??0)+1);
 const unique=valid.filter(row=>counts.get(row.base)===1);
 const btc=unique.find(row=>row.base==='BTC');
 return unique.map(row=>({...row,relativeStrength24h:btc?finiteOrNull(new Decimal(row.change24h).minus(btc.change24h).toNumber()):null}));
}
function compare(rows:ScannerMarket[]):ScannerComparison[]{
 const hl=new Map(rows.filter(r=>r.venue==='hyperliquid').map(r=>[r.base,r]));
 return rows.filter(r=>r.venue==='lighter'&&hl.has(r.base)&&Math.abs(r.observedAt-hl.get(r.base)!.observedAt)<=30_000).map(lighter=>{
  const hyperliquid=hl.get(lighter.base)!;
  const fundingKnown=hyperliquid.fundingHourly!==null&&lighter.fundingHourly!==null;
  const fundingDelta=fundingKnown?finiteOrNull(new Decimal(lighter.fundingHourly!).minus(hyperliquid.fundingHourly!).toNumber()):null;
  const fundingGapHourly=fundingDelta===null?null:Math.abs(fundingDelta);
  const priceDelta=new Decimal(lighter.price).minus(hyperliquid.price);
  const markGapPct=priceDelta.abs().div(new Decimal(lighter.price).plus(hyperliquid.price).div(2)).mul(100).toNumber();
  return {base:lighter.base,hyperliquid,lighter,fundingGapHourly,
   longVenue:fundingDelta===null||fundingDelta===0?null:fundingDelta>0?'hyperliquid':'lighter',
   shortVenue:fundingDelta===null||fundingDelta===0?null:fundingDelta>0?'lighter':'hyperliquid',
   markGapPct,lowerMarkVenue:priceDelta.isZero()?null:priceDelta.gt(0)?'hyperliquid':'lighter',
   higherMarkVenue:priceDelta.isZero()?null:priceDelta.gt(0)?'lighter':'hyperliquid'} satisfies ScannerComparison;
 }).sort((a,b)=>a.base.localeCompare(b.base));
}
/** Public observation only. No account identity, credentials or execution clients. */
export class DiscoveryScanners {
 private cached?:{expires:number;value:Promise<ScannerSnapshot>};
 constructor(private readonly markets:Pick<MarketService,'list'>,private readonly options:{get():Promise<OptionsSnapshot>},private readonly clock:()=>number=Date.now){}
 async get():Promise<ScannerSnapshot>{
  if(!this.cached||this.cached.expires<=this.clock()){
   const value=this.load();this.cached={expires:this.clock()+TTL,value};
   void value.catch(()=>{if(this.cached?.value===value)this.cached=undefined;});
  }
  return structuredClone(await this.cached.value);
 }
 private async load():Promise<ScannerSnapshot>{
  const [results,options]=await Promise.all([
   Promise.all(venues.map(async(venue)=>{
    try{
     const raw=await this.markets.list(venue,'perpetual');
     const rows=normalize(venue,raw,this.clock());
     if(!rows.length)throw new Error('No current valid contracts');
     const excluded=raw.length-rows.length;
     const missingFunding=rows.filter(row=>row.fundingHourly===null).length;
     const messages=[excluded?`${excluded} stale, invalid or ambiguous contracts excluded.`:null,missingFunding?`Current funding is unavailable for ${missingFunding} contracts.`:null].filter(Boolean);
     return {rows,source:{id:venue,status:'ok',observedAt:Math.min(...rows.map(r=>r.observedAt)),count:rows.length,
      message:messages.length?messages.join(' '):null} satisfies ScannerSource};
    }catch{return {rows:[],source:{id:venue,status:'error',observedAt:null,count:0,message:'Current venue market data is unavailable.'} satisfies ScannerSource};}
   })),
   this.options.get().catch(():OptionsSnapshot=>({sources:[{id:'deribit',status:'error',observedAt:null,count:0,message:'Options market data is unavailable.'}],trades:[],overview:[],coverage:[]})),
  ]);
  const markets=results.flatMap(result=>result.rows);
  return {asOf:this.clock(),refreshAfterMs:TTL,sources:results.map(result=>result.source),markets,comparisons:compare(markets),options};
 }
}
