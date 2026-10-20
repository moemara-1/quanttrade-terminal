import test from 'node:test';
import assert from 'node:assert/strict';
import { TradingDesk, type ExecutionClient, type DeskConfig } from '../src/server/trading.ts';
import { DeskStore } from '../src/server/store.ts';
import type { Market, OrderDraft } from '../src/shared/types.ts';

const quote: Market = { venue: 'hyperliquid', symbol: 'BTC-USDC', base: 'BTC', price: '100', change24h: 0, volume24h: '100000', fundingRate: 0, openInterest: null, sizeDecimals: 3, priceDecimals: 2, minSize: '0.001', minNotional: '10', updatedAt: Date.now() };
const draft: OrderDraft = { venue: 'hyperliquid', symbol: 'BTC-USDC', side: 'buy', type: 'limit', size: '1', price: '100', rationale: 'Test proposal' };

test('native triggers stay pending for agents and paper market triggers are not fabricated fills',async()=>{
  const {desk,store,calls}=setup();
  try {
    const trigger={...draft,type:'market' as const,price:undefined,side:'sell' as const,trigger:{triggerPrice:'90',triggerType:'sl' as const},reduceOnly:true};
    const proposal=await desk.propose(trigger,'agent');
    assert.equal(proposal.status,'pending');assert.equal(calls(),0);
    const approved=await desk.approve(proposal.id);
    assert.equal(approved.status,'paper-open');assert.equal(calls(),0);
  } finally {store.close();}
});

test('trigger market price protection is bound to the future trigger and persistent request id',async()=>{
  let protection: string|undefined;let requestId:string|undefined;
  const {desk,store}=setup({mode:'live'},async(_order,bound,id)=>{protection=bound;requestId=id;return 'native:hyperliquid:123';});
  try {
    const proposal=await desk.confirm('manual-stop','live',{...draft,type:'market',price:undefined,side:'sell',reduceOnly:true,trigger:{triggerPrice:'90',triggerType:'sl'}});
    assert.equal(proposal.status,'submitted');assert.equal(protection,'89.1');assert.equal(requestId,proposal.id);
  } finally {store.close();}
});

test('explicit manual resting limits may be away from market but agent entry limits retain their band',async()=>{
  const {desk,store}=setup();
  try {
    const far={...draft,price:'80'};
    assert.equal((await desk.confirm('manual-resting','paper',far)).status,'paper-open');
    await assert.rejects(desk.propose(far,'agent'),/price band/);
  } finally {store.close();}
});
test('terminal confirmation binds a durable request key to one exact order', async () => {
  const { desk, calls } = setup({ mode: 'live' });
  const first = await desk.confirm('native-1', 'live', draft);
  assert.equal((await desk.confirm('native-1', 'live', draft)).id, first.id);
  assert.equal(calls(), 1);
  await assert.rejects(desk.confirm('native-1', 'live', { ...draft, size: '2' }), /different/i);
  await assert.rejects(desk.confirm('native-2', 'paper', draft), /mode/i);
});
test('concurrent terminal confirmations cannot duplicate submissions', async () => {
  const { desk, calls } = setup({ mode: 'live' });
  await Promise.allSettled([desk.confirm('concurrent', 'live', draft), desk.confirm('concurrent', 'live', draft)]);
  assert.equal(calls(), 1);
});

test('manual live orders execute once on submission while agent trades remain pending',async()=>{
  const {desk,store,calls}=setup();
  desk.setVenueMode('hyperliquid','live');
  const manual=await desk.confirm('manual-live','live',draft);
  assert.equal(manual.status,'submitted');assert.equal(manual.source,'manual');assert.equal(calls(),1);
  const agent=await desk.propose(draft,'agent');
  assert.equal(agent.mode,'live');assert.equal(agent.status,'pending');assert.equal(calls(),1);
  desk.setVenueMode('hyperliquid','paper');
  await assert.rejects(desk.approve(agent.id),/mode/i);
  store.close();
});

test('live approval rechecks kill switch, venue mode and physical keys after asynchronous market reads',async()=>{
  for(const change of ['halt','mode','keys']){
    const store=new DeskStore(':memory:');store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));
    let armed=false,calls=0;
    const desk=new TradingDesk(store,{list:async()=>{if(armed){if(change==='halt')desk.setHalted(true);else if(change==='mode')desk.setVenueMode('hyperliquid','paper');else store.setConnectionFingerprint('desk','hyperliquid','b'.repeat(64));}return [{...quote,updatedAt:Date.now()}];}},{configured:true,place:async()=>{calls++;return 'exchange';},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost'});
    try{const proposal=await desk.propose(draft,'agent');armed=true;await assert.rejects(desk.approve(proposal.id),/halted|mode|connection/i);assert.equal(calls,0);assert.equal(store.get(proposal.id).status,'pending');}finally{store.close();}
  }
});

