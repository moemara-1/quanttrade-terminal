import test from 'node:test';
import assert from 'node:assert/strict';
import { AdvancedProtection } from '../src/server/advanced-protection.ts';
import { ProtectionMonitor } from '../src/server/protection-monitor.ts';
import type { ProtectionInput } from '../src/server/advanced-protection.ts';
import type { ChaseRun } from '../src/server/chase-plans.ts';
import { once } from 'node:events';
import { createApp } from '../src/server/app.ts';
import { DeskStore } from '../src/server/store.ts';
import { TradingDesk } from '../src/server/trading.ts';
import { HyperliquidNativeTwap } from '../src/server/hyperliquid-native-twap.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('native protection monitor withholds partial TWAP and reconciles exact full stable fills',async()=>{
 let pairs=0,full=false;
 const protection=new AdvancedProtection(':memory:',{authorize:()=>{},previewExit:async()=>({notional:'1'}),submitPair:async()=>({ids:['tp'+(++pairs),'sl'+pairs]}),exitEvidence:async()=>({status:'open',filledSize:'0'}),cancelExit:async()=>{},stopEntry:async()=>true});
 await protection.prepare({id:'plan',kind:'native-twap',accountName:'desk',connectionRevision:'a'.repeat(64),venue:'hyperliquid',symbol:'GRAM-USDC',side:'buy',size:'10',sizeDecimals:1,reduceOnly:false,protection:{activation:'after-full-entry-fill',management:'managed',stopLossPrice:'1',takeProfits:[{price:'3',sizePercent:'100'}],maxExitNotional:'100'}});protection.bindEntry('plan','123');
 const monitor=new ProtectionMonitor(protection,{evidence:async()=>({twap_id:'123',verified_fill_size:full?'10':'5',fills:[{id:'one',size:'5'},...(full?[{id:'two',size:'5'}]:[])],history_may_be_truncated:false})},{get:()=>{throw Error('Unexpected Chase read');}});
 try{await monitor.tick();assert.equal(pairs,0);full=true;await monitor.tick();assert.equal(pairs,1);assert.equal(protection.get('plan').protectedSize,'10');await monitor.tick();assert.equal(pairs,1);}finally{await monitor.close();protection.close();}
});

const monitoredInput:ProtectionInput={id:'plan',kind:'native-twap',accountName:'desk',connectionRevision:'a'.repeat(64),venue:'hyperliquid',symbol:'GRAM-USDC',side:'buy',size:'10',sizeDecimals:1,reduceOnly:false,protection:{activation:'after-full-entry-fill',management:'managed',stopLossPrice:'1',takeProfits:[{price:'3',sizePercent:'100'}],maxExitNotional:'100'}};
function setupMonitor(path=':memory:'){let pairs=0;const protection=new AdvancedProtection(path,{authorize:()=>{},previewExit:async()=>({notional:'1'}),submitPair:async()=>({ids:['tp'+(++pairs),'sl'+pairs]}),exitEvidence:async()=>({status:'open',filledSize:'0'}),cancelExit:async()=>{},stopEntry:async()=>true});return {protection,pairs:()=>pairs};}

test('native monitor rejects mismatched identity, duplicate fills and inconsistent verified sums',async()=>{
 for(const proof of [
  {twap_id:'999',verified_fill_size:'10',fills:[{id:'one',size:'10'}],history_may_be_truncated:false},
  {twap_id:'123',verified_fill_size:'10',fills:[{id:'one',size:'5'},{id:'one',size:'5'}],history_may_be_truncated:false},
  {twap_id:'123',verified_fill_size:'10',fills:[{id:'one',size:'5'}],history_may_be_truncated:false},
 ]){const x=setupMonitor();await x.protection.prepare(monitoredInput);x.protection.bindEntry('plan','123');const monitor=new ProtectionMonitor(x.protection,{evidence:async()=>proof},{get:()=>{throw Error('Unexpected Chase read');}});try{await monitor.tick();assert.equal(x.pairs(),0);assert.equal(x.protection.get('plan').status,'waiting-evidence');}finally{await monitor.close();x.protection.close();}}
});

