import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/server/app.ts';
import { DeskStore } from '../src/server/store.ts';
import { TradingDesk } from '../src/server/trading.ts';
import type { MarketService } from '../src/server/markets.ts';

async function fixture() {
  const store=new DeskStore(':memory:');
  store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));
  const markets:MarketService={list:async()=>[],candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()})};
  const desk=new TradingDesk(store,markets,{configured:true,place:async()=>{throw Error('No execution permitted in policy test');},cancel:async()=>{throw Error('No cancellation permitted in policy test');}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:100,proposalTtlSeconds:180,pairlensUrl:'http://localhost:4317'});
  const server=createApp({desk,markets,agent:{prepare:async()=>({summary:'No order',proposal:null})},operatorToken:'operator',agentToken:'agent'}).listen(0,'127.0.0.1');
  await once(server,'listening');
  const address=server.address();if(!address||typeof address==='string')throw Error('Missing server address');
  const body={requestId:randomUUID(),proposedAt:Date.now(),accountName:'desk',connectionRevision:'a'.repeat(64),mode:'live',venue:'hyperliquid',enabled:true,acceptFixedSlippageBps:300};
  const update=(input:unknown=body,token='operator')=>fetch(`http://127.0.0.1:${address.port}/api/terminal/native-twap-policy`,{method:'PUT',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(input)});
  return {store,desk,body,update,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}};
}

test('native TWAP permission requires operator authorization and leaves standard risk limits unchanged',async()=>{
  const s=await fixture();try{
    assert.equal((await s.update(s.body,'')).status,401);
    assert.equal((await s.update(s.body,'agent')).status,403);
    assert.equal(s.desk.status().nativeTwapRiskAllowed,false);
    const first=await s.update();assert.equal(first.status,200);
    const expected={enabled:true,accountName:'desk',connectionRevision:'a'.repeat(64)};
    assert.deepEqual(await first.json(),expected);
    assert.deepEqual(await (await s.update()).json(),expected);
    assert.equal(s.desk.status().nativeTwapRiskAllowed,true);
    assert.equal(s.desk.status().maxPriceDeviationBps,100);
    assert.equal(s.desk.status().maxOrderNotional,'1000');
    assert.equal(s.desk.status().dailyNotionalLimit,'2000');
    assert.equal(s.store.used('live',new Date().toISOString().slice(0,10)),'0');
    assert.equal(s.store.audit().filter(event=>event.action==='native-twap-risk-updated').length,1);
    assert.equal((await s.update({...s.body,enabled:false})).status,400);
    assert.equal(s.desk.status().nativeTwapRiskAllowed,true);
    assert.equal((await s.update({...s.body,requestId:randomUUID(),enabled:false})).status,200);
    assert.equal(s.desk.status().nativeTwapRiskAllowed,false);
  }finally{await s.close();}
});

test('permission reviews reject stale scope, expiration and malformed slippage before changing state',async()=>{
 const s=await fixture();try{
  for(const patch of [{accountName:'another'},{connectionRevision:'b'.repeat(64)},{proposedAt:Date.now()-180001},{proposedAt:Date.now()+60000},{acceptFixedSlippageBps:100},{mode:'paper'},{venue:'lighter'}]) {
   assert.equal((await s.update({...s.body,...patch,requestId:randomUUID()})).status,400);
   assert.equal(s.desk.status().nativeTwapRiskAllowed,false);
  }
  s.desk.setVenueMode('hyperliquid','paper');assert.equal((await s.update()).status,400);
  s.desk.setVenueMode('hyperliquid','live');assert.equal((await s.update()).status,200);
  s.store.setConnectionFingerprint('desk','hyperliquid','b'.repeat(64));
  assert.equal(s.desk.status().nativeTwapRiskAllowed,false);
  assert.equal((await s.update()).status,400);
  assert.equal((await s.update({...s.body,requestId:randomUUID(),connectionRevision:'b'.repeat(64)})).status,200);
  assert.equal(s.desk.status().nativeTwapRiskAllowed,true);
 }finally{await s.close();}
});