test('agent proposal is pinned to physical connection revision even when account label and mode stay the same',async()=>{
  const s=setup({mode:'live'});try{s.store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));const proposal=await s.desk.propose(draft,'agent');s.store.setConnectionFingerprint('desk','hyperliquid','b'.repeat(64));await assert.rejects(s.desk.approve(proposal.id),/connection/i);assert.equal(s.calls(),0);}finally{s.store.close();}
});
function setup(overrides: Partial<DeskConfig> = {}, execute?: ExecutionClient['place']) {
  let now = Date.now();
  let market = { ...quote, updatedAt: now };
  let calls = 0;
  const store = new DeskStore(':memory:');
  const execution: ExecutionClient = { configured: true, place: async (order,protectionPrice,requestId) => { calls++; return execute ? execute(order,protectionPrice,requestId) : 'exchange-1'; }, cancel: async () => undefined };
  const config: DeskConfig = { mode: 'paper', accountName: 'desk', maxOrderNotional: '1000', dailyNotionalLimit: '2000', maxPriceDeviationBps: 100, proposalTtlSeconds: 120, pairlensUrl: 'http://localhost:3000', ...overrides };
  const desk = new TradingDesk(store, { list: async () => [market] }, execution, config, () => now);
  return { desk, store, calls: () => calls, tick: (ms: number) => { now += ms; market.updatedAt = now; }, setMarket: (changes: Partial<Market>) => { market = { ...market, ...changes }; } };
}

