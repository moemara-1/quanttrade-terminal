import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server/app.ts';
import { DeskStore } from '../src/server/store.ts';
import { TradingDesk } from '../src/server/trading.ts';
import type { MarketService } from '../src/server/markets.ts';

test('hosted operator session requires trusted proxy and exact origin; agents cannot configure keys',async()=>{
  const store=new DeskStore(':memory:');
  const markets:MarketService={list:async()=>[],candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()})};
  const desk=new TradingDesk(store,markets,{configured:false,place:async()=>{throw new Error('no trading');},cancel:async()=>undefined},{mode:'paper',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'https://quanttrade.example'});
  let saved=0;
  const app=createApp({desk,markets,agent:{prepare:async()=>({summary:'',proposal:null})},execution:{account:async()=>({positions:{data:[],pagination:{has_more:false,next_cursor:null}},orders:{data:[],pagination:{has_more:false,next_cursor:null}}}),connect:async()=>{saved++;},disconnect:async()=>undefined,connections:async()=>['lighter'],balances:async()=>[]},operatorToken:'operator',agentToken:'agent',allowedOrigins:['https://quanttrade.example'],webSession:{origin:'https://quanttrade.example',proxySecret:'proxy-'+'s'.repeat(40)}});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();if(!address || typeof address==='string')throw new Error('No address');
  const base=`http://127.0.0.1:${address.port}`;
  const post={method:'POST',headers:{'Content-Type':'application/json',Origin:'https://quanttrade.example'},body:'{}'};
  try {
    assert.equal((await fetch(base+'/api/session',post)).status,401);
    assert.equal((await fetch(base+'/api/session',{...post,headers:{...post.headers,'X-QuantTrade-Session-Secret':'wrong'}})).status,401);
    assert.equal((await fetch(base+'/api/session',{...post,headers:{...post.headers,Origin:'http://localhost:4317','X-QuantTrade-Session-Secret':'proxy-'+'s'.repeat(40)}})).status,403);
    const session=await fetch(base+'/api/session',{...post,headers:{...post.headers,'X-QuantTrade-Session-Secret':'proxy-'+'s'.repeat(40)}});
    assert.equal(session.status,200);
    const cookie=session.headers.get('set-cookie');assert.ok(cookie);
    assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);
    const headers={...post.headers,Cookie:cookie.split(';')[0]};
    const status=await fetch(base+'/api/status',{headers});assert.equal(status.status,200);
    const connected=await fetch(base+'/api/connections',{headers});assert.equal(connected.status,200);
    assert.equal((await fetch(base+'/api/sync-state',{headers:{Authorization:'Bearer agent'}})).status,403);
    const syncBody=JSON.stringify({entries:{language:{value:'en',updatedAt:0}}});
    assert.equal((await fetch(base+'/api/sync-state',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie.split(';')[0]},body:syncBody})).status,403);
    const syncWrite=await fetch(base+'/api/sync-state',{method:'PUT',headers,body:syncBody});assert.equal(syncWrite.status,200);
    assert.deepEqual(await syncWrite.json(),{entries:{language:{value:'en',updatedAt:0}}});
    assert.deepEqual(await (await fetch(base+'/api/sync-state',{headers})).json(),{entries:{language:{value:'en',updatedAt:0}}});
    assert.deepEqual(await connected.json(),[{venue:'hyperliquid',connected:false,mode:'paper',accountName:'desk'},{venue:'lighter',connected:true,mode:'paper',accountName:'desk'}]);
    assert.equal((await fetch(base+'/api/connections',{...post,headers:{...headers,Authorization:'Bearer agent'},body:JSON.stringify({venue:'lighter',credentials:{}})})).status,403);
    assert.equal((await fetch(base+'/api/connections',{...post,headers:{'Content-Type':'application/json',Cookie:cookie.split(';')[0]},body:JSON.stringify({venue:'lighter',credentials:{}})})).status,403);
    const result=await fetch(base+'/api/connections',{...post,headers,body:JSON.stringify({venue:'lighter',credentials:{}})});
    assert.equal(result.status,200);assert.equal(saved,1);
    assert.equal((await fetch(base+'/api/status',{headers:{Cookie:'qt_operator=forged'}})).status,401);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
