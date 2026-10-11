import test from 'node:test';
import assert from 'node:assert/strict';
import { ChasePlans } from '../src/server/chase-plans.ts';
import { TradingDesk } from '../src/server/trading.ts';
import { DeskStore } from '../src/server/store.ts';
import type { OrderDraft, Market } from '../src/shared/types.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}

function setup(path=':memory:') {
  let now=Date.now(),calls=0,cancels=0;
  let evidence:{status:'open'|'settled'|'pending';filledSize?:string;exchangeId?:string}={status:'open',exchangeId:'100'};
  const store=new DeskStore(':memory:');store.setConnectionFingerprint('desk','lighter','a'.repeat(64));
  const market:Market={venue:'lighter',symbol:'PRL-USDC',base:'PRL',price:'1.4',change24h:0,volume24h:'1',fundingRate:null,openInterest:null,sizeDecimals:2,priceDecimals:4,minSize:'0.01',minNotional:'1',maxLeverage:3,updatedAt:now};
  const placed:OrderDraft[]=[];
  let evidenceHook:()=>Promise<void>=async()=>{},marketHook:()=>Promise<void>=async()=>{},cancelHook:()=>Promise<void>=async()=>{};
  const desk=new TradingDesk(store,{list:async()=>{await marketHook();return [{...market,updatedAt:now}];}},{configured:true,place:async order=>{calls++;placed.push(order);return 'owned-'+calls;},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:180,pairlensUrl:'http://localhost'},()=>now);
  const clients={evidence:{chaseEvidence:async()=>{await evidenceHook();return evidence;}},operations:{perform:async()=>{cancels++;await cancelHook();return {status:'accepted'};}}};
  const plans=new ChasePlans(path,desk,clients.evidence,clients.operations,()=>now);
  const proposal={requestId:'a38504c2-eaa7-4759-a9d2-df9c67d7d8bc',proposedAt:now,credentialId:'lt',accountName:'desk',connectionRevision:'a'.repeat(64),mode:'live',venue:'lighter',marketType:'perpetual',symbol:'PRL-USDC',side:'buy',size:'12',lowerPrice:'1.3',upperPrice:'1.5',durationSeconds:60,intervalSeconds:10,maxAttempts:3,maxTotalNotional:'100',leverage:3,marginMode:'cross'};
  return {plans,store,desk,clients,clock:()=>now,proposal,placed,setEvidence:(value:typeof evidence)=>{evidence=value;},setEvidenceHook:(value:typeof evidenceHook)=>{evidenceHook=value;},setMarketHook:(value:typeof marketHook)=>{marketHook=value;},setCancelHook:(value:typeof cancelHook)=>{cancelHook=value;},advance:(amount=11000)=>{now+=amount;},counts:()=>({calls,cancels}),close:()=>{plans.close();store.close();}};
}
test('one Chase approval cancels only owned order, proves partial fill, and replaces only exact remainder',async()=>{
  const x=setup();try{
    await x.plans.start(x.proposal);assert.deepEqual(x.counts(),{calls:0,cancels:0});
    await x.plans.tick();assert.equal(x.counts().calls,1);
    x.advance();await x.plans.tick();assert.deepEqual(x.counts(),{calls:1,cancels:1});
    x.setEvidence({status:'pending'});await x.plans.tick();assert.equal(x.counts().calls,1);
    x.setEvidence({status:'settled',filledSize:'4.01',exchangeId:'100'});await x.plans.tick();assert.equal(x.counts().calls,1);
    await x.plans.tick();assert.equal(x.counts().calls,2);assert.equal(x.placed[1].size,'7.99');
    await x.plans.start(x.proposal);assert.equal(x.counts().calls,2);
  }finally{x.close();}
});

test('deadline cancels the owned remainder and cancellation acknowledgment alone never permits replacement',async()=>{
 const x=setup();try{await x.plans.start(x.proposal);await x.plans.tick();x.advance(61000);await x.plans.tick();assert.deepEqual(x.counts(),{calls:1,cancels:1});x.setEvidence({status:'open',exchangeId:'100'});await x.plans.tick();assert.deepEqual(x.counts(),{calls:1,cancels:1});x.setEvidence({status:'settled',filledSize:'2.5'});await x.plans.tick();assert.equal(x.plans.get(x.proposal.requestId).status,'cancelled');assert.equal(x.plans.get(x.proposal.requestId).filledSize,'2.5');await x.plans.tick();assert.equal(x.counts().calls,1);}finally{x.close();}
});

test('replacement spends gross submission budget and never silently treats cancelled quantity as free',async()=>{
 const x=setup();try{await x.plans.start({...x.proposal,maxTotalNotional:'18'});await x.plans.tick();x.advance();await x.plans.tick();x.setEvidence({status:'settled',filledSize:'0'});await x.plans.tick();await x.plans.tick();const run=x.plans.get(x.proposal.requestId);assert.equal(run.status,'paused');assert.match(run.error??'',/budget/);assert.equal(x.counts().calls,1);}finally{x.close();}
});

