import test from 'node:test';
import assert from 'node:assert/strict';
import { ScannerStrengthHistory } from '../src/server/scanner-strength-history.ts';
import type { Market, Venue } from '../src/shared/types.ts';
const HOUR=3600000,now=Date.UTC(2026,9,21,12,30);
function fixture(missing=false){
 let reads=0;
 const market=(symbol:string,quote='USDC'):Market=>({venue:'hyperliquid',symbol,base:symbol.slice(0,-quote.length-1),quote,price:'100',change24h:1,volume24h:'1',fundingRate:null,openInterest:null,updatedAt:now,sizeDecimals:1,priceDecimals:1,minSize:'1',minNotional:'1'});
 const service=new ScannerStrengthHistory({list:async()=>[market('BTC-USDC'),market('ETH-USDC'),market('xyz:TSLA-USDH','USDH')],candles:async(_venue:Venue,symbol:string,interval:string,_type:unknown,end:number|undefined,limit=25)=>{reads++;const step=interval==='1d'?24*HOUR:HOUR;return Array.from({length:limit-(missing?1:0)},(_,i)=>({time:((end??0)-step*limit+i*step)/1000,close:100+i*(symbol==='BTC-USDC'?1:2),open:100,high:200,low:1,volume:1}));}},()=>now);
 return{service,reads:()=>reads};
}
test('real normalized percent series and same venue BTC excess align completed closes',async()=>{
 const f=fixture();const result=await f.service.get({venue:'hyperliquid',symbols:['ETH-USDC'],window:'1d'});
 assert.equal(result.series[0].status,'ok');assert.equal(result.series[0].points.length,25);
 assert.equal(result.series[0].points.at(-1)?.changePct,48);assert.equal(result.series[0].points.at(-1)?.relativeStrengthPp,24);
 assert.equal(result.series[0].points[0].time,result.windowStart);assert.equal(result.series[0].points.at(-1)?.time,result.windowEnd);assert.equal(f.reads(),2);
});
test('seven and thirty day windows use real completed hourly and daily observations',async()=>{
 const f=fixture();for(const [window,count]of [['7d',169],['30d',31]] as const){const r=await f.service.get({venue:'hyperliquid',symbols:['ETH-USDC'],window});assert.equal(r.series[0].points.length,count);assert.equal(r.series[0].status,'ok');}
});
test('missing history remains partial; builder quote and namespace are preserved without fabricated BTC excess',async()=>{
 const r=await fixture(true).service.get({venue:'hyperliquid',symbols:['xyz:TSLA-USDH'],window:'1d'});
 assert.equal(r.series[0].status,'partial');assert.equal(r.series[0].base,'xyz:TSLA');assert.equal(r.benchmarkSymbol,null);assert.ok(r.series[0].points.every(p=>p.relativeStrengthPp===null));
});
test('invalid identities and oversized selection reject before source reads; missing catalog markets stay errors',async()=>{
 const f=fixture();await assert.rejects(f.service.get({venue:'hyperliquid',symbols:['https://bad'],window:'1d'}));
 await assert.rejects(f.service.get({venue:'hyperliquid',symbols:Array.from({length:9},(_,i)=>`X${i}-USDC`),window:'1d'}));
 const r=await f.service.get({venue:'hyperliquid',symbols:['TSLA-USDH'],window:'1d'});assert.equal(r.series[0].status,'error');assert.equal(r.series[0].base,'TSLA');assert.equal(f.reads(),0);
});
test('cache coalesces and returns isolated snapshots; benchmark fetched only once',async()=>{
 const f=fixture(),input={venue:'hyperliquid',symbols:['ETH-USDC','BTC-USDC'],window:'1d'} as const;
 const [a,b]=await Promise.all([f.service.get({...input,symbols:[...input.symbols]}),f.service.get({...input,symbols:[...input.symbols]})]);assert.equal(f.reads(),2);a.series.length=0;assert.equal(b.series.length,2);
});
test('active report budget rejects a third distinct request without duplicating identical requests',async()=>{
 let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 const service=new ScannerStrengthHistory({list:async()=>{calls++;await gate;return[];},candles:async()=>[]},()=>now);
 const a=service.get({venue:'lighter',symbols:['BTC-USDC'],window:'1d'}),same=service.get({venue:'lighter',symbols:['BTC-USDC'],window:'1d'}),b=service.get({venue:'lighter',symbols:['ETH-USDC'],window:'1d'});
 await assert.rejects(service.get({venue:'lighter',symbols:['SOL-USDC'],window:'1d'}),/busy/);release();await Promise.all([a,same,b]);assert.equal(calls,2);
});
test('stale catalog observations and wrong namespaces do not request history',async()=>{
 let reads=0;const market:Market={venue:'hyperliquid',symbol:'xyz:ETH-USDC',base:'xyz:ETH',quote:'USDC',price:'1',change24h:0,volume24h:'1',fundingRate:null,openInterest:null,updatedAt:now-121000,sizeDecimals:1,priceDecimals:1,minSize:'1',minNotional:'1'};
 const service=new ScannerStrengthHistory({list:async()=>[market],candles:async()=>{reads++;return[];}},()=>now);
 const result=await service.get({venue:'hyperliquid',symbols:['xyz:ETH-USDC','ETH-USDC'],window:'1d'});assert.ok(result.series.every(row=>row.status==='error'));assert.equal(reads,0);
});
