import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';

const inputSchema=z.object({requestId:z.string().uuid(),atomic:z.boolean().optional().default(true),apiKey:z.string().trim().min(1).max(4096).regex(/^[^\r\n]+$/),request:z.object({model:z.string().trim().min(1).max(256),stream:z.literal(true),messages:z.array(z.unknown()).min(1)}).passthrough()}).strict();
type Fetcher=(url:string,options:RequestInit)=>Promise<Response>;
type Failure='upstream-connection'|'upstream-stream'|'timeout'|'canceled'|'buffer-limit'|'incomplete-step';
type FailureDetail='provider-idle'|'provider-read-failed'|'invalid-content-type'|'invalid-completion'|'invalid-sse-event'|'provider-error-event'|'incomplete-sse';
const toolCallSchema=z.object({id:z.string().min(1).max(256),type:z.literal('function'),function:z.object({name:z.string().regex(/^[a-zA-Z0-9_.-]{1,256}$/),arguments:z.string().max(1024*1024).refine(value=>{try{const parsed:unknown=JSON.parse(value);return parsed!==null&&typeof parsed==='object'&&!Array.isArray(parsed);}catch{return false;}})})});
const completionSchema=z.object({id:z.string().max(256).optional(),model:z.string().max(256).optional(),choices:z.array(z.object({index:z.literal(0),finish_reason:z.string().min(1),message:z.object({role:z.literal('assistant').optional(),content:z.string().nullable().optional(),reasoning_content:z.string().optional(),reasoning:z.string().optional(),tool_calls:z.array(toolCallSchema).max(64).optional()})})).length(1),usage:z.object({prompt_tokens:z.number().int().nonnegative(),completion_tokens:z.number().int().nonnegative(),total_tokens:z.number().int().nonnegative().optional()}).optional()});
interface Job {id:string;owner:string;requestId:string;hash:string;atomic:boolean;model:string;messageCount:number;started:number;attempt:number;controller:AbortController;chunks:Uint8Array[];bytes:number;capacity:number;status?:number;contentType:string;diagnostics:Headers;failure?:Failure;detail?:FailureDetail;done:boolean;failed:boolean;ended?:number;listeners:Set<()=>void>;timer:ReturnType<typeof setTimeout>}
export interface InferenceEvent {event:'started'|'retry'|'completed'|'failed';id:string;model:string;messageCount:number;attempt:number;durationMs:number;bytes:number;providerStatus?:number;failure?:Failure;detail?:FailureDetail}
export class NanoGptJobError extends Error {constructor(public status:number,message:string){super(message);}}
/** Ephemeral provider bytes only. Browser disconnects never abort provider work. */
export class NanoGptJobs {
 private jobs=new Map<string,Job>();private bytes=0;private closed=false;private sweep:ReturnType<typeof setInterval>;
 constructor(private fetcher:Fetcher=fetch,private observer?:(event:InferenceEvent)=>void,private idleTimeoutMs=90_000){if(!Number.isInteger(idleTimeoutMs)||idleTimeoutMs<1||idleTimeoutMs>90_000)throw new Error('Invalid inference idle timeout');this.sweep=setInterval(()=>this.cleanup(),60_000);this.sweep.unref();}
 private report(job:Job,event:InferenceEvent['event']){if(!this.observer)return;try{this.observer({event,id:job.id,model:job.model,messageCount:job.messageCount,attempt:job.attempt,durationMs:Date.now()-job.started,bytes:job.bytes,...(job.status===undefined?{}:{providerStatus:job.status}),...(job.failure?{failure:job.failure}:{}),...(job.detail?{detail:job.detail}:{})});}catch{console.warn('Inference diagnostic reporter failed');}}
 get activeCount(){return [...this.jobs.values()].filter(job=>!job.done).length;}
 get retainedCount(){this.cleanup();return this.jobs.size;}
 private cleanup(){const now=Date.now();for(const [id,job]of this.jobs)if(job.ended!==undefined&&now-job.ended>=600_000){this.bytes-=job.capacity;this.jobs.delete(id);}}
 private finish(job:Job,failed=false){if(job.done)return;job.done=true;job.failed=failed;job.ended=Date.now();clearTimeout(job.timer);this.report(job,failed?'failed':'completed');for(const listener of [...job.listeners])listener();}
 private get(owner:string,id:string){this.cleanup();const job=this.jobs.get(id);if(!job||job.owner!==owner)throw new NanoGptJobError(404,'Inference job not found');return job;}
 start(owner:string,input:unknown,acceptNew=true):string {
  this.cleanup();const parsed=inputSchema.safeParse(input);if(!parsed.success)throw new NanoGptJobError(400,'Invalid inference request');
  const data=parsed.data;const providerRequest:Record<string,unknown>={...data.request};
  // Atomic jobs never expose partial provider bytes. Requesting one complete
  // JSON response avoids upstream SSE resets without changing the SDK's
  // resumable SSE contract or replaying any already executed client tools.
  if(data.atomic){providerRequest.stream=false;delete providerRequest.stream_options;}
  const payload=JSON.stringify(providerRequest);if(Buffer.byteLength(JSON.stringify(input))>2*1024*1024)throw new NanoGptJobError(413,'Inference request is too large');
  if(data.atomic&&data.request.n!==undefined&&data.request.n!==1)throw new NanoGptJobError(400,'Atomic inference requires a single completion');
  const hash=createHash('sha256').update(data.apiKey).update('\0').update(payload).update(data.atomic?'atomic':'stream').digest('hex');
  for(const job of this.jobs.values())if(job.owner===owner&&job.requestId===data.requestId){if(job.hash!==hash)throw new NanoGptJobError(409,'Inference request ID was already used');return job.id;}
  if(!acceptNew)throw new NanoGptJobError(503,'Inference service is draining existing work');
  const active=[...this.jobs.values()].filter(job=>!job.done);if(this.closed||this.jobs.size>=64||active.length>=16||active.filter(job=>job.owner===owner).length>=4||this.bytes>=64*1024*1024)throw new NanoGptJobError(429,'Inference job limit reached');
 const controller=new AbortController();const id=randomUUID();const timer=setTimeout(()=>{job.failure='timeout';this.finish(job,true);controller.abort();},600_000);timer.unref();
 const job:Job={id,owner,requestId:data.requestId,hash,atomic:data.atomic,model:/^[a-zA-Z0-9/_.:+-]{1,256}$/.test(data.request.model)?data.request.model:'redacted-model',messageCount:data.request.messages.length,started:Date.now(),attempt:0,controller,chunks:[],bytes:0,capacity:0,contentType:'application/octet-stream',diagnostics:new Headers(),done:false,failed:false,listeners:new Set(),timer};this.jobs.set(id,job);this.report(job,'started');
  void this.run(job,data.apiKey,payload);return id;
 }
 private async run(job:Job,apiKey:string,payload:string){
  try{
   for(let attempt=0;attempt<2;attempt++){
    job.attempt=attempt+1;const attemptController=new AbortController();
    let idleTimer:ReturnType<typeof setTimeout>|undefined;
    const activity=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>{job.detail='provider-idle';attemptController.abort();},this.idleTimeoutMs);idleTimer.unref();};activity();
    try{
     const response=await this.fetcher('https://nano-gpt.com/api/v1/chat/completions',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:payload,signal:AbortSignal.any([job.controller.signal,attemptController.signal])});activity();
     if(job.done){await response.body?.cancel();return;}
     job.status=response.status;job.contentType=response.headers.get('Content-Type')??'application/octet-stream';
     const requestId=response.headers.get('X-Request-ID');if(requestId&&/^[a-zA-Z0-9._:-]{1,128}$/.test(requestId))job.diagnostics.set('X-Request-ID',requestId);
     const retryAfter=response.headers.get('Retry-After');if(retryAfter&&/^\d{1,3}$/.test(retryAfter)&&Number(retryAfter)<=120)job.diagnostics.set('Retry-After',retryAfter);
     if(!response.ok){await response.body?.cancel();job.contentType='application/json';this.append(job,new TextEncoder().encode('{"error":"NanoGPT rejected the inference request"}'));this.finish(job);return;}
     // Atomic jobs expose no bytes or tool calls until a whole model step is
     // verified. Retrying that one step cannot repeat previously completed tools.
     if(job.atomic&&job.contentType.toLowerCase().includes('application/json')){
      const reader=response.body?.getReader();if(!reader){job.detail='invalid-completion';throw new Error('Missing inference completion');}
      try{for(;;){const next=await reader.read();activity();if(job.done){await reader.cancel().catch(()=>undefined);return;}if(next.done)break;this.append(job,next.value);}}finally{reader.releaseLock();}
      let raw:unknown;try{raw=JSON.parse(Buffer.concat(job.chunks,job.bytes).toString('utf8'));}catch{job.detail='invalid-completion';throw new Error('Invalid inference completion');}
      const parsed=completionSchema.safeParse(raw);if(!parsed.success){job.detail='invalid-completion';throw new Error('Invalid inference completion');}
      const completion=parsed.data,choice=completion.choices[0]!;
      if(!['stop','tool_calls'].includes(choice.finish_reason)){job.failure='incomplete-step';throw new Error('Inference step did not complete');}
      const calls=choice.message.tool_calls;
      if(calls?.length?choice.finish_reason!=='tool_calls':choice.finish_reason!=='stop'||typeof choice.message.content!=='string'){job.detail='invalid-completion';throw new Error('Incomplete inference message');}
      if(calls&&new Set(calls.map(call=>call.id)).size!==calls.length){job.detail='invalid-completion';throw new Error('Duplicate inference tool identity');}
      const delta={...choice.message,...(calls?{tool_calls:calls.map((call,index)=>({...call,index}))}:{})};
      const chunk={id:completion.id,model:completion.model,object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason:choice.finish_reason}],...(completion.usage?{usage:completion.usage}:{})};
      this.bytes-=job.capacity;job.chunks=[];job.bytes=0;job.capacity=0;job.contentType='text/event-stream';
      this.append(job,new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`));this.finish(job);return;
     }
     if(job.atomic&&!job.contentType.toLowerCase().includes('text/event-stream')){job.detail='invalid-content-type';await response.body?.cancel();throw new Error('Invalid inference stream');}
     for(const listener of [...job.listeners])listener();
     let sawDone=false,sawFinish=false,pending='',eventData:string[]=[],eventSize=0;const decoder=new TextDecoder();
     const flushEvent=()=>{
      const data=eventData.join('\n').trim();eventData=[];eventSize=0;
      if(!data)return;if(data==='[DONE]'){sawDone=true;return;}
      let event:unknown;try{event=JSON.parse(data);}catch{job.detail='invalid-sse-event';throw new Error('Invalid inference event');}
      if(event&&typeof event==='object'){if('error' in event){job.detail='provider-error-event';throw new Error('Provider stream failed');}if('choices' in event&&Array.isArray(event.choices))for(const choice of event.choices)if(choice&&typeof choice==='object'&&'finish_reason' in choice&&typeof choice.finish_reason==='string'&&choice.finish_reason.length>0){if(!['stop','tool_calls','function_call'].includes(choice.finish_reason)){job.failure='incomplete-step';throw new Error('Inference step did not complete');}sawFinish=true;}}
     };
     const lineEvent=(line:string)=>{
      if(line===''){flushEvent();return;}
      if(!line.startsWith('data:'))return;
      const data=line.slice(5).replace(/^ /,'');eventSize+=data.length+1;
      if(data.trim()==='[DONE]'&&eventData.length===0){sawDone=true;eventSize=0;return;}
      if(eventSize>1024*1024){job.failure='buffer-limit';throw new Error('Inference event limit reached');}
      eventData.push(data);
     };
     const inspect=(chunk?:Uint8Array)=>{
      pending+=chunk?decoder.decode(chunk,{stream:true}):decoder.decode();
      let newline:number;while((newline=pending.indexOf('\n'))!==-1){const line=pending.slice(0,newline).replace(/\r$/,'');pending=pending.slice(newline+1);lineEvent(line);}
      if(pending.length+eventSize>1024*1024){job.failure='buffer-limit';throw new Error('Inference event limit reached');}
      if(!chunk){if(pending)lineEvent(pending.replace(/\r$/,''));pending='';flushEvent();}
     };
     if(response.body){const reader=response.body.getReader();try{while(!job.done){const next=await reader.read();activity();if(job.done){await reader.cancel().catch(()=>undefined);break;}if(next.done)break;this.append(job,next.value);if(job.atomic){inspect(next.value);if(sawDone&&sawFinish){await reader.cancel().catch(()=>undefined);break;}}}}finally{if(job.done)await reader.cancel().catch(()=>undefined);reader.releaseLock();}}
     if(job.done)return;if(job.atomic){inspect();if(!sawDone||!sawFinish){job.detail='incomplete-sse';throw new Error('Incomplete inference stream');}}this.finish(job);return;
    }catch(error){
     if(job.status!==undefined&&!job.detail&&!job.failure)job.detail='provider-read-failed';
     attemptController.abort();
     const startup=job.status===undefined;
     if(job.done||job.controller.signal.aborted||attempt===1||job.failure==='buffer-limit'||job.failure==='incomplete-step'||(!startup&&!job.atomic))throw error;
     this.report(job,'retry');
     // No atomic bytes have been released. Discard the failed draft and its
     // allocation; a resumed reader can only observe the committed replacement.
     this.bytes-=job.capacity;job.chunks=[];job.bytes=0;job.capacity=0;job.status=undefined;job.detail=undefined;job.diagnostics=new Headers();
     await delay(250,undefined,{signal:job.controller.signal});
    }finally{clearTimeout(idleTimer);}
   }
  }catch{if(!job.done){job.failure??=job.status===undefined?'upstream-connection':'upstream-stream';this.finish(job,true);}job.controller.abort();}
  finally{apiKey='';payload='';}
 }
 private append(job:Job,chunk:Uint8Array){
  if(job.bytes+chunk.byteLength>8*1024*1024){job.failure='buffer-limit';throw new Error('Inference response limit reached');}
  // Fixed blocks bound both bytes and metadata even if the provider sends one byte per chunk.
  let consumed=0;while(consumed<chunk.byteLength){let last=job.chunks.at(-1);if(!last||last.byteLength===65_536){if(this.bytes+65_536>64*1024*1024){job.failure='buffer-limit';throw new Error('Inference buffer limit reached');}last=new Uint8Array(new ArrayBuffer(65_536),0,0);job.chunks.push(last);job.capacity+=65_536;this.bytes+=65_536;}const count=Math.min(65_536-last.byteLength,chunk.byteLength-consumed);new Uint8Array(last.buffer).set(chunk.subarray(consumed,consumed+count),last.byteLength);job.chunks[job.chunks.length-1]=new Uint8Array(last.buffer,0,last.byteLength+count);consumed+=count;job.bytes+=count;}
  for(const listener of [...job.listeners])listener();
 }
 read(owner:string,id:string,offset:number):Response|null {
  const job=this.get(owner,id);if(!Number.isSafeInteger(offset)||offset<0||offset>job.bytes)throw new NanoGptJobError(400,'Invalid inference response offset');
  if(job.failed)return new Response('{"error":"Inference step could not complete; completed tool actions were not replayed"}',{status:502,headers:{'Content-Type':'application/json','X-QuantTrade-AI-Failure':job.failure??'canceled'}});
  if(job.status===undefined||(job.atomic&&!job.done))return null;
  if(job.listeners.size>=4)throw new NanoGptJobError(429,'Inference reader limit reached');
  let position=offset;let detach=()=>undefined;let flush=()=>undefined;
  const stream=new ReadableStream<Uint8Array>({start(controller){flush=()=>{if(job.failed){job.listeners.delete(flush);controller.error(new Error('Inference stream interrupted'));return;}let start=0;for(const chunk of job.chunks){const end=start+chunk.byteLength;if(end>position&&(controller.desiredSize??0)>0){const output=chunk.subarray(Math.max(0,position-start));position=end;controller.enqueue(output);}start=end;}if(job.done&&position===job.bytes){job.listeners.delete(flush);controller.close();}};detach=()=>{job.listeners.delete(flush);};job.listeners.add(flush);flush();},pull(){flush();},cancel(){detach();}});
  const headers=new Headers(job.diagnostics);headers.set('Content-Type',job.contentType);headers.set('X-QuantTrade-AI-Upstream','1');return new Response(stream,{status:job.status,headers});
 }
 cancel(owner:string,id:string){const job=this.get(owner,id);if(!job.done)job.failure='canceled';this.finish(job,true);job.controller.abort();}
 close(){if(this.closed)return;this.closed=true;clearInterval(this.sweep);for(const job of this.jobs.values()){this.finish(job,true);job.controller.abort();}this.jobs.clear();this.bytes=0;}
}
