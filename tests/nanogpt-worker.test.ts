import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { z } from 'zod';
import { NanoGptJobs, type InferenceEvent } from '../src/server/nanogpt-jobs.ts';
import { createNanoGptWorker, NanoGptWorkerClient } from '../src/server/nanogpt-worker.ts';
import { createApp } from '../src/server/app.ts';
import { DeskStore } from '../src/server/store.ts';
import { TradingDesk } from '../src/server/trading.ts';

const owner = createHash('sha256').update('operator fixture').digest('hex');
const step = 'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
const input = () => ({requestId:randomUUID(),apiKey:'fixture-secret',request:{model:'fixture',stream:true,messages:[{role:'user',content:'OK'}]}});
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

for(const variant of [
  {name:'missing final newline',sse:step.trimEnd()},
  {name:'multiline data event',sse:'data: {"choices": [\ndata: {"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'},
])test(`atomic validation accepts valid SSE with ${variant.name}`,async()=>{
  let calls=0;const jobs=new NanoGptJobs(async()=>{calls++;return new Response(variant.sse,{headers:{'Content-Type':'text/event-stream'}});});
  try{const id=jobs.start(owner,input());await new Promise(resolve=>setTimeout(resolve,350));const response=jobs.read(owner,id,0)!;assert.equal(response.status,200);assert.equal(await response.text(),variant.sse);assert.equal(calls,1);}finally{jobs.close();}
});

test('a silent provider attempt times out and retries only its unexposed step with sanitized diagnostics',async()=>{
  let calls=0;const events:InferenceEvent[]=[];
  const jobs=new NanoGptJobs(async(_url,options)=>{
    calls++;
    if(calls===1)return new Promise<Response>((_resolve,reject)=>options.signal?.addEventListener('abort',()=>reject(new Error('private provider detail'))));
    return new Response(step,{headers:{'Content-Type':'text/event-stream'}});
  },event=>events.push(event),5);
  try {
    const body=input();body.request.model='Bearer fixture-secret';body.request.messages[0]!.content='secret-user-prompt';
    const id=jobs.start(owner,body);await new Promise(resolve=>setTimeout(resolve,350));
    assert.equal(await jobs.read(owner,id,0)!.text(),step);assert.equal(calls,2);
    assert.deepEqual(events.map(event=>event.event),['started','retry','completed']);assert.equal(events[1]!.detail,'provider-idle');
    assert(!JSON.stringify(events).includes('fixture-secret'));assert(!JSON.stringify(events).includes('secret-user-prompt'));
    assert.equal(events.at(-1)!.model,'redacted-model');
  } finally {jobs.close();}
});

test('old clients get atomic completion by default rather than partial tool bytes', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const jobs = new NanoGptJobs(async () => new Response(new ReadableStream({start(value){stream=value;}}),{headers:{'Content-Type':'text/event-stream'}}));
  try {
    const id = jobs.start(owner,input()); await tick();
    stream.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"unfinished"}}]}\n\n'));
    await tick(); assert.equal(jobs.read(owner,id,0),null);
    stream.enqueue(new TextEncoder().encode(step)); stream.close(); await tick();
    assert.equal(jobs.read(owner,id,0)!.status,200);
  } finally {jobs.close();}
});

