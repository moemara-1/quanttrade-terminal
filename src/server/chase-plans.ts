import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { advancedProtectionSchema, type AdvancedProtection } from './advanced-protection.ts';
import type { TradingDesk } from './trading.ts';
import type { OperationClient } from './operations.ts';
import type { OrderDraft } from '../shared/types.ts';
import type { OrderBook, Venue } from '../shared/types.ts';

const positive=z.string().max(40).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine(v=>new Decimal(v).gt(0));
export const chasePlanSchema=z.object({requestId:z.string().uuid(),proposedAt:z.number().int().nonnegative(),credentialId:z.string().min(1).max(200),accountName:z.string().min(1).max(200),connectionRevision:z.string().regex(/^[a-f0-9]{64}$/),mode:z.literal('live'),venue:z.enum(['lighter','hyperliquid']),marketType:z.literal('perpetual'),symbol:z.string().max(100).regex(/^[A-Za-z0-9:_.]+-USDC$/),side:z.enum(['buy','sell']),size:positive,lowerPrice:positive,upperPrice:positive,durationSeconds:z.number().int().min(30).max(86400),intervalSeconds:z.number().int().min(10).max(300),maxAttempts:z.number().int().min(1).max(100),maxTotalNotional:positive,protection:advancedProtectionSchema.optional(),postOnly:z.boolean().optional(),reduceOnly:z.boolean().optional(),leverage:z.number().int().min(1).max(125).optional(),marginMode:z.enum(['cross','isolated']).optional()}).strict();
type Plan=z.infer<typeof chasePlanSchema>;
export interface ChaseEvidence {status:'open'|'settled'|'pending';filledSize?:string;exchangeId?:string;error?:string}
interface EvidenceClient {chaseEvidence(order:OrderDraft,id:string):Promise<ChaseEvidence>}
type Attempt={order:OrderDraft;orderId?:string;exchangeId?:string;phase:'submitting'|'open'|'cancelling'|'settled';submittedAt:number;filledSize?:string};
export type ChaseRun={id:string;fingerprint:string;plan:Plan;startedAt:number;deadline:number;status:'active'|'paused'|'completed'|'cancelled';attempts:Attempt[];filledSize:string;spent:string;stopRequested:boolean;error?:string};