test('truncated history is accepted only when stable exact fills cover the entire reviewed native quantity',async()=>{
 const x=setupMonitor();await x.protection.prepare(monitoredInput);x.protection.bindEntry('plan','123');let full=false;
 const monitor=new ProtectionMonitor(x.protection,{evidence:async()=>({twap_id:'123',verified_fill_size:full?'10':'5',fills:[{id:'one',size:full?'10':'5'}],history_may_be_truncated:true})},{get:()=>{throw Error('Unexpected Chase read');}});
 try{await monitor.tick();assert.equal(x.pairs(),0);full=true;await monitor.tick();assert.equal(x.pairs(),1);}finally{await monitor.close();x.protection.close();}
});

test('settled Chase attempts retain protection while active, completed or cancelled',async()=>{
 for(const status of ['active','completed','cancelled'] as const){
  const x=setupMonitor();const input={...monitoredInput,kind:'chase' as const,protection:{...monitoredInput.protection,activation:'verified-settled-attempt-fills' as const}};await x.protection.prepare(input);x.protection.bindEntry('plan','plan');
  const order={venue:'hyperliquid' as const,symbol:'GRAM-USDC',side:'buy' as const,type:'limit' as const,size:'10',price:'2',rationale:'reviewed'};
  const entry:ChaseRun={id:'plan',fingerprint:'x',plan:{requestId:'plan',proposedAt:0,credentialId:'credential',accountName:'desk',connectionRevision:'a'.repeat(64),mode:'live',venue:'hyperliquid',marketType:'perpetual',symbol:'GRAM-USDC',side:'buy',size:'10',lowerPrice:'1',upperPrice:'3',durationSeconds:30,intervalSeconds:10,maxAttempts:2,maxTotalNotional:'100'},startedAt:0,deadline:30000,status,attempts:[{order,orderId:'owned',phase:'settled',submittedAt:0,filledSize:'10'}],filledSize:'10',spent:'20',stopRequested:false};
  const monitor=new ProtectionMonitor(x.protection,{evidence:async()=>{throw Error('Unexpected native read');}},{get:()=>entry});
  if(status==='active')entry.attempts.push({order,orderId:'pending-child',phase:'open',submittedAt:1});
  try{await monitor.tick();assert.equal(x.pairs(),1);assert.equal(x.protection.get('plan').entrySettled,status!=='active');}finally{await monitor.close();x.protection.close();}
 }
});

test('monitor sends immutable native entry scope and close waits for the ongoing tick',async()=>{
 const x=setupMonitor();await x.protection.prepare(monitoredInput);x.protection.bindEntry('plan','123');let release:()=>void=()=>{throw Error('No pending evidence');};let requested:unknown;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const monitor=new ProtectionMonitor(x.protection,{evidence:async request=>{requested=request;await gate;return {twap_id:'123',verified_fill_size:'10',fills:[{id:'one',size:'10'}],history_may_be_truncated:false};}},{get:()=>{throw Error('Unexpected Chase read');}});
 const tick=monitor.tick();let closed=false;const closing=monitor.close().then(()=>{closed=true;});
 try{await Promise.resolve();assert.equal(closed,false);assert.deepEqual(requested,{requestId:'plan',accountName:'desk',connectionRevision:'a'.repeat(64),symbol:'GRAM-USDC',twapId:'123',side:'buy',size:'10'});release();await tick;await closing;assert.equal(closed,true);assert.equal(x.pairs(),1);await monitor.tick();assert.equal(x.pairs(),1);}finally{release();await monitor.close();x.protection.close();}
});

test('protection status requires operator credentials and the current live connection scope',async()=>{
 const x=setupMonitor();const requestId='00000000-0000-4000-8000-000000000001';await x.protection.prepare({...monitoredInput,id:requestId});
 const store=new DeskStore(':memory:');store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));
 const markets={list:async()=>[],candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()})};
 const desk=new TradingDesk(store,markets,{configured:true,place:async()=>{throw Error('No trading in status test');},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost'});
 const server=createApp({desk,markets,advancedProtection:x.protection,agent:{prepare:async()=>({summary:'none',proposal:null})},operatorToken:'operator',agentToken:'agent'}).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('No test server address');
 const url=`http://127.0.0.1:${address.port}/api/advanced-protection?requestId=${requestId}`;
 try{assert.equal((await fetch(url,{headers:{Authorization:'Bearer agent'}})).status,403);const response=await fetch(url,{headers:{Authorization:'Bearer operator'}});assert.equal(response.status,200);assert.equal((await response.json() as {run:{id:string}}).run.id,requestId);store.setConnectionFingerprint('desk','hyperliquid','b'.repeat(64));assert.notEqual((await fetch(url,{headers:{Authorization:'Bearer operator'}})).status,200);store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));desk.setVenueMode('hyperliquid','paper');assert.notEqual((await fetch(url,{headers:{Authorization:'Bearer operator'}})).status,200);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));x.protection.close();store.close();}
});