test('explicit cancellation received during evidence await prevents any subsequent replacement',async()=>{
 const x=setup();try{await x.plans.start(x.proposal);await x.plans.tick();const gate=deferred(),entered=deferred();x.setEvidence({status:'settled',filledSize:'4'});x.setEvidenceHook(async()=>{entered.release();await gate.promise;});const tick=x.plans.tick();await entered.promise;x.plans.cancel(x.proposal.requestId);gate.release();await tick;x.setEvidenceHook(async()=>{});await x.plans.tick();assert.equal(x.plans.get(x.proposal.requestId).status,'cancelled');assert.equal(x.counts().calls,1);}finally{x.close();}
});

test('kill switch or connection change after an awaited market read prevents first submission',async()=>{
 for(const mutation of ['halt','revision']){const x=setup();try{await x.plans.start(x.proposal);const gate=deferred(),entered=deferred();x.setMarketHook(async()=>{entered.release();await gate.promise;});const tick=x.plans.tick();await entered.promise;if(mutation==='halt')x.desk.setHalted(true);else x.store.setConnectionFingerprint('desk','lighter','b'.repeat(64));gate.release();await tick;assert.equal(x.plans.get(x.proposal.requestId).status,'paused');assert.equal(x.counts().calls,0);}finally{x.close();}}
});

test('concurrent ticks do not duplicate cancellation or placement during exchange awaits',async()=>{
 const x=setup();try{await x.plans.start(x.proposal);await Promise.all([x.plans.tick(),x.plans.tick()]);assert.equal(x.counts().calls,1);x.advance();const gate=deferred(),entered=deferred();x.setCancelHook(async()=>{entered.release();await gate.promise;});const tick=x.plans.tick();await entered.promise;await x.plans.tick();assert.deepEqual(x.counts(),{calls:1,cancels:1});gate.release();await tick;assert.equal(x.plans.get(x.proposal.requestId).attempts[0].phase,'cancelling');}finally{x.close();}
});

test('restarts during either persisted mutation phase pause and never replay orders',async()=>{
 for(const phase of ['submitting','cancelling'] as const){const dir=mkdtempSync(join(tmpdir(),'qt-chase-')),path=join(dir,'runs.sqlite'),x=setup(path);let restarted:ChasePlans|undefined;
  try{await x.plans.start(x.proposal);await x.plans.tick();x.plans.close();const db=new DatabaseSync(path);const row=db.prepare('SELECT body FROM chase_runs WHERE id=?').get(x.proposal.requestId);assert(row);const run=JSON.parse(String(row.body));run.attempts[0].phase=phase;db.prepare('UPDATE chase_runs SET body=? WHERE id=?').run(JSON.stringify(run),x.proposal.requestId);db.close();restarted=new ChasePlans(path,x.desk,x.clients.evidence,x.clients.operations,x.clock);assert.equal(restarted.get(x.proposal.requestId).status,'paused');await restarted.tick();assert.deepEqual(x.counts(),{calls:1,cancels:0});}finally{restarted?.close();x.close();rmSync(dir,{recursive:true,force:true});}
 }
});
test('Chase cannot replace on oversized evidence or changed credentials',async()=>{
  const x=setup();try{await x.plans.start(x.proposal);await x.plans.tick();x.advance();await x.plans.tick();x.setEvidence({status:'settled',filledSize:'13',exchangeId:'100'});await x.plans.tick();assert.equal(x.plans.get(x.proposal.requestId).status,'paused');assert.equal(x.counts().calls,1);}finally{x.close();}
  const y=setup();try{await y.plans.start(y.proposal);y.store.setConnectionFingerprint('desk','lighter','b'.repeat(64));await y.plans.tick();assert.equal(y.plans.get(y.proposal.requestId).status,'paused');assert.equal(y.counts().calls,0);}finally{y.close();}
});

test('kill switch pauses placements but explicit cancellation can still settle the owned order',async()=>{
 const x=setup();try{await x.plans.start(x.proposal);await x.plans.tick();x.desk.setHalted(true);await x.plans.tick();assert.equal(x.plans.get(x.proposal.requestId).status,'paused');x.plans.cancel(x.proposal.requestId);await x.plans.tick();assert.deepEqual(x.counts(),{calls:1,cancels:1});x.setEvidence({status:'settled',filledSize:'2'});await x.plans.tick();assert.equal(x.plans.get(x.proposal.requestId).status,'cancelled');await x.plans.tick();assert.equal(x.counts().calls,1);}finally{x.close();}
});

test('production Chase quotes the fresh bid instead of the mark and rejects crossed books',async()=>{
 const x=setup();const runner=new ChasePlans(':memory:',x.desk,x.clients.evidence,x.clients.operations,x.clock,{book:async()=>({bids:[{price:'1.399',size:'100'}],asks:[{price:'1.401',size:'100'}],updatedAt:x.clock()})});
 try{await runner.start(x.proposal);await runner.tick();assert.equal(x.placed[0].price,'1.399');}finally{runner.close();x.close();}
 const y=setup();const invalid=new ChasePlans(':memory:',y.desk,y.clients.evidence,y.clients.operations,y.clock,{book:async()=>({bids:[{price:'1.401',size:'100'}],asks:[{price:'1.399',size:'100'}],updatedAt:y.clock()})});
 try{await assert.rejects(invalid.start(y.proposal),/Fresh uncrossed/);assert.equal(y.counts().calls,0);}finally{invalid.close();y.close();}
});
