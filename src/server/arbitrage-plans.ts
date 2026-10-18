import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import Decimal from 'decimal.js';
import {z} from 'zod';
import type {ArbitrageAccount,ArbitragePlan} from '../shared/arbitrage.ts';
import type {Venue} from '../shared/types.ts';
import {TradingDesk} from './trading.ts';

const inputSchema=z.object({maxTotalInitialMargin:z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).max(40).refine(value=>new Decimal(value).gt(0)).optional(),requestId:z.string().min(1).max(128),base:z.string().regex(/^[A-Za-z0-9:_.]+$/).max(80),longVenue:z.enum(['lighter','hyperliquid']),size:z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).max(40),leverage:z.number().int().min(1).max(125),marginMode:z.enum(['cross','isolated'])}).strict();
/** Two separate venue submissions, never an atomic cross-exchange transaction. */
export class ArbitragePlans {
 private readonly db:DatabaseSync;
 private readonly preparing=new Set<string>();
 constructor(path:string,private readonly desk:TradingDesk,private readonly readAccount:(venue:Venue)=>Promise<ArbitrageAccount>,private readonly clock:()=>number=Date.now){
  this.db=new DatabaseSync(path);this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS arbitrage_plans(id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,body TEXT NOT NULL)');
  for(const row of this.db.prepare("SELECT body FROM arbitrage_plans WHERE json_extract(body,'$.status')='executing'").all()){
   const plan=JSON.parse(String(row.body)) as ArbitragePlan;plan.status='unknown';plan.message='Service restarted during paired execution. Inspect both exchanges; this plan cannot be retried.';this.save(plan);
  }
 }
 close():void{this.db.close();}
 get(id:string):ArbitragePlan{const row=this.db.prepare('SELECT body FROM arbitrage_plans WHERE id=?').get(id);if(!row)throw Error('Arbitrage plan not found');return JSON.parse(String(row.body)) as ArbitragePlan;}
 list():ArbitragePlan[]{return this.db.prepare('SELECT body FROM arbitrage_plans ORDER BY rowid DESC LIMIT 100').all().map(row=>JSON.parse(String(row.body)) as ArbitragePlan);}
 private save(plan:ArbitragePlan):void{plan.updatedAt=this.clock();this.db.prepare('UPDATE arbitrage_plans SET body=? WHERE id=?').run(JSON.stringify(plan),plan.id);}
 private checkAccount(account:ArbitrageAccount,venue:Venue):void{
  const status=this.desk.status();
  if(account.accountName!==status.accountName||account.mode!==this.desk.modeFor(venue))throw Error('Arbitrage account or mode changed');
  if(account.mode==='live'&&(!account.connectionRevision||account.connectionRevision!==this.desk.store.connectionFingerprint(account.accountName,venue)))throw Error('Arbitrage connection revision changed or is unverified');
  if(!Number.isFinite(account.observedAt)||this.clock()-account.observedAt>15000||account.observedAt>this.clock()+5000)throw Error('Arbitrage balance is stale');
  const available=new Decimal(account.availableMargin);if(!available.isFinite()||available.lt(0))throw Error('Arbitrage available margin is unavailable');
 }
 private async preflight(plan:ArbitragePlan):Promise<void>{
  if(plan.expiresAt<=this.clock())throw Error('Arbitrage review expired; prepare a new plan');
  if(this.desk.status().halted)throw Error('Execution is halted');
  const accounts=await Promise.all(plan.legs.map(leg=>this.readAccount(leg.proposal.order.venue)));
  let combined=new Decimal(0),combinedMargin=new Decimal(0);
  for(let i=0;i<2;i++){
   const leg=plan.legs[i],account=accounts[i];this.checkAccount(account,leg.proposal.order.venue);
   if(account.mode!==leg.account.mode||account.accountName!==leg.account.accountName||account.connectionRevision!==leg.account.connectionRevision)throw Error('Reviewed arbitrage account or connection changed');
   const preview=await this.desk.preview(leg.proposal.order);combined=combined.plus(preview.notional);combinedMargin=combinedMargin.plus(new Decimal(preview.notional).div(leg.proposal.order.leverage!));
   // Conservative upper notional includes the configured market protection band. Fees remain unknown.
   if(account.mode==='live'&&new Decimal(account.availableMargin).lt(new Decimal(preview.notional).div(leg.proposal.order.leverage!)))throw Error('Insufficient available margin for both arbitrage legs');
  }
  if(plan.maxTotalInitialMargin&&combinedMargin.gt(plan.maxTotalInitialMargin))throw Error('The paired entry exceeds the reviewed total margin cap');
  const status=this.desk.status();
  if(status.dailyNotionalLimit!==null){const mode=plan.legs[0].account.mode;const used=this.desk.store.used(mode,new Date(this.clock()).toISOString().slice(0,10));if(new Decimal(used).plus(combined).gt(status.dailyNotionalLimit))throw Error('Combined arbitrage legs exceed the remaining daily notional limit');}
 }
 async prepare(raw:unknown,authorize?:()=>void):Promise<ArbitragePlan>{
  authorize?.();const input=inputSchema.parse(raw);if(new Decimal(input.size).lte(0))throw Error('Arbitrage size must be positive');
  const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const existing=this.db.prepare('SELECT body FROM arbitrage_plans WHERE request_id=?').get(input.requestId);
  if(existing){const plan=JSON.parse(String(existing.body)) as ArbitragePlan;if(plan.fingerprint!==fingerprint)throw Error('Request ID already used for different arbitrage terms');return plan;}
  if(this.preparing.has(input.requestId))throw Error('Arbitrage preparation already in progress');this.preparing.add(input.requestId);
  try{
   const venues:[Venue,Venue]=[input.longVenue,input.longVenue==='lighter'?'hyperliquid':'lighter'];
   const accounts=await Promise.all(venues.map(venue=>this.readAccount(venue)));
   accounts.forEach((account,i)=>this.checkAccount(account,venues[i]));
   if(accounts[0].mode!==accounts[1].mode)throw Error('Both arbitrage venues must use the same reviewed mode');
   const orders=venues.map((venue,i)=>({venue,marketType:'perpetual' as const,symbol:input.base+'-USDC',side:i===0?'buy' as const:'sell' as const,type:'market' as const,size:input.size,leverage:input.leverage,marginMode:input.marginMode,rationale:'Reviewed two-venue paired entry; sequential execution, funding and basis can change. No guaranteed profit.'}));
   // Validate both exact catalog identities and venue precision before creating either proposal.
   await Promise.all(orders.map(order=>this.desk.preview(order)));authorize?.();
   const proposals=await Promise.all(orders.map(order=>this.desk.propose(order,'agent')));
   const plan:ArbitragePlan={...(input.maxTotalInitialMargin?{maxTotalInitialMargin:input.maxTotalInitialMargin}:{}),id:randomUUID(),fingerprint,createdAt:this.clock(),expiresAt:Math.min(...proposals.map(p=>p.expiresAt)),status:'review',legs:[{account:accounts[0],proposal:proposals[0]},{account:accounts[1],proposal:proposals[1]}],message:'Review both exact legs. Sequential execution can leave an unhedged position. Fees, slippage and funding changes can eliminate the indicative return. No automatic unwind.',updatedAt:this.clock()};
   await this.preflight(plan);authorize?.();this.db.prepare('INSERT INTO arbitrage_plans(id,request_id,body) VALUES(?,?,?)').run(plan.id,input.requestId,JSON.stringify(plan));return plan;
  }finally{this.preparing.delete(input.requestId);}
 }
 async execute(id:string,authorize?:()=>void):Promise<ArbitragePlan>{
  authorize?.();const plan=this.get(id);if(plan.status!=='review')return plan;
  // Durable transition before the first asynchronous read prevents concurrent or restarted retries.
  plan.status='executing';this.save(plan);let attempted=false;
  try{
   await this.preflight(plan);authorize?.();
   for(let i=0;i<2;i++){
    const leg=plan.legs[i];authorize?.();attempted=true;
    leg.proposal=await this.desk.approve(leg.proposal.id,leg.proposal.estimatedNotional,authorize);this.save(plan);
    if(leg.proposal.status==='unknown'){plan.status='unknown';plan.message='A leg submission outcome is uncertain. Inspect both exchanges; no retry or automatic unwind.';this.save(plan);return plan;}
    let evidence=leg.proposal.status==='paper-filled'?{status:'filled',fillSize:leg.proposal.order.size,fillPrice:leg.proposal.referencePrice}:await this.desk.orderEvidence(leg.proposal.order,leg.proposal.orderId!,leg.proposal.mode);
    // Brief bounded reconciliation, never a resubmission or a detached retry worker.
    for(let poll=0;poll<3&&evidence.status==='pending';poll++){
     await new Promise<void>(resolve=>setTimeout(resolve,750));authorize?.();
     evidence=await this.desk.orderEvidence(leg.proposal.order,leg.proposal.orderId!,leg.proposal.mode);
    }
    leg.fillEvidence={status:evidence.status==='filled'?'filled':evidence.status==='failed'?'failed':'pending',fillSize:evidence.fillSize,fillPrice:evidence.fillPrice,observedAt:this.clock()};this.save(plan);
    if(evidence.status!=='filled'||!evidence.fillSize||!evidence.fillPrice||!new Decimal(evidence.fillSize).eq(leg.proposal.order.size)||!new Decimal(evidence.fillPrice).isFinite()||new Decimal(evidence.fillPrice).lte(0)){
     plan.status='partial';plan.message=`Leg ${i+1} has no verified complete fill. Remaining submission stopped; inspect both exchanges. This plan cannot be retried and no automatic unwind occurs.`;this.save(plan);return plan;
    }
   }
   plan.status='filled';plan.message='Both entry fills verified. This does not guarantee profit or provide automatic exits.';
  }catch(error){plan.status=attempted?'unknown':'blocked';plan.message=attempted?'Paired execution stopped; a submission or fill may exist. Inspect both exchanges. No retry or automatic unwind.':error instanceof Error?error.message:'Arbitrage preflight failed';}
  this.save(plan);return plan;
 }
}
