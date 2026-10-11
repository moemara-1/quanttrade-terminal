import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import DecimalBase from 'decimal.js';
const Decimal = DecimalBase.clone({precision:100});
import { z } from 'zod';
import type { OrderDraft } from '../shared/types.ts';
const positive=z.string().max(40).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine(v=>new Decimal(v).gt(0));
export const advancedProtectionSchema=z.object({activation:z.enum(['after-full-entry-fill','verified-settled-attempt-fills']),management:z.literal('managed'),stopLossPrice:positive,takeProfits:z.array(z.object({price:positive,sizePercent:positive}).strict()).min(1).max(8),maxExitNotional:positive}).strict().refine(s=>s.takeProfits.reduce((n,p)=>n.plus(p.sizePercent),new Decimal(0)).eq(100),'Take-profit percentages must total 100');
export type ProtectionSpec=z.infer<typeof advancedProtectionSchema>;
export type ProtectionInput={id:string;kind:'chase'|'native-twap';accountName:string;connectionRevision:string;venue:'lighter'|'hyperliquid';symbol:string;side:'buy'|'sell';size:string;sizeDecimals:number;reduceOnly:boolean;protection:ProtectionSpec};
export type ProtectionFill={id:string;size:string;price?:string};
type Exit={id?:string;order:OrderDraft;phase:'submitting'|'open'|'cancelling'|'settled';filledSize:string};
type Group={requestId:string;size:string;retired?:boolean;notionalCaps?:[string,string];exits:[Exit,Exit]};
export type ProtectionRun={id:string;fingerprint:string;input:ProtectionInput;entryId?:string;status:'prepared'|'active'|'waiting-evidence'|'paused'|'stopping-entry'|'completed';fills:ProtectionFill[];groups:Group[];protectedSize:string;spent:string;stopEntryRequested:boolean;entryStopped:boolean;entrySettled:boolean;error?:string};
export interface ProtectionAdapter {
 authorize(run:ProtectionRun,allowHalted:boolean):void;
 previewExit(order:OrderDraft):Promise<{notional:string}>;
 submitPair(run:ProtectionRun,orders:[OrderDraft,OrderDraft],requestId:string,onSubmitted?:(index:0|1,id:string)=>void,notionalCaps?:readonly [string,string]):Promise<{ids:[string,string]}>;
 exitEvidence(run:ProtectionRun,order:OrderDraft,id:string):Promise<{status:'open'|'settled'|'pending';filledSize?:string}>;
 cancelExit(run:ProtectionRun,id:string,requestId:string):Promise<void>;
 stopEntry(run:ProtectionRun):Promise<boolean>;
}
/** Every mutation is persisted first. Unknown outcomes are never replayed. */
export class AdvancedProtection {
 private db:DatabaseSync;private busy=new Set<string>();private operations=0;private closing=false;private closed=false;
 constructor(path:string,private adapter:ProtectionAdapter){this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS advanced_protection(id TEXT PRIMARY KEY,body TEXT NOT NULL)');for(const run of this.list())if(run.groups.some(g=>g.exits.some(e=>e.phase==='submitting'||e.phase==='cancelling'))||run.status==='stopping-entry'){run.status='paused';run.error='Restart during an uncertain protection mutation; inspect owned identities. No replay is allowed.';this.save(run);}}
 list():ProtectionRun[]{return this.db.prepare('SELECT body FROM advanced_protection').all().map(r=>JSON.parse(String(r.body)) as ProtectionRun);}
 get(id:string):ProtectionRun{const row=this.db.prepare('SELECT body FROM advanced_protection WHERE id=?').get(id);if(!row)throw Error('Protection run not found');return JSON.parse(String(row.body)) as ProtectionRun;}
 private save(run:ProtectionRun){this.db.prepare('INSERT INTO advanced_protection(id,body) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(run.id,JSON.stringify(run));}
 private exits(input:ProtectionInput,size:string,price:string):[OrderDraft,OrderDraft]{const make=(triggerType:'tp'|'sl',triggerPrice:string):OrderDraft=>({venue:input.venue,marketType:'perpetual',symbol:input.symbol,side:input.side==='buy'?'sell':'buy',type:'market',size,reduceOnly:true,trigger:{triggerType,triggerPrice},rationale:'Immutable reviewed protection of verified advanced entry fills'});return [make('tp',price),make('sl',input.protection.stopLossPrice)];}
 async prepare(input:ProtectionInput):Promise<ProtectionRun>{
  if(this.closing)throw Error('Protection service is closing');this.operations++;
  try{return await this.prepareRun(input);}finally{this.operations--;this.finishClose();}
 }
 private async prepareRun(input:ProtectionInput):Promise<ProtectionRun>{
  input={...input,protection:advancedProtectionSchema.parse(input.protection)};
  if(input.protection.activation!==(input.kind==='native-twap'?'after-full-entry-fill':'verified-settled-attempt-fills'))throw Error('Protection activation does not match reviewed entry kind');
  if(input.reduceOnly)throw Error('Reduce-only entries cannot include opening protection');
  if(!Number.isInteger(input.sizeDecimals)||input.sizeDecimals<0||input.sizeDecimals>18)throw Error('Invalid market size precision');
  positive.parse(input.size);if(new Decimal(input.size).decimalPlaces()>input.sizeDecimals)throw Error('Protection entry violates size precision');
  const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');const existing=this.list().find(r=>r.id===input.id);if(existing){if(existing.fingerprint!==fingerprint)throw Error('Protection approval belongs to a different immutable specification');return existing;}
  if(this.list().filter(r=>r.status!=='completed').length>=20)throw Error('Too many active protection runs');
  let budget=new Decimal(0);for(const p of input.protection.takeProfits){if(input.side==='buy'?new Decimal(p.price).lte(input.protection.stopLossPrice):new Decimal(p.price).gte(input.protection.stopLossPrice))throw Error('Protection prices are not ordered for entry side');budget=budget.plus(new Decimal(input.size).mul(new Decimal(p.sizePercent).div(100)).mul(new Decimal(p.price).plus(input.protection.stopLossPrice)));}
  if(budget.gt(input.protection.maxExitNotional))throw Error('Reviewed exit budget does not cover all protection allocations');
  const run:ProtectionRun={id:input.id,fingerprint,input,status:'prepared',fills:[],groups:[],protectedSize:'0',spent:'0',stopEntryRequested:false,entryStopped:false,entrySettled:false};this.adapter.authorize(run,false);
  let previewBudget=new Decimal(0);
  for(const allocation of this.allocations(input,input.size))for(const order of this.exits(input,allocation.size.toFixed(),allocation.price)){
   const preview=await this.adapter.previewExit(order);this.adapter.authorize(run,false);
   previewBudget=previewBudget.plus(positive.parse(preview.notional));
  }
  if(previewBudget.gt(input.protection.maxExitNotional))throw Error('Reviewed exit budget cannot cover actual protection preview notional');
  if(this.closing)throw Error('Protection service is closing');
  const raced=this.list().find(r=>r.id===input.id);if(raced){if(raced.fingerprint!==fingerprint)throw Error('Protection approval changed during review');return raced;}if(this.list().filter(r=>r.status!=='completed').length>=20)throw Error('Too many active protection runs');this.save(run);return run;
 }
 bindEntry(id:string,identity:string){if(!identity)throw Error('Owned entry identity required');const run=this.get(id);if(run.entryId&&run.entryId!==identity)throw Error('Protection is already bound to another owned entry');if(run.status==='paused')throw Error('Uncertain protection cannot bind a new entry');run.entryId=identity;run.status='active';this.save(run);}
 entryAllowed(id:string):boolean{const run=this.get(id);return !run.stopEntryRequested&&!['paused','stopping-entry','completed','waiting-evidence'].includes(run.status);}
 private allocations(input:ProtectionInput,size:string){
  const quantity=new Decimal(size);
  const allocations=input.protection.takeProfits.map(p=>({price:p.price,size:quantity.mul(p.sizePercent).div(100).toDecimalPlaces(input.sizeDecimals,Decimal.ROUND_DOWN)}));
  const sum=allocations.reduce((n,p)=>n.plus(p.size),new Decimal(0));
  allocations.at(-1)!.size=allocations.at(-1)!.size.plus(quantity.minus(sum));
  if(allocations.some(p=>p.size.lte(0)))throw Error('New fill cannot be partitioned at market precision; remains unprotected');
  return allocations;
 }
 private mergeFills(run:ProtectionRun,evidence:{complete:boolean;fills:ProtectionFill[];entrySettled:boolean}){
  if(evidence.complete){
   const fills=new Map<string,ProtectionFill>();
   for(const fill of [...run.fills,...evidence.fills]){
    positive.parse(fill.size);if(fill.price!==undefined)positive.parse(fill.price);if(!fill.id)throw Error('Stable fill identity required');
    const previous=fills.get(fill.id);
    if(previous&&(!new Decimal(previous.size).eq(fill.size)||previous.price!==fill.price))throw Error('Conflicting duplicate fill evidence');
    fills.set(fill.id,fill);
   }
   run.fills=[...fills.values()];run.entrySettled=evidence.entrySettled;
  }
  const total=run.fills.reduce((sum,fill)=>sum.plus(fill.size),new Decimal(0));
  if(total.gt(run.input.size)||total.decimalPlaces()>run.input.sizeDecimals)throw Error('Verified fill quantity exceeds approved entry or precision');
  return total;
 }
 private coverage(run:ProtectionRun):DecimalBase{
  return run.groups.reduce((sum,group)=>{
   const filled=group.exits.reduce((n,exit)=>n.plus(exit.filledSize),new Decimal(0));
   if(filled.gt(group.size))throw Error('Owned paired exit fills exceed verified allocation');
   if(group.retired)return sum.plus(filled);
   if(group.exits.some(e=>e.phase==='submitting'||e.phase==='cancelling'))return sum.plus(filled);
   return sum.plus(group.size);
  },new Decimal(0));
 }
 async reconcile(id:string,evidence:{complete:boolean;fills:ProtectionFill[];entrySettled:boolean}):Promise<ProtectionRun>{
  if(this.closing||this.busy.has(id))return this.get(id);
  this.busy.add(id);const run=this.get(id);
  try{
   if(run.status==='paused'||run.status==='completed')return run;
   if(!run.entryId)throw Error('Owned entry identity unavailable');this.adapter.authorize(run,run.stopEntryRequested);
   const total=this.mergeFills(run,evidence);this.save(run);
   let pendingExit=false;
   for(const group of run.groups){
    if(group.retired)continue;
    for(const exit of group.exits){
     if(!exit.id||exit.phase==='settled')continue;
     const proof=await this.adapter.exitEvidence(run,exit.order,exit.id);this.adapter.authorize(run,run.stopEntryRequested);
     if(proof.status==='pending'||proof.filledSize===undefined){pendingExit=true;continue;}
     const filled=new Decimal(proof.filledSize);
     if(!filled.isFinite()||filled.lt(exit.filledSize)||filled.gt(exit.order.size))throw Error('Owned exit fill evidence conflicts');
     exit.filledSize=filled.toFixed();if(filled.gt(0))run.stopEntryRequested=true;
     if(proof.status==='settled')exit.phase='settled';
    }
   }
   this.save(run);
   if(run.stopEntryRequested){
    if(!run.entryStopped){
     run.status='stopping-entry';this.save(run);this.adapter.authorize(run,true);
     if(this.closing)throw Error('Protection service is closing');
     run.entryStopped=await this.adapter.stopEntry(run);this.adapter.authorize(run,true);
     run.status=run.entryStopped?'active':'stopping-entry';this.save(run);if(!run.entryStopped)return run;
    }
    let cancelling=false;
    for(const group of run.groups){
     if(group.retired||!group.exits.some(e=>new Decimal(e.filledSize).gt(0)))continue;
     for(let index=0;index<group.exits.length;index++){
      const exit=group.exits[index];
      if(exit.phase==='open'){
       if(this.closing)throw Error('Protection service is closing');
       exit.phase='cancelling';this.save(run);this.adapter.authorize(run,true);
       await this.adapter.cancelExit(run,exit.id!,group.requestId+`-exit-${index}-cancel`);
       this.adapter.authorize(run,true);this.save(run);
      }
      if(exit.phase!=='settled')cancelling=true;
     }
     if(group.exits.every(e=>e.phase==='settled'))group.retired=true;
    }
    run.protectedSize=this.coverage(run).toFixed();this.save(run);
    if(cancelling){run.status='waiting-evidence';run.error='Owned protective cancellation awaits authoritative settlement; residual fills are not yet reprotected';this.save(run);return run;}
   }
   if(pendingExit||!evidence.complete){run.status='waiting-evidence';run.error='Exact complete entry and owned exit evidence required; no new protection or entry is permitted';this.save(run);return run;}
   for(const group of run.groups)if(group.exits.every(exit=>exit.phase==='settled'))group.retired=true;
   run.protectedSize=this.coverage(run).toFixed();
   if(new Decimal(run.protectedSize).gt(total))throw Error('Owned protection exceeds verified entry fills');
   run.status='active';delete run.error;this.save(run);
   if(run.input.kind==='native-twap'&&!total.eq(run.input.size)){run.status='waiting-evidence';run.error='Native TWAP protection activates only after exact full entry fills; partial fills remain unprotected';this.save(run);return run;}
   const delta=total.minus(run.protectedSize);
   if(delta.gt(0))for(const allocation of this.allocations(run.input,delta.toFixed())){
    const orders=this.exits(run.input,allocation.size.toFixed(),allocation.price);let amount=new Decimal(0);const caps:string[]=[];
    for(const order of orders){const preview=await this.adapter.previewExit(order);this.adapter.authorize(run,false);const cap=positive.parse(preview.notional);caps.push(cap);amount=amount.plus(cap);}
    if(new Decimal(run.spent).plus(amount).gt(run.input.protection.maxExitNotional))throw Error('Reviewed protection budget exhausted; verified residual remains unprotected');
    if(this.closing)throw Error('Protection service is closing');
    const group:Group={requestId:`protection-${id}-${run.groups.length+1}`,size:allocation.size.toFixed(),notionalCaps:[caps[0],caps[1]],exits:orders.map(order=>({order,phase:'submitting' as const,filledSize:'0'})) as [Exit,Exit]};
    run.groups.push(group);run.spent=new Decimal(run.spent).plus(amount).toFixed();this.save(run);this.adapter.authorize(run,false);
    const result=await this.adapter.submitPair(run,orders,group.requestId,(index,identity)=>{
     if(!identity||group.exits.some((exit,other)=>other!==index&&exit.id===identity))throw Error('Protective acknowledgement identity is unverified');
     if(group.exits[index].id&&group.exits[index].id!==identity)throw Error('Protective acknowledgement identity changed');
     group.exits[index].id=identity;this.save(run);
    },group.notionalCaps);
    if(!result.ids[0]||!result.ids[1]||result.ids[0]===result.ids[1])throw Error('Protective pair identity is unverified');
    for(let i=0;i<2;i++){if(group.exits[i].id&&group.exits[i].id!==result.ids[i])throw Error('Protective receipt conflicts with durable owned identity');group.exits[i].id=result.ids[i];group.exits[i].phase='open';}
    run.protectedSize=this.coverage(run).toFixed();this.save(run);this.adapter.authorize(run,false);
   }
   if(run.entrySettled&&run.groups.length>0&&run.groups.every(g=>g.retired)&&new Decimal(run.protectedSize).eq(total))run.status='completed';
   this.save(run);return run;
  }catch(error){run.status='paused';run.error=error instanceof Error?error.message:'Protection unverified';this.save(run);return run;}finally{this.busy.delete(id);this.finishClose();}
 }
 private finishClose(){if(this.closing&&!this.closed&&this.busy.size===0&&this.operations===0){this.closed=true;this.db.close();}}
 close(){this.closing=true;this.finishClose();}
}
