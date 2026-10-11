import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DeskStore } from '../src/server/store.ts';
import { TradingDesk } from '../src/server/trading.ts';
import { HyperliquidNativeTwap } from '../src/server/hyperliquid-native-twap.ts';

function setup(bps=300,fail=false){
 const now=Date.now(),store=new DeskStore(':memory:');store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));
 const markets={list:async()=>[{venue:'hyperliquid' as const,symbol:'GRAM-USDC',maxLeverage:20,base:'GRAM',price:'2',change24h:0,volume24h:'1',fundingRate:0,openInterest:null,sizeDecimals:3,priceDecimals:2,minSize:'0.001',minNotional:'10',updatedAt:now}]};
 const desk=new TradingDesk(store,markets,{configured:true,place:async()=>{throw new Error('Unexpected generic order');},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:bps,proposalTtlSeconds:180,pairlensUrl:'http://localhost'},()=>now);
 let calls=0;let payload:Record<string,unknown>={};
 const service=new HyperliquidNativeTwap(desk,{perform:async(action,input)=>{calls++;payload=input;if(fail)throw new Error('network');return {status:'accepted',connector_name:'hyperliquid_perpetual',trading_pair:'GRAM-USD',...(action==='hyperliquid-twap'?{twap_id:'123'}:{twap_id:input.twap_id})};}},markets,()=>now);
 const plan={requestId:randomUUID(),proposedAt:now,credentialId:'hl',connectionRevision:'a'.repeat(64),accountName:'desk',mode:'live',venue:'hyperliquid',marketType:'perpetual',symbol:'GRAM-USDC',action:'create',side:'buy',size:'60',durationMinutes:5,randomize:false,reduceOnly:false,acceptNativeRisk:true,referenceNotionalBudget:'124'};
 return {store,desk,service,plan,markets,now,calls:()=>calls,payload:()=>payload};
}
test('native TWAP one admission reserves full reviewed reference estimate once and never claims fills',async()=>{
 const s=setup();try{const result=await s.service.execute(s.plan);assert.equal(result.status,'accepted');assert(!('fillPrice' in result));assert.equal((await s.service.execute(s.plan)).status,'accepted');assert.equal(s.calls(),1);assert.equal(s.payload().amount,'60');assert.equal(s.payload().duration_minutes,5);assert.equal(s.store.used('live',new Date(s.now).toISOString().slice(0,10)),'123.6');}finally{s.store.close();}
});
test('native fixed slippage, venue minimum, reviewed estimate, quantity precision and connection checks fail before submission',async()=>{
 const narrow=setup(100);try{await assert.rejects(narrow.service.execute(narrow.plan),/3%/);assert.equal(narrow.calls(),0);}finally{narrow.store.close();}
 const s=setup();try{for(const patch of [{size:'49'},{size:'60.0001'},{referenceNotionalBudget:'120'},{acceptNativeRisk:false},{durationMinutes:4},{connectionRevision:'b'.repeat(64)}])await assert.rejects(s.service.execute({...s.plan,...patch}));assert.equal(s.calls(),0);}finally{s.store.close();}
});
test('uncertain native submission is durable and never replayed',async()=>{const s=setup(300,true);try{assert.equal((await s.service.execute(s.plan)).status,'unknown');assert.equal((await s.service.execute(s.plan)).status,'unknown');assert.equal(s.calls(),1);}finally{s.store.close();}});
test('cancellation remains available under halt, requires exact reviewed scope and does not reserve exposure',async()=>{
 const s=setup();try{s.desk.setHalted(true);const common={requestId:randomUUID(),proposedAt:s.now,credentialId:'hl',connectionRevision:'a'.repeat(64),accountName:'desk',mode:'live',venue:'hyperliquid',marketType:'perpetual',symbol:'GRAM-USDC',action:'cancel',twapId:'123'};assert.equal((await s.service.execute(common)).status,'accepted');assert.equal(s.payload().twap_id,'123');assert.equal(s.store.used('live',new Date(s.now).toISOString().slice(0,10)),'0');}finally{s.store.close();}
});
test('native TWAP rejects changed keys after awaited market reads and mismatched acknowledgments',async()=>{
 const s=setup();try{
  let calls=0;
  const service=new HyperliquidNativeTwap(s.desk,{perform:async()=>{calls++;return {status:'accepted',connector_name:'hyperliquid_perpetual',trading_pair:'WRONG-USD',twap_id:'123'};}},{list:async()=>{s.store.setConnectionFingerprint('desk','hyperliquid','b'.repeat(64));return s.markets.list();}},()=>s.now);
  await assert.rejects(service.execute(s.plan),/revision changed/);assert.equal(calls,0);
  s.store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));
  const bad=new HyperliquidNativeTwap(s.desk,{perform:async()=>{calls++;return {status:'accepted',connector_name:'hyperliquid_perpetual',trading_pair:'WRONG-USD',twap_id:'123'};}},{list:async()=>[{venue:'hyperliquid',symbol:'GRAM-USDC',maxLeverage:20,base:'GRAM',price:'2',change24h:0,volume24h:'1',fundingRate:0,openInterest:null,sizeDecimals:3,priceDecimals:2,minSize:'0.001',minNotional:'10',updatedAt:s.now}]},()=>s.now);
  assert.equal((await bad.execute(s.plan)).status,'unknown');assert.equal((await bad.execute(s.plan)).status,'unknown');assert.equal(calls,1);
 }finally{s.store.close();}
});

