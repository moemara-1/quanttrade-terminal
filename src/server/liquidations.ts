import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import Decimal from 'decimal.js';
import { z } from 'zod';

type Venue='binance-futures'|'bybit-futures';
type Print={symbol:string;ts:number;side:'long'|'short';price:string;size:string};
type Socket=Pick<WebSocket,'addEventListener'|'send'|'close'|'readyState'>;
type Options={fetcher?:typeof fetch;socketFactory?:(url:string)=>Socket;now?:()=>number;logger?:(message:string)=>void};
const RETENTION=72*3_600_000;
const querySchema=z.object({venue:z.enum(['binance-futures','bybit-futures']),pairKey:z.string().regex(/^[A-Z0-9]{1,32}-[A-Z0-9]{1,16}-[A-Z0-9]{1,16}$/).refine(pair=>pair.split('-')[1]===pair.split('-')[2]),hours:z.coerce.number().refine(n=>[1,6,24,72].includes(n))});
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
function positive(v:unknown):string|null {if(typeof v!=='string'||v.length>64||!/^\d+(\.\d+)?$/.test(v))return null;const d=new Decimal(v);return d.isFinite()&&d.gt(0)&&d.lt('1e20')?d.toString():null;}
export function parseLiquidation(venue:Venue,raw:unknown,now:number):Print[]{
 const envelope=record(raw);if(!envelope)return[];
 const body=record(envelope.data)??envelope;
 const rows:unknown[]=venue==='binance-futures'?[body]:Array.isArray(envelope.data)?envelope.data:[];
 const output:Print[]=[];
 for(const value of rows.slice(0,10_000)){const row=record(value);if(!row)continue;const binance=venue==='binance-futures';if(binance&&(row.e!=='forceOrder'||row.st===2))continue;const o=binance?record(row.o):row;if(!o)continue;
 const symbol=o.s,ts=o.T,side=o.S,price=positive(binance?o.ap:o.p),size=positive(binance?o.z:o.v);
 if(typeof symbol!=='string'||! /^[A-Z0-9]{1,32}USDT$/.test(symbol)||typeof ts!=='number'||!Number.isSafeInteger(ts)||ts<now-RETENTION||ts>now+5_000||!price||!size)continue;
 if(binance?side!=='BUY'&&side!=='SELL':side!=='Buy'&&side!=='Sell')continue;
 output.push({symbol,ts,price,size,side:(binance?side==='SELL':side==='Buy')?'long':'short'});
 }return output;
}
export class LiquidationCollector {
 private readonly db:DatabaseSync;private readonly fetcher:typeof fetch;private readonly socketFactory:(url:string)=>Socket;private readonly now:()=>number;
 private readonly catalogs=new Map<Venue,Set<string>>();private readonly ready=new Set<Venue>();private readonly sockets=new Map<Venue,Socket>();private readonly timers=new Set<ReturnType<typeof setTimeout>>();private stopped=false;private started=false;private readonly logger:(message:string)=>void;private readonly lastLog=new Map<Venue,number>();
 constructor(path:string,options:Options={}){this.now=options.now??Date.now;this.logger=options.logger??(message=>console.warn(message));this.fetcher=options.fetcher??fetch;this.socketFactory=options.socketFactory??(url=>new WebSocket(url));this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS liquidation_prints(venue TEXT,symbol TEXT,ts INTEGER,side TEXT,price TEXT,size TEXT,event_id TEXT,PRIMARY KEY(venue,event_id));
 CREATE INDEX IF NOT EXISTS liquidation_time ON liquidation_prints(ts); CREATE INDEX IF NOT EXISTS liquidation_pair_time ON liquidation_prints(venue,symbol,ts);
 CREATE TABLE IF NOT EXISTS liquidation_coverage(venue TEXT PRIMARY KEY,tracked INTEGER,last INTEGER);
 CREATE TABLE IF NOT EXISTS liquidation_gaps(venue TEXT,start INTEGER,end INTEGER);`);
 for(const row of this.db.prepare('SELECT venue,last FROM liquidation_coverage').all())if(Number(row.last)<this.now())this.db.prepare('INSERT INTO liquidation_gaps VALUES(?,?,?)').run(String(row.venue),Number(row.last),this.now());
 this.prune();}
 start():void{if(this.started||this.stopped)return;this.started=true;for(const venue of ['binance-futures','bybit-futures'] as const)void this.connect(venue,0);}
 close():void{if(this.stopped)return;this.stopped=true;for(const timer of this.timers)clearTimeout(timer);this.timers.clear();for(const socket of this.sockets.values())socket.close();this.sockets.clear();this.ready.clear();this.db.close();}
 diagnostics():{pendingTimers:number;connectedVenues:string[]}{return{pendingTimers:this.timers.size,connectedVenues:[...this.ready]};}
 private log(venue:Venue,category:string):void{const previous=this.lastLog.get(venue);if(previous!==undefined&&this.now()-previous<60_000)return;this.lastLog.set(venue,this.now());this.logger(`[liquidations] ${venue}: ${category}; retrying public feed`);}
 private later(fn:()=>void,delay:number):ReturnType<typeof setTimeout>|undefined{if(this.stopped)return;const timer=setTimeout(()=>{this.timers.delete(timer);if(!this.stopped)fn();},delay);timer.unref();this.timers.add(timer);return timer;}
 private prune():void{const cutoff=this.now()-RETENTION;this.db.prepare('DELETE FROM liquidation_prints WHERE ts<?').run(cutoff);this.db.prepare('DELETE FROM liquidation_gaps WHERE end<?').run(cutoff);for(const venue of ['binance-futures','bybit-futures']){const count=Number(this.db.prepare('SELECT count(*) AS n FROM liquidation_prints WHERE venue=?').get(venue)?.n??0);if(count>500_000){const boundary=this.db.prepare('SELECT ts FROM liquidation_prints WHERE venue=? ORDER BY ts LIMIT 1 OFFSET ?').get(venue,count-500_000);if(boundary){this.db.prepare('DELETE FROM liquidation_prints WHERE venue=? AND ts<?').run(venue,Number(boundary.ts));this.db.prepare('UPDATE liquidation_coverage SET tracked=max(tracked,?) WHERE venue=?').run(Number(boundary.ts),venue);}}}this.db.exec('PRAGMA wal_checkpoint(PASSIVE)');}
 private async json(url:string):Promise<unknown>{const response=await this.fetcher(url,{signal:AbortSignal.timeout(15_000)});if(!response.ok)throw Error(`Liquidation catalog HTTP ${response.status}`);return response.json();}
 private async catalog(venue:Venue):Promise<Set<string>>{
 const symbols=new Set<string>();if(venue==='binance-futures'){const body=record(await this.json('https://fapi.binance.com/fapi/v1/exchangeInfo'));if(!body||!Array.isArray(body.symbols))throw Error('Invalid Binance catalog');for(const value of body.symbols){const r=record(value);if(r?.status==='TRADING'&&r.contractType==='PERPETUAL'&&r.quoteAsset==='USDT'&&r.marginAsset==='USDT'&&typeof r.symbol==='string')symbols.add(r.symbol);}}
 else{let cursor='';const cursors=new Set<string>();for(let page=0;page<10;page++){const body=record(await this.json(`https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`));const result=record(body?.result);if(body?.retCode!==0||!result||!Array.isArray(result.list))throw Error('Invalid Bybit catalog');for(const value of result.list){const r=record(value);if(r?.status==='Trading'&&r.contractType==='LinearPerpetual'&&r.quoteCoin==='USDT'&&r.settleCoin==='USDT'&&typeof r.symbol==='string')symbols.add(r.symbol);}const next=result.nextPageCursor;if(typeof next!=='string'||!next)break;if(cursors.has(next)||page===9)throw Error('Incomplete Bybit catalog');cursors.add(next);cursor=next;}}
 if(!symbols.size||symbols.size>10_000)throw Error('Empty or oversized liquidation catalog');return symbols;}
 private async connect(venue:Venue,attempt:number):Promise<void>{
 try{const symbols=await this.catalog(venue);if(this.stopped)return;this.catalogs.set(venue,symbols);const socket=this.socketFactory(venue==='binance-futures'?'wss://fstream.binance.com/market/ws/!forceOrder@arr':'wss://stream.bybit.com/v5/public/linear');this.sockets.set(venue,socket);let connected=false;const pending=new Set<string>();let batchId=0;let lost=false;let lastMessage=this.now();const connectionTimers=new Set<ReturnType<typeof setTimeout>>();const schedule=(fn:()=>void,delay:number)=>{const timer=this.later(()=>{if(timer)connectionTimers.delete(timer);fn();},delay);if(timer)connectionTimers.add(timer);};
 const acknowledge=()=>{if(this.stopped||lost)return;connected=true;this.ready.add(venue);const now=this.now();const previous=this.db.prepare('SELECT last FROM liquidation_coverage WHERE venue=?').get(venue);if(previous&&Number(previous.last)<now)this.db.prepare('INSERT INTO liquidation_gaps VALUES(?,?,?)').run(venue,Number(previous.last),now);this.db.prepare('INSERT INTO liquidation_coverage VALUES(?,?,?) ON CONFLICT(venue) DO UPDATE SET last=excluded.last').run(venue,now,now);};
 const heartbeat=()=>{if(this.stopped||lost)return;if(socket.readyState!==1)return;if(venue==='bybit-futures'&&this.now()-lastMessage>60_000){fail();return;}if(venue==='bybit-futures')socket.send(JSON.stringify({op:'ping'}));if(connected)this.db.prepare('UPDATE liquidation_coverage SET last=? WHERE venue=?').run(this.now(),venue);this.prune();schedule(heartbeat,20_000);};
 const fail=()=>{if(this.stopped||lost)return;lost=true;this.ready.delete(venue);for(const timer of connectionTimers){clearTimeout(timer);this.timers.delete(timer);}connectionTimers.clear();this.log(venue,'connection interrupted');socket.close();this.later(()=>void this.connect(venue,connected?0:attempt+1),Math.min(60_000,1000*2**Math.min(attempt,6)));};
 socket.addEventListener('open',()=>{if(this.stopped)return;if(venue==='binance-futures')acknowledge();else{let args:string[]=[];let size=0;const send=()=>{if(!args.length)return;const req_id=String(++batchId);pending.add(req_id);socket.send(JSON.stringify({op:'subscribe',req_id,args}));args=[];size=0;};for(const symbol of symbols){const topic=`allLiquidation.${symbol}`;if(size+topic.length+3>18_000)send();args.push(topic);size+=topic.length+3;}send();}heartbeat();});
 socket.addEventListener('message',event=>{if(this.stopped||lost)return;lastMessage=this.now();try{const message=String((event as MessageEvent).data);if(message.length>1_000_000){fail();return;}const data=JSON.parse(message) as unknown;const r=record(data);if(Array.isArray(r?.data)&&r.data.length>10000){fail();return;}if(venue==='bybit-futures'&&r?.op==='subscribe'){if(typeof r.req_id!=='string'||!pending.has(r.req_id))return;if(r.success!==true){fail();return;}pending.delete(r.req_id);if(pending.size===0)acknowledge();return;}const frame=createHash('sha256').update(message).digest('hex');for(const [index,print] of parseLiquidation(venue,data,this.now()).entries())if(symbols.has(print.symbol))this.db.prepare('INSERT OR IGNORE INTO liquidation_prints VALUES(?,?,?,?,?,?,?)').run(venue,print.symbol,print.ts,print.side,print.price,print.size,frame+':'+index);}catch(error){if(error instanceof SyntaxError)return;fail();}});
 socket.addEventListener('close',fail);socket.addEventListener('error',fail);schedule(()=>{if(!connected)fail();},30_000);schedule(fail,23*3_600_000);
 }catch(error){const status=error instanceof Error?/^Liquidation catalog HTTP (\d{3})$/.exec(error.message)?.[1]:undefined;if(!this.stopped)this.log(venue,status?'catalog HTTP '+status:'catalog or connection initialization failed');if(!this.stopped)this.later(()=>void this.connect(venue,attempt+1),Math.min(60_000,1000*2**Math.min(attempt,6)));}}
 get(raw:unknown):Record<string,unknown>{const source=record(raw);const q=querySchema.parse(source?{...source,pairKey:source.pairKey??source.pair}:raw);const venue=q.venue;const [base,quote]=q.pairKey.split('-');const symbol=base+quote;const now=this.now();const fetchedAt=new Date(now).toISOString();const coverage=this.db.prepare('SELECT tracked,last FROM liquidation_coverage WHERE venue=?').get(venue);
 if(quote!=='USDT')return{error:'liquidations_unavailable',reason:'not_tracked',fetchedAt};if(!this.catalogs.get(venue)?.has(symbol))return{error:'liquidations_unavailable',reason:this.catalogs.has(venue)?'not_tracked':'collecting',fetchedAt};
 if(!coverage||!this.ready.has(venue))return{error:'liquidations_unavailable',reason:'collecting',trackedSince:coverage?Number(coverage.tracked):undefined,connected:false,fetchedAt};
 const since=now-q.hours*3_600_000;
 const first=this.db.prepare('SELECT price FROM liquidation_prints WHERE venue=? AND symbol=? AND ts>=? ORDER BY ts LIMIT 1').get(venue,symbol,since);
 const reference=new Decimal(first?String(first.price):1);const width=new Decimal(10).pow(reference.log(10).floor().minus(3));
 const buckets=new Map<string,{ts:number;price:number;side:string;notionalUsd:number;count:number}>();let truncated=false;let count=0;
 for(const r of this.db.prepare('SELECT ts,side,price,size FROM liquidation_prints WHERE venue=? AND symbol=? AND ts>=? ORDER BY ts LIMIT 200001').iterate(venue,symbol,since)){
 if(++count>200000){truncated=true;break;}
 const ts=Math.floor(Number(r.ts)/60_000)*60_000;const price=new Decimal(String(r.price)).div(width).floor().mul(width).toNumber();const side=String(r.side),key=`${ts}:${price}:${side}`;
 const value=new Decimal(String(r.price)).mul(String(r.size));const prev=buckets.get(key);if(prev){prev.notionalUsd=new Decimal(prev.notionalUsd).plus(value).toNumber();prev.count++;}else{if(buckets.size>=10000){truncated=true;break;}buckets.set(key,{ts,price,side,notionalUsd:value.toNumber(),count:1});}
 } return{venue,pairKey:q.pairKey,bucketWidth:width.toNumber(),resolutionMs:60_000,retentionMs:RETENTION,trackedSince:Math.max(Number(coverage.tracked),now-RETENTION),truncated,completeness:venue==='binance-futures'||truncated?'sampled':'complete',coverageThrough:Number(coverage.last),connected:true,coverageGaps:this.db.prepare('SELECT start,end FROM liquidation_gaps WHERE venue=? AND end>=?').all(venue,now-q.hours*3_600_000).map(r=>({from:Number(r.start),to:Number(r.end)})),buckets:[...buckets.values()],fetchedAt};}
}







