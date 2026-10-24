import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DeskStore } from '../src/server/store.ts';
import { TradingDesk } from '../src/server/trading.ts';
import { LighterNativeOrders } from '../src/server/lighter-native-orders.ts';

function setup(fail=false){
  const now=Date.now(),store=new DeskStore(':memory:');store.setConnectionFingerprint('desk','lighter','a'.repeat(64));
  const markets={list:async()=>[{venue:'lighter' as const,symbol:'GRAM-USDC',marketId:9,maxLeverage:20,base:'GRAM',price:'2',change24h:0,volume24h:'1',fundingRate:0,openInterest:null,sizeDecimals:3,priceDecimals:2,minSize:'0.001',minNotional:'0.001',updatedAt:now}]};
  const desk=new TradingDesk(store,markets,{configured:true,place:async()=>{throw new Error('No generic execution');},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:100,proposalTtlSeconds:180,pairlensUrl:'http://localhost'},()=>now);
  let calls=0,payload:Record<string,unknown>={};
  const service=new LighterNativeOrders(desk,{perform:async(action,input)=>{if(action==='snapshot')return {connector_name:'lighter_perpetual',trading_pair:'GRAM-USDC',account:{accounts:[{index:12,positions:[{market_id:9,position:'3',sign:1}]}]}};calls++;payload=input;if(fail)throw new Error('transport');return {status:'accepted',grouping:input.grouping,connector_name:'lighter_perpetual',trading_pair:'GRAM-USDC',client_order_ids:(input.legs as unknown[]).map((_,i)=>String(i+1)),tx_hash:'tx'};}},markets,()=>now);
  const plan={requestId:randomUUID(),proposedAt:now,credentialId:'device-lighter',connectionRevision:'a'.repeat(64),accountName:'desk',mode:'live',venue:'lighter',marketType:'perpetual',symbol:'GRAM-USDC',grouping:'single',legs:[{side:'buy',type:'market',amount:'3',price:'2.02',reduceOnly:false,timeInForce:'ioc'}]};
  return {store,desk,service,markets,plan,calls:()=>calls,payload:()=>payload,now};
}
test('native preflight validates the exact plan without claiming, reserving or submitting',async()=>{
 const s=setup();try{const preview=await s.service.preview(s.plan);assert.deepEqual(preview.plan,s.plan);assert.equal(preview.initialMargin,null);assert.equal(preview.marginStatus,'unknown');assert.equal(s.calls(),0);assert.equal(s.store.used('live',new Date(s.now).toISOString().slice(0,10)),'0');assert.equal((await s.service.execute(s.plan)).status,'accepted');assert.equal(s.calls(),1);}finally{s.store.close();}
});
test('native preflight rejects invalid child amount, time-in-force and expiry before card',async()=>{
 const s=setup();try{for(const patch of [{legs:[{...s.plan.legs[0],type:'sl-market',triggerPrice:'2',timeInForce:'gtt'}]},{legs:[{...s.plan.legs[0],expiry:s.now+2592000001}]},{grouping:'oto',legs:[s.plan.legs[0],{side:'sell',type:'sl-market',amount:'1',price:'1.77',triggerPrice:'1.78',reduceOnly:true,timeInForce:'ioc'}]}])await assert.rejects(s.service.preview({...s.plan,...patch}));assert.equal(s.calls(),0);}finally{s.store.close();}
});
test('native explicit leverage uses conservative actual opening exposure and fresh available margin',async()=>{
 const s=setup();try{let available='100';const service=new LighterNativeOrders(s.desk,{perform:async()=>{throw Error('No writes');}},s.markets,()=>s.now,async()=>[{currency:'USDC',available}]);const plan={...s.plan,leverage:1,marginMode:'cross'};const preview=await service.preview(plan);assert.equal(preview.openingNotional,'6.06');assert.equal(preview.initialMargin,'6.06');assert.equal(preview.availableMargin,'100');assert.equal(preview.marginStatus,'verified');available='5';await assert.rejects(service.preview(plan),/available margin/);await assert.rejects(service.execute(plan),/available margin/);}finally{s.store.close();}
});
test('preflight checks daily exposure without creating an operation claim',async()=>{
 const s=setup();try{s.store.reserveOperation('used-limit','live',new Date(s.now).toISOString().slice(0,10),'2000','2000');await assert.rejects(s.service.preview(s.plan),/Daily notional limit exceeded/);assert.equal(s.store.claimOperation(s.plan.requestId,'unclaimed-preview'),null);assert.equal(s.calls(),0);}finally{s.store.close();}
});
test('reduce-only preview needs no free collateral and does not block closing on unavailable or negative balances',async()=>{
 const s=setup();try{for(const failure of ['negative','unavailable']){let reads=0;const service=new LighterNativeOrders(s.desk,{perform:async()=>{throw Error('No writes');}},s.markets,()=>s.now,async()=>{reads++;if(failure==='unavailable')throw Error('Balance unavailable');return [{currency:'USDC',available:'-10'}];});const plan={...s.plan,legs:[{...s.plan.legs[0],side:'sell',reduceOnly:true,price:'1.98'}]};const reviewed=await service.preview(plan);assert.equal(reviewed.openingNotional,'0');assert.equal(reviewed.initialMargin,'0');assert.equal(reviewed.availableMargin,null);assert.equal(reviewed.marginStatus,'unknown');assert.equal(reads,0);assert.equal(s.calls(),0);await assert.rejects(service.preview(s.plan),/available margin|Balance unavailable/);assert.equal(reads,1);}}finally{s.store.close();}
});
test('native approval pins account, revision, TTL, exact wire fields and reserves the complete plan once',async()=>{
 const s=setup();try{assert.equal((await s.service.execute(s.plan)).status,'accepted');assert.equal((await s.service.execute(s.plan)).status,'accepted');assert.equal(s.calls(),1);assert.equal(s.payload().account_name,'desk');assert.equal(s.payload().request_id,s.plan.requestId);assert.equal(s.payload().connector_name,'lighter_perpetual');assert.equal(s.store.used('live',new Date(s.now).toISOString().slice(0,10)),'6.06');await assert.rejects(s.service.execute({...s.plan,legs:[{...s.plan.legs[0],amount:'4'}]}),/different/);}finally{s.store.close();}
});
test('native approval rejects paper, stale account/key/time and unsupported topology without mutation',async()=>{
 const s=setup();try{for(const patch of [{mode:'paper'},{accountName:'other'},{connectionRevision:'b'.repeat(64)},{proposedAt:s.now-180001},{grouping:'otoco'}])await assert.rejects(s.service.execute({...s.plan,...patch}));assert.equal(s.calls(),0);}finally{s.store.close();}
});
test('uncertain native acknowledgment is journaled and never retried',async()=>{
 const s=setup(true);try{assert.equal((await s.service.execute(s.plan)).status,'unknown');assert.equal((await s.service.execute(s.plan)).status,'unknown');assert.equal(s.calls(),1);}finally{s.store.close();}
});
test('attached zero-size exits reserve effective parent exposure and match exact native grouping',async()=>{
 const s=setup();try{const plan={...s.plan,grouping:'otoco',leverage:5,marginMode:'cross',legs:[s.plan.legs[0],{side:'sell',type:'sl-market',amount:'0',price:'1.77',triggerPrice:'1.78',reduceOnly:true,timeInForce:'ioc'},{side:'sell',type:'tp-market',amount:'0',price:'2.17',triggerPrice:'2.18',reduceOnly:true,timeInForce:'ioc'}]};assert.equal((await s.service.execute(plan)).status,'accepted');assert.deepEqual((s.payload().legs as Record<string,unknown>[]).map(leg=>leg.type),['market','tp-market','sl-market']);assert.equal((s.payload().legs as Record<string,unknown>[])[1]?.amount,'0');assert.equal(s.payload().margin_mode,'cross');assert(Number(s.store.used('live',new Date(s.now).toISOString().slice(0,10)))>18);}finally{s.store.close();}
});
test('zero native OCO requires reviewed position size matching a fresh same-market position',async()=>{
 const s=setup();try{const plan={...s.plan,grouping:'oco',positionSize:'3',legs:[{side:'sell',type:'sl-market',amount:'0',price:'1.77',triggerPrice:'1.78',reduceOnly:true,timeInForce:'ioc'},{side:'sell',type:'tp-market',amount:'0',price:'2.17',triggerPrice:'2.18',reduceOnly:true,timeInForce:'ioc'}]};await assert.rejects(s.service.execute({...plan,positionSize:'4'}),/position/);assert.equal((await s.service.execute(plan)).status,'accepted');assert.equal(s.calls(),1);}finally{s.store.close();}
});
test('native TWAP maps duration and GTT while rejecting incompatible time-in-force before submission',async()=>{
 const s=setup();try{const plan={...s.plan,legs:[{...s.plan.legs[0],type:'twap',timeInForce:'gtt',durationSeconds:300}]};await assert.rejects(s.service.execute({...plan,legs:[{...plan.legs[0],timeInForce:'ioc'}]}),/TWAP/);assert.equal((await s.service.execute(plan)).status,'accepted');assert.equal((s.payload().legs as Record<string,unknown>[])[0]?.duration_seconds,300);assert.equal((s.payload().legs as Record<string,unknown>[])[0]?.time_in_force,'gtt');}finally{s.store.close();}
});
test('every native base order type maps conditional values and no acknowledgment is represented as a fill',async()=>{
 for(const type of ['limit','sl-market','sl-limit','tp-market','tp-limit']){const s=setup();try{const conditional=type.startsWith('sl-')||type.startsWith('tp-');const leg={...s.plan.legs[0],type,timeInForce:type.endsWith('limit')?'gtt':'ioc',...(conditional?{triggerPrice:'2'}:{})};const result=await s.service.execute({...s.plan,legs:[leg]});assert.equal(result.status,'accepted');assert(!('fillPrice' in result));assert.equal((s.payload().legs as Record<string,unknown>[])[0]?.trigger_price,conditional?'2':undefined);}finally{s.store.close();}}
});
test('native exact risk limits, market leverage cap and protection bounds reject before sending',async()=>{
 const s=setup();try{for(const patch of [{leverage:21,marginMode:'cross'},{legs:[{...s.plan.legs[0],amount:'1000'}]},{legs:[{...s.plan.legs[0],price:'3'}]},{legs:[{...s.plan.legs[0],amount:'0'}]}])await assert.rejects(s.service.execute({...s.plan,...patch}));s.desk.setHalted(true);await assert.rejects(s.service.execute(s.plan),/enabled/);assert.equal(s.calls(),0);}finally{s.store.close();}
});
test('daily reservation failure reports its real cause before any native submission',async()=>{
 const s=setup();try{s.store.reserveOperation('used-limit','live',new Date(s.now).toISOString().slice(0,10),'2000','2000');await assert.rejects(s.service.execute(s.plan),/Daily notional limit exceeded/);assert.equal(s.calls(),0);assert.equal((await s.service.execute(s.plan)).status,'unknown');assert.equal(s.calls(),0);}finally{s.store.close();}
});
test('mismatched native acknowledgment never claims acceptance and its request is not retried',async()=>{
 const s=setup();let calls=0;try{const service=new LighterNativeOrders(s.desk,{perform:async()=>{calls++;return {status:'accepted',grouping:'single',connector_name:'lighter_perpetual',trading_pair:'OTHER-USDC',client_order_ids:['1'],tx_hash:'tx'};}},s.markets,()=>s.now);assert.equal((await service.execute(s.plan)).status,'unknown');assert.equal((await service.execute(s.plan)).status,'unknown');assert.equal(calls,1);}finally{s.store.close();}
});
test('keys changed during asynchronous native preview invalidate the reviewed revision before sending',async()=>{
 const s=setup();let reads=0,calls=0;try{const markets={list:async()=>{reads++;if(reads===2)s.store.setConnectionFingerprint('desk','lighter','b'.repeat(64));return s.markets.list();}};const desk=new TradingDesk(s.store,markets,{configured:true,place:async()=>{throw new Error('Unexpected execution');},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:100,proposalTtlSeconds:180,pairlensUrl:'http://localhost'},()=>s.now);const service=new LighterNativeOrders(desk,{perform:async()=>{calls++;throw new Error('Unexpected native submission');}},markets,()=>s.now);await assert.rejects(service.execute(s.plan),/revision changed/);assert.equal(calls,0);}finally{s.store.close();}
});

