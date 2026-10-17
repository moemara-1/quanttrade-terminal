import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';

const inputSchema=z.object({requestId:z.string().uuid(),apiKey:z.string().trim().min(1).max(4096).regex(/^[^\r\n]+$/),request:z.object({model:z.string().trim().min(1).max(256),stream:z.literal(true),messages:z.array(z.unknown()).min(1)}).passthrough()}).strict();
type Fetcher=(url:string,options:RequestInit)=>Promise<Response>;
interface Job {id:string;owner:string;requestId:string;hash:string;controller:AbortController;chunks:Uint8Array[];bytes:number;capacity:number;status?:number;contentType:string;done:boolean;failed:boolean;ended?:number;listeners:Set<()=>void>;timer:ReturnType<typeof setTimeout>}
export class NanoGptJobError extends Error {constructor(public status:number,message:string){super(message);}}
/** Ephemeral provider bytes only. Browser disconnects never abort provider work. */
export class NanoGptJobs {
 private jobs=new Map<string,Job>();private bytes=0;private closed=false;private sweep:ReturnType<typeof setInterval>;
 constructor(private fetcher:Fetcher=fetch){this.sweep=setInterval(()=>this.cleanup(),60_000);this.sweep.unref();}
 private cleanup(){const now=Date.now();for(const [id,job]of this.jobs)if(job.ended!==undefined&&now-job.ended>=600_000){this.bytes-=job.capacity;this.jobs.delete(id);}}
 private finish(job:Job,failed=false){if(job.done)return;job.done=true;job.failed=failed;job.ended=Date.now();clearTimeout(job.timer);for(const listener of [...job.listeners])listener();}
 private get(owner:string,id:string){this.cleanup();const job=this.jobs.get(id);if(!job||job.owner!==owner)throw new NanoGptJobError(404,'Inference job not found');return job;}
 start(owner:string,input:unknown):string {
  this.cleanup();const parsed=inputSchema.safeParse(input);if(!parsed.success)throw new NanoGptJobError(400,'Invalid inference request');
  const data=parsed.data;const payload=JSON.stringify(data.request);if(Buffer.byteLength(JSON.stringify(input))>2*1024*1024)throw new NanoGptJobError(413,'Inference request is too large');
  const hash=createHash('sha256').update(data.apiKey).update('\0').update(payload).digest('hex');
  for(const job of this.jobs.values())if(job.owner===owner&&job.requestId===data.requestId){if(job.hash!==hash)throw new NanoGptJobError(409,'Inference request ID was already used');return job.id;}
  const active=[...this.jobs.values()].filter(job=>!job.done);if(this.closed||this.jobs.size>=64||active.length>=16||active.filter(job=>job.owner===owner).length>=4||this.bytes>=64*1024*1024)throw new NanoGptJobError(429,'Inference job limit reached');
  const controller=new AbortController();const id=randomUUID();const timer=setTimeout(()=>{this.finish(job,true);controller.abort();},600_000);timer.unref();
  const job:Job={id,owner,requestId:data.requestId,hash,controller,chunks:[],bytes:0,capacity:0,contentType:'application/octet-stream',done:false,failed:false,listeners:new Set(),timer};this.jobs.set(id,job);
  void this.run(job,data.apiKey,payload);return id;
 }
 private async run(job:Job,apiKey:string,payload:string){
  try{
   const response=await this.fetcher('https://api.nano-gpt.com/api/v1/chat/completions',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:payload,signal:job.controller.signal});
   apiKey='';payload='';if(job.done){await response.body?.cancel();return;}
   job.status=response.status;job.contentType=response.headers.get('Content-Type')??'application/octet-stream';
   if(!response.ok){await response.body?.cancel();job.contentType='application/json';this.append(job,new TextEncoder().encode('{"error":"NanoGPT rejected the inference request"}'));this.finish(job);return;}
   for(const listener of [...job.listeners])listener();
   if(response.body){const reader=response.body.getReader();try{while(!job.done){const next=await reader.read();if(next.done)break;this.append(job,next.value);}}finally{if(job.done)await reader.cancel().catch(()=>undefined);reader.releaseLock();}}
   this.finish(job);
  }catch{apiKey='';payload='';this.finish(job,true);job.controller.abort();}
 }
 private append(job:Job,chunk:Uint8Array){
  if(job.bytes+chunk.byteLength>8*1024*1024)throw new Error('Inference response limit reached');
  // Fixed blocks bound both bytes and metadata even if the provider sends one byte per chunk.
  let consumed=0;while(consumed<chunk.byteLength){let last=job.chunks.at(-1);if(!last||last.byteLength===65_536){if(this.bytes+65_536>64*1024*1024)throw new Error('Inference buffer limit reached');last=new Uint8Array(new ArrayBuffer(65_536),0,0);job.chunks.push(last);job.capacity+=65_536;this.bytes+=65_536;}const count=Math.min(65_536-last.byteLength,chunk.byteLength-consumed);new Uint8Array(last.buffer).set(chunk.subarray(consumed,consumed+count),last.byteLength);job.chunks[job.chunks.length-1]=new Uint8Array(last.buffer,0,last.byteLength+count);consumed+=count;job.bytes+=count;}
  for(const listener of [...job.listeners])listener();
 }
 read(owner:string,id:string,offset:number):Response|null {
  const job=this.get(owner,id);if(!Number.isSafeInteger(offset)||offset<0||offset>job.bytes)throw new NanoGptJobError(400,'Invalid inference response offset');
  if(job.failed)return new Response('{"error":"Inference connection ended; no request was replayed"}',{status:502,headers:{'Content-Type':'application/json'}});
  if(job.status===undefined)return null;
  if(job.listeners.size>=4)throw new NanoGptJobError(429,'Inference reader limit reached');
  let position=offset;let detach=()=>undefined;let flush=()=>undefined;
  const stream=new ReadableStream<Uint8Array>({start(controller){flush=()=>{if(job.failed){job.listeners.delete(flush);controller.error(new Error('Inference stream interrupted'));return;}let start=0;for(const chunk of job.chunks){const end=start+chunk.byteLength;if(end>position&&(controller.desiredSize??0)>0){const output=chunk.subarray(Math.max(0,position-start));position=end;controller.enqueue(output);}start=end;}if(job.done&&position===job.bytes){job.listeners.delete(flush);controller.close();}};detach=()=>{job.listeners.delete(flush);};job.listeners.add(flush);flush();},pull(){flush();},cancel(){detach();}});
  return new Response(stream,{status:job.status,headers:{'Content-Type':job.contentType,'X-QuantTrade-AI-Upstream':'1'}});
 }
 cancel(owner:string,id:string){const job=this.get(owner,id);this.finish(job,true);job.controller.abort();}
 close(){if(this.closed)return;this.closed=true;clearInterval(this.sweep);for(const job of this.jobs.values()){this.finish(job,true);job.controller.abort();}this.jobs.clear();this.bytes=0;}
}
