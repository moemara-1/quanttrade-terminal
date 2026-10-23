import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {AssetProfiles} from '../src/server/asset-profiles.ts';
import {createApp} from '../src/server/app.ts';
import {DeskStore} from '../src/server/store.ts';
import {TradingDesk} from '../src/server/trading.ts';

const fixture={id:'zcash',symbol:'zec',name:'Zcash',market_data:{circulating_supply:16,total_supply:16,max_supply:21,last_updated:'2026-10-23T12:00:00Z'},description:{en:'Zcash profile'}};

test('asset profiles use only fixed CoinGecko endpoints and preserve dated unknown data',async()=>{
 const paths:string[]=[];const service=new AssetProfiles(async(url,options)=>{paths.push(String(url));assert.equal(options?.redirect,'error');return Response.json({...fixture,privateUnneeded:'excluded'});});
 const result=await service.get({action:'profile',id:'zcash'});
 assert.deepEqual(result,fixture);assert.equal('privateUnneeded' in result,false);
 assert(paths[0].startsWith('https://api.coingecko.com/api/v3/coins/zcash?'));
 assert(paths[0].includes('market_data=true'));
 await service.get({action:'profile',id:'zcash'});assert.equal(paths.length,1);
 await assert.rejects(service.get({action:'profile',id:'https://evil.example/path'}));
 await assert.rejects(service.get({action:'profile',id:'zcash',url:'https://evil.example'}));
 assert.equal(paths.length,1);
});

test('asset profiles bound response bytes and never cache failed provider data',async()=>{
 let calls=0;const failed=new AssetProfiles(async()=>{calls++;return new Response(null,{status:429});});
 await assert.rejects(failed.get({action:'profile',id:'zcash'}),/unavailable/);
 await assert.rejects(failed.get({action:'profile',id:'zcash'}),/unavailable/);assert.equal(calls,2);
 const huge=new AssetProfiles(async()=>new Response('x'.repeat(1024*1024+1)));
 await assert.rejects(huge.get({action:'profile',id:'zcash'}),/too large/);
 const wrong=new AssetProfiles(async()=>Response.json({...fixture,id:'bitcoin'}));
 await assert.rejects(wrong.get({action:'profile',id:'zcash'}),/identity/);
});

test('same-origin asset profile route requires operator scope and validates all query parameters',async()=>{
 const store=new DeskStore(':memory:');const markets={list:async()=>[],candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()})};
 const desk=new TradingDesk(store,markets,{configured:false,place:async()=>{throw Error('Unexpected order');},cancel:async()=>undefined},{mode:'paper',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost:4317'});
 let calls=0;const assetProfiles=new AssetProfiles(async()=>{calls++;return Response.json(fixture);});
 const app=createApp({desk,markets,agent:{prepare:async()=>({summary:'No order',proposal:null})},operatorToken:'operator',agentToken:'agent',assetProfiles});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}/api/asset-profile`;
 try{
  assert.equal((await fetch(base+'?action=profile&id=zcash')).status,401);
  assert.equal((await fetch(base+'?action=profile&id=zcash',{headers:{Authorization:'Bearer agent'}})).status,403);
  assert.equal((await fetch(base+'?action=profile&id=zcash&url=https://evil.example',{headers:{Authorization:'Bearer operator'}})).status,400);
  const response=await fetch(base+'?action=profile&id=zcash',{headers:{Authorization:'Bearer operator'}});assert.equal(response.status,200);assert.deepEqual(await response.json(),fixture);assert.equal(calls,1);
 }finally{app.locals.hostedAuthClose();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
