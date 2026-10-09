import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowRuns } from '../src/server/workflows.ts';
import { TradingDesk } from '../src/server/trading.ts';
import { DeskStore } from '../src/server/store.ts';
import type { Market,OrderDraft } from '../src/shared/types.ts';
import { DatabaseSync } from 'node:sqlite';

const order:OrderDraft={venue:'lighter',symbol:'PRL-USDC',side:'buy',type:'market',size:'10',leverage:3,marginMode:'cross',rationale:'Reviewed DCA'};
function setup(venue:'lighter'|'hyperliquid'='lighter'){
  let now=100000;let calls=0;let fail=false;let filled=false;let brackets=0;
  const quote:Market={venue,symbol:'PRL-USDC',base:'PRL',price:'1',change24h:0,volume24h:'1',fundingRate:null,openInterest:null,sizeDecimals:2,priceDecimals:4,minSize:'1',minNotional:'1',maxLeverage:3,updatedAt:now};
  const store=new DeskStore(':memory:');
  const desk=new TradingDesk(store,{list:async()=>[{...quote,updatedAt:now}]},{configured:true,place:async()=>{calls++;if(fail)throw new Error('Unverified');return 'exchange-'+calls;},cancel:async()=>{},placeBracket:async()=>{brackets++;return 'native-oco:lighter:11,12';},placeEntryBracket:async()=>{brackets++;return {orderId:'native-entry-oco:hyperliquid:11,12,13',entryOrderId:'native:hyperliquid:11'};},orderEvidence:async()=>filled?{status:'filled',fillSize:'9',fillPrice:'1.1'}:{status:'pending'}},{mode:'live',accountName:'desk',maxOrderNotional:'100',dailyNotionalLimit:'1000',maxPriceDeviationBps:50,proposalTtlSeconds:180,pairlensUrl:'http://localhost'},()=>now);
  const input={clientOrderId:'approved-plan',proposedAt:now,plan:{name:'PRL DCA',accountName:'desk',mode:'live' as const,maxTotalNotional:'25',steps:[{delaySeconds:0,order},{delaySeconds:10800,order}]}};
  return {store,desk,input,filled:()=>{filled=true;},brackets:()=>brackets,get now(){return now;},price:(value:string)=>{quote.price=value;},advance:(seconds:number)=>{now+=seconds*1000;},calls:()=>calls,fail:()=>{fail=true;}};
}
test('rising prices cannot exceed the reviewed aggregate budget on later steps',async()=>{
  const f=setup();const runs=new WorkflowRuns(':memory:',f.desk,()=>f.now);
  try{await runs.start(f.input);await runs.tick();assert.equal(f.calls(),1);f.price('2');f.advance(10800);await runs.tick();assert.equal(f.calls(),1);assert.equal(runs.get(f.input.clientOrderId).status,'paused');assert.match(runs.get(f.input.clientOrderId).error??'',/budget/);}
  finally{runs.close();f.store.close();}
});
test('kill switch, credential replacement and missed schedules pause without an order',async()=>{
  for(const reason of ['kill','credentials','late']){
    const f=setup();const runs=new WorkflowRuns(':memory:',f.desk,()=>f.now);
    try{await runs.start(f.input);if(reason==='kill')f.desk.setHalted(true);if(reason==='credentials')runs.pauseVenue('lighter');if(reason==='late')f.advance(301);await runs.tick();assert.equal(f.calls(),0);assert.equal(runs.get(f.input.clientOrderId).status,'paused');}
    finally{runs.close();f.store.close();}
  }
});
test('restart during an uncertain submission pauses and never retries the entry',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'qt-interrupted-'));const path=join(dir,'runs.sqlite');const f=setup();let runs=new WorkflowRuns(path,f.desk,()=>f.now);
  try{await runs.start(f.input);runs.close();const db=new DatabaseSync(path);const row=db.prepare('SELECT body FROM workflow_runs').get();const run=JSON.parse(String(row?.body));run.states[0].status='submitting';db.prepare('UPDATE workflow_runs SET body=?').run(JSON.stringify(run));db.close();runs=new WorkflowRuns(path,f.desk,()=>f.now);await runs.tick();assert.equal(f.calls(),0);assert.equal(runs.get(f.input.clientOrderId).status,'paused');assert.equal(runs.get(f.input.clientOrderId).states[0].status,'unverified');}
  finally{runs.close();f.store.close();rmSync(dir,{recursive:true,force:true});}
});
test('one approved plan schedules exact orders on server and survives restart without duplicate entry',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'qt-workflow-'));const path=join(dir,'runs.sqlite');const f=setup();let runs=new WorkflowRuns(path,f.desk,()=>f.now);
  try{
    await runs.start(f.input);assert.equal(f.calls(),0);
    await Promise.all([runs.tick(),runs.tick()]);assert.equal(f.calls(),1);
    await runs.start(f.input);assert.equal(f.calls(),1);
    runs.close();runs=new WorkflowRuns(path,f.desk,()=>f.now);
    await runs.tick();assert.equal(f.calls(),1);
    f.advance(10800);await runs.tick();assert.equal(f.calls(),2);
    assert.equal(runs.get(f.input.clientOrderId).status,'completed');
  }finally{runs.close();f.store.close();rmSync(dir,{recursive:true,force:true});}
});
test('stale approval, altered plan, wrong account/mode and unsupported budget fail before execution',async()=>{
  const f=setup();const runs=new WorkflowRuns(':memory:',f.desk,()=>f.now);
  try{
    await assert.rejects(runs.start({...f.input,proposedAt:f.now-180001}),/expired/);
    await assert.rejects(runs.start({...f.input,plan:{...f.input.plan,accountName:'other'}}),/account/);
    await assert.rejects(runs.start({...f.input,plan:{...f.input.plan,mode:'paper'}}),/mode/);
    await assert.rejects(runs.start({...f.input,plan:{...f.input.plan,maxTotalNotional:'1'}}),/budget/);
    await runs.start(f.input);
    await assert.rejects(runs.start({...f.input,plan:{...f.input.plan,maxTotalNotional:'30'}}),/different/);
    assert.equal(f.calls(),0);
  }finally{runs.close();f.store.close();}
});
test('failed entry pauses remaining orders and never retries; cancelling stops future legs',async()=>{
  const f=setup();const runs=new WorkflowRuns(':memory:',f.desk,()=>f.now);
  try{
    await runs.start(f.input);f.fail();await runs.tick();assert.equal(f.calls(),1);
    assert.equal(runs.get(f.input.clientOrderId).status,'paused');
    f.advance(10800);await runs.tick();assert.equal(f.calls(),1);
    await runs.start({...f.input,clientOrderId:'cancelled',proposedAt:f.now});runs.cancel('cancelled');await runs.tick();assert.equal(f.calls(),1);
  }finally{runs.close();f.store.close();}
});
test('exchange mode change or kill switch pauses future orders rather than simulating them',async()=>{
  const f=setup();const runs=new WorkflowRuns(':memory:',f.desk,()=>f.now);
  try{
    await runs.start(f.input);f.desk.setVenueMode('lighter','paper');await runs.tick();assert.equal(f.calls(),0);
    assert.equal(runs.get(f.input.clientOrderId).status,'paused');
  }finally{runs.close();f.store.close();}
});

