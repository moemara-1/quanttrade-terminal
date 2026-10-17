import assert from 'node:assert/strict';
import test from 'node:test';
import type { Market } from '../src/shared/types.ts';
import { DiscoveryScanners } from '../src/server/scanners.ts';

const now=1_800_000_000_000;
const emptyOptions={sources:[],trades:[],overview:[],coverage:[]};
function market(venue:'lighter'|'hyperliquid',base:string,overrides:Partial<Market>={}):Market {
 return {venue,base,symbol:`${base}-USDC`,price:'100',change24h:5,volume24h:'1000',fundingRate:0.0001,openInterest:'20',updatedAt:now,sizeDecimals:2,priceDecimals:2,minSize:'0.01',minNotional:'10',...overrides};
}
function service(hl:Market[],lt:Market[]){return {list:async(venue:'lighter'|'hyperliquid')=>venue==='lighter'?lt:hl};}
test('funding comparisons use normalized hourly fractions, correct payment direction and midpoint mark gap',async()=>{
 const scanner=new DiscoveryScanners(service([market('hyperliquid','BTC',{price:'100',fundingRate:-0.0002})],[market('lighter','BTC',{price:'102',fundingRate:0.0001})]),{get:async()=>emptyOptions},()=>now);
 const snapshot=await scanner.get();const pair=snapshot.comparisons[0]!;
 assert.equal(pair.longVenue,'hyperliquid');assert.equal(pair.shortVenue,'lighter');
 assert.ok(Math.abs(pair.fundingGapHourly!-0.0003)<1e-12);
 assert.ok(Math.abs(pair.markGapPct-2/101*100)<1e-12);
 assert.equal(pair.lowerMarkVenue,'hyperliquid');assert.equal(pair.higherMarkVenue,'lighter');
 assert.equal(snapshot.markets[0]!.openInterestUsd,2000);
 assert.equal(snapshot.markets[0]!.oiToVolume,2);
});
test('relative strength compares BTC within the venue and never invents missing rates or division by zero',async()=>{
 const scanner=new DiscoveryScanners(service([market('hyperliquid','BTC',{change24h:2}),market('hyperliquid','ETH',{change24h:8,fundingRate:null,volume24h:'0'})],[market('lighter','ETH',{fundingRate:0})]),{get:async()=>emptyOptions},()=>now);
 const snapshot=await scanner.get();
 const eth=snapshot.markets.find(r=>r.venue==='hyperliquid'&&r.base==='ETH')!;
 assert.equal(eth.relativeStrength24h,6);assert.equal(eth.oiToVolume,null);
 assert.equal(snapshot.markets.find(r=>r.venue==='lighter')!.relativeStrength24h,null);
 assert.equal(snapshot.comparisons[0]!.fundingGapHourly,null);
 assert.equal(snapshot.comparisons[0]!.longVenue,null);
});
test('exact base joins exclude multipliers, namespace aliases, duplicate bases and unhealthy rows',async()=>{
 const hl=[market('hyperliquid','BTC'),market('hyperliquid','BTC'),market('hyperliquid','kPEPE'),market('hyperliquid','ETH',{updatedAt:now-121000}),market('hyperliquid','SOL',{price:'NaN'})];
 const scanner=new DiscoveryScanners(service(hl,[market('lighter','BTC'),market('lighter','1000PEPE'),market('lighter','ETH'),market('lighter','SOL')]),{get:async()=>emptyOptions},()=>now);
 const snapshot=await scanner.get();assert.equal(snapshot.comparisons.length,0);
 assert.equal(snapshot.markets.some(r=>r.venue==='hyperliquid'&&r.base==='BTC'),false);
 assert.equal(snapshot.sources[0]!.status,'ok');assert.ok(snapshot.sources[0]!.message);
});
test('source failures preserve healthy venue and options data; errors are not healthy empty books',async()=>{
 const scanner=new DiscoveryScanners({list:async(venue)=>{if(venue==='lighter')throw Error('private upstream body');return [market('hyperliquid','BTC')];}},{get:async()=>emptyOptions},()=>now);
 const snapshot=await scanner.get();assert.equal(snapshot.markets.length,1);
 assert.equal(snapshot.sources.find(r=>r.id==='lighter')!.status,'error');
 assert.equal(JSON.stringify(snapshot).includes('private upstream'),false);
 assert.equal(snapshot.comparisons.length,0);
});
test('cache coalesces concurrent scans, isolates returned mutation, and refreshes after TTL',async()=>{
 let calls=0,clock=now;
 const scanner=new DiscoveryScanners({list:async(venue)=>{calls++;return [market(venue,'BTC',{updatedAt:clock})];}},{get:async()=>emptyOptions},()=>clock);
 const [first,second]=await Promise.all([scanner.get(),scanner.get()]);assert.equal(calls,2);
 first.markets.length=0;assert.equal(second.markets.length,2);assert.equal((await scanner.get()).markets.length,2);
 clock+=30001;await scanner.get();assert.equal(calls,4);
});
test('equal funding and marks do not manufacture trade direction; empty venue metadata is unavailable',async()=>{
 const scanner=new DiscoveryScanners(service([market('hyperliquid','BTC')],[market('lighter','BTC')]),{get:async()=>emptyOptions},()=>now);
 const pair=(await scanner.get()).comparisons[0]!;
 assert.equal(pair.fundingGapHourly,0);assert.equal(pair.longVenue,null);assert.equal(pair.shortVenue,null);
 assert.equal(pair.markGapPct,0);assert.equal(pair.lowerMarkVenue,null);
 const empty=new DiscoveryScanners(service([],[]),{get:async()=>emptyOptions},()=>now);
 assert.ok((await empty.get()).sources.every(s=>s.status==='error'));
});

test('non-contemporaneous venues are not compared and extreme derived values never serialize as Infinity',async()=>{
 const scanner=new DiscoveryScanners(service([market('hyperliquid','BTC',{updatedAt:now-31000}),market('hyperliquid','ETH',{volume24h:'1e-300',openInterest:'1e200'})],[market('lighter','BTC')]),{get:async()=>emptyOptions},()=>now);
 const result=await scanner.get();assert.equal(result.comparisons.length,0);
 assert.equal(result.markets.find(r=>r.base==='ETH')!.oiToVolume,null);
});
