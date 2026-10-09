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
function setup(){
  let now=100000;let calls=0;let fail=false;
  const quote:Market={venue:'lighter',symbol:'PRL-USDC',base:'PRL',price:'1',change24h:0,volume24h:'1',fundingRate:null,openInterest:null,sizeDecimals:2,priceDecimals:4,minSize:'1',minNotional:'1',maxLeverage:3,updatedAt:now};
  const store=new DeskStore(':memory:');
  const desk=new TradingDesk(store,{list:async()=>[{...quote,updatedAt:now}]},{configured:true,place:async()=>{calls++;if(fail)throw new Error('Unverified');return 'exchange-'+calls;},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'100',dailyNotionalLimit:'1000',maxPriceDeviationBps:50,proposalTtlSeconds:180,pairlensUrl:'http://localhost'},()=>now);
  const input={clientOrderId:'approved-plan',proposedAt:now,plan:{name:'PRL DCA',accountName:'desk',mode:'live' as const,maxTotalNotional:'25',steps:[{delaySeconds:0,order},{delaySeconds:10800,order}]}};
  return {store,desk,input,get now(){return now;},price:(value:string)=>{quote.price=value;},advance:(seconds:number)=>{now+=seconds*1000;},calls:()=>calls,fail:()=>{fail=true;}};
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
