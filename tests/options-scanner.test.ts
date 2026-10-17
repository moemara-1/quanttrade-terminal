import test from 'node:test';
import assert from 'node:assert/strict';
import { OptionsScanner } from '../src/server/options-scanner.ts';

const now=1_792_257_000_000;
const trade={trade_id:'1',timestamp:now-1000,instrument_name:'BTC-23OCT26-82000-C',direction:'buy',amount:2,price:0.01,index_price:80_000,iv:30,block_trade_id:'BLOCK-1',block_trade_leg_count:2};
const summary={instrument_name:'BTC-23OCT26-82000-C',open_interest:5,volume:2};
function response(url:RequestInfo|URL,trades:unknown[]=[trade],summaries:unknown[]=[summary]):Response {
  const value=String(url),currency=new URL(value).searchParams.get('currency');
  return Response.json({result:value.includes('get_last_trades')?{trades:currency==='BTC'?trades:[],has_more:true}:currency==='BTC'?summaries:[]});
}
test('options keeps genuine block legs, deduplicates IDs and computes premium and native-unit overview',async()=>{
  const service=new OptionsScanner(async(url)=>response(url,[trade,trade,{...trade,trade_id:'2',block_trade_id:undefined}],[summary,{...summary,instrument_name:'BTC-23OCT26-82000-P',open_interest:3,volume:1}]),()=>now);
  const result=await service.get();
  assert.equal(result.trades.length,1);assert.equal(result.trades[0].premiumUsd,1600);assert.equal(result.trades[0].optionType,'call');
  assert.equal(result.overview[0].callOpenInterest,5);assert.equal(result.overview[0].putCallVolumeRatio,0.5);
  assert.equal(result.coverage[0].sampledTrades,2);assert.equal(result.sources[0].count,2);assert.equal(result.sources.every(s=>s.status==='ok'),true);
});
test('missing optional index does not invent a dollar premium; malformed mandatory rows are excluded',async()=>{
  const result=await new OptionsScanner(async(url)=>response(url,[{...trade,index_price:undefined},{...trade,trade_id:'bad',amount:-1}]),()=>now).get();
  assert.equal(result.trades[0].premiumUsd,null);assert.equal(result.sources[0].count,1);
});
test('source failures preserve healthy overview and never masquerade as empty coverage',async()=>{
  const result=await new OptionsScanner(async(url)=>String(url).includes('currency=BTC')&&String(url).includes('get_last_trades')?new Response('secret upstream body',{status:503}):response(url),()=>now).get();
  assert.equal(result.sources[0].status,'error');assert.equal(result.sources[0].message?.includes('secret'),false);assert.equal(result.coverage.some(c=>c.currency==='BTC'),false);assert.equal(result.overview.length,2);
});
test('empty valid tape and no block trades remain healthy',async()=>{
  const result=await new OptionsScanner(async(url)=>response(url,[{...trade,block_trade_id:''}]),()=>now).get();
  assert.equal(result.trades.length,0);assert.equal(result.coverage[0].sampledTrades,1);assert.equal(result.sources.every(s=>s.status==='ok'),true);
});
test('nonempty entirely malformed tape and summary fail truthfully',async()=>{
  const result=await new OptionsScanner(async(url)=>response(url,[{...trade,timestamp:now+61_000}],[{...summary,volume:'NaN'}]),()=>now).get();
  assert.equal(result.sources.find(s=>s.id==='deribit-btc-trades')?.status,'error');assert.equal(result.sources.find(s=>s.id==='deribit-btc-summary')?.status,'error');assert.equal(result.overview.some(o=>o.currency==='BTC'),false);
});
test('coalesced cached snapshots are immutable to callers and refresh after thirty seconds',async()=>{
  let calls=0,clock=now;const service=new OptionsScanner(async(url)=>{calls++;return response(url);},()=>clock);
  const [first,second]=await Promise.all([service.get(),service.get()]);assert.equal(calls,4);
  first.trades.length=0;second.sources[0].status='error';assert.equal((await service.get()).trades.length,1);assert.equal((await service.get()).sources[0].status,'ok');
  clock+=30_001;await service.get();assert.equal(calls,8);
});
test('oversized response bodies fail safely',async()=>{
  const result=await new OptionsScanner(async()=>new Response(' '.repeat(2_000_001)),()=>now).get();assert.equal(result.sources.every(s=>s.status==='error'),true);
});
test('wrong currency, invalid strikes and future summary timestamps are rejected',async()=>{
  const result=await new OptionsScanner(async(url)=>response(url,[{...trade,instrument_name:'ETH-23OCT26-82000-C'},{...trade,trade_id:'zero',instrument_name:'BTC-23OCT26-0-C'}],[{...summary,creation_timestamp:now+61_000}]),()=>now).get();
  assert.equal(result.sources.find(s=>s.id==='deribit-btc-trades')?.status,'error');assert.equal(result.sources.find(s=>s.id==='deribit-btc-summary')?.status,'error');
});
test('requests stay on the fixed public endpoints and use bounded transport settings',async()=>{
  const urls:URL[]=[];
  await new OptionsScanner(async(url,init)=>{urls.push(new URL(String(url)));assert.equal(init?.redirect,'error');assert.ok(init?.signal);return response(url);},()=>now).get();
  assert.equal(urls.length,4);assert.ok(urls.every(url=>url.origin==='https://www.deribit.com'&&url.searchParams.get('kind')==='option'));
  assert.equal(urls.filter(url=>url.searchParams.get('count')==='1000'&&url.searchParams.get('sorting')==='desc').length,2);
});

test('stale option summaries are unavailable and partial samples disclose exclusions without a complete ratio',async()=>{
 const stale=await new OptionsScanner(async(url)=>response(url,[],[{...summary,creation_timestamp:now-121000}]),()=>now).get();
 assert.equal(stale.sources.find(s=>s.id==='deribit-btc-summary')?.status,'error');
 const partial=await new OptionsScanner(async(url)=>response(url,[trade,{...trade,trade_id:'bad',amount:-2}],[summary,{...summary,instrument_name:'BTC-23OCT26-82000-P',volume:-1}]),()=>now).get();
 assert.ok(partial.sources.find(s=>s.id==='deribit-btc-summary')?.message);
 assert.ok(partial.sources.find(s=>s.id==='deribit-btc-trades')?.message);
 assert.equal(partial.overview[0].putCallVolumeRatio,null);
});
