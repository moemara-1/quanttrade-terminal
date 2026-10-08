import { z } from 'zod';

const DAY=86_400_000;
const integer=z.union([z.number(),z.string().regex(/^\d+$/)]).transform(Number).pipe(z.number().int().min(1).max(92));
const iso=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value,'Invalid calendar date');
const earningsQuery=z.object({days:integer.default(7),start:iso.optional(),symbols:z.string().max(1500).regex(/^[A-Za-z0-9.^-]+(?:,[A-Za-z0-9.^-]+)*$/).optional()}).strict();
const rangeQuery=z.object({days:integer.optional()}).strict();
const record=z.record(z.unknown());
const agencySources=[{source:'BLS',url:'https://www.bls.gov/schedule/news_release/bls.ics'},{source:'BEA',url:'https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics'}] as const;
export interface EarningsEntry {symbol:string;name:string|null;reportDate:string;fiscalDateEnding:null;epsEstimate:number|null;currency:string|null;reportTime?:'bmo'|'amc'}
export interface IpoEntry {symbol:string;name:string;date:string;exchange:string|null;priceRangeLow:number|null;priceRangeHigh:number|null;currency:string|null}
export interface EconomicEntry {id:string;title:string;source:string;date:string;releaseMs:number|null;importance:'high'|'medium'|'low';country:string}
function easternDate(date:Date):string {return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function addDays(value:string,count:number):string{return new Date(Date.parse(value)+count*DAY).toISOString().slice(0,10);}
function text(value:unknown):string|null {return typeof value==='string' && value.trim()?value.trim().slice(0,500):null;}
function number(value:unknown):number|null {if(typeof value!=='string' && typeof value!=='number')return null;const raw=String(value).trim();if(!/^[($\d.,)\s-]+$/.test(raw))return null;const n=Number(raw.replace(/[$,()\s]/g,''));return Number.isFinite(n)?(raw.startsWith('(')?-n:n):null;}
function usDate(value:unknown):string|null {if(typeof value!=='string')return null;const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);if(!m)return null;const date=`${m[3]}-${m[1]?.padStart(2,'0')}-${m[2]?.padStart(2,'0')}`;return iso.safeParse(date).success?date:null;}
function easternMs(date:string,time:string):number {const wanted=Date.parse(`${date}T${time}Z`);let guess=wanted;for(let i=0;i<3;i++){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess));const fields=Object.fromEntries(p.map(v=>[v.type,v.value]));const local=Date.parse(`${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}:${fields.second}Z`);guess+=wanted-local;}return guess;}
export function parseAgencyCalendar(raw:string,source:string):EconomicEntry[] {
 if(!raw.includes('BEGIN:VCALENDAR') || !raw.includes('END:VCALENDAR'))throw new Error('Agency calendar is malformed');
 const unfolded=raw.replace(/\r?\n[ \t]/g,'');const rows:EconomicEntry[]=[];
 for(const block of unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/g)) {
  const lines=block[1]?.split(/\r?\n/)??[];const title=text(lines.find(line=>line.startsWith('SUMMARY:'))?.slice(8).replace(/\\n/gi,' ').replace(/\\([,;\\])/g,'$1'));const start=lines.find(line=>line.startsWith('DTSTART'));
  if(!title || !start || lines.includes('STATUS:CANCELLED'))continue;
  const m=/^(DTSTART[^:]*):(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(start);if(!m)continue;
  const localDate=`${m[2]}-${m[3]}-${m[4]}`;if(!iso.safeParse(localDate).success)continue;
  let releaseMs:number|null=null;
  if(m[5]) {const time=`${m[5]}:${m[6]}:${m[7]}`;if(m[8])releaseMs=Date.parse(`${localDate}T${time}Z`);else if(/TZID=(?:US-Eastern|America\/New_York)/.test(m[1]??''))releaseMs=easternMs(localDate,time);else continue;if(!Number.isFinite(releaseMs))continue;}
  const date=releaseMs===null?localDate:easternDate(new Date(releaseMs));const importance=/Consumer Price Index|Producer Price Index|Employment Situation|Gross Domestic Product|\bGDP\b|Personal Income and Outlays/i.test(title)?'high':/Employment|Job Openings|International Trade|Productivity/i.test(title)?'medium':'low';
  rows.push({id:`${source}:${date}:${title}`,title,source,date,releaseMs,importance,country:'US'});
 }
 return rows;
}

