import test from 'node:test';
import assert from 'node:assert/strict';
import { TradingDesk } from '../src/server/trading.ts';
import { DeskStore } from '../src/server/store.ts';
import { HummingbotOperations, VenueOperations } from '../src/server/operations.ts';

function setup(fail=false) {
  const store=new DeskStore(':memory:');
  const desk=new TradingDesk(store,{list:async()=>[]},{configured:true,place:async()=>{throw new Error('No orders allowed in this test');},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost'});
  let calls=0;let payload:Record<string,unknown>={};
  const operations=new VenueOperations(desk,{perform:async(_action,input)=>{calls++;payload=input;if(fail)throw new Error('transport');return {status:'accepted',leverage:3};}},{list:async()=>[{venue:'hyperliquid',symbol:'BTC-USDC',base:'BTC',maxLeverage:40,price:'100',change24h:0,volume24h:'1',fundingRate:0,openInterest:null,sizeDecimals:3,priceDecimals:2,minSize:'0.001',minNotional:'1',updatedAt:Date.now()}]});
  return {store,desk,operations,calls:()=>calls,payload:()=>payload};
}

test('kill switch during leverage metadata read blocks the exchange mutation',async()=>{
 const state=setup();try {
  let calls=0;
  const operations=new VenueOperations(state.desk,{perform:async()=>{calls++;return {status:'accepted'};}},{list:async()=>{
   state.store.halted=true;
   return [{venue:'hyperliquid',symbol:'BTC-USDC',base:'BTC',maxLeverage:40,price:'100',change24h:0,volume24h:'1',fundingRate:0,openInterest:null,sizeDecimals:3,priceDecimals:2,minSize:'0.001',minNotional:'1',updatedAt:Date.now()}];
  }});
  await assert.rejects(operations.execute(leverage),/halted/);assert.equal(calls,0);
 }finally{state.store.close();}
});
const leverage={requestId:'operation-identifier',venue:'hyperliquid',marketType:'perpetual',symbol:'BTC-USDC',mode:'live',action:'leverage',leverage:3,marginMode:'isolated'};
test('reviewed amendments bind account and connection and reject stale scope before mutation',async()=>{
 const s=setup();try{
  s.store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));
  const amendment={requestId:'amend-reviewed-identifier',venue:'hyperliquid',marketType:'perpetual',symbol:'BTC-USDC',mode:'live',action:'amend',exchangeOrderId:'14918173922809911',amount:'1',price:'100',accountName:'desk',connectionRevision:'a'.repeat(64),proposedAt:Date.now()};
  assert.equal((await s.operations.execute(amendment)).status,'accepted');assert.equal(s.calls(),1);
  for(const patch of [{accountName:'other'},{connectionRevision:'b'.repeat(64)},{proposedAt:Date.now()-200000}])await assert.rejects(s.operations.execute({...amendment,requestId:'another-amend-reviewed-id',...patch}),/Reviewed/);
  assert.equal(s.calls(),1);
 }finally{s.store.close();}
});
test('native order reads preserve verified total size separately from remaining size',async()=>{
 const s=setup();try{
  s.store.setConnectionFingerprint('desk','lighter','a'.repeat(64));
  const operations=new VenueOperations(s.desk,{perform:async()=>({connector_name:'lighter_perpetual',scope:'all-perpetual-markets',complete:true,orders:[{symbol:'BTC-USDC',exchangeOrderId:'14918173922809911',size:'60',totalSize:'100',type:'limit'}]})},{list:async()=>[]});
  const book=await operations.openOrders({venue:'lighter',marketType:'perpetual'});assert.equal(book.orders[0]?.size,'60');assert.equal(book.orders[0]?.totalSize,'100');
 }finally{s.store.close();}
});
test('exchange mutations keep exact account/pair and durable duplicate keys cannot resubmit',async()=>{
  const state=setup();try {
    assert.equal((await state.operations.execute(leverage)).status,'accepted');
    assert.equal((await state.operations.execute(leverage)).status,'accepted');assert.equal(state.calls(),1);
    assert.deepEqual(state.payload(),{account_name:'desk',connector_name:'hyperliquid_perpetual',trading_pair:'BTC-USD',request_id:'operation-identifier',leverage:3,margin_mode:'isolated'});
    await assert.rejects(state.operations.execute({...leverage,leverage:4}),/different/);
  } finally {state.store.close();}
});
test('uncertain exchange mutation is not retried after transport failure',async()=>{
  const state=setup(true);try {
    assert.equal((await state.operations.execute(leverage)).status,'unknown');
    assert.equal((await state.operations.execute(leverage)).status,'unknown');assert.equal(state.calls(),1);
  } finally {state.store.close();}
});
test('paper, spot leverage and excess amendment budget fail before submission',async()=>{
  const state=setup();try {
    await assert.rejects(state.operations.execute({...leverage,marketType:'spot'}),/Spot/);
    state.desk.setVenueMode('hyperliquid','paper');await assert.rejects(state.operations.execute(leverage),/Live/);
    state.desk.setVenueMode('hyperliquid','live');
    await assert.rejects(state.operations.execute({requestId:'amendment-identifier',venue:'hyperliquid',symbol:'BTC-USDC',mode:'live',action:'amend',exchangeOrderId:'123',amount:'100',price:'100'}),/notional/);
    await assert.rejects(state.operations.execute({requestId:'amendment-low-limit',venue:'hyperliquid',symbol:'BTC-USDC',mode:'live',action:'amend',exchangeOrderId:'123',amount:'100',price:'1'}),/notional/);
    assert.equal(state.calls(),0);
  } finally {state.store.close();}
});

