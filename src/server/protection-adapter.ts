import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import type { ProtectionAdapter, ProtectionRun } from './advanced-protection.ts';
import type { TradingDesk } from './trading.ts';
import type { HummingbotExecution } from './execution.ts';
import type { OperationClient } from './operations.ts';
import type { ChasePlans } from './chase-plans.ts';

export function createProtectionAdapter(desk:TradingDesk,execution:Pick<HummingbotExecution,'chaseEvidence'>,client:OperationClient,chase:()=>Pick<ChasePlans,'get'|'cancel'>):ProtectionAdapter {
 const authorize=(run:ProtectionRun,allowHalted:boolean)=>{
  const status=desk.status(),input=run.input;
  if(!status.executionConfigured||status.halted&&!allowHalted||status.accountName!==input.accountName||desk.modeFor(input.venue)!=='live'||desk.store.connectionFingerprint(input.accountName,input.venue)!==input.connectionRevision)throw Error('Protection halted or reviewed account, mode or connection changed');
 };
 return {
  authorize,
  previewExit:async order=>desk.preview(order),
  submitPair:async(run,orders,requestId,onSubmitted,notionalCaps)=>{
   authorize(run,false);
   if(run.input.venue==='lighter'){
    const result=await desk.confirmBracket(requestId,'live',orders,()=>authorize(run,false),notionalCaps?new Decimal(notionalCaps[0]).plus(notionalCaps[1]).toFixed():undefined);
    if(result.status!=='submitted'||!result.orderId)throw Error('Native protective OCO submission uncertain; inspect owned orders');
    const match=/^native-oco:lighter:([1-9]\d*),([1-9]\d*)$/.exec(result.orderId);
    if(!match)throw Error('Native protective OCO identities are unverified');
    const ids:[string,string]=['native-client:lighter:'+match[1],'native-client:lighter:'+match[2]];
    onSubmitted?.(0,ids[0]);onSubmitted?.(1,ids[1]);return {ids};
   }
   const ids:string[]=[];
   for(const [index,order] of orders.entries()){
    authorize(run,false);const result=await desk.confirm(requestId+'-'+index,'live',order,()=>authorize(run,false),notionalCaps?.[index]);
    if(result.status!=='submitted'||!result.orderId)throw Error('Managed protective pair is incomplete or uncertain; inspect '+(ids.join(', ')||'owned submissions'));
    onSubmitted?.(index===0?0:1,result.orderId);ids.push(result.orderId);authorize(run,false);
   }
   return {ids:[ids[0],ids[1]]};
  },
  exitEvidence:async(run,order,id)=>{
   authorize(run,true);
   try{const result=await execution.chaseEvidence(order,id);authorize(run,true);return result;}
   catch{authorize(run,true);return {status:'pending'};}
  },
  cancelExit:async(run,id,requestId)=>{
   authorize(run,true);const exit=run.groups.flatMap(g=>g.exits).find(e=>e.id===id);
   if(!exit)throw Error('Protective exit is not owned by this reviewed plan');
   const proof=await execution.chaseEvidence(exit.order,id);authorize(run,true);
   if(proof.status==='settled')return;
   if(proof.status!=='open'||!proof.exchangeId||!/^[1-9]\d*$/.test(proof.exchangeId))throw Error('Owned protective order cancellation identity is unavailable');
   const operationId=createHash('sha256').update(requestId+':'+id).digest('hex');
   const payload={request_id:operationId,account_name:run.input.accountName,connector_name:run.input.venue+'_perpetual',trading_pair:run.input.venue==='hyperliquid'?run.input.symbol.replace(/-USDC$/,'-USD'):run.input.symbol,exchange_order_id:proof.exchangeId};
   const previous=desk.store.claimOperation(operationId,createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
   if(previous){if(previous.state==='completed')return;throw Error('Owned protection cancellation outcome uncertain; no retry permitted');}
   try{authorize(run,true);z.object({status:z.literal('accepted')}).parse(await client.perform('cancel-order',payload));desk.store.finishOperation(operationId,'completed',{orderId:id});}
   catch(error){desk.store.finishOperation(operationId,'unknown',{orderId:id});throw Error('Owned protection cancellation uncertain: '+(error instanceof Error?error.message:'inspect venue'));}
  },
  stopEntry:async run=>{
   authorize(run,true);
   if(run.input.kind==='native-twap')return run.entrySettled&&run.fills.reduce((n,f)=>n.plus(f.size),new Decimal(0)).eq(run.input.size);
   const runner=chase();let entry=runner.get(run.entryId!);
   if(!entry.stopRequested&&!['completed','cancelled'].includes(entry.status))entry=runner.cancel(entry.id);
   return ['completed','cancelled'].includes(entry.status)&&entry.attempts.every(a=>a.phase==='settled');
  },
 };
}
