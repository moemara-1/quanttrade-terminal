import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import type { OperationClient } from './operations.ts';
import type { QuoteSource, TradingDesk } from './trading.ts';

const positive=z.string().max(40).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine(value=>new Decimal(value).gt(0));
const scope={requestId:z.string().uuid(),proposedAt:z.number().int().nonnegative(),credentialId:z.string().min(1).max(200),connectionRevision:z.string().regex(/^[a-f0-9]{64}$/),accountName:z.string().min(1).max(200),mode:z.literal('live'),venue:z.literal('hyperliquid'),marketType:z.literal('perpetual'),symbol:z.string().max(100).regex(/^[A-Za-z0-9:_.]+-USDC$/)};
export const hyperliquidNativeTwapSchema=z.discriminatedUnion('action',[
 z.object({...scope,action:z.literal('create'),side:z.enum(['buy','sell']),size:positive,durationMinutes:z.number().int().min(5).max(10080),randomize:z.boolean(),reduceOnly:z.boolean(),acceptNativeRisk:z.literal(true),referenceNotionalBudget:positive,leverage:z.number().int().min(1).max(125).optional(),marginMode:z.enum(['cross','isolated']).optional()}).strict(),
 z.object({...scope,action:z.literal('cancel'),twapId:z.string().regex(/^[1-9]\d*$/).refine(value=>Number.isSafeInteger(Number(value)))}).strict(),
]);
type Plan=z.infer<typeof hyperliquidNativeTwapSchema>;

