import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server/app.ts';
import { TradingDesk } from '../src/server/trading.ts';
import { DeskStore } from '../src/server/store.ts';

test('native route distinguishes known pre-submission failures from uncertain attempted outcomes',async()=>{
  for(const behavior of ['absent','blocked','unknown'] as const){
    const store=new DeskStore(':memory:');
    const markets={list:async()=>[],candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()})};
    const desk=new TradingDesk(store,markets,{configured:true,place:async()=>{throw new Error('Unexpected live order');},cancel:async()=>{}},{mode:'live',accountName:'desk',maxOrderNotional:'100',dailyNotionalLimit:'1000',maxPriceDeviationBps:100,proposalTtlSeconds:180,pairlensUrl:'http://localhost'});
    const app=createApp({desk,markets,agent:{prepare:async()=>({summary:'No order',proposal:null})},operatorToken:'operator-token',agentToken:'agent-token',...(behavior==='absent'?{}:{lighterNativeOrders:{execute:async()=>{if(behavior==='blocked')throw new Error('Daily notional limit exceeded');return {status:'unknown' as const,result:{error:'Outcome is uncertain; inspect exchange'}};}}})});
    const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No server address');
    try{
      const response=await fetch(`http://127.0.0.1:${address.port}/api/terminal/lighter-native-orders`,{method:'POST',headers:{Authorization:'Bearer operator-token','Content-Type':'application/json'},body:'{}'});
      const result=await response.json() as Record<string,unknown>;
      assert.equal(response.status,behavior==='absent'?503:behavior==='blocked'?400:200);
      if(behavior==='unknown'){assert.equal(result.status,'unknown');assert(!('submissionAttempted' in result));}
      else {assert.equal(result.submissionAttempted,false);assert.equal(result.error,behavior==='absent'?'Native Lighter execution is unavailable':'Daily notional limit exceeded');}
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
  }
});