test('independent worker retains the same provider job when bridge clients close and reconnect', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>; let calls=0;
  const jobs = new NanoGptJobs(async () => {calls++;return new Response(new ReadableStream({start(value){stream=value;}}),{headers:{'Content-Type':'text/event-stream'}});});
  const worker=createNanoGptWorker('worker-fixture-token',jobs);
  const server=worker.app.listen(0,'127.0.0.1'); await once(server,'listening');
  const address=server.address(); assert(address&&typeof address==='object'); const url=`http://127.0.0.1:${address.port}`;
  try {
    const first=new NanoGptWorkerClient(url,'worker-fixture-token'); const body=input();
    const id=await first.start(owner,body); assert.equal(await first.read(owner,id,0),null);
    first.close(); assert.equal(jobs.activeCount,1);
    const replacement=new NanoGptWorkerClient(url,'worker-fixture-token');
    assert.equal(await replacement.start(owner,body),id,'Lost startup acknowledgments recover the same request, never a second provider call');
    stream.enqueue(new TextEncoder().encode(step));stream.close();await tick();
    assert.equal(await (await replacement.read(owner,id,0))!.text(),step);assert.equal(calls,1);
    const wrongOwner=createHash('sha256').update('different session').digest('hex');
    assert.equal((await replacement.read(wrongOwner,id,0))!.status,404);
  } finally {worker.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('worker requires private authorization, owner scope and drains without cancelling accepted work', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const worker=createNanoGptWorker('worker-fixture-token',new NanoGptJobs(async()=>new Response(new ReadableStream({start(value){stream=value;}}),{headers:{'Content-Type':'text/event-stream'}})));
  const server=worker.app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(url+'/jobs',{method:'POST'})).status,401);
    assert.equal((await fetch(url+'/jobs',{method:'POST',headers:{Authorization:'Bearer worker-fixture-token','Content-Type':'application/json'},body:JSON.stringify(input())})).status,400);
    const client=new NanoGptWorkerClient(url,'worker-fixture-token');const body=input();const id=await client.start(owner,body);worker.drain();
    assert.equal(await client.start(owner,body),id,'A lost creation acknowledgment must recover even during drain');
    await assert.rejects(client.start(owner,input()),error=>error instanceof Error&&'status' in error&&error.status===503);
    assert.equal(worker.jobs.activeCount,1);stream.enqueue(new TextEncoder().encode(step));stream.close();await tick();
    assert.equal(await (await client.read(owner,id,0))!.text(),step);assert.equal(worker.jobs.activeCount,0);assert.equal(worker.jobs.retainedCount,1,'Completed but resumable output must survive a graceful stop');
    assert.throws(()=>new NanoGptWorkerClient('https://remote.invalid','key'),/local HTTP/);
  } finally {worker.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('authenticated HTTP inference resumes after the actual bridge application shuts down', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;let calls=0;
  const worker=createNanoGptWorker('worker-token',new NanoGptJobs(async()=>{calls++;return new Response(new ReadableStream({start(value){stream=value;}}),{headers:{'Content-Type':'text/event-stream'}});}));
  const workerServer=worker.app.listen(0,'127.0.0.1');await once(workerServer,'listening');
  const address=workerServer.address();assert(address&&typeof address==='object');const workerUrl=`http://127.0.0.1:${address.port}`;
  const store=new DeskStore(':memory:');const markets={list:async()=>[],candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()})};
  const desk=new TradingDesk(store,markets,{configured:false,place:async()=>{throw Error('No financial QA');},cancel:async()=>undefined},{mode:'paper',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost:4317'});
  const launch=async()=>{
    const app=createApp({desk,markets,agent:{prepare:async()=>({summary:'No order',proposal:null})},operatorToken:'operator',agentToken:'agent',nanogptJobs:new NanoGptWorkerClient(workerUrl,'worker-token')});
    const server=app.listen(0,'127.0.0.1');await once(server,'listening');const endpoint=server.address();assert(endpoint&&typeof endpoint==='object');
    return {base:`http://127.0.0.1:${endpoint.port}/api/ai/nanogpt/jobs`,close:async()=>{app.locals.hostedAuthClose();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
  };
  let bridge=await launch();const headers={Authorization:'Bearer operator','Content-Type':'application/json'};
  try {
    const created=await fetch(bridge.base,{method:'POST',headers,body:JSON.stringify(input())});assert.equal(created.status,201);
    const result=z.object({id:z.string().uuid()}).parse(await created.json());
    await bridge.close();assert.equal(worker.jobs.activeCount,1);bridge=await launch();
    assert.equal((await fetch(`${bridge.base}/${result.id}`,{headers})).status,202);
    stream.enqueue(new TextEncoder().encode(step));stream.close();await tick();
    assert.equal(await (await fetch(`${bridge.base}/${result.id}`,{headers})).text(),step);assert.equal(calls,1);
  } finally {await bridge.close();worker.close();workerServer.closeAllConnections();await new Promise<void>(resolve=>workerServer.close(()=>resolve()));store.close();}
});