test('post-submit journal failure remains uncertain and never reports a pre-submission block',async()=>{
 const s=setup();const finish=s.store.finishOperation.bind(s.store);try{s.store.finishOperation=()=>{throw new Error('Database write unavailable');};const result=await s.service.execute(s.plan);assert.equal(result.status,'unknown');assert.equal(s.calls(),1);assert.match(JSON.stringify(result),/Durable status/);assert.equal((await s.service.execute(s.plan)).status,'unknown');assert.equal(s.calls(),1);}finally{s.store.finishOperation=finish;s.store.close();}
});

test('uncapped native review preserves margin validation and reservations without limiting gross turnover',async()=>{
 const s=setup();try{const desk=new TradingDesk(s.store,s.markets,{configured:true,place:async()=>{throw Error('Unexpected generic order');},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:null,dailyNotionalLimit:null,maxPriceDeviationBps:100,proposalTtlSeconds:180,pairlensUrl:'http://localhost'},()=>s.now);const day=new Date(s.now).toISOString().slice(0,10);s.store.reserveOperation('prior-turnover','live',day,'6000',null);let calls=0,available='3000';const service=new LighterNativeOrders(desk,{perform:async()=>{calls++;return {status:'accepted',grouping:'single',connector_name:'lighter_perpetual',trading_pair:'GRAM-USDC',client_order_ids:['99'],tx_hash:'test-only'};}},s.markets,()=>s.now,async()=>[{currency:'USDC',available}]);const plan={...s.plan,leverage:1,marginMode:'cross',legs:[{...s.plan.legs[0],amount:'600'}]};const reviewed=await service.preview(plan);assert.equal(reviewed.estimatedNotional,'1212');assert.equal(calls,0);available='100';await assert.rejects(service.execute(plan),/available margin/);assert.equal(calls,0);available='3000';assert.equal((await service.execute(plan)).status,'accepted');await service.execute(plan);assert.equal(calls,1);assert.equal(s.store.used('live',day),'7212');}finally{s.store.close();}
});

test('native uncertain receipt retains safe adapter rejection and never retries',async()=>{
 const s=setup();let calls=0;try{
 const service=new LighterNativeOrders(s.desk,{perform:async()=>{calls++;throw Error('Native order rejected: expiry');}},s.markets,()=>s.now);
 const first=await service.execute(s.plan);
 assert.equal(first.status,'unknown');assert.match(JSON.stringify(first.result),/Native order rejected: expiry/);
 assert.equal((await service.execute(s.plan)).status,'unknown');assert.equal(calls,1);
 }finally{s.store.close();}
});