test('original graph entry waits for fills, persists across restart, then submits one native OCO pair',async()=>{
  const f=setup(),dir=mkdtempSync(join(tmpdir(),'qt-graph-run-')),path=join(dir,'runs.sqlite');let runs=new WorkflowRuns(path,f.desk,()=>f.now);
  const graph={oco:true,steps:[{id:'t',type:'trigger',data:{}},{id:'entry',type:'market-order',data:{side:'inherit',sizeMode:'percent',size:100}},{id:'tp',type:'take-profit',data:{triggerMode:'percent',triggerValue:10,sizePercent:100,orderType:'market'}},{id:'sl',type:'stop-loss',data:{triggerMode:'percent',triggerValue:5,sizePercent:100,orderType:'market'}}],edges:[{id:'a',source:'t',target:'entry'},{id:'b',source:'entry',target:'tp'},{id:'c',source:'entry',target:'sl'}]};
  try{
    await runs.start({...f.input,plan:{name:'Entry with OCO',accountName:'desk',mode:'live',maxTotalNotional:'100',graph,input:order}});await runs.tick();assert.equal(f.calls(),1);assert.equal(f.brackets(),0);assert.equal(runs.get(f.input.clientOrderId).graphState?.nodes.entry.status,'waiting-fill');
    runs.close();runs=new WorkflowRuns(path,f.desk,()=>f.now);await runs.tick();assert.equal(f.calls(),1);assert.equal(f.brackets(),0);
    f.filled();await runs.tick();assert.equal(f.calls(),1);assert.equal(f.brackets(),1);assert.equal(runs.get(f.input.clientOrderId).status,'completed');await runs.tick();assert.equal(f.brackets(),1);
  }finally{runs.close();f.store.close();rmSync(dir,{recursive:true,force:true});}
});
test('schedules beyond 20 orders and 48 hours are valid; graph cycles and quote input never register',async()=>{
  const f=setup();const runs=new WorkflowRuns(':memory:',f.desk,()=>f.now);
  try{
    const run=await runs.start({...f.input,plan:{...f.input.plan,maxTotalNotional:'400',steps:Array.from({length:30},(_,i)=>({order,delaySeconds:i*10800}))}});assert.equal(run.states.length,30);assert.equal(run.plan.steps?.[29].delaySeconds,313200);assert.equal(f.calls(),0);
    await assert.rejects(runs.start({...f.input,clientOrderId:'bad-graph',plan:{name:'Bad',accountName:'desk',mode:'live',maxTotalNotional:'100',graph:{steps:[{id:'t',type:'trigger',data:{}}],edges:[{id:'cycle',source:'t',target:'t'}]},input:order}}));
  }finally{runs.close();f.store.close();}
});

