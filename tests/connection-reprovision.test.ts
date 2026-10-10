import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
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
  const app=createApp({desk,markets,agent:{prepare:async()=>({summary:'',proposal:null})},execution:{account:async()=>({positions:{data:[],pagination:{has_more:false,next_cursor:null}},orders:{data:[],pagination:{has_more:false,next_cursor:null}}}),connect:async()=>{connects++;entered?.();await hold;if(fail)throw new Error('verification failed');connected=true;},disconnect:async()=>{connected=false;},connections:async()=>connected?['lighter']:[],balances:async()=>[]},workflows:{start:async()=>{throw new Error('no workflow registration');},list:()=>[],cancel:()=>{throw new Error('no cancellation');},pauseVenue:()=>{pauses++;}},operatorToken:'operator',agentToken:'agent',allowedOrigins:['https://quanttrade.example']});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();if(!address||typeof address==='string')throw new Error('No address');
  const base=`http://127.0.0.1:${address.port}`;
  const credentials={lighter_perpetual_l1_address:'0x'+'1'.repeat(40),lighter_perpetual_api_key_index:4,lighter_perpetual_api_private_key:'2'.repeat(64),lighter_perpetual_account_limit:'Standard'};
  const headers={Authorization:'Bearer operator','Content-Type':'application/json',Origin:'https://quanttrade.example'};
  const connect=async(mode='live',key=credentials.lighter_perpetual_api_private_key)=>fetch(base+'/api/connections',{method:'POST',headers,body:JSON.stringify({venue:'lighter',credentials:{...credentials,lighter_perpetual_api_private_key:key},mode})});
  try{
    assert.equal((await connect()).status,200);assert.equal(pauses,1);assert.equal(connects,1);
    assert.equal((await connect()).status,200);assert.equal(pauses,1);assert.equal(connects,1);
    assert.equal((await connect('paper')).status,200);assert.equal(pauses,2);assert.equal(connects,1);
    assert.equal((await connect('paper','3'.repeat(64))).status,200);assert.equal(pauses,3);assert.equal(connects,2);
    assert.equal((await fetch(base+'/api/connections/lighter',{method:'DELETE',headers})).status,200);assert.equal(pauses,4);
    assert.equal((await connect('paper','3'.repeat(64))).status,200);assert.equal(pauses,5);assert.equal(connects,3);
    hold=new Promise<void>(resolve=>{release=resolve;});
    const started=new Promise<void>(resolve=>{entered=resolve;});
    const pending=connect('live','4'.repeat(64));await started;
    assert.equal((await connect('paper','3'.repeat(64))).status,409);
    release?.();assert.equal((await pending).status,200);assert.equal(pauses,6);assert.equal(connects,4);
    assert.equal((await connect('live','4'.repeat(64))).status,200);assert.equal(pauses,6);assert.equal(connects,4);
    fail=true;assert.equal((await connect('live','5'.repeat(64))).status,400);assert.equal(pauses,7);assert.equal(connects,5);
    fail=false;assert.equal((await connect('live','5'.repeat(64))).status,200);assert.equal(pauses,8);assert.equal(connects,6);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