test('native TWAP admission uses the latest validated quote rather than the first market read',async()=>{
 const s=setup();try{
  let reads=0,calls=0;
  const moving={list:async()=>{reads++;return (await s.markets.list()).map(market=>({...market,price:reads===1?'2':'3'}));}};
  const desk=new TradingDesk(s.store,moving,{configured:true,place:async()=>'',cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:300,proposalTtlSeconds:180,pairlensUrl:'http://localhost'},()=>s.now);
  const service=new HyperliquidNativeTwap(desk,{perform:async()=>{calls++;return {status:'accepted',connector_name:'hyperliquid_perpetual',trading_pair:'GRAM-USD',twap_id:'123'};}},moving,()=>s.now);
  await assert.rejects(service.execute(s.plan),/admission estimate/);assert.equal(calls,0);assert.equal(s.store.used('live',new Date(s.now).toISOString().slice(0,10)),'0');
  reads=0;await service.execute({...s.plan,referenceNotionalBudget:'186'});assert.equal(calls,1);assert.equal(s.store.used('live',new Date(s.now).toISOString().slice(0,10)),'185.4');
 }finally{s.store.close();}
});

test('native TWAP minimum reference amount is checked against the latest quote',async()=>{
 const s=setup();try{
  let reads=0,calls=0;
  const moving={list:async()=>{reads++;return (await s.markets.list()).map(market=>({...market,price:reads===1?'2':'1'}));}};
  const desk=new TradingDesk(s.store,moving,{configured:true,place:async()=>'',cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:300,proposalTtlSeconds:180,pairlensUrl:'http://localhost'},()=>s.now);
  const service=new HyperliquidNativeTwap(desk,{perform:async()=>{calls++;return {};}},moving,()=>s.now);
  await assert.rejects(service.execute(s.plan),/100 USDC/);assert.equal(calls,0);
 }finally{s.store.close();}
});

test('native TWAP evidence is pinned to account and connection and can verify an owned accepted receipt',async()=>{
 const s=setup();try{
  await s.service.execute(s.plan);
  const request={accountName:'desk',connectionRevision:'a'.repeat(64),requestId:s.plan.requestId,symbol:'GRAM-USDC',twapId:'123',side:'buy',size:'60'};
  await s.service.evidence(request);assert.equal(s.payload().account_name,'desk');
  for(const patch of [{accountName:'other'},{connectionRevision:'b'.repeat(64)},{requestId:randomUUID()},{twapId:'124'},{symbol:'BTC-USDC'},{side:'sell'},{size:'59'}])await assert.rejects(s.service.evidence({...request,...patch}));
  assert.equal(s.calls(),2);
  const receipt=s.store.operation(s.plan.requestId);assert.equal(receipt?.state,'completed');assert.equal(s.store.operation(randomUUID()),null);
 }finally{s.store.close();}
});

test('native TWAP evidence rejects a connection change during its awaited exchange read',async()=>{
 const s=setup();try{
  const service=new HyperliquidNativeTwap(s.desk,{perform:async()=>{s.store.setConnectionFingerprint('desk','hyperliquid','b'.repeat(64));return {status:'fills-observed'};}},s.markets,()=>s.now);
  await assert.rejects(service.evidence({accountName:'desk',connectionRevision:'a'.repeat(64),symbol:'GRAM-USDC',twapId:'123',side:'buy',size:'60'}),/account or connection/);
 }finally{s.store.close();}
});

test('native TWAP permission allows 3% slices without widening ordinary risk and revocation during reads blocks submission',async()=>{
 const s=setup(100);try{
  s.store.setNativeTwapRiskAllowed('desk','a'.repeat(64),true);
  assert.equal((await s.service.execute(s.plan)).status,'accepted');assert.equal(s.desk.status().maxPriceDeviationBps,100);assert.equal(s.store.used('live',new Date(s.now).toISOString().slice(0,10)),'123.6');
 }finally{s.store.close();}
 const revoked=setup(100);try{
  revoked.store.setNativeTwapRiskAllowed('desk','a'.repeat(64),true);let calls=0;
  const service=new HyperliquidNativeTwap(revoked.desk,{perform:async()=>{calls++;return {};}},{list:async()=>{revoked.store.setNativeTwapRiskAllowed('desk','a'.repeat(64),false);return revoked.markets.list();}},()=>revoked.now);
  await assert.rejects(service.execute(revoked.plan),/3%/);assert.equal(calls,0);
 }finally{revoked.store.close();}
});
test('native TWAP rejects protection already crossed at the latest admission reference price',async()=>{const x=setup();try{await assert.rejects(x.service.execute({...x.plan,protection:{activation:'after-full-entry-fill',management:'managed',stopLossPrice:'2',takeProfits:[{price:'3',sizePercent:'100'}],maxExitNotional:'1000'}}),/admission reference/);assert.equal(x.calls(),0);}finally{x.store.close();}});