test('a draft never executes and approved paper order never reaches exchange', async () => {
  const { desk, calls } = setup();
  const proposal = await desk.propose(draft, 'agent');
  assert.equal(proposal.status, 'pending');
  assert.equal(calls(), 0);
  assert.equal((await desk.approve(proposal.id)).status, 'paper-open');
  assert.equal(calls(), 0);
});
test('validation refuses dangerous numeric values and unsupported extra fields', async () => {
  const { desk } = setup();
  for (const size of ['0', '-1', 'NaN', 'Infinity', '1e300', '0.0001']) {
    await assert.rejects(desk.propose({ ...draft, size }, 'manual'));
  }
  await assert.rejects(desk.propose({ ...draft, leverage: 126 }, 'agent'));
  await assert.rejects(desk.propose({ ...draft, unsupportedFlag: true }, 'agent'));
  await assert.rejects(desk.propose({ ...draft, venue: 'binance' }, 'agent'));
  await assert.rejects(desk.propose({ ...draft, size: '0.001' }, 'agent'));
});
test('expired and rejected proposals cannot be approved', async () => {
  const { desk, tick } = setup();
  const first = await desk.propose(draft, 'agent');
  tick(121_000);
  await assert.rejects(desk.approve(first.id), /expired/i);
  const second = await desk.propose(draft, 'agent');
  desk.reject(second.id);
  await assert.rejects(desk.approve(second.id), /pending/i);
});
test('rechecks price, stale feed and halt immediately before submission', async () => {
  const { desk, setMarket } = setup();
  const p = await desk.propose(draft, 'manual');
  setMarket({ price: '120' });
  await assert.rejects(desk.approve(p.id), /price/i);
  setMarket({ price: '100', updatedAt: 1 });
  await assert.rejects(desk.approve(p.id), /stale/i);
  desk.setHalted(true);
  await assert.rejects(desk.approve(p.id), /halt/i);
});
test('concurrent approvals and later repeats submit once', async () => {
  const { desk, calls } = setup({ mode: 'live' });
  const p = await desk.propose(draft, 'manual');
  const results = await Promise.allSettled([desk.approve(p.id), desk.approve(p.id)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(calls(), 1);
  await assert.rejects(desk.approve(p.id));
  assert.equal(calls(), 1);
});
test('ambiguous execution failure stays unknown and is never retried', async () => {
  const { desk, calls } = setup({ mode: 'live' }, async () => { throw new Error('timed out'); });
  const p = await desk.propose(draft, 'manual');
  assert.equal((await desk.approve(p.id)).status, 'unknown');
  await assert.rejects(desk.approve(p.id));
  assert.equal(calls(), 1);
  assert.equal(desk.status().dailyNotionalUsed, '100');
});
test('daily reservations prevent concurrent proposals exceeding budget', async () => {
  const { desk, calls } = setup({ mode: 'live', dailyNotionalLimit: '150' });
  const a = await desk.propose(draft, 'manual');
  const b = await desk.propose(draft, 'manual');
  const results = await Promise.allSettled([desk.approve(a.id), desk.approve(b.id)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(calls(), 1);
});
test('live market proposal remains pending until attended approval', async () => {
  const {desk,calls}=setup({mode:'live'});
  const proposal=await desk.propose({...draft,type:'market',price:undefined},'agent');
  assert.equal(proposal.status,'pending');assert.equal(calls(),0);
});
test('paper limit cancellation remains simulated and frees no daily turnover budget', async () => {
  const { desk } = setup();
  const p = await desk.propose(draft, 'manual');
  await desk.approve(p.id);
  assert.equal((await desk.cancel(p.id)).status, 'cancelled');
  assert.equal(desk.status().dailyNotionalUsed, '100');
});
test('proposal copies cannot modify stored approved parameters', async () => {
  const { desk } = setup();
  const p = await desk.propose(draft, 'agent');
  p.order.size = '999999';
  const approved = await desk.approve(p.id);
  assert.equal(approved.order.size, '1');
});
test('a proposal cannot migrate to a different configured execution account', async () => {
  const { desk, store } = setup();
  const p = await desk.propose(draft, 'agent');
  const other = new TradingDesk(store,{list:async()=>[{...quote,updatedAt:Date.now()}]}, {configured:true,place:async()=> 'bad',cancel:async()=>undefined},
    {mode:'paper',accountName:'other-account',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost:3000'});
  await assert.rejects(other.approve(p.id), /account/i);
});

test('reduce-only orders preserve the close flag through manual execution and idempotency', async () => {
  let placed: OrderDraft | undefined;
  const {desk,calls}=setup({mode:'live'},async order=>{placed=order;return 'close-1';});
  const close={...draft,side:'sell' as const,reduceOnly:true};
  await desk.confirm('close-request','live',close);
  assert.equal(placed?.reduceOnly,true);
  assert.equal(calls(),1);
  await assert.rejects(desk.confirm('close-request','live',{...close,reduceOnly:false}),/different/i);
});

test('market execution is bounded after venue precision and conservatively reserves notional',async()=>{
  let protection: string | undefined;
  const store=new DeskStore(':memory:');
  const desk=new TradingDesk(store,{list:async()=>[{...quote,price:'99.999',updatedAt:Date.now()}]},
    {configured:true,place:async (_order,price)=>{protection=price;return 'market1';},cancel:async()=>undefined},
    {mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost'});
  const buy=await desk.confirm('bounded-buy','live',{...draft,type:'market',price:undefined});
  assert.equal(buy.status,'submitted');assert.equal(protection,'100.99');
  assert.equal(buy.estimatedNotional,'100.99899');
  await desk.confirm('bounded-sell','live',{...draft,type:'market',side:'sell',price:undefined,reduceOnly:true});
  assert.equal(protection,'99');store.close();
});

test('post-only requires a limit order and remains part of the approved order',async()=>{
  const {desk}=setup();
  await assert.rejects(desk.propose({...draft,type:'market',price:undefined,postOnly:true},'agent'),/Post-only/i);
  const proposal=await desk.propose({...draft,postOnly:true},'agent');
  assert.equal(proposal.order.postOnly,true);
});


test('spot quote sizes convert exactly at venue precision and persist a buy budget',async()=>{
 const {desk,store,setMarket}=setup();
 try {
  setMarket({marketType:'spot',price:'3',sizeDecimals:2,minSize:'0.01',minNotional:'1'});
  const p=await desk.propose({...draft,marketType:'spot',sizeUnit:'quote',size:'50.50',price:'3'},'manual');
  assert.equal(p.order.size,'16.83');assert.equal(p.order.sizeUnit,'base');assert.equal(p.order.quoteBudget,'50.50');
 }finally{store.close();}
});
test('quote-sized spot market buys cap cost at the protected execution price',async()=>{
 const {desk,store,setMarket}=setup();
 try {
  setMarket({marketType:'spot'});
  const p=await desk.propose({...draft,marketType:'spot',sizeUnit:'quote',size:'50',type:'market',price:undefined},'agent');
  assert.equal(p.order.size,'0.495');assert.equal(p.order.quoteBudget,'50');
  setMarket({price:'100.5'});
  await assert.rejects(desk.approve(p.id),/quote budget/);
 }finally{store.close();}
});

test('PRL rejects over-cap manual orders before execution and rechecks approved agent leverage',async()=>{
 const {desk,store,calls,setMarket}=setup({mode:'live'});
 try {
  setMarket({venue:'lighter',symbol:'PRL-USDC',base:'PRL',maxLeverage:3,sizeDecimals:2,priceDecimals:4,minSize:'5',minNotional:'10',price:'2'});
  const prl={...draft,venue:'lighter' as const,symbol:'PRL-USDC',size:'5',price:'2',leverage:3,marginMode:'cross' as const};
  await assert.rejects(desk.confirm('prl-over-cap','live',{...prl,leverage:4}),/maximum leverage is 3x/);assert.equal(calls(),0);
  assert.equal((await desk.confirm('prl-valid','live',prl)).status,'submitted');assert.equal(calls(),1);
  const proposal=await desk.propose(prl,'agent');assert.equal(proposal.status,'pending');
  setMarket({maxLeverage:2});await assert.rejects(desk.approve(proposal.id),/maximum leverage is 2x/);assert.equal(calls(),1);
 } finally {store.close();}
});

test('disabled caps allow approved notional above former defaults and keep turnover and replay guards', async () => {
 const s=setup({maxOrderNotional:null,dailyNotionalLimit:null});
 try {const p=await s.desk.propose({...draft,size:'60'},'agent');assert.equal(p.status,'pending');assert.equal(s.calls(),0);await s.desk.approve(p.id);assert.equal(s.desk.status().dailyNotionalUsed,'6000');await assert.rejects(s.desk.approve(p.id));assert.equal(s.desk.status().maxOrderNotional,null);assert.equal(s.desk.status().dailyNotionalLimit,null);} finally{s.store.close();}
});
test('disabled operation cap still reserves once and rejects changed reservation amounts', () => {
 const store=new DeskStore(':memory:');try{store.reserveOperation('uncapped','live','2026-10-14','6000',null);store.reserveOperation('uncapped','live','2026-10-14','6000',null);assert.equal(store.used('live','2026-10-14'),'6000');assert.throws(()=>store.reserveOperation('uncapped','live','2026-10-14','7000',null),/different/);assert.throws(()=>store.reserveOperation('finite','live','2026-10-14','1','5000'),/Daily/);}finally{store.close();}
});

test('live builder proposals require connection-scoped execution readiness while paper reads remain available',async()=>{
 const store=new DeskStore(':memory:');
 const market={...quote,base:'para:PAPER',symbol:'para:PAPER-USDC',dex:'para',coin:'para:PAPER',assetId:180038,collateralToken:0,onlyIsolated:true,maxLeverage:3,marginModes:['isolated' as const]};
 const order={...draft,symbol:market.symbol,leverage:3,marginMode:'isolated' as const};
 let calls=0,probes=0;
 const execution:ExecutionClient={configured:true,place:async()=>{calls++;return 'never';},cancel:async()=>{}};
 const config:DeskConfig={mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost'};
 const desk=new TradingDesk(store,{list:async()=>[{...market,updatedAt:Date.now()}]},execution,config);
 try{
  await assert.rejects(desk.propose(order,'agent'),/builder.*readiness/i);assert.equal(calls,0);
  execution.validateBuilderMarket=async(market,account,revision)=>{probes++;assert.equal(market.assetId,180038);assert.equal(account,'desk');assert.equal(revision,null);};
  assert.equal((await desk.propose(order,'agent')).status,'pending');assert.equal(probes,1);assert.equal(calls,0);
  desk.setVenueMode('hyperliquid','paper');assert.equal((await desk.propose(order,'agent')).status,'pending');assert.equal(probes,1);
 }finally{store.close();}
});

test('stale builder quotes refresh before readiness while missing refresh remains rejected',async()=>{
 for(const refresh of [false,true]){
  const store=new DeskStore(':memory:');const now=Date.now();let probes=0;
  const market={...quote,base:'para:PAPER',symbol:'para:PAPER-USDC',dex:'para',assetId:180038,onlyIsolated:true,maxLeverage:3,updatedAt:now-16000};
  const source={list:async()=>[market],...(refresh?{refreshMarket:async()=>({...market,updatedAt:now})}:{})};
  const desk=new TradingDesk(store,source,{configured:true,place:async()=>{throw Error('No execution');},cancel:async()=>{},validateBuilderMarket:async(row)=>{probes++;assert.equal(row.updatedAt,now);}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost'},()=>now);
  try{const pending=desk.propose({...draft,symbol:market.symbol,leverage:3,marginMode:'isolated'},'agent');if(refresh)assert.equal((await pending).status,'pending');else await assert.rejects(pending,/stale/);assert.equal(probes,refresh?1:0);}finally{store.close();}
 }
});
