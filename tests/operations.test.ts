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
const leverage={requestId:'operation-identifier',venue:'hyperliquid',marketType:'perpetual',symbol:'BTC-USDC',mode:'live',action:'leverage',leverage:3,marginMode:'isolated'};
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