/** Native slices are venue-managed; this admission estimate is not a future price cap. */
export class HyperliquidNativeTwap {
 constructor(private readonly desk:TradingDesk,private readonly client:OperationClient,private readonly markets:QuoteSource,private readonly clock:()=>number=Date.now){}
 async evidence(raw:unknown):Promise<unknown>{
  const request=z.object({accountName:scope.accountName,connectionRevision:scope.connectionRevision,requestId:z.string().uuid().optional(),symbol:scope.symbol,twapId:z.string().regex(/^[1-9]\d*$/).refine(v=>Number.isSafeInteger(Number(v))),side:z.enum(['buy','sell']),size:positive}).strict().parse(raw);
  const authorized=()=>{
   if(this.desk.status().accountName!==request.accountName||this.desk.modeFor('hyperliquid')!=='live'||this.desk.store.connectionFingerprint(request.accountName,'hyperliquid')!==request.connectionRevision)throw new Error('Reviewed account or connection changed; native TWAP evidence is unavailable for this account');
  };
  authorized();
  if(request.requestId){
   const operation=this.desk.store.operation(request.requestId);
   const receipt=z.object({status:z.literal('accepted'),twap_id:z.literal(request.twapId),reviewedPlan:z.object({requestId:z.literal(request.requestId),action:z.literal('create'),accountName:z.literal(request.accountName),connectionRevision:z.literal(request.connectionRevision),symbol:z.literal(request.symbol),side:z.literal(request.side),size:positive})}).safeParse(operation?.result);
   if(operation?.state!=='completed'||!receipt.success||!new Decimal(receipt.data.reviewedPlan.size).eq(request.size))throw new Error('Native TWAP evidence does not match an owned accepted request');
  }
  const result=await this.client.perform('hyperliquid-twap-evidence',{request_id:createHash('sha256').update(JSON.stringify(request)).digest('hex'),account_name:request.accountName,connector_name:'hyperliquid_perpetual',trading_pair:request.symbol.replace(/-USDC$/,'-USD'),twap_id:request.twapId,side:request.side,amount:request.size});
  authorized();return result;
 }
 private authorize(plan:Plan):void{
  const status=this.desk.status();
  if(!status.executionConfigured||this.desk.modeFor('hyperliquid')!=='live'||plan.action==='create'&&status.halted)throw new Error('Native TWAP requires an enabled Live Hyperliquid connection');
  if(plan.action==='create'&&!status.nativeTwapRiskAllowed&&status.maxPriceDeviationBps<300)throw new Error('Native TWAP fixed 3% risk permission is required');
  if(status.accountName!==plan.accountName||this.desk.store.connectionFingerprint(plan.accountName,'hyperliquid')!==plan.connectionRevision)throw new Error('Reviewed account or connection revision changed; prepare a fresh proposal');
  if(plan.proposedAt>this.clock()+5000||this.clock()-plan.proposedAt>180000)throw new Error('Native TWAP proposal expired');
 }
 async execute(raw:unknown):Promise<{status:'accepted'|'unknown';result:unknown}>{
  const plan=hyperliquidNativeTwapSchema.parse(raw);this.authorize(plan);
  let notional=new Decimal(0);
  if(plan.action==='create'){
   if((plan.leverage===undefined)!==(plan.marginMode===undefined)||plan.reduceOnly&&plan.leverage!==undefined)throw new Error('Review opening leverage and margin mode together');
   const market=(await this.markets.list('hyperliquid','perpetual')).find(row=>row.symbol===plan.symbol);
   if(!market||this.clock()-market.updatedAt>15000||market.updatedAt>this.clock()+5000)throw new Error('Fresh market data required for native TWAP');
   const size=new Decimal(plan.size);
   if(size.decimalPlaces()>market.sizeDecimals||size.lt(market.minSize))throw new Error('Native TWAP amount violates market precision or minimum size');
   const order={venue:'hyperliquid' as const,marketType:'perpetual' as const,symbol:plan.symbol,side:plan.side,type:'market' as const,size:plan.size,reduceOnly:plan.reduceOnly,...(plan.leverage!==undefined?{leverage:plan.leverage,marginMode:plan.marginMode}:{}),rationale:'Reviewed native TWAP; fixed 3% slice slippage and no absolute future notional cap'};
   const preview=await this.desk.preview(order);
   const ordinaryMultiplier=new Decimal(1).plus(new Decimal(this.desk.status().maxPriceDeviationBps).div(10000));
   const latestReferenceNotional=new Decimal(preview.notional).div(ordinaryMultiplier);
   if(latestReferenceNotional.lt(100))throw new Error('Native Hyperliquid TWAP requires at least 100 USDC reference notional');
   notional=latestReferenceNotional.mul(Decimal.max('1.03',ordinaryMultiplier));
   if(notional.gt(plan.referenceNotionalBudget)||notional.gt(this.desk.status().maxOrderNotional))throw new Error('Native TWAP reference admission estimate exceeds reviewed or configured notional limit');
  }
  this.authorize(plan);
  const fingerprint=createHash('sha256').update(JSON.stringify(plan)).digest('hex'),previous=this.desk.store.claimOperation(plan.requestId,fingerprint);
  if(previous)return previous.state==='completed'?{status:'accepted',result:previous.result}:{status:'unknown',result:{error:'Native TWAP outcome is uncertain or in progress; inspect exchange state. This request will not be retried.'}};
  let attempted=false;
  try{
   if(plan.action==='create')this.desk.store.reserveOperation(plan.requestId,'live',new Date(this.clock()).toISOString().slice(0,10),notional.toFixed(),this.desk.status().dailyNotionalLimit);
   this.authorize(plan);attempted=true;
   const result=z.object({status:z.literal('accepted'),connector_name:z.literal('hyperliquid_perpetual'),trading_pair:z.literal(plan.symbol.replace(/-USDC$/,'-USD')),twap_id:z.string().regex(/^[1-9]\d*$/)}).passthrough().parse(await this.client.perform(plan.action==='create'?'hyperliquid-twap':'hyperliquid-twap-cancel',{request_id:plan.requestId,account_name:plan.accountName,connector_name:'hyperliquid_perpetual',trading_pair:plan.symbol.replace(/-USDC$/,'-USD'),...(plan.action==='create'?{side:plan.side,amount:plan.size,duration_minutes:plan.durationMinutes,randomize:plan.randomize,reduce_only:plan.reduceOnly,...(plan.leverage!==undefined?{leverage:plan.leverage,margin_mode:plan.marginMode}:{})}:{twap_id:plan.twapId})}));
   if(plan.action==='cancel'&&result.twap_id!==plan.twapId)throw new Error('TWAP cancellation acknowledgment identity mismatch');
   const receipt=plan.action==='create'?{...result,reviewedPlan:plan}:result;
   this.desk.store.finishOperation(plan.requestId,'completed',receipt);return {status:'accepted',result:receipt};
  }catch(error){
   const result={error:attempted?'Native TWAP submission outcome is uncertain. Inspect exchange state; this request will not be retried.':'Native TWAP blocked before submission; prepare a fresh proposal.'};
   try{this.desk.store.finishOperation(plan.requestId,'unknown',result);}catch{result.error+=' Durable status could not be updated; the request remains claimed.';}
   if(!attempted)throw error;
   return {status:'unknown',result};
  }
 }
}
