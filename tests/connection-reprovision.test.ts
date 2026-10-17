import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { parseCredentials } from '../src/server/connections.ts';
import { createApp } from '../src/server/app.ts';
import { DeskStore } from '../src/server/store.ts';
import { TradingDesk } from '../src/server/trading.ts';
import type { MarketService } from '../src/server/markets.ts';

test('unchanged credential reprovision does not pause runs; mode/key changes and disconnect do',async()=>{
  const store=new DeskStore(':memory:');
  const markets:MarketService={list:async()=>[],candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()})};
  const desk=new TradingDesk(store,markets,{configured:false,place:async()=>{throw new Error('no trading');},cancel:async()=>undefined},{mode:'paper',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'https://quanttrade.example'});
  let connects=0,pauses=0,connected=false,fail=false;
  let hold:Promise<void>|undefined,release:(()=>void)|undefined,entered:(()=>void)|undefined;
  const makeApp=()=>createApp({desk,markets,agent:{prepare:async()=>({summary:'',proposal:null})},execution:{account:async()=>({positions:{data:[],pagination:{has_more:false,next_cursor:null}},orders:{data:[],pagination:{has_more:false,next_cursor:null}}}),connect:async()=>{connects++;entered?.();await hold;if(fail)throw new Error('verification failed');connected=true;},disconnect:async()=>{connected=false;},connections:async()=>connected?['lighter']:[],balances:async()=>[]},workflows:{start:async()=>{throw new Error('no workflow registration');},list:()=>[],cancel:()=>{throw new Error('no cancellation');},pauseVenue:()=>{pauses++;}},operatorToken:'operator',agentToken:'agent',allowedOrigins:['https://quanttrade.example']});
  const server=makeApp().listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();if(!address||typeof address==='string')throw new Error('No address');
  const base=`http://127.0.0.1:${address.port}`;
  const credentials={lighter_perpetual_l1_address:'0x'+'1'.repeat(40),lighter_perpetual_api_key_index:4,lighter_perpetual_api_private_key:'2'.repeat(64),lighter_perpetual_account_limit:'Standard'};
  const headers={Authorization:'Bearer operator','Content-Type':'application/json',Origin:'https://quanttrade.example'};
  const connect=async(mode='live',key=credentials.lighter_perpetual_api_private_key)=>fetch(base+'/api/connections',{method:'POST',headers,body:JSON.stringify({venue:'lighter',credentials:{...credentials,lighter_perpetual_api_private_key:key},mode})});
  try{
    const initial=await connect();assert.equal(initial.status,200);assert.equal((await initial.json()).spotConnected,false);assert.equal(pauses,1);assert.equal(connects,1);
    assert.equal(store.connectionFingerprint('desk','lighter')?.length,64);
    const restarted=makeApp().listen(0,'127.0.0.1');await once(restarted,'listening');
    try {
      const reopened=restarted.address();if(!reopened||typeof reopened==='string')throw new Error('No restarted address');
      const response=await fetch(`http://127.0.0.1:${reopened.port}/api/connections`,{method:'POST',headers,body:JSON.stringify({venue:'lighter',credentials,mode:'live'})});
      assert.equal(response.status,200);assert.equal(pauses,1);assert.equal(connects,1);
    }finally{restarted.closeAllConnections();await new Promise<void>(resolve=>restarted.close(()=>resolve()));}
    assert.equal((await connect()).status,200);assert.equal(pauses,1);assert.equal(connects,1);
    assert.equal((await connect('paper')).status,200);assert.equal(pauses,2);assert.equal(connects,1);
    assert.equal((await connect('paper','3'.repeat(64))).status,200);assert.equal(pauses,3);assert.equal(connects,2);
    assert.equal((await fetch(base+'/api/connections/lighter',{method:'DELETE',headers})).status,200);assert.equal(pauses,4);
    assert.equal((await connect('paper','3'.repeat(64))).status,200);assert.equal(pauses,5);assert.equal(connects,3);
    hold=new Promise<void>(resolve=>{release=resolve;});
    const started=new Promise<void>(resolve=>{entered=resolve;});
    const pending=connect('live','4'.repeat(64));await started;
    assert.equal((await connect('paper','3'.repeat(64))).status,409);
    for(const path of ['/api/terminal/orders','/api/terminal/operations','/api/proposals/00000000-0000-4000-8000-000000000000/approve']){
      const blocked=await fetch(base+path,{method:'POST',headers,body:'{}'});assert.equal(blocked.status,409);assert.equal((await blocked.json() as {submissionAttempted:boolean}).submissionAttempted,false);
    }
    release?.();assert.equal((await pending).status,200);assert.equal(pauses,6);assert.equal(connects,4);
    assert.equal((await connect('live','4'.repeat(64))).status,200);assert.equal(pauses,6);assert.equal(connects,4);
    fail=true;assert.equal((await connect('live','5'.repeat(64))).status,400);assert.equal(pauses,7);assert.equal(connects,5);
    fail=false;assert.equal((await connect('live','5'.repeat(64))).status,200);assert.equal(pauses,8);assert.equal(connects,6);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});

