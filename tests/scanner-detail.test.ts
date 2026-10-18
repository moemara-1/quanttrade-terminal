import test from 'node:test';
import assert from 'node:assert/strict';
import { ScannerDetails } from '../src/server/scanner-detail.ts';
import type { Market, Venue } from '../src/shared/types.ts';

const HOUR=3600000,now=Date.UTC(2026,9,18,12,30),end=Math.floor(now/HOUR)*HOUR,start=end-24*HOUR;
function fixture(options:{missing?:boolean;bad?:boolean;duplicate?:boolean;jitter?:boolean}={}){
 let researchCalls=0,candleCalls=0;
 const market=(venue:Venue,base:string):Market=>({venue,base,symbol:`${base}-USDC`,marketId:1,price:'100',change24h:1,volume24h:'1000',fundingRate:0.0001,openInterest:'1',sizeDecimals:1,priceDecimals:2,minSize:'1',minNotional:'1',updatedAt:now});
 const markets={list:async(venue:Venue)=>[market(venue,'ETH'),market(venue,'BTC')],candles:async(_venue:Venue,symbol:string)=>{candleCalls++;return Array.from({length:25},(_,i)=>({time:(start-HOUR+i*HOUR)/1000,open:100,high:200,low:100,close:100+i*(symbol==='BTC-USDC'?1:2),volume:1}));}};
 const research={execute:async(raw:unknown)=>{researchCalls++;const r=raw as {venue:Venue};return{venue:r.venue,action:'funding-history',observedAt:now,truncated:false,data:Array.from({length:options.missing?23:24},(_,i)=>r.venue==='lighter'?{timestamp:(start+(options.duplicate&&i===23?22:i)*HOUR)/1000,rate:options.bad?'bad':'0.01',direction:i===0?'short':'long'}:{time:start+i*HOUR+(options.jitter?7:0),fundingRate:'0.0002'})};}};
 return{service:new ScannerDetails(markets,research,()=>now),calls:()=>({researchCalls,candleCalls})};
}
test('selected details sum signed settled histories and keep projections separate; coalesce cache',async()=>{
 const f=fixture();const [a,b]=await Promise.all([f.service.get('ETH','all'),f.service.get('ETH','all')]);
 assert.equal(a.windowStart,start);assert.equal(a.windowEnd,end);assert.equal(a.venues.length,2);
 const lighter=a.venues.find(row=>row.venue==='lighter')!;assert.ok(Math.abs(lighter.funding.actual24h!-0.0022)<1e-12);assert.equal(lighter.funding.sampleCount,24);assert.equal(lighter.projected24hFunding,0.0024);
 assert.equal(lighter.price.points[0].time,start);assert.equal(lighter.price.points.at(-1)?.time,end);assert.equal(lighter.price.points.at(-1)?.relativeStrengthPp,24);assert.deepEqual(a,b);assert.deepEqual(f.calls(),{researchCalls:2,candleCalls:4});a.venues.length=0;assert.equal((await f.service.get('ETH','all')).venues.length,2);
});
test('partial or malformed history is unknown, never zero or extrapolated',async()=>{
 const partial=await fixture({missing:true}).service.get('ETH','lighter');assert.equal(partial.venues[0].funding.status,'partial');assert.equal(partial.venues[0].funding.actual24h,null);assert.equal(partial.venues[0].funding.sampleCount,23);
 const bad=await fixture({bad:true}).service.get('ETH','lighter');assert.equal(bad.venues[0].funding.actual24h,null);assert.equal(bad.venues[0].funding.observedSum,null);
 const duplicate=await fixture({duplicate:true}).service.get('ETH','lighter');assert.equal(duplicate.venues[0].funding.actual24h,null);assert.equal(duplicate.venues[0].funding.sampleCount,23);
});
test('different selected-market loads are bounded while identical requests coalesce',async()=>{
 let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 const service=new ScannerDetails({list:async()=>{calls++;await gate;return[];},candles:async()=>[]},{execute:async()=>{throw Error('Not needed');}},()=>now);
 const first=service.get('BTC','lighter'),same=service.get('BTC','lighter'),second=service.get('ETH','lighter');
 await assert.rejects(service.get('SOL','lighter'),/busy/);release();await Promise.all([first,same,second]);assert.equal(calls,2);
});
test('strict selected symbols reject caller URLs, native settlement suffixes and unknown markets',async()=>{
 const f=fixture();await assert.rejects(f.service.get('https://bad.invalid','all'));await assert.rejects(f.service.get('ETH-USDC-USDC','all'));const missing=await f.service.get('NOPE','all');assert.equal(missing.venues[0].funding.status,'error');assert.equal(f.calls().researchCalls,0);
});
test('one failed venue and failed BTC history preserve available prices without inventing relative strength',async()=>{
 const f=fixture();const source={list:async(venue:Venue)=>{if(venue==='hyperliquid')throw Error('secret upstream text');return[{venue,base:'ETH',symbol:'ETH-USDC',marketId:1,price:'1',change24h:1,volume24h:'1',fundingRate:null,openInterest:null,sizeDecimals:1,priceDecimals:1,minSize:'1',minNotional:'1',updatedAt:now}];},candles:async(_venue:Venue,symbol:string)=>{if(symbol==='BTC-USDC')throw Error('BTC unavailable');return[{time:(end-HOUR)/1000,open:1,high:1,low:1,close:1,volume:1}];}};
 const service=new ScannerDetails(source,{execute:async()=>{throw Error('upstream rejected');}},()=>now);
 const value=await service.get('ETH','all');assert.equal(value.venues[0].funding.status,'error');assert.equal(value.venues[1].price.points.length,1);assert.equal(value.venues[1].price.points[0].relativeStrengthPp,null);assert.equal(value.venues[1].currentFundingHourly,null);assert.doesNotMatch(JSON.stringify(value),/secret|rejected/);assert.equal(f.calls().researchCalls,0);
});

test('venue settlement timestamp jitter aligns to the same hourly chart buckets',async()=>{
 const result=await fixture({jitter:true}).service.get('ETH','all');
 assert.deepEqual(result.venues[0].funding.samples.map(p=>p.time),result.venues[1].funding.samples.map(p=>p.time));
 assert.equal(result.venues[0].funding.actual24h,0.0048);
});
