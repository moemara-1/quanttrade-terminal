import Decimal from 'decimal.js';
import { z } from 'zod';
import type { MarketService } from './markets.ts';
import type { VenueResearch } from './research.ts';
import type { Candle, Venue } from '../shared/types.ts';
import type { ScannerDetailSnapshot, ScannerFundingPoint, ScannerPricePoint, ScannerVenueDetail } from '../shared/scanner-detail.ts';

const HOUR=3600000,TTL=60000;
const baseSchema=z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:]+$/);
const venueSchema=z.enum(['all','lighter','hyperliquid']);
const numberValue=z.union([z.number(),z.string().min(1)]).transform(Number).refine(Number.isFinite);
const hlFunding=z.object({time:z.number().int().positive(),fundingRate:numberValue});
const ltFunding=z.object({timestamp:z.number().int().positive(),rate:numberValue.refine(n=>n>=0),direction:z.enum(['long','short'])});
async function deadline<T>(promise:Promise<T>,ms:number):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Public detail deadline exceeded')),ms);})]);}
 finally{if(timer)clearTimeout(timer);}
}
function history(raw:unknown,venue:Venue,start:number,end:number):ScannerVenueDetail['funding']{
 if(!Array.isArray(raw)||raw.length>48)throw new Error('Invalid funding history');
 const points=new Map<number,ScannerFundingPoint>();let invalid=false;
 for(const row of raw){
  let point:ScannerFundingPoint;
  if(venue==='hyperliquid'){const parsed=hlFunding.safeParse(row);if(!parsed.success){invalid=true;continue;}point={time:parsed.data.time,rate:parsed.data.fundingRate};}
  else{const parsed=ltFunding.safeParse(row);if(!parsed.success){invalid=true;continue;}point={time:parsed.data.timestamp*1000,rate:new Decimal(parsed.data.rate).div(100).mul(parsed.data.direction==='long'?1:-1).toNumber()};}
  if(point.time<start||point.time>=end)continue;
  const bucket=Math.floor(point.time/HOUR)*HOUR;
  if(points.has(bucket)){invalid=true;continue;}
  // Compare hourly observations by their settlement bucket, not venue timestamp jitter.
  points.set(bucket,{...point,time:bucket});
 }
 const samples=[...points.values()].sort((a,b)=>a.time-b.time);
 const sum=samples.length?samples.reduce((a,b)=>a.plus(b.rate),new Decimal(0)).toNumber():null;
 if(sum!==null&&!Number.isFinite(sum))throw new Error('Invalid funding sum');
 const complete=samples.length===24&&!invalid;
 return{status:complete?'ok':'partial',samples,sampleCount:samples.length,expectedSamples:24,observedSum:sum,actual24h:complete?sum:null,message:complete?null:'Incomplete or invalid hourly history; the observed sum is not a verified 24-hour total.'};
}
function prices(rows:Candle[],btc:Candle[],start:number,end:number):ScannerVenueDetail['price']{
 const clean=(items:Candle[])=>[...new Map(items.filter(row=>Number.isSafeInteger(row.time)&&row.time*1000>=start-HOUR&&row.time*1000<end&&Number.isFinite(row.close)&&row.close>0).map(row=>[row.time,row])).values()].sort((a,b)=>a.time-b.time);
 const selected=clean(rows),benchmark=clean(btc),first=selected[0],btcFirst=benchmark.find(row=>row.time===first?.time);
 if(!first)throw new Error('Price history unavailable');
 const btcMap=new Map(benchmark.map(row=>[row.time,row.close]));
 const points:ScannerPricePoint[]=selected.flatMap(row=>{
  const changePct=new Decimal(row.close).div(first.close).minus(1).mul(100).toNumber();
  const reference=btcMap.get(row.time);
  const btcChangePct=btcFirst&&reference?new Decimal(reference).div(btcFirst.close).minus(1).mul(100).toNumber():null;
  const relativeStrengthPp=btcChangePct===null?null:new Decimal(changePct).minus(btcChangePct).toNumber();
  if(!Number.isFinite(changePct)||(btcChangePct!==null&&!Number.isFinite(btcChangePct))||(relativeStrengthPp!==null&&!Number.isFinite(relativeStrengthPp)))return[];
  // The observation is the completed candle close, not its opening time.
  return[{time:row.time*1000+HOUR,close:row.close,changePct,btcChangePct,relativeStrengthPp}];
 });
 const complete=points.length===25&&points.every((point,i)=>point.time===start+i*HOUR)&&points.every(point=>point.btcChangePct!==null);
 return{status:complete?'ok':'partial',points,message:complete?null:'Hourly price or same-venue BTC coverage is incomplete; missing points are not interpolated.'};
}
/** Selected public markets only. At most two independent detail loads, each with bounded source reads. */
export class ScannerDetails{
 private readonly cache=new Map<string,{expires:number;value:Promise<ScannerDetailSnapshot>}>();
 private active=0;
 constructor(private readonly markets:Pick<MarketService,'list'|'candles'>,private readonly research:Pick<VenueResearch,'execute'>,private readonly clock:()=>number=Date.now){}
 async get(rawBase:string,rawVenue:'all'|Venue='all'):Promise<ScannerDetailSnapshot>{
  const base=baseSchema.parse(rawBase),scope=venueSchema.parse(rawVenue),key=`${scope}:${base}`,now=this.clock();
  let cached=this.cache.get(key);
  if(!cached||cached.expires<=now){
   if(this.active>=2)throw new Error('Scanner detail is busy; retry shortly');
   if(this.cache.size>=64)this.cache.delete(this.cache.keys().next().value??'');
   this.active++;
   const value=this.load(base,scope).finally(()=>{this.active--;});
   cached={expires:now+TTL,value};this.cache.set(key,cached);
   void value.catch(()=>{if(this.cache.get(key)?.value===value)this.cache.delete(key);});
  }
  return structuredClone(await cached.value);
 }
 private async load(base:string,scope:'all'|Venue):Promise<ScannerDetailSnapshot>{
  const now=this.clock(),end=Math.floor(now/HOUR)*HOUR,start=end-24*HOUR;
  const venues:Venue[]=scope==='all'?['hyperliquid','lighter']:[scope];
  return{asOf:now,base,windowStart:start,windowEnd:end,refreshAfterMs:TTL,venues:await Promise.all(venues.map(venue=>this.venue(venue,base,start,end)))};
 }
 private async venue(venue:Venue,base:string,start:number,end:number):Promise<ScannerVenueDetail>{
  const failed:ScannerVenueDetail={venue,symbol:`${base}-USDC`,currentFundingHourly:null,projected24hFunding:null,funding:{status:'error',samples:[],sampleCount:0,expectedSamples:24,observedSum:null,actual24h:null,message:'Selected market funding history is unavailable.'},price:{status:'error',points:[],message:'Selected market price history is unavailable.'}};
  try{
   const catalog=await deadline(this.markets.list(venue,'perpetual'),22000);
   const matches=catalog.filter(row=>row.base===base&&row.symbol===`${base}-USDC`&&row.venue===venue&&row.marketType!=='spot');
   if(matches.length!==1)return failed;
   const market=matches[0];
   const fundingInput=venue==='hyperliquid'?{venue,action:'funding-history',coin:base,startTime:start,endTime:end-1,limit:48}:{venue,action:'funding-history',marketId:market.marketId,startTime:start,endTime:end-1,limit:48,resolution:'1h'};
   const [fundingResult,priceResult,btcResult]=await Promise.allSettled([
    deadline(this.research.execute(fundingInput),12000),
    deadline(this.markets.candles(venue,market.symbol,'1h','perpetual',end,25),12000),
    deadline(this.markets.candles(venue,'BTC-USDC','1h','perpetual',end,25),12000),
   ]);
   if(Number.isFinite(market.fundingRate)&&market.fundingRate!==null&&market.updatedAt>=this.clock()-120000&&market.updatedAt<=this.clock()+5000){failed.currentFundingHourly=market.fundingRate;const projected=new Decimal(market.fundingRate).mul(24).toNumber();failed.projected24hFunding=Number.isFinite(projected)?projected:null;}
   if(fundingResult.status==='fulfilled'){
    try{failed.funding=history(fundingResult.value.data,venue,start,end);if(fundingResult.value.truncated){failed.funding.actual24h=null;failed.funding.status='partial';failed.funding.message='Funding history was truncated; a full 24-hour total is unavailable.';}}
    catch{failed.funding.message='The venue returned invalid funding history.';}
   }
   if(priceResult.status==='fulfilled'){
    try{failed.price=prices(priceResult.value,btcResult.status==='fulfilled'?btcResult.value:[],start,end);}
    catch{failed.price.message='The venue returned invalid price history.';}
   }
   return failed;
  }catch{return failed;}
 }
}
