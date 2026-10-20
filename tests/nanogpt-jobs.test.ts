import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NanoGptJobs} from '../src/server/nanogpt-jobs.ts';
import {createApp} from '../src/server/app.ts';
import {DeskStore} from '../src/server/store.ts';
import {TradingDesk} from '../src/server/trading.ts';
import {once} from 'node:events';

const input=()=>({requestId:randomUUID(),atomic:false,apiKey:'test-secret',request:{model:'test',stream:true,messages:[{role:'user',content:'OK'}]}});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const completeStep='data: {"choices":[{"index":0,"delta":{"content":"Ready"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';

test('atomic inference withholds incomplete tool output and recovers one interrupted step',async()=>{
 let calls=0;let first!:ReadableStreamDefaultController<Uint8Array>;let second!:ReadableStreamDefaultController<Uint8Array>;
 const jobs=new NanoGptJobs(async()=>{calls++;return new Response(new ReadableStream({start(controller){if(calls===1)first=controller;else second=controller;}}),{headers:{'Content-Type':'text/event-stream'}});});
 try{const body={...input(),atomic:true};const id=jobs.start('owner',body);await tick();first.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"tool_calls":[{"id":"discard-this"}]}}]}\n\n'));await tick();assert.equal(jobs.read('owner',id,0),null,'No model output may escape before the step commits');first.error(new Error('private provider interruption'));await new Promise(resolve=>setTimeout(resolve,350));assert.equal(calls,2);assert.equal(jobs.read('owner',id,0),null);second.enqueue(new TextEncoder().encode(completeStep));second.close();await tick();assert.equal(await jobs.read('owner',id,0)!.text(),completeStep);assert.equal(jobs.start('owner',body),id);assert.equal(calls,2);}finally{jobs.close();}
});

