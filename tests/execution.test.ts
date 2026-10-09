import test from 'node:test';
import assert from 'node:assert/strict';
import { HummingbotExecution } from '../src/server/execution.ts';
import type { OrderDraft } from '../src/shared/types.ts';

test('Hyperliquid standalone OCO rejects instead of claiming sibling cancellation',async()=>{
  let calls=0;
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(url,init)=>{
    calls++;assert.equal(new URL(url instanceof Request?url.url:url).pathname,'/quanttrade/trading/bracket-orders');
    const body=JSON.parse(String(init?.body));assert.equal(body.trading_pair,'BTC-USD');assert.equal(body.account_name,'desk');assert.equal(body.amount,'1.001');assert.equal(body.stop_loss.execution_price,'89.01');
    return Response.json({status:'accepted',grouping:'oco',exchange_order_ids:['11','12']});
  });
  const exits:[OrderDraft,OrderDraft]=[{venue:'hyperliquid',symbol:'BTC-USDC',type:'market',side:'sell',size:'1.001',reduceOnly:true,trigger:{triggerType:'tp',triggerPrice:'110'},rationale:'approved exits'},{venue:'hyperliquid',symbol:'BTC-USDC',type:'market',side:'sell',size:'1.001',reduceOnly:true,trigger:{triggerType:'sl',triggerPrice:'90'},rationale:'approved exits'}];
  await assert.rejects(client.placeBracket(exits,['109.01','89.01'],'approved-bracket-id'),/entry-attached/);assert.equal(calls,0);
});

test('Hyperliquid entry OCO submits one exact native parent-plus-children batch',async()=>{
  let calls=0;
  const cloids=['0x'+'1'.repeat(32),'0x'+'2'.repeat(32),'0x'+'3'.repeat(32)];
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(url,init)=>{
    calls++;assert.equal(new URL(url instanceof Request?url.url:url).pathname,'/quanttrade/trading/entry-bracket-orders');
    const body=JSON.parse(String(init?.body));assert.equal(body.entry_tif,'Ioc');assert.equal(body.entry_price,'100.01');assert.equal(body.amount,'1.001');assert.equal(body.leverage,3);assert.equal(body.margin_mode,'isolated');assert.equal(body.stop_loss.execution_price,'89.01');
    return Response.json({status:'accepted',grouping:'normalTpsl',order_ids:['11',cloids[1],cloids[2]],client_order_ids:cloids,entry_order_id:'11',fill_price:'100',fill_size:'1.001'});
  });
  const entry:OrderDraft={venue:'hyperliquid',symbol:'BTC-USDC',side:'buy',type:'market',size:'1.001',leverage:3,marginMode:'isolated',rationale:'approved'};
  const tp:OrderDraft={...entry,side:'sell',reduceOnly:true,leverage:undefined,marginMode:undefined,trigger:{triggerType:'tp',triggerPrice:'110'}};
  const sl:OrderDraft={...tp,trigger:{triggerType:'sl',triggerPrice:'90'}};
  assert.deepEqual(await client.placeEntryBracket([entry,tp,sl],['100.01','109.01','89.01'],'approved-entry-bracket'),{orderId:'native-entry-oco:hyperliquid:11,'+cloids[1]+','+cloids[2],entryOrderId:'native:hyperliquid:11',fillPrice:'100',fillSize:'1.001'});
  assert.equal(calls,1);
  await assert.rejects(client.placeEntryBracket([entry,{...tp,size:'0.5'},sl],['100.01','109.01','89.01'],'approved-entry-bracket'),/same-sized/);
  await assert.rejects(client.placeEntryBracket([{...entry,marginMode:undefined},tp,sl],['100.01','109.01','89.01'],'approved-entry-bracket'),/margin/);
  assert.equal(calls,1);
});

test('Lighter OCO requires both distinct native client IDs and transaction hash',async()=>{
  const exits:[OrderDraft,OrderDraft]=[{venue:'lighter',symbol:'PRL-USDC',type:'limit',price:'1.8',side:'sell',size:'48',reduceOnly:true,trigger:{triggerType:'tp',triggerPrice:'1.8'},rationale:'approved'},{venue:'lighter',symbol:'PRL-USDC',type:'limit',price:'1.2',side:'sell',size:'48',reduceOnly:true,trigger:{triggerType:'sl',triggerPrice:'1.2'},rationale:'approved'}];
  const good=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async()=>Response.json({status:'accepted',grouping:'oco',client_order_ids:['111','222'],tx_hash:'hash'}));
  assert.equal(await good.placeBracket(exits,[undefined,undefined],'approved-bracket-id'),'native-oco:lighter:111,222');
  const bad=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async()=>Response.json({status:'accepted',grouping:'oco',client_order_ids:['111','111'],tx_hash:'hash'}));
  await assert.rejects(bad.placeBracket(exits,[undefined,undefined],'approved-bracket-id'),/distinct native/);
});

