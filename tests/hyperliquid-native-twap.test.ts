import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DeskStore } from '../src/server/store.ts';
import { TradingDesk } from '../src/server/trading.ts';
import { HyperliquidNativeTwap } from '../src/server/hyperliquid-native-twap.ts';
import { AdvancedProtection } from '../src/server/advanced-protection.ts';

function setup(bps=300,fail=false){
 const now=Date.now(),store=new DeskStore(':memory:');store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));
 const markets={list:async()=>[{venue:'hyperliquid' as const,symbol:'GRAM-USDC',maxLeverage:20,base:'GRAM',price:'2',change24h:0,volume24h:'1',fundingRate:0,openInterest:null,sizeDecimals:3,priceDecimals:2,minSize:'0.001',minNotional:'10',updatedAt:now}]};
 const desk=new TradingDesk(store,markets,{configured:true,place:async()=>{throw new Error('Unexpected generic order');},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:bps,proposalTtlSeconds:180,pairlensUrl:'http://localhost'},()=>now);
 let calls=0;let payload:Record<string,unknown>={};
 const service=new HyperliquidNativeTwap(desk,{perform:async(action,input)=>{calls++;payload=input;if(fail)throw new Error('network');return {status:'accepted',connector_name:'hyperliquid_perpetual',trading_pair:'GRAM-USD',...(action==='hyperliquid-twap'?{twap_id:'123'}:{twap_id:input.twap_id})};}},markets,()=>now);
 const plan={requestId:randomUUID(),proposedAt:now,credentialId:'hl',connectionRevision:'a'.repeat(64),accountName:'desk',mode:'live',venue:'hyperliquid',marketType:'perpetual',symbol:'GRAM-USDC',action:'create',side:'buy',size:'60',durationMinutes:5,randomize:false,reduceOnly:false,acceptNativeRisk:true,referenceNotionalBudget:'124'};
 return {store,desk,service,plan,markets,now,calls:()=>calls,payload:()=>payload};
}

test('accepted native TWAP receipt survives a protection binding failure and never replays the entry',async()=>{
 const s=setup();let submissions=0;
 class BindingFailure extends AdvancedProtection { override bindEntry(){throw Error('Local binding unavailable');} }
 const protection=new BindingFailure(':memory:',{authorize:()=>{},previewExit:async()=>({notional:'1'}),submitPair:async()=>{throw Error('Unexpected protection submission');},exitEvidence:async()=>({status:'pending'}),cancelExit:async()=>{throw Error('Unexpected cancellation');},stopEntry:async()=>false});
 try{
  const service=new HyperliquidNativeTwap(s.desk,{perform:async()=>{submissions++;return {status:'accepted',connector_name:'hyperliquid_perpetual',trading_pair:'GRAM-USD',twap_id:'123'};}},s.markets,()=>s.now,protection);
  const plan={...s.plan,protection:{activation:'after-full-entry-fill',management:'managed',stopLossPrice:'1.8',takeProfits:[{price:'2.2',sizePercent:'100'}],maxExitNotional:'250'}};
  const result=await service.execute(plan);
  assert.equal(result.status,'accepted');assert.match(JSON.stringify(result.result),/binding pending/i);
  assert.equal(s.store.operation(plan.requestId)?.state,'completed');
  assert.equal(service.recoverOwnedEntry(protection.get(plan.requestId).input),'123');
  assert.equal((await service.execute(plan)).status,'accepted');assert.equal(submissions,1);
 }finally{protection.close();s.store.close();}
});