// Fixed public sources; no caller-controlled destination, secret or paid API.
// Requests share per-source/date caches, so different UI windows do not refetch
// overlapping dates. A failed provider never becomes a successful empty feed.
export class MarketCalendars {
 private readonly cache=new Map<string,{expires:number;promise:Promise<string>}>();
 constructor(private readonly request:typeof fetch=fetch,private readonly clock:()=>Date=()=>new Date()){}
 private async download(url:string):Promise<string> {
  const existing=this.cache.get(url);if(existing && existing.expires>this.clock().getTime())return existing.promise;
  if(this.cache.size>=256)this.cache.delete(this.cache.keys().next().value??'');
  const promise=this.fetchText(url).catch((error:unknown)=>{this.cache.delete(url);throw error;});this.cache.set(url,{expires:this.clock().getTime()+15*60_000,promise});return promise;
 }
 private async fetchText(url:string):Promise<string> {
  const response=await this.request(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; CoinTrade/1.0)','Accept':'application/json,text/calendar,*/*','Origin':'https://www.nasdaq.com'},signal:AbortSignal.timeout(20_000),redirect:'error'});
  if(!response.ok)throw new Error(`Calendar provider returned HTTP ${response.status}`);if(!response.body)throw new Error('Calendar provider body is empty');
  const reader=response.body.getReader();const parts:Uint8Array[]=[];let size=0;
  try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2_000_000){await reader.cancel();throw new Error('Calendar provider response too large');}parts.push(part.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return new TextDecoder().decode(bytes);
 }
 private async nasdaq(url:string):Promise<Record<string,unknown>> {
  let value:unknown;try{value=JSON.parse(await this.download(url));}catch(error){if(error instanceof SyntaxError)throw new Error('Calendar provider returned invalid JSON');throw error;}
  const body=record.parse(value);const status=record.parse(body.status);if(status.rCode!==200)throw new Error('Calendar provider rejected request');return record.parse(body.data);
 }
 async earnings(raw:unknown={}) {
  const query=earningsQuery.parse(raw);const start=query.start??easternDate(this.clock());const end=addDays(start,query.days-1);const symbols=query.symbols?new Set(query.symbols.toUpperCase().split(',')):null;
  const dates=Array.from({length:query.days},(_,i)=>addDays(start,i));const entries:EarningsEntry[]=[];let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,dates.length)},async()=>{while(cursor<dates.length){const date=dates[cursor++];if(!date)continue;const body=await this.nasdaq(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`);if(body.rows!==null && !Array.isArray(body.rows))throw new Error('Earnings calendar rows are malformed');for(const rawRow of (body.rows??[]) as unknown[]){const row=record.parse(rawRow);const symbol=text(row.symbol)?.toUpperCase();if(!symbol || !/^[A-Z0-9.^-]+$/.test(symbol) || (symbols&&!symbols.has(symbol)))continue;const epsEstimate=number(row.epsForecast);const reportTime=row.time==='time-before-hours'?'bmo':row.time==='time-after-hours'?'amc':undefined;entries.push({symbol,name:text(row.name),reportDate:date,fiscalDateEnding:null,epsEstimate,currency:epsEstimate===null?null:'USD',...(reportTime?{reportTime}:{})});}}}));
  entries.sort((a,b)=>a.reportDate.localeCompare(b.reportDate)||a.symbol.localeCompare(b.symbol));return {entries,start,end,fetchedAt:this.clock().toISOString()};
 }
 async ipos(raw:unknown={}) {
  const query=rangeQuery.parse(raw);const start=easternDate(this.clock());const end=addDays(start,(query.days??92)-1);const months=new Set(Array.from({length:query.days??92},(_,i)=>addDays(start,i).slice(0,7)));const entries:IpoEntry[]=[];
  for(const month of months){const body=await this.nasdaq(`https://api.nasdaq.com/api/ipo/calendar?date=${month}`);const upcoming=record.parse(body.upcoming);const table=record.parse(upcoming.upcomingTable);if(table.rows!==null&&!Array.isArray(table.rows))throw new Error('IPO calendar rows are malformed');for(const rawRow of (table.rows??[]) as unknown[]){const row=record.parse(rawRow);const symbol=text(row.proposedTickerSymbol);const name=text(row.companyName);const date=usDate(row.expectedPriceDate);if(!symbol||!name||!date||date<start||date>end)continue;const range=text(row.proposedSharePrice)?.split(/\s*-\s*/);const low=number(range?.[0]);const high=range?.length===2?number(range[1]):low;entries.push({symbol,name,date,exchange:text(row.proposedExchange),priceRangeLow:low,priceRangeHigh:high,currency:low===null?null:'USD'});}}
  const unique=Array.from(new Map(entries.map(row=>[`${row.symbol}:${row.date}`,row])).values());unique.sort((a,b)=>a.date.localeCompare(b.date)||a.symbol.localeCompare(b.symbol));return {entries:unique,fetchedAt:this.clock().toISOString()};
 }
 async economic(raw:unknown={}) {
  const query=rangeQuery.parse(raw);const start=easternDate(this.clock());const end=addDays(start,(query.days??14)-1);
  const results=await Promise.allSettled(agencySources.map(async agency=>({source:agency.source,entries:parseAgencyCalendar(await this.download(agency.url),agency.source)})));
  if(results.every(r=>r.status==='rejected'))throw new Error('Economic calendar sources are unavailable');
  const entries=results.flatMap(result=>result.status==='fulfilled'?result.value.entries:[]).filter(row=>row.date>=start&&row.date<=end);entries.sort((a,b)=>a.date.localeCompare(b.date)||(a.releaseMs??Infinity)-(b.releaseMs??Infinity)||a.title.localeCompare(b.title));
  return {entries,start,end,fetchedAt:this.clock().toISOString(),sources:{available:results.flatMap(r=>r.status==='fulfilled'?[r.value.source]:[]),unavailable:results.flatMap((r,i)=>r.status==='rejected'?[agencySources[i]?.source??'unknown']:[])}};
 }
}
