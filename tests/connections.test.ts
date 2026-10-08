import test from 'node:test';
import assert from 'node:assert/strict';
import { HummingbotExecution } from '../src/server/execution.ts';

test('connection stores exact venue credentials in fixed account and returns no signing secret',async()=>{
  const calls: {path:string;body:unknown}[]=[];
  const client=new HummingbotExecution({url:'http://127.0.0.1:8000',username:'u',password:'p',accountName:'desk'},async(url,init)=>{
    calls.push({path:new URL(String(url)).pathname,body:init?.body?JSON.parse(String(init.body)):null});
    return Response.json(init?.method==='POST'?{message:'ok'}:['lighter_perpetual','lighter']);
  });
  const credentials={lighter_perpetual_l1_address:'0x'+'a'.repeat(40),lighter_perpetual_api_key_index:4,lighter_perpetual_api_private_key:'b'.repeat(80),lighter_perpetual_account_limit:'Standard'};
  await client.connect('lighter',credentials);
  assert.deepEqual(calls[0],{path:'/quanttrade/connections/desk/lighter',body:credentials});
  assert.deepEqual(await client.connections(),['lighter']);
});

test('disconnect removes only fixed-account venue credentials',async()=>{
  let path='';
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(url)=>{path=new URL(String(url)).pathname;return Response.json({message:'deleted'});});
  await client.disconnect('lighter');
  assert.equal(path,'/quanttrade/connections/desk/lighter');
});

test('reads real account collateral without submitting orders and fails on an absent snapshot',async()=>{
  let payload:unknown;
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(url,init)=>{
    assert.equal(new URL(String(url)).pathname,'/portfolio/state');payload=JSON.parse(String(init?.body));
    return Response.json({desk:{lighter_perpetual:[{token:'USDC',units:120,available_units:100}]}});
  });
  assert.deepEqual(await client.balances('lighter'),[{currency:'USDC',total:'120',available:'100',frozen:'20'}]);
  assert.deepEqual(payload,{account_names:['desk'],connector_names:['lighter_perpetual'],skip_gateway:true,refresh:true});
  const absent=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async()=>Response.json({}));
  await assert.rejects(absent.balances('lighter'),/unavailable/);
});

test('invalid credentials and arbitrary target fields are rejected before calling Hummingbot',async()=>{
  let calls=0;
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async()=>{calls++;return Response.json({});});
  await assert.rejects(client.connect('hyperliquid',{hyperliquid_perpetual_address:'bad',hyperliquid_perpetual_secret_key:'short'}));
  await assert.rejects(client.connect('lighter',{lighter_perpetual_l1_address:'0x'+'a'.repeat(40),lighter_perpetual_api_key_index:0,lighter_perpetual_api_private_key:'b'.repeat(80),lighter_perpetual_account_limit:'Standard',account_name:'attacker'}));
  assert.equal(calls,0);
});

test('credential failure does not expose downstream response or treat it as connected',async()=>{
  const secret='sensitive-secret-must-not-leak';
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async()=>Response.json({detail:secret},{status:400}));
  await assert.rejects(client.connect('hyperliquid',{hyperliquid_perpetual_mode:'api_wallet',use_vault:false,hyperliquid_perpetual_address:'0x'+'a'.repeat(40),hyperliquid_perpetual_secret_key:'b'.repeat(64)}),error=>error instanceof Error && !error.message.includes(secret));
});

test('spot balances select spot connector and legacy perpetual connections retain their status',async()=>{
  const client=new HummingbotExecution({url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'},async(url,init)=>{
    if(init?.method==='POST') {
      assert.deepEqual(JSON.parse(String(init.body)).connector_names,['hyperliquid']);
      return Response.json({desk:{hyperliquid:[{token:'UBTC',units:'1',available_units:'0.75'}]}});
    }
    return Response.json(['hyperliquid_perpetual']);
  });
  assert.deepEqual(await client.balances('hyperliquid','spot'),[{currency:'UBTC',total:'1',available:'0.75',frozen:'0.25'}]);
  assert.deepEqual(await client.connections(),['hyperliquid']);
  assert.deepEqual(await client.spotConnections(),[]);
});
