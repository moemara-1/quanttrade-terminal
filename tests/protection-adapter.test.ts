import test from 'node:test';
import assert from 'node:assert/strict';
import { DeskStore } from '../src/server/store.ts';
import { TradingDesk } from '../src/server/trading.ts';
import { createProtectionAdapter } from '../src/server/protection-adapter.ts';
import type { ProtectionRun } from '../src/server/advanced-protection.ts';

test('protection adapter cancels only a verified owned exit once and never retries uncertainty',async()=>{
 const store=new DeskStore(':memory:');store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));
 const desk=new TradingDesk(store,{list:async()=>[]},{configured:true,place:async()=>'',cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost'});
 const order={venue:'hyperliquid' as const,symbol:'GRAM-USDC',side:'sell' as const,type:'market' as const,size:'10',reduceOnly:true,trigger:{triggerType:'tp' as const,triggerPrice:'3'},rationale:'reviewed'};
 const run:ProtectionRun={id:'plan',fingerprint:'x',input:{id:'plan',kind:'native-twap',accountName:'desk',connectionRevision:'a'.repeat(64),venue:'hyperliquid',symbol:'GRAM-USDC',side:'buy',size:'10',sizeDecimals:2,reduceOnly:false,protection:{activation:'after-full-entry-fill',management:'managed',stopLossPrice:'1',takeProfits:[{price:'3',sizePercent:'100'}],maxExitNotional:'100'}},entryId:'123',status:'active',fills:[{id:'fill',size:'10'}],groups:[{requestId:'group',size:'10',exits:[{id:'native:hyperliquid:11',order,phase:'open',filledSize:'0'},{id:'native:hyperliquid:12',order,phase:'open',filledSize:'0'}]}],protectedSize:'10',spent:'40',stopEntryRequested:true,entryStopped:false,entrySettled:true};
 let calls=0,readFails=false;
 const adapter=createProtectionAdapter(desk,{chaseEvidence:async()=>{if(readFails)throw Error('Transient venue read');return {status:'open',exchangeId:'11',filledSize:'0'};}},{perform:async()=>{calls++;throw Error('uncertain');}},()=>{throw Error('No Chase access expected');});
 try{
  assert.equal(await adapter.stopEntry(run),true);
  await assert.rejects(adapter.cancelExit(run,'native:hyperliquid:11','cancel-key'),/uncertain/i);
  await assert.rejects(adapter.cancelExit(run,'native:hyperliquid:11','cancel-key'),/uncertain/i);
  assert.equal(calls,1);
  readFails=true;
  assert.deepEqual(await adapter.exitEvidence(run,order,'native:hyperliquid:11'),{status:'pending'});
  store.setConnectionFingerprint('desk','hyperliquid','b'.repeat(64));
  await assert.rejects(adapter.exitEvidence(run,order,'native:hyperliquid:11'),/connection|account/i);
  assert.throws(()=>adapter.authorize(run,true),/connection|account/i);
 }finally{store.close();}
});

test('managed protection rejects connection changes during proposal quote before any execution',async()=>{
 const store=new DeskStore(':memory:');store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));
 let executions=0,release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const now=Date.now();
 const desk=new TradingDesk(store,{list:async()=>{entered();await gate;return [{venue:'hyperliquid',symbol:'BTC-USDC',base:'BTC',price:'100',change24h:0,volume24h:'1000',fundingRate:0,openInterest:null,sizeDecimals:2,priceDecimals:2,minSize:'0.01',minNotional:'10',updatedAt:now}];}},{configured:true,place:async()=>{executions++;return 'native:hyperliquid:11';},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost'},()=>now);
 const tp={venue:'hyperliquid' as const,symbol:'BTC-USDC',side:'sell' as const,type:'market' as const,size:'1',reduceOnly:true,trigger:{triggerType:'tp' as const,triggerPrice:'110'},rationale:'reviewed'};
 const sl={...tp,trigger:{triggerType:'sl' as const,triggerPrice:'90'}};
 const run:ProtectionRun={id:'race',fingerprint:'x',input:{id:'race',kind:'chase',accountName:'desk',connectionRevision:'a'.repeat(64),venue:'hyperliquid',symbol:'BTC-USDC',side:'buy',size:'1',sizeDecimals:2,reduceOnly:false,protection:{activation:'verified-settled-attempt-fills',management:'managed',stopLossPrice:'90',takeProfits:[{price:'110',sizePercent:'100'}],maxExitNotional:'300'}},entryId:'owned',status:'active',fills:[{id:'entry-fill',size:'1'}],groups:[],protectedSize:'0',spent:'0',stopEntryRequested:false,entryStopped:false,entrySettled:true};
 const adapter=createProtectionAdapter(desk,{chaseEvidence:async()=>({status:'pending'})},{perform:async()=>{throw Error('No operation expected');}},()=>{throw Error('No Chase access expected');});
 try{
  const submitted=adapter.submitPair(run,[tp,sl],'race-protection');
  await started;store.setConnectionFingerprint('desk','hyperliquid','b'.repeat(64));release();
  await assert.rejects(submitted,/connection|account/i);
  assert.equal(executions,0);
  assert.equal(store.used('live',new Date(now).toISOString().slice(0,10)),'0');
 }finally{release();store.close();}
});

