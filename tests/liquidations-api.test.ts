import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server/app.ts';
import { DeskStore } from '../src/server/store.ts';
import { TradingDesk } from '../src/server/trading.ts';
import type { MarketService } from '../src/server/markets.ts';

test('liquidation history stays public and typed collection states never challenge browser login',async()=>{
 const store=new DeskStore(':memory:');
 const markets:MarketService={list:async()=>[],candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()})};
 const desk=new TradingDesk(store,markets,{configured:false,place:async()=>{throw new Error('No execution');},cancel:async()=>undefined},{mode:'paper',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'https://cointrade.example'});
 const fetchedAt=new Date().toISOString();
 const app=createApp({desk,markets,agent:{prepare:async()=>({summary:'',proposal:null})},operatorToken:'operator',agentToken:'agent',liquidations:{get:(raw)=>{
  const venue=(raw as Record<string,unknown>).venue;
  return venue==='binance-futures'?{venue:'binance-futures',pairKey:'BTC-USDT-USDT',bucketWidth:10,resolutionMs:60000,retentionMs:72*3600000,trackedSince:Date.now()-60000,completeness:'sampled' as const,buckets:[],fetchedAt}:venue==='bybit-futures'?{error:'liquidations_unavailable' as const,reason:'collecting' as const,trackedSince:Date.now(),fetchedAt}:{error:'liquidations_unavailable' as const,reason:'not_tracked' as const,fetchedAt};
 }}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();if(!address||typeof address==='string')throw new Error('No address');
 const base=`http://127.0.0.1:${address.port}/api/liquidations?venue=`;
 try{
  const history=await fetch(base+'binance-futures');assert.equal(history.status,200);assert.equal(history.headers.get('www-authenticate'),null);assert.equal((await history.json()).completeness,'sampled');
  const pending=await fetch(base+'bybit-futures');assert.equal(pending.status,503);assert.equal((await pending.json()).reason,'collecting');assert.equal(pending.headers.get('www-authenticate'),null);
  const missing=await fetch(base+'kraken-futures');assert.equal(missing.status,404);assert.equal((await missing.json()).reason,'not_tracked');
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
