import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {get, type ServerResponse} from 'node:http';
import {createApp} from '../src/server/app.ts';
import {DeskStore} from '../src/server/store.ts';
import {TradingDesk} from '../src/server/trading.ts';

async function fixture(){
 const store=new DeskStore(':memory:');
 const markets={list:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()}),candles:async()=>[]};
 const desk=new TradingDesk(store,markets,{configured:false,place:async()=>{throw new Error('Unexpected execution');},cancel:async()=>undefined},{mode:'paper',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost:4317'});
 const schedule={entries:[],start:'2026-10-24',end:'2026-10-24',fetchedAt:'now'};
 const pending:Array<()=>void>=[];
 let entered:()=>void=()=>undefined;
 const app=createApp({desk,markets,agent:{prepare:async()=>({summary:'none',proposal:null})},operatorToken:'operator',agentToken:'agent',calendars:{earnings:async()=>{await new Promise<void>(resolve=>{pending.push(resolve);entered();});return schedule;},ipos:async()=>schedule,economic:async()=>({...schedule,sources:{available:[],unavailable:[]}})}});
 const server=app.listen(0,'127.0.0.1');
 const responses:ServerResponse[]=[];
 server.on('request',(_request,response)=>responses.push(response));
 await once(server,'listening');
 const address=server.address();if(!address||typeof address==='string')throw new Error('Missing server address');
 const base=`http://127.0.0.1:${address.port}`;
 return {base,pending,async hold(){
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const request=get(base+'/api/earnings-calendar');
  request.on('error',()=>undefined); // Deliberate disconnects are expected below.
  await started;
  const response=responses.at(-1)!;
  return {request,response};
 },async close(){pending.forEach(resolve=>resolve());server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));app.locals.hostedAuthClose();store.close();}};
}

test('aborted public feed responses release all sixteen request slots',async()=>{
 const f=await fixture();
 try{
  for(let index=0;index<16;index++){
   const held=await f.hold();
   const closed=once(held.response,'close');
   held.request.destroy();
   await closed;
  }
  const response=await fetch(f.base+'/api/ipo-calendar');
  assert.equal(response.status,200,'Disconnected clients must not permanently exhaust data concurrency');
 }finally{await f.close();}
});

test('finish followed by close releases once and preserves sixteen concurrent slots',async()=>{
 const f=await fixture();
 try{
  for(let index=0;index<20;index++)assert.equal((await fetch(f.base+'/api/ipo-calendar')).status,200);
  for(let index=0;index<16;index++)await f.hold();
  const blocked=await fetch(f.base+'/api/ipo-calendar');
  assert.equal(blocked.status,429,'Normal finish+close must not decrement capacity twice');
  assert.equal(blocked.headers.get('retry-after'),'60');
 }finally{await f.close();}
});

test('completed public feed requests still enforce the 240 per minute budget',async()=>{
 const f=await fixture();
 try{
  for(let index=0;index<240;index++)assert.equal((await fetch(f.base+'/api/ipo-calendar')).status,200);
  assert.equal((await fetch(f.base+'/api/ipo-calendar')).status,429);
 }finally{await f.close();}
});
