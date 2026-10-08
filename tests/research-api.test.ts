import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server/app.ts';
import { DeskStore } from '../src/server/store.ts';
import { TradingDesk } from '../src/server/trading.ts';

test('public venue research cannot exhaust exchange concurrency or bypass origin checks',async()=>{
 const store=new DeskStore(':memory:');
 const markets={list:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()}),candles:async()=>[]};
 const desk=new TradingDesk(store,markets,{configured:false,place:async()=>{throw new Error('Unexpected order');},cancel:async()=>undefined},{mode:'paper',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost:4317'});
 let calls=0;let release:()=>void=()=>{throw new Error('Gate not initialized')};
 const gate=new Promise<void>(resolve=>{release=resolve});
 const app=createApp({desk,markets,agent:{prepare:async()=>({summary:'none',proposal:null})},operatorToken:'operator',agentToken:'agent',research:{execute:async()=>{calls++;await gate;return{venue:'hyperliquid',action:'predicted-funding',observedAt:Date.now(),data:[],truncated:false}}}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const addr=server.address();if(!addr||typeof addr==='string')throw new Error('Address unavailable');
 const url=`http://127.0.0.1:${addr.port}/api/public/research?venue=hyperliquid&action=predicted-funding`;
 try {
  assert.equal((await fetch(url,{headers:{Origin:'https://evil.example'}})).status,403);assert.equal(calls,0);
  const pending=Array.from({length:4},()=>fetch(url));
  for(let tries=0;calls<4&&tries<100;tries++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(calls,4);
  const rejected=await fetch(url);assert.equal(rejected.status,429);assert.equal(rejected.headers.get('Retry-After'),'60');assert.equal(calls,4);
  release();for(const response of await Promise.all(pending))assert.equal(response.status,200);
 }finally{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