test('atomic inference detects a silently truncated SSE step instead of pretending completion',async()=>{
 let calls=0;const jobs=new NanoGptJobs(async()=>{calls++;return new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',{headers:{'Content-Type':'text/event-stream'}});});
 try{const id=jobs.start('owner',{...input(),atomic:true});await new Promise(resolve=>setTimeout(resolve,350));const result=jobs.read('owner',id,0)!;assert.equal(result.status,502);assert.equal(result.headers.get('X-QuantTrade-AI-Failure'),'upstream-stream');assert.equal(calls,2);}finally{jobs.close();}
});

test('atomic inference refuses a token-limited step without replaying its incomplete tools',async()=>{
 let calls=0;const jobs=new NanoGptJobs(async()=>{calls++;return new Response('data: {"choices":[{"index":0,"delta":{"tool_calls":[{"id":"unfinished"}]},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});});
 try{const id=jobs.start('owner',{...input(),atomic:true});await tick();const response=jobs.read('owner',id,0)!;assert.equal(response.status,502);assert.equal(response.headers.get('X-QuantTrade-AI-Failure'),'incomplete-step');assert.equal(calls,1);}finally{jobs.close();}
});

test('atomic cancellation never retries and completion mode is bound to the request identity',async()=>{
 let calls=0;const jobs=new NanoGptJobs(async()=>{calls++;return new Response(new ReadableStream(),{headers:{'Content-Type':'text/event-stream'}});});
 try{const body={...input(),atomic:true};const id=jobs.start('owner',body);assert.throws(()=>jobs.start('owner',{...body,atomic:false}),/already used/);await tick();jobs.cancel('owner',id);await tick();assert.equal(jobs.read('owner',id,0)!.status,502);assert.equal(calls,1);}finally{jobs.close();}
});

test('atomic inference rejects multiple completions before starting a provider request',()=>{
 let calls=0;const jobs=new NanoGptJobs(async()=>{calls++;return new Response('');});
 try{const body=input();assert.throws(()=>jobs.start('owner',{...body,atomic:true,request:{...body.request,n:2}}),/single completion/);assert.equal(calls,0);}finally{jobs.close();}
});

test('recovers a transient provider startup failure within the same job',async()=>{
 let calls=0;const payloads:string[]=[];
 const jobs=new NanoGptJobs(async(_url,options)=>{calls++;payloads.push(String(options.body));if(calls===1)throw new TypeError('private network detail');return new Response('recovered');});
 try{const body=input();const id=jobs.start('owner',body);await new Promise(resolve=>setTimeout(resolve,350));const response=jobs.read('owner',id,0)!;assert.equal(response.status,200);assert.equal(await response.text(),'recovered');assert.equal(calls,2);assert.equal(payloads[0],payloads[1]);assert.equal(jobs.start('owner',body),id);assert.equal(calls,2);}finally{jobs.close();}
});

test('bounds startup recovery and distinguishes a terminal connection failure',async()=>{
 let calls=0;const jobs=new NanoGptJobs(async()=>{calls++;throw new Error('secret-key');});
 try{const id=jobs.start('owner',input());await new Promise(resolve=>setTimeout(resolve,350));const response=jobs.read('owner',id,0)!;assert.equal(calls,2);assert.equal(response.status,502);assert.equal(response.headers.get('X-QuantTrade-AI-Failure'),'upstream-connection');assert(!(await response.text()).includes('secret-key'));}finally{jobs.close();}
});

test('forwards only bounded provider diagnostics and retry guidance',async()=>{
 const jobs=new NanoGptJobs(async()=>new Response('private error body',{status:503,headers:{'X-Request-ID':'req-abc_123','Retry-After':'2','X-Private':'secret'}}));
 try{const id=jobs.start('owner',input());await tick();const response=jobs.read('owner',id,0)!;assert.equal(response.status,503);assert.equal(response.headers.get('X-Request-ID'),'req-abc_123');assert.equal(response.headers.get('Retry-After'),'2');assert.equal(response.headers.get('X-Private'),null);assert(!(await response.text()).includes('private error body'));}finally{jobs.close();}
});

test('never restarts an accepted provider stream and labels its interruption',async()=>{
 let calls=0;const jobs=new NanoGptJobs(async()=>{calls++;return new Response(new ReadableStream({start(controller){controller.error(new Error('private stream error'));}}));});
 try{const id=jobs.start('owner',input());await tick();const response=jobs.read('owner',id,0)!;assert.equal(response.status,502);assert.equal(response.headers.get('X-QuantTrade-AI-Failure'),'upstream-stream');assert.equal(calls,1);}finally{jobs.close();}
});

test('cancel during startup backoff prevents a second provider request',async()=>{
 let calls=0;const jobs=new NanoGptJobs(async()=>{calls++;throw new TypeError('offline');});
 try{const id=jobs.start('owner',input());await tick();jobs.cancel('owner',id);await new Promise(resolve=>setTimeout(resolve,350));assert.equal(calls,1);assert.equal(jobs.read('owner',id,0)!.headers.get('X-QuantTrade-AI-Failure'),'canceled');}finally{jobs.close();}
});

test('rejects unbounded or unsafe provider diagnostic headers',async()=>{
 const jobs=new NanoGptJobs(async()=>new Response('OK',{headers:{'X-Request-ID':'private bearer value','Retry-After':'999'}}));
 try{const id=jobs.start('owner',input());await tick();const response=jobs.read('owner',id,0)!;assert.equal(response.headers.get('X-Request-ID'),null);assert.equal(response.headers.get('Retry-After'),null);}finally{jobs.close();}
});

test('a waiting live reader receives every provider byte exactly once',async()=>{
 let source!:ReadableStreamDefaultController<Uint8Array>;
 const jobs=new NanoGptJobs(async()=>new Response(new ReadableStream({start(controller){source=controller;}})));
 try{
  const id=jobs.start('owner',input());await tick();
  const reader=jobs.read('owner',id,0)!.body!.getReader();
  const output:Uint8Array[]=[];
  const consume=(async()=>{for(;;){const part=await reader.read();if(part.done)break;output.push(part.value);}})();
  for(const word of ['Broad',' market',' is red',' today',' — €']){source.enqueue(new TextEncoder().encode(word));await tick();}
  source.close();await consume;
  assert.equal(Buffer.concat(output).toString('utf8'),'Broad market is red today — €');
 }finally{jobs.close();}
});
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
 let failUpstream=false;const jobs=new NanoGptJobs(async()=>{if(failUpstream)throw new TypeError('private connection detail');return new Response('data: OK\n\n',{headers:{'Content-Type':'text/event-stream','X-Request-ID':'safe-request-1','Retry-After':'2','X-Private':'not-forwarded'}});});
 const store=new DeskStore(':memory:');const markets={list:async()=>[],candles:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()})};
 const desk=new TradingDesk(store,markets,{configured:false,place:async()=>{throw new Error('unexpected execution');},cancel:async()=>undefined},{mode:'paper',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'2000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost:4317'});
 const app=createApp({desk,markets,agent:{prepare:async()=>({summary:'No order',proposal:null})},operatorToken:'operator',agentToken:'agent',nanogptJobs:jobs});const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No server address');const base=`http://127.0.0.1:${address.port}/api/ai/nanogpt/jobs`;const headers={Authorization:'Bearer operator','Content-Type':'application/json'};
 try{
  assert.equal((await fetch(base)).status,401);assert.equal((await fetch(base,{method:'POST',headers:{...headers,Authorization:'Bearer agent'},body:JSON.stringify(input())})).status,403);
  assert.equal((await fetch(base,{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'})).status,403);
  const body=input();const created=await fetch(base,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(created.status,201);const {id}=await created.json() as {id:string};
  assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify(body)})).status,201);
  assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify({...body,apiKey:'changed'})})).status,409);
  const result=await fetch(`${base}/${id}`,{headers});assert.equal(result.status,200);assert.equal(result.headers.get('X-QuantTrade-AI-Upstream'),'1');assert.equal(result.headers.get('X-Request-ID'),'safe-request-1');assert.equal(result.headers.get('Retry-After'),'2');assert.equal(result.headers.get('X-Private'),null);assert.equal(await result.text(),'data: OK\n\n');
  const resumed=await fetch(`${base}/${id}?offset=6`,{headers});assert.equal(await resumed.text(),'OK\n\n');
  for(const offset of ['-1','1.5','9999','NaN','0&offset=1'])assert.equal((await fetch(`${base}/${id}?offset=${offset}`,{headers})).status,400);
  assert.equal((await fetch(base,{method:'POST',headers,body:'{"apiKey":"never-echo"'})).status,400);
  const tooBig=await fetch(base,{method:'POST',headers,body:JSON.stringify({...input(),padding:'s'.repeat(2*1024*1024)})});assert.equal(tooBig.status,413);assert(!(await tooBig.text()).includes('test-secret'));
  assert.equal((await fetch(`${base}/${id}`,{method:'DELETE',headers})).status,204);
  const failed=await fetch(`${base}/${id}`,{headers});assert.equal(failed.status,200,'Deleting a completed response must not rewrite its recorded outcome');
  failUpstream=true;const failedJob=await fetch(base,{method:'POST',headers,body:JSON.stringify(input())});const failedId=(await failedJob.json() as {id:string}).id;await new Promise(resolve=>setTimeout(resolve,350));const terminal=await fetch(`${base}/${failedId}`,{headers});assert.equal(terminal.status,502);assert.equal(terminal.headers.get('X-QuantTrade-AI-Failure'),'upstream-connection');assert(!terminal.headers.has('X-QuantTrade-AI-Upstream'));assert(!(await terminal.text()).includes('private'));
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
