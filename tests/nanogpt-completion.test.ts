import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NanoGptJobs} from '../src/server/nanogpt-jobs.ts';

const request=()=>({requestId:randomUUID(),apiKey:'fixture-secret',request:{model:'fixture',stream:true,messages:[{role:'user',content:'read only'}],stream_options:{include_usage:true},tools:[{type:'function',function:{name:'read_news',parameters:{type:'object'}}}]}});
const completion=(finish='tool_calls',args='{"ticker":"TIA"}')=>({id:'completion-1',model:'fixture',choices:[{index:0,message:{role:'assistant',content:null,reasoning_content:'Read once.',tool_calls:[{id:'call-1',type:'function',function:{name:'read_news',arguments:args}}]},finish_reason:finish}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}});
const wait=()=>new Promise(resolve=>setTimeout(resolve,350));

test('atomic jobs request complete JSON and preserve tool identity, arguments, reasoning and usage as SDK SSE',async()=>{
 let calls=0;const jobs=new NanoGptJobs(async(_url,options)=>{calls++;const body=JSON.parse(String(options.body));assert.equal(body.stream,false);assert.equal(body.stream_options,undefined);assert.equal(body.tools[0].function.name,'read_news');return Response.json(completion());});
 try{const input=request(),id=jobs.start('owner',input);await wait();const response=jobs.read('owner',id,0)!;assert.equal(response.status,200);assert.match(response.headers.get('Content-Type')??'',/text\/event-stream/);const text=await response.text();const events=text.split('\n\n').filter(Boolean).map(line=>line.slice(6));assert.equal(events.at(-1),'[DONE]');const chunks=events.slice(0,-1).map(line=>JSON.parse(line));const call=chunks[0].choices[0].delta.tool_calls[0];assert.equal(call.id,'call-1');assert.equal(call.index,0);assert.equal(call.function.arguments,'{"ticker":"TIA"}');assert.equal(chunks[0].choices[0].delta.reasoning_content,'Read once.');assert.equal(chunks[0].choices[0].finish_reason,'tool_calls');assert.equal(chunks[0].usage.total_tokens,120);assert.equal(jobs.start('owner',input),id);assert.equal(calls,1);}finally{jobs.close();}
});

for(const variant of [
 {name:'truncated JSON',body:'{"choices":['},
 {name:'invalid tool arguments',body:JSON.stringify(completion('tool_calls','{"ticker":'))},
 {name:'missing completion identity',body:JSON.stringify({...completion(),choices:[{index:0,message:{content:'partial'},finish_reason:null}]})},
])test(`atomic JSON rejects ${variant.name} without exposing partial tool calls`,async()=>{
 let calls=0;const jobs=new NanoGptJobs(async()=>{calls++;return new Response(variant.body,{headers:{'Content-Type':'application/json'}});});
 try{const id=jobs.start('owner',request());await wait();const response=jobs.read('owner',id,0)!;assert.equal(response.status,502);assert(!((await response.text()).includes('call-1')));assert.equal(calls,2);}finally{jobs.close();}
});

test('token-limited JSON is terminal and never releases its incomplete tool arguments',async()=>{
 let calls=0;const jobs=new NanoGptJobs(async()=>{calls++;return Response.json(completion('length'));});
 try{const id=jobs.start('owner',request());await wait();const response=jobs.read('owner',id,0)!;assert.equal(response.status,502);assert.equal(response.headers.get('X-QuantTrade-AI-Failure'),'incomplete-step');assert.equal(calls,1);}finally{jobs.close();}
});
