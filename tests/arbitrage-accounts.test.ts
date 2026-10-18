import test from 'node:test';
import assert from 'node:assert/strict';
import {readArbitrageAccount} from '../src/server/arbitrage-accounts.ts';
const revision='a'.repeat(64);
test('paired account reads verify connection and retain current exact collateral scope',async()=>{
 const account=await readArbitrageAccount('lighter',{state:()=>({accountName:'desk',mode:'live',connectionRevision:revision}),connections:async()=>['lighter'],balances:async()=>[{currency:'USDC',available:'52.123'}]},()=>100);
 assert.deepEqual(account,{accountName:'desk',mode:'live',connectionRevision:revision,availableMargin:'52.123',observedAt:100});
});
test('missing or changed connection and ambiguous collateral never become funds',async()=>{
 let calls=0;
 await assert.rejects(readArbitrageAccount('lighter',{state:()=>({accountName:'desk',mode:'live',connectionRevision:null}),connections:async()=>['lighter'],balances:async()=>{calls++;return[];}}),/verified/);
 assert.equal(calls,0);
 const state={accountName:'desk',mode:'live' as const,connectionRevision:revision};
 await assert.rejects(readArbitrageAccount('lighter',{state:()=>({...state}),connections:async()=>['lighter'],balances:async()=>{state.connectionRevision='b'.repeat(64);return[{currency:'USDC',available:'100'}];}}),/changed/);
 await assert.rejects(readArbitrageAccount('lighter',{state:()=>state,connections:async()=>['lighter'],balances:async()=>[{currency:'USDC',available:'100'},{currency:'USD',available:'100'}]}),/ambiguous/);
});
