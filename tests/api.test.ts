import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server/app.ts';
import { DeskStore } from '../src/server/store.ts';
import { TradingDesk } from '../src/server/trading.ts';
import type { MarketService } from '../src/server/markets.ts';

test('agent credential can draft but cannot approve, cancel, halt or impersonate manual input', async () => {
  const store=new DeskStore(':memory:');
  const markets: MarketService={list:async()=>[{venue:'hyperliquid',symbol:'BTC-USDC',base:'BTC',price:'100',change24h:0,volume24h:'1',fundingRate:0,openInterest:'1',sizeDecimals:3,priceDecimals:2,minSize:'0.001',minNotional:'10',updatedAt:Date.now()}],candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()})};
  const desk=new TradingDesk(store,markets,{configured:false,place:async()=>{throw new Error('unexpected execution');},cancel:async()=>undefined},{mode:'paper',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost:4317'});
  const services={desk,markets,agent:{prepare:async()=>({summary:'No order',proposal:null})},operatorToken:'operator-token',agentToken:'agent-token'};
  assert.throws(()=>createApp({...services,allowedOrigins:['http://public.example']}),/HTTPS/i);
  assert.throws(()=>createApp({...services,allowedOrigins:['https://user:secret@public.example']}),/origin/i);
  const app=createApp({...services,allowedOrigins:['https://quanttrade.example']});
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const address=server.address(); if (!address || typeof address==='string') throw new Error('No server address');
  const url=`http://127.0.0.1:${address.port}`;
  const headers={Authorization:'Bearer agent-token','Content-Type':'application/json'};
  try {
    assert.equal((await fetch(`${url}/api/status`)).status,401);
    assert.equal((await fetch(`${url}/api/terminal/native-twap-runs`)).status,401);
    assert.equal((await fetch(`${url}/api/terminal/native-twap-runs`,{headers})).status,403);
    assert.equal((await fetch(`${url}/api/status`,{headers:{...headers,Origin:'https://quanttrade.example'}})).status,200);
    assert.equal((await fetch(`${url}/api/status`,{headers:{...headers,Origin:'https://quanttrade.example.attacker.test'}})).status,403);
    const created=await fetch(`${url}/api/proposals`,{method:'POST',headers,body:JSON.stringify({venue:'hyperliquid',symbol:'BTC-USDC',side:'buy',type:'limit',size:'1',price:'100',rationale:'test'})});
    assert.equal(created.status,201);
    const proposal=await created.json() as {id:string;source:string};
    assert.equal(proposal.source,'agent');
    for (const route of [`/api/proposals/${proposal.id}/approve`,`/api/proposals/${proposal.id}/cancel`,'/api/halt','/api/terminal/orders','/api/terminal/operations','/api/terminal/lighter-native-orders','/api/terminal/lighter-native-preview','/api/terminal/hyperliquid-twap','/api/terminal/chase-plans','/api/terminal/chase-cancel','/api/terminal/hyperliquid-twap-evidence','/api/chase-plans/test/cancel','/api/terminal/snapshot','/api/terminal/open-orders','/api/workflow-runs','/api/workflow-runs/test/cancel','/api/workflow-runs/test/pause']) {
      assert.equal((await fetch(`${url}${route}`,{method:'POST',headers,body:'{}'})).status,403);
    }
    const approved=await fetch(`${url}/api/proposals/${proposal.id}/approve`,{method:'POST',headers:{...headers,Authorization:'Bearer operator-token'},body:'{}'});
    assert.equal(approved.status,200);
    markets.coverage=()=>({complete:false,failedDexs:['para']});
    const catalog=await fetch(`${url}/api/public/markets?venue=hyperliquid`);
    assert.equal(catalog.status,200);
    assert.equal(catalog.headers.get('X-QuantTrade-Catalog-Complete'),'false');
    assert.deepEqual(JSON.parse(catalog.headers.get('X-QuantTrade-Failed-Dexs')??'null'),['para']);
    assert(Array.isArray(await catalog.json()),'Legacy array catalog contract remains intact');
    const native=await fetch(`${url}/api/terminal/orders`,{method:'POST',headers:{...headers,Authorization:'Bearer operator-token',Origin:'http://127.0.0.1:4317'},body:JSON.stringify({clientOrderId:'native-api',mode:'paper',order:{venue:'hyperliquid',symbol:'BTC-USDC',side:'buy',type:'limit',size:'1',price:'100',rationale:'Native review'}})});
    assert.equal(native.status,200);
    assert.equal((await native.json() as {status:string}).status,'paper-open');
    assert.equal((await fetch(`${url}/`,{redirect:'manual'})).headers.get('location'),'http://localhost:4317');
    assert.equal((await fetch(`${url}/api/status`,{headers:{...headers,Origin:'https://attacker.example'}})).status,403);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve)=>server.close(()=>resolve())); store.close(); }
});