/** A bounded approval owns every child. Replacement waits for authoritative settlement. */
export class ChasePlans {
  private db:DatabaseSync;
  private timer:ReturnType<typeof setInterval>|undefined;
  private busy=false;
  private closing=false;
  private closed=false;
  private closeWaiters:Array<()=>void>=[];
  constructor(path:string,private desk:TradingDesk,private evidence:EvidenceClient,private client:OperationClient,private clock=Date.now,private books?:{book(venue:Venue,symbol:string,marketType:'perpetual'):Promise<OrderBook>},private protection?:AdvancedProtection){
    this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS chase_runs(id TEXT PRIMARY KEY,body TEXT NOT NULL)');
    for(const run of this.list())if(run.status==='active'&&run.attempts.some(a=>a.phase==='submitting'||a.phase==='cancelling')){run.status='paused';run.error='Service restarted during an exchange mutation. Inspect owned orders; this plan will not replay.';this.save(run);}
  }
  list():ChaseRun[]{return this.db.prepare('SELECT body FROM chase_runs').all().map(row=>JSON.parse(String(row.body)) as ChaseRun);}
  get(id:string):ChaseRun{const row=this.db.prepare('SELECT body FROM chase_runs WHERE id=?').get(id);if(!row)throw Error('Chase plan not found');return JSON.parse(String(row.body)) as ChaseRun;}
  private save(run:ChaseRun){const previous=this.db.prepare('SELECT body FROM chase_runs WHERE id=?').get(run.id);if(previous)run.stopRequested=run.stopRequested||(JSON.parse(String(previous.body)) as ChaseRun).stopRequested;this.db.prepare('INSERT INTO chase_runs(id,body) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(run.id,JSON.stringify(run));}
  private authorized(plan:Plan,allowHalted=false){const status=this.desk.status();if(status.halted&&!allowHalted||!status.executionConfigured||status.accountName!==plan.accountName||this.desk.modeFor(plan.venue)!=='live'||this.desk.store.connectionFingerprint(plan.accountName,plan.venue)!==plan.connectionRevision)throw Error('Chase halted or reviewed account, mode or connection changed');}
  private order(plan:Plan,size:string,price:string,first:boolean):OrderDraft{return {venue:plan.venue,marketType:'perpetual',symbol:plan.symbol,side:plan.side,type:'limit',size,price,postOnly:plan.postOnly??true,reduceOnly:plan.reduceOnly??false,...(first&&plan.leverage!==undefined?{leverage:plan.leverage,marginMode:plan.marginMode}:{}),rationale:'Confirmed bounded Chase limit plan'};}
  private async price(plan:Plan,precision:number,reference:string):Promise<Decimal>{
    let price=reference;
    if(this.books){const book=await this.books.book(plan.venue,plan.symbol,'perpetual');const bid=book.bids[0]?.price,ask=book.asks[0]?.price;if(!bid||!ask||this.clock()-book.updatedAt>15000||book.updatedAt>this.clock()+5000||new Decimal(bid).lte(0)||new Decimal(ask).lte(bid))throw Error('Fresh uncrossed order book required for Chase');price=plan.side==='buy'?bid:ask;}
    return new Decimal(price).toDecimalPlaces(precision,plan.side==='buy'?Decimal.ROUND_DOWN:Decimal.ROUND_UP);
  }
  async start(raw:unknown):Promise<ChaseRun>{
    const plan=chasePlanSchema.parse(raw),fingerprint=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    const existing=this.list().find(r=>r.id===plan.requestId);if(existing){if(existing.fingerprint!==fingerprint)throw Error('Approval ID belongs to a different Chase plan');return existing;}
    this.authorized(plan);
    if(plan.proposedAt>this.clock()+5000||this.clock()-plan.proposedAt>180000)throw Error('Chase proposal expired; prepare a fresh review');
    if(plan.protection){
      const stop=new Decimal(plan.protection.stopLossPrice);
      if(plan.side==='buy'?stop.gte(plan.lowerPrice)||plan.protection.takeProfits.some(p=>new Decimal(p.price).lte(plan.upperPrice)):stop.lte(plan.upperPrice)||plan.protection.takeProfits.some(p=>new Decimal(p.price).gte(plan.lowerPrice)))throw Error('Protective stop and take-profits must lie strictly outside the reviewed entry band');
    }
    if(new Decimal(plan.lowerPrice).gte(plan.upperPrice))throw Error('Chase lower price must be below its upper price');
    if((plan.leverage===undefined)!==(plan.marginMode===undefined)||plan.reduceOnly&&plan.leverage!==undefined)throw Error('Opening leverage requires paired margin mode; reduce-only Chase cannot change leverage');
    if(this.list().filter(r=>r.status==='active').length>=20)throw Error('Too many active Chase plans');
    const market=await this.desk.currentMarket(this.order(plan,plan.size,plan.lowerPrice,true));
    for(const price of [plan.lowerPrice,plan.upperPrice])if(new Decimal(price).decimalPlaces()>market.priceDecimals||(plan.venue==='hyperliquid'&&new Decimal(price).sd()>5&&!new Decimal(price).isInteger()))throw Error('Chase band violates exchange price precision');
    const initialPrice=await this.price(plan,market.priceDecimals,market.price);
    if(initialPrice.lt(plan.lowerPrice)||initialPrice.gt(plan.upperPrice))throw Error('Current market is outside the reviewed Chase price band');
    await this.desk.preview(this.order(plan,plan.size,initialPrice.toFixed(),true));
    if(new Decimal(plan.size).mul(plan.upperPrice).gt(plan.maxTotalNotional))throw Error('Chase budget cannot cover one complete entry at the upper price');
    this.authorized(plan);
    if(this.clock()-plan.proposedAt>180000)throw Error('Chase proposal expired during market reads');
    const raced=this.list().find(r=>r.id===plan.requestId);if(raced){if(raced.fingerprint!==fingerprint)throw Error('Approval ID belongs to a different Chase plan');return raced;}
    if(this.list().filter(r=>r.status==='active').length>=20)throw Error('Too many active Chase plans');
    if(plan.protection){if(!this.protection)throw Error('Advanced protection service is unavailable');await this.protection.prepare({id:plan.requestId,kind:'chase',accountName:plan.accountName,connectionRevision:plan.connectionRevision,venue:plan.venue,symbol:plan.symbol,side:plan.side,size:plan.size,sizeDecimals:market.sizeDecimals,reduceOnly:plan.reduceOnly??false,protection:plan.protection});this.authorized(plan);}
    const run:ChaseRun={id:plan.requestId,fingerprint,plan,startedAt:this.clock(),deadline:this.clock()+plan.durationSeconds*1000,status:'active',attempts:[],filledSize:'0',spent:'0',stopRequested:false};this.save(run);return run;
  }
  cancel(id:string):ChaseRun{const run=this.get(id);if(!['active','paused'].includes(run.status)||run.attempts.at(-1)?.phase==='submitting'||run.status==='paused'&&run.attempts.at(-1)?.phase==='cancelling')throw Error('Uncertain Chase mutations must be inspected before cancellation');this.authorized(run.plan,true);run.stopRequested=true;run.status='active';this.save(run);return run;}
  cancelReviewed(raw:unknown):ChaseRun{
    const request=z.object({requestId:z.string().uuid(),proposedAt:z.number().int(),credentialId:z.string().min(1),accountName:z.string().min(1),connectionRevision:z.string().regex(/^[a-f0-9]{64}$/),mode:z.literal('live'),venue:z.enum(['lighter','hyperliquid']),marketType:z.literal('perpetual'),symbol:z.string(),runId:z.string().uuid()}).strict().parse(raw);
    const run=this.get(request.runId);
    if(request.accountName!==run.plan.accountName||request.venue!==run.plan.venue||request.symbol!==run.plan.symbol||request.connectionRevision!==run.plan.connectionRevision)throw Error('Reviewed cancellation does not match the owned Chase plan');
    this.authorized(run.plan,true);
    if(request.proposedAt>this.clock()+5000||this.clock()-request.proposedAt>180000)throw Error('Chase cancellation review expired');
    const fingerprint=createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const previous=this.desk.store.claimOperation(request.requestId,fingerprint);
    if(previous){if(previous.state!=='completed')throw Error('Chase cancellation registration is uncertain; inspect runs');return this.get(request.runId);}
    try{const result=this.cancel(request.runId);this.desk.store.finishOperation(request.requestId,'completed',{runId:result.id});return result;}
    catch(error){this.desk.store.finishOperation(request.requestId,'unknown',{error:'Cancellation registration failed; inspect Chase run'});throw error;}
  }
  async tick(){
    if(this.busy||this.closing)return;this.busy=true;
    try{for(const run of this.list().filter(r=>r.status==='active')){
      try{
        if(run.plan.protection){if(!this.protection)throw Error('Protection service unavailable');const protectionRun=this.protection.get(run.id);if(protectionRun.entryId){await this.protection.reconcile(run.id,{complete:true,fills:run.attempts.flatMap((a,i)=>a.phase==='settled'&&new Decimal(a.filledSize??'0').gt(0)?[{id:`attempt-${i+1}`,size:a.filledSize!}]:[]),entrySettled:run.status==='completed'||run.status==='cancelled'});if(this.protection.get(run.id).stopEntryRequested){run.stopRequested=true;this.save(run);}}}
        this.authorized(run.plan,run.stopRequested);const attempt=run.attempts.at(-1);
        if(attempt&&attempt.phase!=='settled'){
          if(!attempt.orderId)throw Error('Owned order identity is unavailable; no replacement allowed');
          const proof=await this.evidence.chaseEvidence(attempt.order,attempt.orderId);this.authorized(run.plan,run.stopRequested);
          if(this.closing||this.get(run.id).status!=='active')continue;
          if(proof.status==='pending'){run.error=proof.error??'Owned order evidence is pending; no replacement is allowed';this.save(run);continue;}
          delete run.error;
          if(proof.status==='settled'){
            if(proof.filledSize===undefined||!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(proof.filledSize)||new Decimal(proof.filledSize).gt(attempt.order.size))throw Error('Settled order fill quantity is invalid; no replacement allowed');
            attempt.filledSize=proof.filledSize;attempt.phase='settled';run.filledSize=run.attempts.reduce((sum,a)=>sum.plus(a.filledSize??'0'),new Decimal(0)).toFixed();
            if(new Decimal(run.filledSize).gt(run.plan.size))throw Error('Cumulative fills exceed the approved Chase quantity');
            if(new Decimal(run.filledSize).eq(run.plan.size))run.status='completed';
            else if(run.stopRequested||this.clock()>=run.deadline||run.attempts.length>=run.plan.maxAttempts)run.status='cancelled';
            this.save(run);continue;
          }
          if(attempt.phase==='cancelling')continue;
          if(!proof.exchangeId||!/^[1-9]\d*$/.test(proof.exchangeId))throw Error('Owned native order identity is not verified; no cancellation allowed');
          attempt.exchangeId=proof.exchangeId;
          if(run.stopRequested||this.clock()>=run.deadline||this.clock()-attempt.submittedAt>=run.plan.intervalSeconds*1000){
            // Persist before mutation: an uncertain cancel can never cause a replacement.
            attempt.phase='cancelling';this.save(run);this.authorized(run.plan,run.stopRequested);
            z.object({status:z.literal('accepted')}).parse(await this.client.perform('cancel-order',{request_id:`chase-${run.id}-${run.attempts.length}-cancel`,account_name:run.plan.accountName,connector_name:run.plan.venue+'_perpetual',trading_pair:run.plan.venue==='hyperliquid'?run.plan.symbol.replace(/-USDC$/,'-USD'):run.plan.symbol,exchange_order_id:proof.exchangeId}));
            this.save(run);
          }
          continue;
        }
        if(run.plan.protection&&!this.protection!.entryAllowed(run.id))throw Error('Protection evidence or mutation unresolved; no further entry allowed');
        if(run.stopRequested||this.clock()>=run.deadline||run.attempts.length>=run.plan.maxAttempts){run.status='cancelled';this.save(run);continue;}
        const remaining=new Decimal(run.plan.size).minus(run.filledSize).toFixed();
        const market=await this.desk.currentMarket(this.order(run.plan,remaining,run.plan.lowerPrice,run.attempts.length===0));this.authorized(run.plan);
        const price=await this.price(run.plan,market.priceDecimals,market.price);this.authorized(run.plan);
        if(price.lt(run.plan.lowerPrice)||price.gt(run.plan.upperPrice))throw Error('Market left the approved Chase price band; remaining orders paused');
        const order=this.order(run.plan,remaining,price.toFixed(),run.attempts.length===0),preview=await this.desk.preview(order);this.authorized(run.plan);
        if(this.closing||this.clock()>=run.deadline||this.get(run.id).stopRequested)continue;
        if(new Decimal(run.spent).plus(preview.notional).gt(run.plan.maxTotalNotional))throw Error('Chase gross submission budget exhausted; remaining orders paused');
        const remainingBudget=new Decimal(run.plan.maxTotalNotional).minus(run.spent).toFixed();
        const current:Attempt={order,phase:'submitting',submittedAt:this.clock()};run.attempts.push(current);run.spent=new Decimal(run.spent).plus(preview.notional).toFixed();this.save(run);
        const proposal=await this.desk.confirm(`chase:${run.id}:${run.attempts.length}`,'live',order,()=>{this.authorized(run.plan);if(this.closing||this.get(run.id).stopRequested)throw Error('Chase entry stopped during confirmation');},remainingBudget);
        run.spent=new Decimal(run.spent).minus(preview.notional).plus(proposal.estimatedNotional).toFixed();this.save(run);
        if(proposal.status!=='submitted'||!proposal.orderId)throw Error('Chase submission outcome is uncertain; inspect owned order before another trade');
        current.orderId=proposal.orderId;current.phase='open';this.save(run);if(run.plan.protection&&!this.protection!.get(run.id).entryId)this.protection!.bindEntry(run.id,run.id);this.authorized(run.plan);
      }catch(error){run.status='paused';run.error=error instanceof Error?error.message:'Chase execution unverified';this.save(run);}
    }}finally{this.busy=false;if(this.closing&&!this.closed){this.closed=true;this.db.close();for(const resolve of this.closeWaiters.splice(0))resolve();}}
  }
  startTimer(){if(!this.timer)this.timer=setInterval(()=>{void this.tick();},1000).unref();}
  close():Promise<void>{
    this.closing=true;if(this.timer)clearInterval(this.timer);
    if(this.closed)return Promise.resolve();
    if(!this.busy){this.closed=true;this.db.close();return Promise.resolve();}
    return new Promise<void>(resolve=>{this.closeWaiters.push(resolve);});
  }
}
