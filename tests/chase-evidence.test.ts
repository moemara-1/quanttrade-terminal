import test from 'node:test';
import assert from 'node:assert/strict';
import { HummingbotExecution } from '../src/server/execution.ts';
import type { OrderDraft } from '../src/shared/types.ts';

const order:OrderDraft={venue:'lighter',symbol:'GRAM-USDC',side:'buy',type:'limit',price:'1',size:'10',rationale:'reviewed'};
test('Chase resolves owned Lighter client identity and explicit cancelled partial quantity',async()=>{
  let state='open';
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(url)=>{
    const path=new URL(String(url)).pathname;
    if(path==='/trading/orders/search')return Response.json({data:[{order_id:'client',account_name:'desk',connector_name:'lighter_perpetual',trading_pair:'GRAM-USDC',exchange_order_id:'42'}],pagination:{has_more:false}});
    return Response.json({connector_name:'lighter_perpetual',trading_pair:'GRAM-USDC',open_orders:state==='open'?[{client_order_index:'42',exchange_order_id:'987',status:'open',initial_base_amount:'10',filled_base_amount:'2',is_ask:false}]:[],order_history:state==='open'?[]:[{client_order_index:'42',exchange_order_id:'987',status:state,initial_base_amount:'10',filled_base_amount:'2',is_ask:false}]});
  });
  assert.deepEqual(await client.chaseEvidence(order,'client'),{status:'open',exchangeId:'987',filledSize:'2'});
  state='canceled';assert.deepEqual(await client.chaseEvidence(order,'client'),{status:'settled',exchangeId:'987',filledSize:'2'});
});
test('Chase never infers zero or accepts mismatched or ambiguous Lighter orders',async()=>{
  for(const rows of [
    [{exchange_order_id:'987',status:'canceled',initial_base_amount:'10'}],
    [{exchange_order_id:'987',status:'canceled',initial_base_amount:'11',filled_base_amount:'0'}],
    [{exchange_order_id:'987',status:'canceled',initial_base_amount:'10',filled_base_amount:'11'}],
    [{exchange_order_id:'987',status:'canceled',initial_base_amount:'10',filled_base_amount:'0',is_ask:true}],
  ]){
    const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async()=>Response.json({connector_name:'lighter_perpetual',trading_pair:'GRAM-USDC',open_orders:[],order_history:rows}));
    assert.equal((await client.chaseEvidence(order,'native:lighter:987')).status,'pending');
  }
});
test('Chase accepts authoritative explicit cancelled zero and rejects unscoped generic identities',async()=>{
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(url)=>new URL(String(url)).pathname==='/trading/orders/search'?Response.json({data:[{order_id:'other',account_name:'other',connector_name:'lighter_perpetual',trading_pair:'GRAM-USDC',exchange_order_id:'987'}],pagination:{has_more:false}}):Response.json({connector_name:'lighter_perpetual',trading_pair:'GRAM-USDC',open_orders:[],order_history:[{exchange_order_id:'987',status:'canceled',initial_base_amount:'10',filled_base_amount:'0'}]}));
  assert.deepEqual(await client.chaseEvidence(order,'native:lighter:987'),{status:'settled',exchangeId:'987',filledSize:'0'});
  assert.deepEqual(await client.chaseEvidence({...order,venue:'hyperliquid'},'client'),{status:'pending'});
});
test('Chase walks history pages and refuses ambiguous client-to-native mappings',async()=>{
  for(const ambiguous of [false,true]){
    let reads=0;
    const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async()=>{
      reads++;
      return Response.json({connector_name:'lighter_perpetual',trading_pair:'GRAM-USDC',open_orders:[],order_history:reads===1?(ambiguous?[{client_order_index:'42',exchange_order_id:'986',status:'canceled',initial_base_amount:'10',filled_base_amount:'0'}]:[]):[{client_order_index:'42',exchange_order_id:'987',status:'canceled',initial_base_amount:'10',filled_base_amount:'0'}],history_next_cursor:reads===1?'page2':null});
    });
    assert.deepEqual(await client.chaseEvidence(order,'native-client:lighter:42'),ambiguous?{status:'pending'}:{status:'settled',exchangeId:'987',filledSize:'0'});
    assert.equal(reads,2);
  }
});
test('Chase Hyperliquid validates returned native identity and exact cumulative quantity',async()=>{
  for(const evidence of [{status:'open',exchangeId:'11',filledSize:'2'},{status:'open',exchangeId:'11'},{status:'settled',exchangeId:'11',filledSize:'2'},{status:'settled',exchangeId:'11',filledSize:'11'},{status:'settled',exchangeId:'12',filledSize:'0'},{status:'settled',exchangeId:'11'}]){
    const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(url,init)=>{
      assert.equal(new URL(String(url)).pathname,'/quanttrade/trading/settled-order-evidence');
      assert.equal(JSON.parse(String(init?.body)).amount,'10');return Response.json(evidence);
    });
    const result=await client.chaseEvidence({...order,venue:'hyperliquid'},'native:hyperliquid:11');
    assert.deepEqual(result,evidence.exchangeId==='11'&&evidence.filledSize==='2'?evidence:{status:'pending'});
  }
});

test('owned conditional exits expose exact open fills and reject missing conflicting oversized evidence',async()=>{
 for(const venue of ['lighter','hyperliquid'] as const)for(const quantity of ['2',undefined,'11','conflict']){
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async()=>Response.json(venue==='hyperliquid'?{status:'open',exchangeId:'11',filledSize:quantity}:{connector_name:'lighter_perpetual',trading_pair:order.symbol,open_orders:[{exchange_order_id:'11',status:'open',initial_base_amount:'10',filled_base_amount:quantity,is_ask:false},...(quantity==='conflict'?[{exchange_order_id:'11',status:'open',initial_base_amount:'10',filled_base_amount:'1',is_ask:false}]:[])],order_history:[]}));
  const result=await client.chaseEvidence({...order,venue,trigger:{triggerPrice:'1.1',triggerType:'tp'},reduceOnly:true},'native:'+venue+':11');
  assert.deepEqual(result,quantity==='2'?{status:'open',exchangeId:'11',filledSize:'2'}:{status:'pending'});
 }
});