test('changing leverage without an explicit margin mode never mutates exchange state', async () => {
  let calls=0;
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async()=>{calls++;return Response.json({status:'accepted',order_id:'unexpected'});});
  await assert.rejects(client.place({venue:'lighter',symbol:'STRK-USDC',side:'buy',type:'limit',size:'100',price:'0.1',leverage:2,rationale:'test'},undefined,'missing-margin-mode'),/explicit margin mode/);
  assert.equal(calls,0);
});

test('leverage acknowledgment precedes exact order submission and failure cannot place an order',async()=>{
  const paths:string[]=[];
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(url,init)=>{
    paths.push(new URL(url instanceof Request?url.url:url).pathname);
    const body=JSON.parse(String(init?.body));
    if (paths.length===1) {assert.equal(body.margin_mode,'isolated');assert.equal(body.request_id,'proposal-identifier-lev');return Response.json({status:'accepted'});}
    return Response.json({order_id:'oid'});
  });
  const order={venue:'hyperliquid' as const,symbol:'BTC-USDC',side:'buy' as const,type:'limit' as const,price:'100',size:'1',leverage:3,marginMode:'isolated' as const,rationale:'test'};
  assert.equal(await client.place(order,undefined,'proposal-identifier'),'oid');
  assert.deepEqual(paths,['/quanttrade/trading/leverage','/quanttrade/trading/orders']);
  let calls=0;
  const failing=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async()=>{calls++;return Response.json({status:'error'});});
  await assert.rejects(failing.place(order,undefined,'failed-identifier'));assert.equal(calls,1);
});

test('native TP/SL carries the explicit bound and native identity rather than a fabricated HBot order',async()=>{
  let body:Record<string,unknown>={};
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(url,init)=>{
    assert.equal(new URL(url instanceof Request?url.url:url).pathname,'/quanttrade/trading/trigger-orders');body=JSON.parse(String(init?.body));return Response.json({status:'accepted',exchange_order_id:'123'});
  });
  const id=await client.place({venue:'hyperliquid',symbol:'BTC-USDC',side:'sell',type:'market',size:'1',reduceOnly:true,trigger:{triggerPrice:'90',triggerType:'sl'},rationale:'test'},'89.1','trigger-identifier');
  assert.equal(id,'native:hyperliquid:123');assert.equal(body.execution_price,'89.1');assert.equal(body.trigger_price,'90');assert.equal(body.reduce_only,true);
});
test('account reads collect every page and reject a repeating cursor', async () => {
  const client = new HummingbotExecution({url:'http://127.0.0.1:8000',username:'u',password:'p',accountName:'desk'}, async (_url, init) => {
    const input=JSON.parse(String(init?.body)) as {cursor?:string};
    return Response.json({data:[{order_id:input.cursor?'second':'first'}],pagination:{has_more:!input.cursor,next_cursor:input.cursor?null:'page-2'}});
  });
  const account=await client.account();
  assert.equal(account.orders.data.length,2);
  const repeating = new HummingbotExecution({url:'http://127.0.0.1:8000',username:'u',password:'p',accountName:'desk'}, async () => Response.json({data:[],pagination:{has_more:true,next_cursor:'same'}}));
  await assert.rejects(repeating.account(), /cursor/i);
});
test('Hummingbot payload maps exact decimals and venue, never agent-selected account', async () => {
  let body: unknown;
  const client = new HummingbotExecution({url:'http://127.0.0.1:8000',username:'operator',password:'test-pass',accountName:'desk'}, async (_url, init) => {
    body = JSON.parse(String(init?.body)); return Response.json({order_id:'oid-1',status:'submitted'});
  });
  assert.equal(await client.place({venue:'lighter',symbol:'BTC-USDC',side:'sell',type:'limit',price:'100',size:'0.125',rationale:'test'}),'oid-1');
  assert.deepEqual(body,{account_name:'desk',connector_name:'lighter_perpetual',trading_pair:'BTC-USDC',trade_type:'SELL',order_type:'LIMIT',amount:'0.125',price:'100',position_action:'OPEN'});
});
test('missing client order id is an error, never an assumed submission', async () => {
  const client = new HummingbotExecution({url:'http://127.0.0.1:8000',username:'operator',password:'test-pass',accountName:'desk'}, async () => Response.json({status:'submitted'}));
  await assert.rejects(client.place({venue:'hyperliquid',symbol:'BTC-USDC',side:'buy',type:'limit',price:'100',size:'1',rationale:'test'}));
});
test('refuses remote unencrypted execution service', () => {
  assert.throws(()=>new HummingbotExecution({url:'http://evil.example',username:'a',password:'b',accountName:'desk'}));
});
test('maps USDC collateral display symbol to Hummingbot Hyperliquid USD quote alias', async () => {
  let pair: unknown;
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(_url,init)=>{
    pair=JSON.parse(String(init?.body)).trading_pair;return Response.json({order_id:'hl-1'});
  });
  await client.place({venue:'hyperliquid',symbol:'BTC-USDC',side:'buy',type:'limit',price:'100',size:'1',rationale:'test'});
  assert.equal(pair,'BTC-USD');
});

