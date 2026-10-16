import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NanoGptJobs} from '../src/server/nanogpt-jobs.ts';
import {createApp} from '../src/server/app.ts';
import {DeskStore} from '../src/server/store.ts';
import {TradingDesk} from '../src/server/trading.ts';
import {once} from 'node:events';

const input=()=>({requestId:randomUUID(),apiKey:'test-secret',request:{model:'test',stream:true,messages:[{role:'user',content:'OK'}]}});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('retains exact bytes across disconnected readers and never repeats an upstream request',async()=>{
 let calls=0;let source!:ReadableStreamDefaultController<Uint8Array>;
 const jobs=new NanoGptJobs(async(url,options)=>{calls++;assert.equal(String(url),'https://api.nano-gpt.com/api/v1/chat/completions');assert.equal(new Headers(options?.headers).get('Authorization'),'Bearer test-secret');return new Response(new ReadableStream({start(controller){source=controller;}}),{headers:{'Content-Type':'text/event-stream','X-Secret':'hidden'}});});
 try{const body=input();const id=jobs.start('owner',body);assert.equal(jobs.start('owner',body),id);await tick();source.enqueue(new Uint8Array([1,2,3]));await tick();const first=jobs.read('owner',id,0)!;assert.equal(first.headers.get('X-Secret'),null);const reader=first.body!.getReader();assert.deepEqual((await reader.read()).value,new Uint8Array([1,2,3]));await reader.cancel();source.enqueue(new Uint8Array([4,5]));source.close();await tick();assert.deepEqual(new Uint8Array(await jobs.read('owner',id,3)!.arrayBuffer()),new Uint8Array([4,5]));assert.equal(calls,1);assert.throws(()=>jobs.read('other',id,0));assert.throws(()=>jobs.start('owner',{...body,apiKey:'changed'}));}finally{jobs.close();}
});
test('pending, cancellation, invalid offsets, upstream failure and limits are safe',async()=>{
 let signal:AbortSignal|undefined;const jobs=new NanoGptJobs(async(_url,options)=>{signal=options?.signal??undefined;return await new Promise<Response>((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(new Error('test-secret'))));});
 try{const id=jobs.start('owner',input());assert.equal(jobs.read('owner',id,0),null);assert.throws(()=>jobs.read('owner',id,-1));assert.throws(()=>jobs.read('owner',id,1));for(let i=0;i<3;i++)jobs.start('owner',input());assert.throws(()=>jobs.start('owner',input()),/limit/i);jobs.cancel('owner',id);assert.equal(signal?.aborted,false);assert.equal(jobs.read('owner',id,0)?.status,502);}finally{jobs.close();}
 const failing=new NanoGptJobs(async()=>new Response('echo test-secret',{status:400}));try{const id=failing.start('owner',input());await tick();const response=failing.read('owner',id,0)!;assert.equal(response.status,400);assert(!((await response.text()).includes('test-secret')));}finally{failing.close();}
});
test('validates request before launching provider and bounds buffered output',async()=>{
 let calls=0;const jobs=new NanoGptJobs(async()=>{calls++;return new Response(new Uint8Array(8*1024*1024+1));});try{assert.throws(()=>jobs.start('owner',{...input(),request:{stream:false}}));assert.equal(calls,0);const id=jobs.start('owner',input());await tick();assert.equal(jobs.read('owner',id,0)?.status,502);}finally{jobs.close();}
});
test('HTTP endpoints require operator, preserve auth/origin checks, safely resume and reject malformed bodies',async()=>{
 const jobs=new NanoGptJobs(async()=>new Response('data: OK\n\n',{headers:{'Content-Type':'text/event-stream'}}));
 const store=new DeskStore(':memory:');const markets={list:async()=>[],candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()})};
 const desk=new TradingDesk(store,markets,{configured:false,place:async()=>{throw new Error('unexpected execution');},cancel:async()=>undefined},{mode:'paper',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost:4317'});
 const app=createApp({desk,markets,agent:{prepare:async()=>({summary:'No order',proposal:null})},operatorToken:'operator',agentToken:'agent',nanogptJobs:jobs});const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No server address');const base=`http://127.0.0.1:${address.port}/api/ai/nanogpt/jobs`;const headers={Authorization:'Bearer operator','Content-Type':'application/json'};
 try{
  assert.equal((await fetch(base)).status,401);assert.equal((await fetch(base,{method:'POST',headers:{...headers,Authorization:'Bearer agent'},body:JSON.stringify(input())})).status,403);
  assert.equal((await fetch(base,{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'})).status,403);
  const body=input();const created=await fetch(base,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(created.status,201);const {id}=await created.json() as {id:string};
  assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify(body)})).status,201);
  assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify({...body,apiKey:'changed'})})).status,409);
  const result=await fetch(`${base}/${id}`,{headers});assert.equal(result.status,200);assert.equal(result.headers.get('X-QuantTrade-AI-Upstream'),'1');assert.equal(await result.text(),'data: OK\n\n');
  const resumed=await fetch(`${base}/${id}?offset=6`,{headers});assert.equal(await resumed.text(),'OK\n\n');
  for(const offset of ['-1','1.5','9999','NaN','0&offset=1'])assert.equal((await fetch(`${base}/${id}?offset=${offset}`,{headers})).status,400);
  assert.equal((await fetch(base,{method:'POST',headers,body:'{"apiKey":"never-echo"'})).status,400);
  const tooBig=await fetch(base,{method:'POST',headers,body:JSON.stringify({...input(),padding:'s'.repeat(2*1024*1024)})});assert.equal(tooBig.status,413);assert(!(await tooBig.text()).includes('test-secret'));
  assert.equal((await fetch(`${base}/${id}`,{method:'DELETE',headers})).status,204);
  let limited=0;for(let n=0;n<241;n++)limited=(await fetch(`${base}/${id}?offset=0`,{headers})).status;
  assert.equal(limited,429);
  assert.equal((await fetch(base.replace('/ai/nanogpt/jobs','/status'),{headers})).status,200,'Inference polling must not consume the trading control rate budget');
 }finally{app.locals.hostedAuthClose();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
test('global active limit, retained job count and disposal cannot relaunch uncertain requests',async()=>{
 const pending=new NanoGptJobs(async(_url,options)=>new Promise<Response>((_resolve,reject)=>options.signal?.addEventListener('abort',()=>reject(new Error('aborted')))));
 try{for(let owner=0;owner<4;owner++)for(let n=0;n<4;n++)pending.start(String(owner),input());assert.throws(()=>pending.start('new-owner',input()),/limit/);}finally{pending.close();}
 assert.throws(()=>pending.start('new-owner',input()),/limit/);
 const retained=new NanoGptJobs(async()=>new Response('OK'));try{for(let n=0;n<64;n++){retained.start('owner',input());await tick();}assert.throws(()=>retained.start('owner',input()),/limit/);}finally{retained.close();}
});
test('reader cancellation leaves upstream active, but explicit job cancellation stops it',async()=>{
 let controller!:ReadableStreamDefaultController<Uint8Array>;let upstreamSignal:AbortSignal|undefined;
 const jobs=new NanoGptJobs(async(_url,options)=>{upstreamSignal=options.signal??undefined;return new Response(new ReadableStream({start(value){controller=value;}}));});
 try{const id=jobs.start('owner',input());await tick();const readers=Array.from({length:4},()=>jobs.read('owner',id,0)!.body!.getReader());assert.throws(()=>jobs.read('owner',id,0),/reader limit/);await readers[0].cancel();assert.equal(upstreamSignal?.aborted,false);controller.enqueue(new Uint8Array([9]));assert.deepEqual((await readers[1].read()).value,new Uint8Array([9]));jobs.cancel('owner',id);assert.equal(upstreamSignal?.aborted,true);await assert.rejects(readers[1].read(),/interrupted/);assert.equal(jobs.read('owner',id,0)?.status,502);}finally{jobs.close();}
});
test('provider midstream failures are terminal safe errors, never silently completed or retried',async()=>{
 let controller!:ReadableStreamDefaultController<Uint8Array>;let calls=0;const jobs=new NanoGptJobs(async()=>{calls++;return new Response(new ReadableStream({start(value){controller=value;}}));});
 try{const body=input();const id=jobs.start('owner',body);await tick();controller.enqueue(new Uint8Array([1]));await tick();const reader=jobs.read('owner',id,0)!.body!.getReader();await reader.read();controller.error(new Error('sensitive provider body'));await assert.rejects(reader.read(),/interrupted/);const failed=jobs.read('owner',id,1)!;assert.equal(failed.status,502);assert(!failed.headers.has('X-QuantTrade-AI-Upstream'));assert(!(await failed.text()).includes('sensitive'));assert.equal(jobs.start('owner',body),id);assert.equal(calls,1);}finally{jobs.close();}
});
test('deadline aborts provider and retention cleanup removes only expired completed jobs',async(context)=>{
 context.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:10_000});
 let signal:AbortSignal|undefined;const jobs=new NanoGptJobs(async(_url,options)=>{signal=options.signal??undefined;return new Promise<Response>((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(new Error('aborted'))));});
 try{const id=jobs.start('owner',input());context.mock.timers.tick(600_000);assert.equal(signal?.aborted,true);assert.equal(jobs.read('owner',id,0)?.status,502);context.mock.timers.tick(600_000);assert.throws(()=>jobs.read('owner',id,0),/not found/);}finally{jobs.close();context.mock.timers.reset();}
});
