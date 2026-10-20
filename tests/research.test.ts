import test from 'node:test';
import assert from 'node:assert/strict';
import { VenueResearch } from '../src/server/research.ts';

const wallet = `0x${'1'.repeat(40)}`;
test('research rejects unknown actions, injected parameters, invalid wallets and excessive dates before fetching', async () => {
  let calls = 0;
  const service = new VenueResearch(async () => { calls++; return Response.json([]); });
  for (const input of [
    {venue:'hyperliquid',action:'withdraw'},
    {venue:'hyperliquid',action:'open-orders',wallet:'0x123'},
    {venue:'hyperliquid',action:'open-orders',wallet,url:'https://attacker.invalid'},
    {venue:'lighter',action:'recent-trades',marketId:'0&authorization=secret'},
    {venue:'lighter',action:'account-limits',accountIndex:1},
    {venue:'hyperliquid',action:'funding-history',coin:'BTC',startTime:1,endTime:Date.now()},
    {venue:'hyperliquid',action:'funding-history',coin:'BTC',startTime:Date.now(),endTime:1},
  ]) await assert.rejects(() => service.execute(input));
  assert.equal(calls,0);
});
test('Hyperliquid research uses a fixed info endpoint and bounds returned rows', async () => {
  let body:unknown;
  const service = new VenueResearch(async (url,init) => {
    assert.equal(String(url),'https://api.hyperliquid.xyz/info');
    assert.equal(init?.method,'POST'); body=JSON.parse(String(init?.body));
    return Response.json([{coin:'BTC',oid:1},{coin:'ETH',oid:2}]);
  });
  const result=await service.execute({venue:'hyperliquid',action:'open-orders',wallet,limit:'1'});
  assert.deepEqual(body,{type:'frontendOpenOrders',user:wallet});
  assert.equal(result.truncated,true); assert.equal(Array.isArray(result.data) && result.data.length,1);
});
test('Lighter funding dates convert milliseconds to seconds and all upstream codes are checked',async()=>{
  const startTime=Date.now()-3_600_000, endTime=Date.now();
  const service=new VenueResearch(async(url)=>{
    const u=new URL(String(url)); assert.equal(u.hostname,'mainnet.zklighter.elliot.ai');
    assert.equal(u.pathname,'/api/v1/fundings'); assert.equal(u.searchParams.get('start_timestamp'),String(Math.floor(startTime/1000)));
    assert.equal(u.searchParams.get('count_back'),'5'); return Response.json({code:200,resolution:'1h',fundings:[]});
  });
  assert.equal((await service.execute({venue:'lighter',action:'funding-history',marketId:'0',startTime,endTime,limit:5})).action,'funding-history');
  await assert.rejects(()=>new VenueResearch(async()=>Response.json({code:400,funding_rates:[]})).execute({venue:'lighter',action:'funding-rates'}),/rejected/);
});
test('research rejects HTTP failures, malformed responses and oversized bodies',async()=>{
  for(const response of [new Response('bad',{status:502}),Response.json({error:'upstream'}),new Response('x'.repeat(2_100_000))]) {
    await assert.rejects(()=>new VenueResearch(async()=>response).execute({venue:'lighter',action:'exchange-stats'}));
  }
});
test('research coalesces identical requests without leaking mutable cached data',async()=>{
  let calls=0;
  const service=new VenueResearch(async()=>{calls++;return Response.json({code:200,funding_rates:[{market_id:0,rate:0.1}]});});
  const input={venue:'lighter',action:'funding-rates',marketId:0};
  const [a,b]=await Promise.all([service.execute(input),service.execute(input)]);
  assert.equal(calls,1); assert.deepEqual(a,b);
  if(Array.isArray(a.data)) a.data.length=0;
  assert.notDeepEqual(a,await service.execute(input));
});
test('market stats selects matching native asset and refuses an unknown coin',async()=>{
  const response=[{universe:[{name:'BTC',maxLeverage:50},{name:'ETH',maxLeverage:25}]},[{markPx:'100'},{markPx:'10'}]];
  const service=new VenueResearch(async()=>Response.json(response));
  assert.deepEqual((await service.execute({venue:'hyperliquid',action:'market-stats',coin:'ETH'})).data,{asset:{name:'ETH',maxLeverage:25},context:{markPx:'10'}});
  await assert.rejects(()=>service.execute({venue:'hyperliquid',action:'market-stats',coin:'UNKNOWN'}),/Unknown/);
});

test('builder research infers exact DEX and preserves qualified coin',async()=>{
 const bodies:Record<string,unknown>[]=[];
 const service=new VenueResearch(async(_url,init)=>{const b=JSON.parse(String(init?.body));bodies.push(b);return Response.json(b.type==='metaAndAssetCtxs'?[{universe:[{name:'para:PAPER'}]},[{markPx:'1'}]]:[]);});
 await service.execute({venue:'hyperliquid',action:'market-stats',coin:'para:PAPER'});
 assert.deepEqual(bodies[0],{type:'metaAndAssetCtxs',dex:'para'});
 await service.execute({venue:'hyperliquid',action:'open-orders',wallet,dex:'para'});
 assert.deepEqual(bodies[1],{type:'frontendOpenOrders',user:wallet,dex:'para'});
 await assert.rejects(service.execute({venue:'hyperliquid',action:'market-stats',coin:'para:PAPER',dex:'xyz'}));
 await assert.rejects(service.execute({venue:'hyperliquid',action:'open-orders',wallet,dex:'../../evil'}));
});
