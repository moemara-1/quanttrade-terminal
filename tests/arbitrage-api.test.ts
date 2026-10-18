import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../src/server/app.ts';
import {TradingDesk} from '../src/server/trading.ts';
import {DeskStore} from '../src/server/store.ts';
import {ArbitragePlans} from '../src/server/arbitrage-plans.ts';

test('paired routes require human operator and exact fingerprint; paper confirmation is idempotent',async()=>{
 const store=new DeskStore(':memory:');let sends=0;
 const markets={candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()}),list:async(venue:'lighter'|'hyperliquid')=>[{venue,symbol:'BTC-USDC',base:'BTC',price:'100',change24h:0,volume24h:'1000',fundingRate:0,openInterest:null,sizeDecimals:2,priceDecimals:2,minSize:'0.01',minNotional:'1',updatedAt:Date.now(),maxLeverage:10}]};
 const desk=new TradingDesk(store,markets,{configured:false,place:async()=>{sends++;throw Error('No live orders in this test');},cancel:async()=>{}},{mode:'paper',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:60,pairlensUrl:''});
 const arbitrage=new ArbitragePlans(':memory:',desk,async()=>({accountName:'desk',mode:'paper',connectionRevision:null,availableMargin:'0',observedAt:Date.now()}));
 const app=createApp({desk,markets,arbitrage,agent:{prepare:async()=>({summary:'none',proposal:null})},operatorToken:'operator',agentToken:'agent'});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('No test server');
 const base=`http://127.0.0.1:${address.port}/api/arbitrage`;
 const post=(path:string,token:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const input={requestId:'review',base:'BTC',longVenue:'lighter',size:'1',leverage:5,marginMode:'cross',maxTotalInitialMargin:'41'};
  assert.equal((await post('/prepare','agent',input)).status,403);
  const response=await post('/prepare','operator',input);assert.equal(response.status,200);const plan=await response.json();assert.equal(plan.status,'review');assert.equal(sends,0);
  assert.equal((await post(`/${plan.id}/confirm`,'operator',{fingerprint:'b'.repeat(64)})).status,409);
  assert.equal((await post(`/${plan.id}/confirm`,'agent',{fingerprint:plan.fingerprint})).status,403);
  const result=await post(`/${plan.id}/confirm`,'operator',{fingerprint:plan.fingerprint});assert.equal(result.status,200);assert.equal((await result.json()).status,'filled');
  assert.equal((await (await post(`/${plan.id}/confirm`,'operator',{fingerprint:plan.fingerprint})).json()).status,'filled');assert.equal(sends,0);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));arbitrage.close();store.close();}
});
