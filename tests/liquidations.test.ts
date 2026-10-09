import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLiquidation, LiquidationCollector } from '../src/server/liquidations.ts';
const now=1_800_000_000_000;
test('Binance maps actual filled size and opposite order side, excludes inverse and invalid values',()=>{
 const raw={e:'forceOrder',o:{s:'BTCUSDT',S:'SELL',q:'100',z:'2',ap:'10',T:now},st:1};
 assert.deepEqual(parseLiquidation('binance-futures',raw,now),[{symbol:'BTCUSDT',ts:now,side:'long',price:'10',size:'2'}]);
 assert.deepEqual(parseLiquidation('binance-futures',{...raw,st:2},now),[]);
 assert.deepEqual(parseLiquidation('binance-futures',{...raw,o:{...raw.o,z:'NaN'}},now),[]);
});
test('Bybit processes arrays and position side, rejects future events',()=>{
 assert.deepEqual(parseLiquidation('bybit-futures',{topic:'allLiquidation.BTCUSDT',data:[{s:'BTCUSDT',S:'Buy',v:'3',p:'12',T:now}]},now),[{symbol:'BTCUSDT',ts:now,side:'long',price:'12',size:'3'}]);
 assert.deepEqual(parseLiquidation('bybit-futures',{data:[{s:'BTCUSDT',S:'Buy',v:'3',p:'12',T:now+60_000}]},now),[]);
});
test('unstarted collector reports collecting and validates query',()=>{
 const c=new LiquidationCollector(':memory:',{now:()=>now});
 assert.equal(c.get({venue:'binance-futures',pairKey:'BTC-USDT-USDT',hours:'1'}).error,'liquidations_unavailable');
 assert.throws(()=>c.get({venue:'evil',pairKey:'BTC-USDT-USDT',hours:'1'}));
 assert.throws(()=>c.get({venue:'binance-futures',pairKey:'BTC-USDT-USDT',hours:'2'}));
 c.close();
});
class FakeSocket extends EventTarget {
 readyState=0;sent:string[]=[];
 send(data:string){this.sent.push(data);}
 close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
 message(data:unknown){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('acknowledged feeds aggregate exact values, deduplicate, expose sampled coverage and stop safely',async()=>{
 let time=now;const sockets:FakeSocket[]=[];
 const c=new LiquidationCollector(':memory:',{now:()=>time,socketFactory:()=>{const s=new FakeSocket();sockets.push(s);return s;},fetcher:async url=>String(url).includes('binance')?Response.json({symbols:[{symbol:'BTCUSDT',status:'TRADING',contractType:'PERPETUAL',quoteAsset:'USDT',marginAsset:'USDT'}]}):Response.json({retCode:0,result:{list:[{symbol:'BTCUSDT',status:'Trading',contractType:'LinearPerpetual',quoteCoin:'USDT',settleCoin:'USDT'}],nextPageCursor:''}})});
 c.start();await flush();assert.equal(sockets.length,2);sockets[0].open();sockets[1].open();
 assert.equal(c.get({venue:'bybit-futures',pairKey:'BTC-USDT-USDT',hours:1}).reason,'collecting');
 sockets[1].message({op:'subscribe',success:true,req_id:JSON.parse(sockets[1].sent[0]).req_id});sockets[1].message({topic:'allLiquidation.BTCUSDT',ts:time,data:[{s:'BTCUSDT',S:'Buy',v:'1',p:'10',T:time},{s:'BTCUSDT',S:'Buy',v:'1',p:'10',T:time}]});assert.deepEqual(c.get({venue:'bybit-futures',pair:'BTC-USDT-USDT',hours:1}).buckets,[{ts:time,price:10,side:'long',notionalUsd:20,count:2}]);
 const event={e:'forceOrder',o:{s:'BTCUSDT',S:'SELL',z:'0.2',ap:'10',T:time},st:1};sockets[0].message(event);sockets[0].message(event);
 const result=c.get({venue:'binance-futures',pairKey:'BTC-USDT-USDT',hours:1});
 assert.equal(result.completeness,'sampled');assert.equal(result.trackedSince,time);
 assert.deepEqual(result.buckets,[{ts:time,price:10,side:'long',notionalUsd:2,count:1}]);
 assert.equal(c.get({venue:'binance-futures',pairKey:'BAD-USDT-USDT',hours:1}).reason,'not_tracked');
 time+=100;sockets[0].close();assert.equal(c.get({venue:'binance-futures',pairKey:'BTC-USDT-USDT',hours:1}).reason,'collecting');c.close();
});
test('native provider pair query alias is accepted',()=>{const c=new LiquidationCollector(':memory:',{now:()=>now});assert.equal(c.get({venue:'binance-futures',pair:'BTC-USDT-USDT',hours:'72'}).reason,'collecting');c.close();});


import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('restart preserves history and records downtime instead of inventing earlier coverage',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cointrade-liquidations-'));let time=now;
 const fetcher:typeof fetch=async url=>String(url).includes('binance')?Response.json({symbols:[{symbol:'BTCUSDT',status:'TRADING',contractType:'PERPETUAL',quoteAsset:'USDT',marginAsset:'USDT'}]}):Response.json({retCode:0,result:{list:[{symbol:'BTCUSDT',status:'Trading',contractType:'LinearPerpetual',quoteCoin:'USDT',settleCoin:'USDT'}],nextPageCursor:''}});
 let c:LiquidationCollector|undefined;
 try{let sockets:FakeSocket[]=[];const options={now:()=>time,fetcher,socketFactory:()=>{const s=new FakeSocket();sockets.push(s);return s;}};
 c=new LiquidationCollector(join(dir,'collector.sqlite'),options);c.start();await flush();sockets[0].open();sockets[0].message({e:'forceOrder',o:{s:'BTCUSDT',S:'SELL',z:'2',ap:'10',T:time},st:1});c.close();
 time+=120_000;sockets=[];c=new LiquidationCollector(join(dir,'collector.sqlite'),options);c.start();await flush();sockets[0].open();const response=c.get({venue:'binance-futures',pair:'BTC-USDT-USDT',hours:1});assert.equal(response.trackedSince,now);assert.equal((response.buckets as unknown[]).length,1);assert.ok((response.coverageGaps as unknown[]).length>=1);
 assert.equal(c.get({venue:'binance-futures',pair:'BTC-USDC-USDC',hours:1}).reason,'not_tracked');
 }finally{c?.close();assert.ok(dir.startsWith(join(tmpdir(),'cointrade-liquidations-')));rmSync(dir,{recursive:true,force:true});}
});


test('duplicate and unknown acknowledgements never satisfy multiple subscription batches; disconnect clears connection timers',async()=>{
 const sockets:FakeSocket[]=[];const list=Array.from({length:900},(_,i)=>({symbol:`COIN${i}USDT`,status:'Trading',contractType:'LinearPerpetual',quoteCoin:'USDT',settleCoin:'USDT'}));list.push({symbol:'BTCUSDT',status:'Trading',contractType:'LinearPerpetual',quoteCoin:'USDT',settleCoin:'USDT'});
 const c=new LiquidationCollector(':memory:',{now:()=>now,socketFactory:()=>{const s=new FakeSocket();sockets.push(s);return s;},fetcher:async url=>String(url).includes('binance')?Response.json({symbols:[{symbol:'BTCUSDT',status:'TRADING',contractType:'PERPETUAL',quoteAsset:'USDT',marginAsset:'USDT'}]}):Response.json({retCode:0,result:{list,nextPageCursor:''}})});
 c.start();await flush();sockets[1].open();const batches=sockets[1].sent.map(s=>JSON.parse(s)).filter(s=>s.op==='subscribe');assert.ok(batches.length>1);
 sockets[1].message({op:'subscribe',req_id:batches[0].req_id,success:true});sockets[1].message({op:'subscribe',req_id:batches[0].req_id,success:true});sockets[1].message({op:'subscribe',req_id:'unknown',success:true});assert.equal(c.get({venue:'bybit-futures',pair:'BTC-USDT-USDT',hours:1}).reason,'collecting');
 for(const batch of batches.slice(1))sockets[1].message({op:'subscribe',req_id:batch.req_id,success:true});assert.equal(c.get({venue:'bybit-futures',pair:'BTC-USDT-USDT',hours:1}).connected,true);
 const before=c.diagnostics().pendingTimers;sockets[1].close();assert.ok(c.diagnostics().pendingTimers<before);c.close();assert.equal(c.diagnostics().pendingTimers,0);
});
