import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../src/server/app.ts';
import {DeskStore} from '../src/server/store.ts';
import {TradingDesk} from '../src/server/trading.ts';
import type {MarketService} from '../src/server/markets.ts';

test('only operator fresh preparation recovers missing live metadata without trading or resuming',async()=>{
 const store=new DeskStore(':memory:');
 const markets:MarketService={list:async()=>[],candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()})};
 const desk=new TradingDesk(store,markets,{configured:true,place:async()=>{throw Error('No trades allowed');},cancel:async()=>{throw Error('No cancellations allowed');}},{mode:'live',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'https://quanttrade.example'});
 let verifies=0,pauses=0,fail=false,changeMode=false;
 const app=createApp({desk,markets,agent:{prepare:async()=>({summary:'',proposal:null})},execution:{account:async()=>({positions:{data:[],pagination:{has_more:false,next_cursor:null}},orders:{data:[],pagination:{has_more:false,next_cursor:null}}}),connect:async()=>{throw Error('No key replacement');},disconnect:async()=>{throw Error('No disconnect');},connections:async()=>['lighter'],balances:async()=>[],verifiedConnectionRevision:async()=>{verifies++;if(fail)throw Error('Verification unavailable');if(changeMode)desk.setVenueMode('lighter','paper');return 'a'.repeat(64);}},workflows:{start:async()=>{throw Error('No registration');},list:()=>[],cancel:()=>{throw Error('No cancellation');},pauseVenue:()=>{pauses++;}},operatorToken:'operator',agentToken:'agent'});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('No address');
 const base=`http://127.0.0.1:${address.port}`;
 const recover=(token='operator',accountName='desk')=>fetch(base+'/api/connections/lighter/recover',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({accountName})});
 try {
   assert.equal((await fetch(base+'/api/status',{headers:{Authorization:'Bearer operator'}})).status,200);assert.equal(verifies,0);assert.equal(store.connectionFingerprint('desk','lighter'),null);
   assert.equal((await recover('agent')).status,403);assert.equal((await recover('operator','other')).status,409);assert.equal(verifies,0);
   assert.equal((await recover()).status,200);assert.equal(store.connectionFingerprint('desk','lighter'),'a'.repeat(64));assert.equal(pauses,1);assert.equal(verifies,1);
   assert.equal((await recover()).status,200);assert.equal(verifies,1);assert.equal(pauses,1);
   desk.setVenueMode('lighter','paper');assert.equal((await recover()).status,409);
   store.setConnectionFingerprint('desk','lighter',null);desk.setVenueMode('lighter','live');fail=true;
   assert.notEqual((await recover()).status,200);assert.equal(store.connectionFingerprint('desk','lighter'),null);assert.equal(pauses,1);
   fail=false;changeMode=true;assert.notEqual((await recover()).status,200);assert.equal(store.connectionFingerprint('desk','lighter'),null);assert.equal(pauses,1);
 } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