test('managed pair acknowledges first owned leg before connection change rejects second leg',async()=>{
 const store=new DeskStore(':memory:');store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));let executions=0;const now=Date.now();
 const desk=new TradingDesk(store,{list:async()=>[{venue:'hyperliquid',symbol:'BTC-USDC',base:'BTC',price:'100',change24h:0,volume24h:'1000',fundingRate:0,openInterest:null,sizeDecimals:2,priceDecimals:2,minSize:'0.01',minNotional:'10',updatedAt:now}]},{configured:true,place:async()=>{executions++;store.setConnectionFingerprint('desk','hyperliquid','b'.repeat(64));return 'native:hyperliquid:11';},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost'},()=>now);
 const tp={venue:'hyperliquid' as const,symbol:'BTC-USDC',side:'sell' as const,type:'market' as const,size:'1',reduceOnly:true,trigger:{triggerType:'tp' as const,triggerPrice:'110'},rationale:'reviewed'};const sl={...tp,trigger:{triggerType:'sl' as const,triggerPrice:'90'}};
 const run:ProtectionRun={id:'race',fingerprint:'x',input:{id:'race',kind:'chase',accountName:'desk',connectionRevision:'a'.repeat(64),venue:'hyperliquid',symbol:'BTC-USDC',side:'buy',size:'1',sizeDecimals:2,reduceOnly:false,protection:{activation:'verified-settled-attempt-fills',management:'managed',stopLossPrice:'90',takeProfits:[{price:'110',sizePercent:'100'}],maxExitNotional:'300'}},entryId:'owned',status:'active',fills:[{id:'entry-fill',size:'1'}],groups:[],protectedSize:'0',spent:'0',stopEntryRequested:false,entryStopped:false,entrySettled:true};
 const acknowledged:Array<{index:number;id:string}>=[];
 const adapter=createProtectionAdapter(desk,{chaseEvidence:async()=>({status:'pending'})},{perform:async()=>{throw Error('No operation expected');}},()=>{throw Error('No Chase access expected');});
 try{await assert.rejects(adapter.submitPair(run,[tp,sl],'ack-race',(index,id)=>{acknowledged.push({index,id});}),/connection|account/i);assert.equal(executions,1);assert.deepEqual(acknowledged,[{index:0,id:'native:hyperliquid:11'}]);}finally{store.close();}
});

import { AdvancedProtection } from '../src/server/advanced-protection.ts';
test('final protective quote cannot reserve beyond immutable preview caps',async()=>{
 const store=new DeskStore(':memory:');store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));const now=Date.now();let reads=0,executions=0;
 const desk=new TradingDesk(store,{list:async()=>[{venue:'hyperliquid',symbol:'BTC-USDC',base:'BTC',price:++reads<=4?'100':'120',change24h:0,volume24h:'1000',fundingRate:0,openInterest:null,sizeDecimals:2,priceDecimals:2,minSize:'0.01',minNotional:'10',updatedAt:now}]},{configured:true,place:async()=>{executions++;return 'native:hyperliquid:'+executions;},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost'},()=>now);
 const adapter=createProtectionAdapter(desk,{chaseEvidence:async()=>({status:'pending'})},{perform:async()=>{throw Error('No operation expected');}},()=>{throw Error('No Chase access expected');});const protection=new AdvancedProtection(':memory:',adapter);
 try{await protection.prepare({id:'budget-race',kind:'chase',accountName:'desk',connectionRevision:'a'.repeat(64),venue:'hyperliquid',symbol:'BTC-USDC',side:'buy',size:'1',sizeDecimals:2,reduceOnly:false,protection:{activation:'verified-settled-attempt-fills',management:'managed',stopLossPrice:'90',takeProfits:[{price:'110',sizePercent:'100'}],maxExitNotional:'211.1'}});protection.bindEntry('budget-race','owned');await protection.reconcile('budget-race',{complete:true,fills:[{id:'fill',size:'1'}],entrySettled:true});assert.equal(executions,0);assert.equal(protection.get('budget-race').status,'paused');assert.match(protection.get('budget-race').error??'',/notional.*cap/);assert.equal(store.used('live',new Date(now).toISOString().slice(0,10)),'0');}finally{protection.close();store.close();}
});

