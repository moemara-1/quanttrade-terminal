import test from 'node:test';
import assert from 'node:assert/strict';
import { ProposalAgent } from '../src/server/agent.ts';
import { TradingDesk } from '../src/server/trading.ts';
import { DeskStore } from '../src/server/store.ts';
import type { MarketService } from '../src/server/markets.ts';

function setup(output: unknown) {
  const store=new DeskStore(':memory:');
  const markets: MarketService={list:async()=>[{venue:'hyperliquid',symbol:'BTC-USDC',base:'BTC',price:'100',change24h:0,volume24h:'1',fundingRate:0,openInterest:'1',sizeDecimals:3,priceDecimals:2,minSize:'0.001',minNotional:'10',updatedAt:Date.now()}],candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()})};
  const desk=new TradingDesk(store,markets,{configured:false,place:async()=>{throw new Error('Agent must not execute');},cancel:async()=>undefined},{mode:'paper',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost:3000'});
  const agent=new ProposalAgent({url:'http://localhost:11434/v1',model:'fixture-model',key:''},markets,desk,async()=>Response.json({choices:[{message:{content:JSON.stringify(output)}}]}));
  return {store,agent};
}
const order={venue:'hyperliquid',symbol:'BTC-USDC',side:'buy',type:'limit',size:'1',price:'100',rationale:'User requested a one-unit buy'};
test('model can only create an unapproved proposal',async()=>{
  const {store,agent}=setup({summary:'Draft for review',order});
  try { const result=await agent.prepare('Prepare one BTC buy','hyperliquid','BTC-USDC'); assert.equal(result.proposal?.source,'agent');assert.equal(result.proposal?.status,'pending'); }
  finally {store.close();}
});
test('model output cannot select a different market or sneak in execution controls',async()=>{
  for (const changed of [{...order,symbol:'ETH-USDC'},{...order,approved:true},{...order,size:'1000000'}]) {
    const {store,agent}=setup({summary:'Untrusted model output',order:changed});
    try {await assert.rejects(agent.prepare('test','hyperliquid','BTC-USDC'));assert.equal(store.list().length,0);}
    finally {store.close();}
  }
});
test('model may ask for missing information without generating an order',async()=>{
  const {store,agent}=setup({summary:'Specify side and size.',order:null});
  try {assert.equal((await agent.prepare('Help me','hyperliquid','BTC-USDC')).proposal,null);assert.equal(store.list().length,0);}
  finally {store.close();}
});

test('agent spot drafts stay pending and cannot switch between spot and perpetual',async()=>{
 const {store,agent}=setup({summary:'Spot draft',order:{...order,marketType:'spot'}});
 try {assert.equal((await agent.prepare('Prepare spot buy','hyperliquid','BTC-USDC','spot')).proposal?.status,'pending');}
 finally{store.close();}
 const mismatch=setup({summary:'Wrong market type',order});
 try{await assert.rejects(mismatch.agent.prepare('Spot buy','hyperliquid','BTC-USDC','spot'),/different market/);}
 finally{mismatch.store.close();}
});
