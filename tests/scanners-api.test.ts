import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server/app.ts';
import { DeskStore } from '../src/server/store.ts';
import { TradingDesk } from '../src/server/trading.ts';

test('scanner snapshot is a bounded public read; query overrides and foreign origins never reach the source',async()=>{
 const store=new DeskStore(':memory:');
 const markets={list:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()}),candles:async()=>[]};
 const desk=new TradingDesk(store,markets,{configured:false,place:async()=>{throw Error('No execution');},cancel:async()=>{throw Error('No cancellation');}},{mode:'paper',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost:4317'});
 let calls=0;
 const app=createApp({desk,markets,agent:{prepare:async()=>({summary:'none',proposal:null})},operatorToken:'operator',agentToken:'agent',scannerDetails:{get:async(base,venue)=>{calls++;return{asOf:123,base,windowStart:0,windowEnd:86400000,refreshAfterMs:60000,venues:[]};}},scanners:{get:async()=>{calls++;return{asOf:123,refreshAfterMs:30000,sources:[],markets:[],comparisons:[],options:{sources:[],trades:[],overview:[],coverage:[]}};}}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const addr=server.address();if(!addr||typeof addr==='string')throw Error('No server');
 const url=`http://127.0.0.1:${addr.port}/api/public/scanners`;
 try{
  const response=await fetch(url);assert.equal(response.status,200);assert.equal((await response.json()).asOf,123);
  assert.equal((await fetch(url+'?url=https://bad.invalid')).status,400);
  assert.equal((await fetch(url,{headers:{Origin:'https://bad.invalid'}})).status,403);
  assert.equal(calls,1);
  const detail=await fetch(url+'/detail?base=kPEPE&venue=lighter');assert.equal(detail.status,200);assert.equal((await detail.json()).base,'kPEPE');
  assert.equal((await fetch(url+'/detail?base=BTC&url=https://bad.invalid')).status,400);
  assert.equal((await fetch(url+'/detail?base=BTC&venue=binance')).status,400);
  assert.equal((await fetch(url+'/detail?base=BTC',{headers:{Origin:'https://bad.invalid'}})).status,403);
  assert.equal(calls,2);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