test('native paired protection enforces summed immutable preview cap before reservation',async()=>{
 const store=new DeskStore(':memory:');store.setConnectionFingerprint('desk','lighter','a'.repeat(64));const now=Date.now();let reads=0,executions=0;
 const desk=new TradingDesk(store,{list:async()=>[{venue:'lighter',symbol:'BTC-USDC',base:'BTC',price:++reads<=4?'100':'120',change24h:0,volume24h:'1000',fundingRate:0,openInterest:null,sizeDecimals:2,priceDecimals:2,minSize:'0.01',minNotional:'10',updatedAt:now}]},{configured:true,place:async()=>{throw Error('Unexpected standalone exit');},placeBracket:async()=>{executions++;return 'native-oco:lighter:11,12';},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost'},()=>now);
 const adapter=createProtectionAdapter(desk,{chaseEvidence:async()=>({status:'pending'})},{perform:async()=>{throw Error('No operation expected');}},()=>{throw Error('No Chase access expected');});const protection=new AdvancedProtection(':memory:',adapter);
 try{await protection.prepare({id:'budget-race',kind:'chase',accountName:'desk',connectionRevision:'a'.repeat(64),venue:'lighter',symbol:'BTC-USDC',side:'buy',size:'1',sizeDecimals:2,reduceOnly:false,protection:{activation:'verified-settled-attempt-fills',management:'managed',stopLossPrice:'90',takeProfits:[{price:'110',sizePercent:'100'}],maxExitNotional:'211.1'}});protection.bindEntry('budget-race','owned');await protection.reconcile('budget-race',{complete:true,fills:[{id:'fill',size:'1'}],entrySettled:true});assert.equal(executions,0);assert.equal(protection.get('budget-race').status,'paused');assert.match(protection.get('budget-race').error??'',/notional.*cap/);assert.equal(store.used('live',new Date(now).toISOString().slice(0,10)),'0');}finally{protection.close();store.close();}
});

test('builder protective cancellation retains native namespace and connector pair case',async()=>{
 const store=new DeskStore(':memory:');store.setConnectionFingerprint('desk','hyperliquid','a'.repeat(64));
 const desk=new TradingDesk(store,{list:async()=>[]},{configured:true,place:async()=>'',cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost'});
 const order={venue:'hyperliquid' as const,symbol:'para:PAPER-USDC',side:'sell' as const,type:'market' as const,size:'10',reduceOnly:true,trigger:{triggerType:'tp' as const,triggerPrice:'3'},rationale:'reviewed'};
 const run:ProtectionRun={id:'plan',fingerprint:'x',input:{id:'plan',kind:'native-twap',accountName:'desk',connectionRevision:'a'.repeat(64),venue:'hyperliquid',symbol:'para:PAPER-USDC',side:'buy',size:'10',sizeDecimals:2,reduceOnly:false,protection:{activation:'after-full-entry-fill',management:'managed',stopLossPrice:'1',takeProfits:[{price:'3',sizePercent:'100'}],maxExitNotional:'100'}},entryId:'123',status:'active',fills:[{id:'fill',size:'10'}],groups:[{requestId:'group',size:'10',exits:[{id:'native:hyperliquid:11',order,phase:'open',filledSize:'0'},{id:'native:hyperliquid:12',order,phase:'open',filledSize:'0'}]}],protectedSize:'10',spent:'40',stopEntryRequested:true,entryStopped:false,entrySettled:true};
 let calls=0,readFails=false,wirePair:unknown;
 const adapter=createProtectionAdapter(desk,{chaseEvidence:async()=>{if(readFails)throw Error('Transient venue read');return {status:'open',exchangeId:'11',filledSize:'0'};}},{perform:async(_action,input)=>{calls++;wirePair=input.trading_pair;throw Error('uncertain');}},()=>{throw Error('No Chase access expected');});
 try{
  assert.equal(await adapter.stopEntry(run),true);
  await assert.rejects(adapter.cancelExit(run,'native:hyperliquid:11','cancel-key'),/uncertain/i);
  await assert.rejects(adapter.cancelExit(run,'native:hyperliquid:11','cancel-key'),/uncertain/i);
  assert.equal(calls,1);assert.equal(wirePair,'PARA:PAPER-USD');
  readFails=true;
  assert.deepEqual(await adapter.exitEvidence(run,order,'native:hyperliquid:11'),{status:'pending'});
  store.setConnectionFingerprint('desk','hyperliquid','b'.repeat(64));
  await assert.rejects(adapter.exitEvidence(run,order,'native:hyperliquid:11'),/connection|account/i);
  assert.throws(()=>adapter.authorize(run,true),/connection|account/i);
 }finally{store.close();}
});
