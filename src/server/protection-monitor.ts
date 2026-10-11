import Decimal from 'decimal.js';
import { z } from 'zod';
import type { AdvancedProtection, ProtectionRun, ProtectionFill, ProtectionInput } from './advanced-protection.ts';
import type { HyperliquidNativeTwap } from './hyperliquid-native-twap.ts';
import type { ChasePlans } from './chase-plans.ts';

const decimal=z.string().max(40).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const nativeEvidence=z.object({twap_id:z.string(),verified_fill_size:decimal,history_may_be_truncated:z.boolean(),fills:z.array(z.object({id:z.string().min(1).max(200),size:decimal.refine(value=>new Decimal(value).gt(0)),price:decimal.refine(value=>new Decimal(value).gt(0)).optional()})).max(2000)});
const ExactDecimal=Decimal.clone({precision:100});

/** Entry completion does not stop supervision of its owned protective exits. */
export class ProtectionMonitor {
 private timer:ReturnType<typeof setInterval>|undefined;
 private pending:Promise<void>|undefined;
 private closing=false;
 constructor(private protection:AdvancedProtection,private native:Pick<HyperliquidNativeTwap,'evidence'> & {recoverOwnedEntry?:(input:ProtectionInput)=>string|undefined},private chase:Pick<ChasePlans,'get'>){}
 private chaseScopeMatches(run:ProtectionRun,entry:ReturnType<ChasePlans['get']>):boolean{
  return entry.id===run.id&&entry.plan.requestId===run.id&&entry.plan.accountName===run.input.accountName&&entry.plan.connectionRevision===run.input.connectionRevision&&entry.plan.venue===run.input.venue&&entry.plan.symbol===run.input.symbol&&entry.plan.side===run.input.side&&entry.plan.size===run.input.size&&(entry.plan.reduceOnly??false)===run.input.reduceOnly&&JSON.stringify(entry.plan.protection)===JSON.stringify(run.input.protection);
 }
 private recoverBinding(run:ProtectionRun):boolean{
  if(run.status!=='prepared')return false;
  if(run.input.kind==='native-twap'){
   const identity=this.native.recoverOwnedEntry?.(run.input);if(!identity)return false;
   this.protection.bindEntry(run.id,identity);run.entryId=identity;return true;
  }
  const entry=this.chase.get(run.id);
  if(!this.chaseScopeMatches(run,entry)||!entry.attempts.some(attempt=>Boolean(attempt.orderId)&&attempt.phase!=='submitting')||entry.attempts.some(attempt=>attempt.phase==='submitting')||entry.status==='paused')return false;
  this.protection.bindEntry(run.id,entry.id);run.entryId=entry.id;return true;
 }
 tick():Promise<void>{
  if(this.closing)return Promise.resolve();
  if(this.pending)return this.pending;
  const operation=this.reconcileRuns();this.pending=operation;
  const clear=()=>{if(this.pending===operation)this.pending=undefined;};
  void operation.then(clear,clear);
  return operation;
 }
 private async entryEvidence(run:ProtectionRun):Promise<{complete:boolean;fills:ProtectionFill[];entrySettled:boolean}>{
  if(run.input.kind==='chase'){
   const entry=this.chase.get(run.entryId!);
   if(entry.id!==run.id||entry.plan.accountName!==run.input.accountName||entry.plan.connectionRevision!==run.input.connectionRevision||entry.plan.venue!==run.input.venue||entry.plan.symbol!==run.input.symbol||entry.plan.side!==run.input.side||!new ExactDecimal(entry.plan.size).eq(run.input.size))throw Error('Chase protection entry scope mismatch');
   const settledEvidence=entry.attempts.filter(attempt=>attempt.phase==='settled').every(attempt=>attempt.filledSize!==undefined);
   const allSettled=entry.attempts.every(attempt=>attempt.phase==='settled');
   const fills=entry.attempts.flatMap((attempt,index)=>attempt.phase==='settled'&&attempt.filledSize!==undefined&&new ExactDecimal(attempt.filledSize).gt(0)?[{id:`attempt-${index+1}`,size:attempt.filledSize}]:[]);
   const total=fills.reduce((sum,fill)=>sum.plus(fill.size),new ExactDecimal(0));
   const complete=settledEvidence&&total.eq(entry.filledSize);
   return {complete,fills,entrySettled:complete&&allSettled&&['completed','cancelled'].includes(entry.status)};
  }
  const proof=nativeEvidence.parse(await this.native.evidence({requestId:run.id,accountName:run.input.accountName,connectionRevision:run.input.connectionRevision,symbol:run.input.symbol,twapId:run.entryId,side:run.input.side,size:run.input.size}));
  if(proof.twap_id!==run.entryId)throw Error('Native TWAP protection identity mismatch');
  const identities=new Set<string>();for(const fill of proof.fills){if(identities.has(fill.id))throw Error('Duplicate native TWAP fill identity');identities.add(fill.id);}
  const total=proof.fills.reduce((sum,fill)=>sum.plus(fill.size),new ExactDecimal(0));
  const exact=total.eq(proof.verified_fill_size)&&total.lte(run.input.size);
  const full=exact&&total.eq(run.input.size);
  return {complete:exact&&(!proof.history_may_be_truncated||full),fills:proof.fills,entrySettled:full};
 }
 private async reconcileRuns():Promise<void>{
  for(const run of this.protection.list()){
   if(this.closing)break;
   if(run.status==='paused'||run.status==='completed')continue;
   if(!run.entryId){try{if(!this.recoverBinding(run))continue;}catch{continue;}}
   let evidence:{complete:boolean;fills:ProtectionFill[];entrySettled:boolean};
   try{evidence=await this.entryEvidence(run);}catch{evidence={complete:false,fills:[],entrySettled:false};}
   await this.protection.reconcile(run.id,evidence);
  }
 }
 startTimer(){if(!this.timer&&!this.closing)this.timer=setInterval(()=>{void this.tick().catch(error=>console.error('Protection monitor failed:',error instanceof Error?error.message:'unknown'));},5000).unref();}
 async close():Promise<void>{this.closing=true;if(this.timer)clearInterval(this.timer);await this.pending;}
}