test('restart binds an accepted native receipt to prepared protection without replaying the entry',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'protection-binding-'));const path=join(directory,'protection.sqlite');const requestId='00000000-0000-4000-8000-000000000002';const input={...monitoredInput,id:requestId};let x=setupMonitor(path);await x.protection.prepare(input);x.protection.close();x=setupMonitor(path);
 const store=new DeskStore(':memory:');store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));const markets={list:async()=>[]};const desk=new TradingDesk(store,markets,{configured:true,place:async()=>{throw Error('No entry replay');},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost'});
 const plan={requestId,proposedAt:0,credentialId:'credential',accountName:'desk',connectionRevision:'a'.repeat(64),mode:'live',venue:'hyperliquid',marketType:'perpetual',symbol:'GRAM-USDC',action:'create',side:'buy',size:'10',durationMinutes:5,randomize:false,reduceOnly:false,acceptNativeRisk:true,referenceNotionalBudget:'100',protection:input.protection};
 store.claimOperation(requestId,'seeded-owned-receipt');store.finishOperation(requestId,'completed',{status:'accepted',twap_id:'123',reviewedPlan:plan});let reads=0;
 const native=new HyperliquidNativeTwap(desk,{perform:async action=>{assert.equal(action,'hyperliquid-twap-evidence');reads++;return {twap_id:'123',verified_fill_size:'10',fills:[{id:'one',size:'10'}],history_may_be_truncated:false};}},markets);
 const monitor=new ProtectionMonitor(x.protection,native,{get:()=>{throw Error('No Chase access');}});
 try{await monitor.tick();assert.equal(x.protection.get(requestId).entryId,'123');assert.equal(x.pairs(),1);assert.equal(reads,1);assert.equal(native.recoverOwnedEntry({...input,protection:{...input.protection,stopLossPrice:'0.9'}}),undefined);store.finishOperation(requestId,'unknown',{status:'accepted',twap_id:'123',reviewedPlan:plan});assert.equal(native.recoverOwnedEntry(input),undefined);}finally{await monitor.close();x.protection.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test('restart binds only acknowledged Chase attempts with the exact immutable protection specification',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'protection-chase-binding-'));const path=join(directory,'protection.sqlite');const input={...monitoredInput,kind:'chase' as const,protection:{...monitoredInput.protection,activation:'verified-settled-attempt-fills' as const}};let x=setupMonitor(path);await x.protection.prepare(input);x.protection.close();x=setupMonitor(path);
 const order={venue:'hyperliquid' as const,symbol:'GRAM-USDC',side:'buy' as const,type:'limit' as const,size:'10',price:'2',rationale:'reviewed'};
 const entry:ChaseRun={id:'plan',fingerprint:'x',plan:{requestId:'plan',proposedAt:0,credentialId:'credential',accountName:'desk',connectionRevision:'a'.repeat(64),mode:'live',venue:'hyperliquid',marketType:'perpetual',symbol:'GRAM-USDC',side:'buy',size:'10',lowerPrice:'1',upperPrice:'3',durationSeconds:30,intervalSeconds:10,maxAttempts:2,maxTotalNotional:'100',protection:{...input.protection,stopLossPrice:'0.9'}},startedAt:0,deadline:30000,status:'completed',attempts:[{order,orderId:'owned',phase:'settled',submittedAt:0,filledSize:'10'}],filledSize:'10',spent:'20',stopRequested:false};
 const monitor=new ProtectionMonitor(x.protection,{evidence:async()=>{throw Error('No native read');}},{get:()=>entry});
 try{await monitor.tick();assert.equal(x.protection.get('plan').entryId,undefined);entry.plan.protection=input.protection;entry.attempts[0].phase='submitting';await monitor.tick();assert.equal(x.protection.get('plan').entryId,undefined);entry.attempts[0].phase='settled';await monitor.tick();assert.equal(x.protection.get('plan').entryId,'plan');assert.equal(x.pairs(),1);}finally{await monitor.close();x.protection.close();rmSync(directory,{recursive:true,force:true});}
});