test('native TWAP checks fresh collateral and revalidates scope before any submission',async()=>{
 const s=setup();let submissions=0;
 try{
  const client={perform:async()=>{submissions++;return {status:'accepted',connector_name:'hyperliquid_perpetual',trading_pair:'GRAM-USD',twap_id:'123'};}};
  const low=new HyperliquidNativeTwap(s.desk,client,s.markets,()=>s.now,undefined,async()=>[{currency:'USDC',available:'10'}]);
  const plan={...s.plan,leverage:5,marginMode:'cross'};
  await assert.rejects(low.execute(plan),/available margin/);assert.equal(submissions,0);
  const changed=new HyperliquidNativeTwap(s.desk,client,s.markets,()=>s.now,undefined,async()=>{s.store.setConnectionFingerprint('desk','hyperliquid','b'.repeat(64));return [{currency:'USDC',available:'100'}];});
  await assert.rejects(changed.execute(plan),/revision changed/);assert.equal(submissions,0);
  assert.equal(s.store.operation(plan.requestId),null);
  s.store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));
  const funded=new HyperliquidNativeTwap(s.desk,client,s.markets,()=>s.now,undefined,async()=>[{currency:'USD',available:'100'}]);
  assert.equal((await funded.execute(plan)).status,'accepted');assert.equal(submissions,1);
 }finally{s.store.close();}
});
test('native TWAP activity lists only bounded owned accepted receipts without calling the exchange',async()=>{
 const s=setup();try{
  await s.service.execute(s.plan);
  const before=s.calls(),used=s.store.used('live',new Date(s.now).toISOString().slice(0,10));
  for(const [state,patch] of [['unknown',{}],['completed',{trading_pair:'BTC-USD'}],['completed',{reviewedPlan:{...s.plan,requestId:randomUUID()}}],['completed',{reviewedPlan:{...s.plan,extra:true}}]] as const){
   const id=randomUUID();s.store.claimOperation(id,id);s.store.finishOperation(id,state,{status:'accepted',connector_name:'hyperliquid_perpetual',trading_pair:'GRAM-USD',twap_id:'123',reviewedPlan:{...s.plan,requestId:id},...patch});
  }
  const listed=s.service.list();assert.equal(listed.runs.length,1);assert.equal(listed.runs[0]?.id,s.plan.requestId);assert.equal(listed.runs[0]?.currentAccount,true);assert.equal(listed.runs[0]?.status,'accepted');assert.equal(listed.complete,false);
  s.store.setConnectionFingerprint('desk','hyperliquid','b'.repeat(64));assert.equal(s.service.list().runs[0]?.currentAccount,false);
  assert.equal(s.calls(),before);assert.equal(s.store.used('live',new Date(s.now).toISOString().slice(0,10)),used);
  assert.equal(s.store.operations(1).length,1);assert.throws(()=>s.store.operations(501));assert.throws(()=>s.store.operations(0));
 }finally{s.store.close();}
});
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

test('HIP3 native TWAP uses canonical market and uppercase connector wire after readiness proof',async()=>{
 const now=Date.now(),store=new DeskStore(':memory:');store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));
 const markets={list:async()=>[{venue:'hyperliquid' as const,symbol:'para:PAPER-USDC',base:'para:PAPER',dex:'para',coin:'para:PAPER',assetId:180038,quote:'USDC',collateralToken:0,onlyIsolated:true,maxLeverage:3,price:'2',change24h:0,volume24h:'1',fundingRate:0,openInterest:null,sizeDecimals:3,priceDecimals:2,minSize:'0.001',minNotional:'10',updatedAt:now}]};
 let proofs=0,calls=0,collateralSymbol:unknown;
 const desk=new TradingDesk(store,markets,{configured:true,validateBuilderMarket:async market=>{assert.equal(market.coin,'para:PAPER');proofs++;},place:async()=>{throw Error('No generic order');},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:300,proposalTtlSeconds:180,pairlensUrl:'http://localhost'},()=>now);
 const service=new HyperliquidNativeTwap(desk,{perform:async(_action,input)=>{calls++;assert.equal(input.trading_pair,'PARA:PAPER-USD');return {status:'accepted',connector_name:'hyperliquid_perpetual',trading_pair:'PARA:PAPER-USD',twap_id:'123'};}},markets,()=>now,undefined,async symbol=>{collateralSymbol=symbol;return [{currency:'USDC',available:'150'}];});
 try{
 const plan={requestId:randomUUID(),proposedAt:now,credentialId:'hl',connectionRevision:'a'.repeat(64),accountName:'desk',mode:'live',venue:'hyperliquid',marketType:'perpetual',symbol:'para:PAPER-USDC',action:'create',side:'buy',size:'60',durationMinutes:5,randomize:false,reduceOnly:false,acceptNativeRisk:true,referenceNotionalBudget:'124',leverage:3,marginMode:'isolated'};
 const result=await service.execute(plan);
 assert.equal(result.status,'accepted');assert.equal(collateralSymbol,'para:PAPER-USDC');assert.ok(proofs>0);assert.equal(calls,1);assert.equal(service.list().runs[0]?.symbol,'para:PAPER-USDC');
 const unverified=new HyperliquidNativeTwap(desk,{perform:async()=>{calls++;throw Error('Must not submit');}},markets,()=>now,undefined,async()=>{throw Error('Builder collateral unverified');});
 await assert.rejects(unverified.execute({...plan,requestId:randomUUID()}),/unverified/);assert.equal(calls,1);
 const unavailable=new HyperliquidNativeTwap(desk,{perform:async()=>{calls++;throw Error('Must not submit');}},markets,()=>now);
 await assert.rejects(unavailable.execute({...plan,requestId:randomUUID()}),/collateral.*unverified/);assert.equal(calls,1);
 }finally{store.close();}
});