for(const venue of ['lighter','hyperliquid'] as const) {
 test(`${venue} reconnect repairs missing spot without changing the reviewed identity`,async()=>{
  const credentials=venue==='lighter'?{lighter_perpetual_l1_address:'0x'+'a'.repeat(40),lighter_perpetual_api_key_index:4,lighter_perpetual_api_private_key:'b'.repeat(80),lighter_perpetual_account_limit:'Standard'}:{hyperliquid_perpetual_mode:'api_wallet',use_vault:false,hyperliquid_perpetual_address:'0x'+'a'.repeat(40),hyperliquid_perpetual_secret_key:'b'.repeat(64)};
  const revision=createHash('sha256').update(JSON.stringify(parseCredentials(venue,credentials))).digest('hex');
  const store=new DeskStore(':memory:');store.setConnectionFingerprint('desk',venue,revision);
  const markets:MarketService={list:async()=>[],candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()})};
  const desk=new TradingDesk(store,markets,{configured:true,place:async()=>{throw Error('No trades');},cancel:async()=>{throw Error('No cancellations');}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'https://quanttrade.example'});
  let connects=0,pauses=0,spot=true,fail=false,restoreSpot=true;
  const app=createApp({desk,markets,agent:{prepare:async()=>({summary:'',proposal:null})},execution:{account:async()=>({positions:{data:[],pagination:{has_more:false,next_cursor:null}},orders:{data:[],pagination:{has_more:false,next_cursor:null}}}),connections:async()=>[venue],spotConnections:async()=>spot?[venue]:[],connect:async()=>{connects++;if(fail)throw Error('Atomic verification failed');spot=restoreSpot;},disconnect:async()=>{throw Error('No disconnect');},balances:async()=>[]},workflows:{start:async()=>{throw Error('No registration');},list:()=>[],cancel:()=>{throw Error('No cancellation');},pauseVenue:()=>{pauses++;}},operatorToken:'operator',agentToken:'agent'});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('No address');
  const connect=(token='operator')=>fetch(`http://127.0.0.1:${address.port}/api/connections`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({venue,credentials,mode:'live'})});
  try {
   assert.equal((await connect('agent')).status,403);assert.equal(connects,0);
   assert.equal((await connect()).status,200);assert.equal(connects,0);assert.equal(pauses,0);
   spot=false;let response=await connect();assert.equal(response.status,200);assert.equal((await response.json()).spotConnected,true);assert.equal(connects,1);assert.equal(pauses,0);assert.equal(store.connectionFingerprint('desk',venue),revision);
   spot=false;fail=true;response=await connect();assert.notEqual(response.status,200);assert.equal(connects,2);assert.equal(pauses,0);assert.equal(store.connectionFingerprint('desk',venue),revision);
   fail=false;restoreSpot=false;response=await connect();assert.equal(response.status,200);assert.equal((await response.json()).spotConnected,false);assert.equal(connects,3);assert.equal(pauses,0);
   store.setConnectionFingerprint('desk',venue,'c'.repeat(64));fail=true;response=await connect();assert.notEqual(response.status,200);assert.equal(pauses,1);assert.equal(store.connectionFingerprint('desk',venue),null);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
 });
}
