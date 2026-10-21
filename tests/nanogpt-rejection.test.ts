import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NanoGptJobs,type InferenceEvent} from '../src/server/nanogpt-jobs.ts';
const input=()=>({requestId:randomUUID(),apiKey:'secret-key',request:{model:'test',stream:true,messages:[{role:'user',content:'private conversation'}]}});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
for(const [message,category] of [
 ['maximum context length exceeded','context-length'],
 ['tool messages must respond to preceding tool_calls','tool-history'],
 ['missing reasoning_content','reasoning-history'],
 ['model not found','model'],
 ['unsupported parameter temperature','parameter'],
 ['rate limit exceeded','rate-limit'],
 ['insufficient balance','balance'],
 ['echo secret-key private conversation','unknown'],
])test(`provider rejection safely classifies ${category}: ${message}`,async()=>{
 const events:InferenceEvent[]=[];let calls=0;
 const jobs=new NanoGptJobs(async()=>{calls++;return new Response(JSON.stringify({error:{message:`${message}; secret-key private conversation`}}),{status:400,headers:{'Content-Type':'application/json','X-QuantTrade-AI-Rejection':'malicious'}});},event=>events.push(event));
 try{const id=jobs.start('owner',input());await tick();const response=jobs.read('owner',id,0)!;assert.equal(response.status,400);assert.equal(response.headers.get('X-QuantTrade-AI-Rejection'),category);assert.equal(events.at(-1)?.event,'failed');assert.equal(events.at(-1)?.rejection,category);assert.equal(calls,1);assert(!JSON.stringify(events).includes('secret-key'));const output=await response.text();assert(!output.includes('private conversation'));assert(!output.includes('secret-key'));}finally{jobs.close();}
});
test('oversized rejection body is canceled at 16KiB without retaining arbitrary text',async()=>{
 let canceled=false,pulls=0;
 const jobs=new NanoGptJobs(async()=>new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(8192).fill(120));},cancel(){canceled=true;}}),{status:400}));
 try{const id=jobs.start('owner',input());await tick();const response=jobs.read('owner',id,0)!;assert.equal(response.status,400);assert.equal(response.headers.get('X-QuantTrade-AI-Rejection'),'unknown');assert(canceled);assert(pulls<=3);assert((await response.text()).length<200);}finally{jobs.close();}
});
test('stalled rejection stream retains the provider status and does not retry',async()=>{
 let canceled=false,calls=0;
 const jobs=new NanoGptJobs(async()=>{calls++;return new Response(new ReadableStream({cancel(){canceled=true;}}),{status:400});});
 try{const id=jobs.start('owner',input());await new Promise(resolve=>setTimeout(resolve,1150));const response=jobs.read('owner',id,0)!;assert.equal(response.status,400);assert.equal(response.headers.get('X-QuantTrade-AI-Rejection'),'unknown');assert(canceled);assert.equal(calls,1);}finally{jobs.close();}
});

for(const body of [{error:'context length exceeded; secret-key'},{message:'context length exceeded; secret-key'},{error:{code:'context_length_exceeded'}},{error:{type:'context_length_exceeded'}}])test('recognizes bounded NanoGPT error-shape variants without exposing fields',async()=>{
 const jobs=new NanoGptJobs(async()=>new Response(JSON.stringify(body),{status:400}));
 try{const id=jobs.start('owner',input());await tick();const response=jobs.read('owner',id,0)!;assert.equal(response.headers.get('X-QuantTrade-AI-Rejection'),'context-length');assert(!JSON.stringify(await response.json()).includes('secret-key'));}finally{jobs.close();}
});