test('reduce-only forwards CLOSE to both perpetual connectors', async () => {
  for (const venue of ['lighter','hyperliquid'] as const) {
    let body: Record<string,unknown> = {};
    const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async (_url,init)=>{
      body=JSON.parse(String(init?.body));return Response.json({order_id:'close-1'});
    });
    await client.place({venue,symbol:'BTC-USDC',side:'sell',type:'limit',price:'100',size:'1',reduceOnly:true,rationale:'close'});
    assert.equal(body.position_action,'CLOSE');
  }
});

test('market execution carries explicit protected price instead of widening the order', async () => {
  let payload: Record<string,unknown> = {};
  let path='';
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(url,init)=>{
    path=new URL(String(url)).pathname;payload=JSON.parse(String(init?.body));return Response.json({order_id:'bounded'});
  });
  await client.place({venue:'hyperliquid',symbol:'BTC-USDC',side:'buy',type:'market',size:'1',rationale:'buy'},'101');
  assert.equal(path,'/quanttrade/trading/market-orders');assert.equal(payload.protection_price,'101');
  await assert.rejects(client.place({venue:'lighter',symbol:'BTC-USDC',side:'buy',type:'market',size:'1',rationale:'buy'}),/protection/i);
});

test('spot limit execution preserves real quote and uses the spot connector',async()=>{
  let body:Record<string,unknown>={};
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(_url,init)=>{
    body=JSON.parse(String(init?.body));return Response.json({order_id:'spot-id'});
  });
  await client.place({venue:'hyperliquid',marketType:'spot',symbol:'PURR-USDC',type:'limit',side:'buy',size:'10',price:'1',rationale:'spot'});
  assert.equal(body.connector_name,'hyperliquid');assert.equal(body.trading_pair,'PURR-USDC');
});

test('post-only limit maps to maker order without changing price',async()=>{
  let body:Record<string,unknown>={};
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(_url,init)=>{
    body=JSON.parse(String(init?.body));return Response.json({order_id:'maker'});
  });
  await client.place({venue:'lighter',symbol:'BTC-USDC',type:'limit',side:'buy',size:'1',price:'100',postOnly:true,rationale:'maker'});
  assert.equal(body.order_type,'LIMIT_MAKER');assert.equal(body.price,'100');
});

test('workflow fill evidence is scoped to exact account/instrument and never treats accepted or partial orders as filled',async()=>{
  let state='OPEN';
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.deepEqual(body.account_names,['desk']);assert.deepEqual(body.connector_names,['lighter_perpetual']);assert.deepEqual(body.trading_pairs,['PRL-USDC']);return Response.json({data:[{order_id:'entry',account_name:'other',connector_name:'lighter_perpetual',trading_pair:'PRL-USDC',status:'FILLED',filled_amount:'999',average_fill_price:'999'},{order_id:'entry',account_name:'desk',connector_name:'lighter_perpetual',trading_pair:'PRL-USDC',status:state,filled_amount:'9.99',average_fill_price:'1.2345'}],pagination:{has_more:false,next_cursor:null}});});
  const order:OrderDraft={venue:'lighter',symbol:'PRL-USDC',side:'buy',type:'market',size:'10',rationale:'test'};
  assert.deepEqual(await client.orderEvidence(order,'entry'),{status:'pending'});state='PARTIALLY_FILLED';assert.deepEqual(await client.orderEvidence(order,'entry'),{status:'pending'});state='FILLED';assert.deepEqual(await client.orderEvidence(order,'entry'),{status:'filled',fillSize:'9.99',fillPrice:'1.2345'});state='FAILED';assert.equal((await client.orderEvidence(order,'entry')).status,'failed');
});
