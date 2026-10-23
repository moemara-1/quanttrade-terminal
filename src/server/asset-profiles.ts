import {z} from 'zod';

const requestSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('search'),query:z.string().min(1).max(30).regex(/^[A-Za-z0-9.]+$/)}).strict(),
 z.object({action:z.literal('profile'),id:z.string().min(1).max(200).regex(/^[a-z0-9-]+$/)}).strict(),
]);
const identity=z.object({id:z.string().min(1).max(200).regex(/^[a-z0-9-]+$/),symbol:z.string().min(1).max(100)});
const text=z.string().max(50_000);const links=z.array(z.string().max(2000)).max(100);
const profile=identity.extend({name:z.string().min(1).max(200),description:z.object({en:text.optional()}).optional(),categories:z.array(z.string().max(200)).max(200).optional(),genesis_date:z.string().nullable().optional(),last_updated:z.string().nullable().optional(),links:z.object({homepage:links.optional(),blockchain_site:links.optional(),repos_url:z.object({github:links.optional()}).optional()}).optional(),image:z.object({small:z.string().optional(),large:z.string().optional()}).optional(),market_data:z.object({circulating_supply:z.number().finite().nonnegative().nullable().optional(),total_supply:z.number().finite().nonnegative().nullable().optional(),max_supply:z.number().finite().nonnegative().nullable().optional(),market_cap:z.object({usd:z.number().finite().nonnegative().nullable().optional()}).optional(),last_updated:z.string().nullable().optional()}).optional()});
type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;

/** Only public CoinGecko metadata; caller cannot choose a URL, headers or credentials. */
export class AssetProfiles {
 private cache=new Map<string,{expires:number;value:Record<string,unknown>}>();
 private pending=new Map<string,Promise<Record<string,unknown>>>();
 constructor(private fetcher:Fetcher=fetch,private now=Date.now){}
 async get(input:unknown):Promise<Record<string,unknown>>{
  const request=requestSchema.parse(input),key=JSON.stringify(request);const cached=this.cache.get(key);
  if(cached&&cached.expires>this.now())return cached.value;
  const pending=this.pending.get(key);if(pending)return pending;
  if(this.pending.size>=8)throw new Error('Asset profile provider is busy');
  const promise=this.load(request).then(value=>{if(this.cache.size>=64)this.cache.delete(this.cache.keys().next().value!);this.cache.set(key,{expires:this.now()+300_000,value});return value;}).finally(()=>this.pending.delete(key));
  this.pending.set(key,promise);return promise;
 }
 private async load(request:z.infer<typeof requestSchema>):Promise<Record<string,unknown>>{
  const path=request.action==='search'?`/search?query=${encodeURIComponent(request.query)}`:`/coins/${request.id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
  const response=await this.fetcher('https://api.coingecko.com/api/v3'+path,{redirect:'error',signal:AbortSignal.timeout(6000),headers:{Accept:'application/json'}});
  if(!response.ok){await response.body?.cancel();throw new Error('Public asset overview is unavailable');}
  if(Number(response.headers.get('content-length'))>1024*1024){await response.body?.cancel();throw new Error('Asset profile response is too large');}
  const reader=response.body?.getReader();if(!reader)throw new Error('Public asset overview is unavailable');
  const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1024*1024)throw new Error('Asset profile response is too large');chunks.push(part.value);}}finally{void reader.cancel().catch(()=>undefined);reader.releaseLock();}
  const raw:unknown=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
  if(request.action==='search')return z.object({coins:z.array(identity).max(1000)}).parse(raw);
  const result=profile.parse(raw);if(result.id!==request.id)throw new Error('Asset profile identity mismatch');return result;
 }
}