test('market leverage operations reject the current contract cap before invoking exchange',async()=>{
 const state=setup();try {
  await assert.rejects(state.operations.execute({...leverage,requestId:'over-market-cap-operation',leverage:50}),/maximum leverage is 40x/);
  assert.equal(state.calls(),0);
 } finally {state.store.close();}
});

test('native operation reaches the installed Lighter Python route with the exact reviewed payload',async()=>{
 const payload={request_id:'approved-native-plan',connector_name:'lighter_perpetual',trading_pair:'GRAM-USDC',grouping:'single',legs:[]};let path='',body='';
 const client=new HummingbotOperations({url:'http://127.0.0.1:8000',username:'test',password:'test',accountName:'desk'},async(url,init)=>{path=new URL(String(url)).pathname;body=String(init?.body);return new Response(JSON.stringify({status:'accepted'}),{status:200,headers:{'Content-Type':'application/json'}});});
 await client.perform('native-orders',payload);assert.equal(path,'/quanttrade/trading/lighter-native-orders');assert.deepEqual(JSON.parse(body),payload);
});

test('native open orders preserve exact account revision and never claim or reserve operations',async()=>{
 const state=setup();try {
  const revision='a'.repeat(64);state.store.setConnectionFingerprint('desk','lighter',revision);
  const operations=new VenueOperations(state.desk,{perform:async(action,input)=>{
   assert.equal(action,'open-orders');assert.deepEqual(input,{account_name:'desk',connector_name:'lighter_perpetual'});
   return {connector_name:'lighter_perpetual',scope:'all-perpetual-markets',complete:true,orders:[{symbol:'GRAM-USDC',exchangeOrderId:'14918173922809911',side:'sell',reduceOnly:true}]};
  }},{list:async()=>[]});
  const result=await operations.openOrders({venue:'lighter',marketType:'perpetual'});
  assert.equal(result.connectionRevision,revision);assert.equal(result.orders[0]?.exchangeOrderId,'14918173922809911');assert.equal(state.store.used('live',new Date().toISOString().slice(0,10)),'0');
 }finally{state.store.close();}
});

test('native open orders reject provider failures, wrong scope and credentials changed during read',async()=>{
 const state=setup();try {
  state.store.setConnectionFingerprint('desk','lighter','a'.repeat(64));
  for(const result of [{connector_name:'hyperliquid_perpetual',scope:'all-perpetual-markets',complete:true,orders:[]},{connector_name:'lighter_perpetual',scope:'all-perpetual-markets',complete:true,orders:[{symbol:'GRAM-USDC',exchangeOrderId:'client:123'}]}]){
   const operations=new VenueOperations(state.desk,{perform:async()=>result},{list:async()=>[]});await assert.rejects(operations.openOrders({venue:'lighter'}));
  }
  const changed=new VenueOperations(state.desk,{perform:async()=>{state.store.setConnectionFingerprint('desk','lighter','b'.repeat(64));return {connector_name:'lighter_perpetual',scope:'all-perpetual-markets',complete:true,orders:[]};}},{list:async()=>[]});
  await assert.rejects(changed.openOrders({venue:'lighter'}),/changed/);
  const failed=new VenueOperations(state.desk,{perform:async()=>{throw Error('read failed');}},{list:async()=>[]});await assert.rejects(failed.openOrders({venue:'lighter'}),/read failed/);
 }finally{state.store.close();}
});

test('reviewed cancellation rejects stale or changed account before exchange call',async()=>{
 const state=setup();try {
  const revision='a'.repeat(64);state.store.setConnectionFingerprint('desk','lighter',revision);
  const cancel={requestId:'reviewed-cancellation',venue:'lighter',marketType:'perpetual',symbol:'GRAM-USDC',mode:'live',action:'cancel',exchangeOrderId:'14918173922809911',accountName:'desk',connectionRevision:revision,proposedAt:Date.now()};
  await assert.rejects(state.operations.execute({...cancel,accountName:'other'}),/account/);
  await assert.rejects(state.operations.execute({...cancel,proposedAt:Date.now()-181000}),/expired/);
  await assert.rejects(state.operations.execute({...cancel,connectionRevision:'b'.repeat(64)}),/connection/);
  await assert.rejects(state.operations.execute({...cancel,proposedAt:undefined}));assert.equal(state.calls(),0);
  assert.equal((await state.operations.execute(cancel)).status,'accepted');assert.equal(state.calls(),1);
 }finally{state.store.close();}
});

test('native open-order read preserves partial scope and hides provider response secrets',async()=>{
 const state=setup();try {
  state.store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));
  const operations=new VenueOperations(state.desk,{perform:async()=>({connector_name:'hyperliquid_perpetual',scope:'standard-perpetual-markets',complete:false,error:'Builder markets excluded',orders:[]})},{list:async()=>[]});
  const result=await operations.openOrders({venue:'hyperliquid'});assert.equal(result.complete,false);assert.equal(result.error,'Builder markets excluded');
  const client=new HummingbotOperations({url:'http://127.0.0.1:8000',username:'test',password:'test',accountName:'desk'},async()=>new Response('PRIVATE_SECRET',{status:503}));
  await assert.rejects(client.perform('open-orders',{}),(error:unknown)=>error instanceof Error&&error.message.includes('HTTP 503')&&!error.message.includes('PRIVATE_SECRET'));
 }finally{state.store.close();}
});