test('Hyperliquid native bracket enters and arms both exits once, then reconciles entry without a second order',async()=>{
  const f=setup('hyperliquid');const runs=new WorkflowRuns(':memory:',f.desk,()=>f.now);
  const graph={oco:true,steps:[{id:'t',type:'trigger',data:{}},{id:'entry',type:'market-order',data:{side:'inherit',sizeMode:'percent',size:100}},{id:'tp',type:'take-profit',data:{triggerMode:'percent',triggerValue:10,sizePercent:100,orderType:'market',limitPrice:0}},{id:'sl',type:'stop-loss',data:{triggerMode:'percent',triggerValue:5,sizePercent:100,orderType:'market',limitPrice:0}}],edges:[{id:'a',source:'t',target:'entry'},{id:'b',source:'entry',target:'tp'},{id:'c',source:'entry',target:'sl'}]};
  try{await runs.start({...f.input,plan:{name:'Native HL OCO',accountName:'desk',mode:'live',maxTotalNotional:'100',graph,input:{...order,venue:'hyperliquid'}}});await runs.tick();assert.equal(f.calls(),0);assert.equal(f.brackets(),1);assert.equal(runs.get(f.input.clientOrderId).graphState?.nodes.entry.status,'waiting-fill');assert.equal(runs.get(f.input.clientOrderId).graphState?.nodes.tp.status,'executed');await runs.tick();assert.equal(f.brackets(),1);f.filled();await runs.tick();assert.equal(runs.get(f.input.clientOrderId).status,'completed');assert.equal(f.brackets(),1);assert.equal(f.calls(),0);}
  finally{runs.close();f.store.close();}
});
