import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import type { OperationClient } from './operations.ts';
import type { QuoteSource, TradingDesk } from './trading.ts';

const decimal=z.string().max(40).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const positive=decimal.refine(value=>new Decimal(value).gt(0));
const legSchema=z.object({side:z.enum(['buy','sell']),type:z.enum(['market','limit','sl-market','sl-limit','tp-market','tp-limit','twap']),amount:decimal,price:positive,triggerPrice:positive.optional(),reduceOnly:z.boolean(),timeInForce:z.enum(['ioc','gtt','post-only']),expiry:z.number().int().positive().optional(),durationSeconds:z.number().int().min(300).max(2592000).optional()}).strict();
export const lighterNativeOrderSchema=z.object({requestId:z.string().uuid(),proposedAt:z.number().int().nonnegative(),credentialId:z.string().min(1).max(200),connectionRevision:z.string().regex(/^[a-f0-9]{64}$/),accountName:z.string().min(1).max(200),accountLabel:z.string().max(200).optional(),mode:z.literal('live'),venue:z.literal('lighter'),marketType:z.literal('perpetual'),symbol:z.string().max(100).regex(/^[A-Za-z0-9:_.]+-USDC$/),grouping:z.enum(['single','oto','oco','otoco']),legs:z.array(legSchema).min(1).max(3),leverage:z.number().int().min(1).max(125).optional(),marginMode:z.enum(['cross','isolated']).optional(),positionSize:positive.optional()}).strict();
type Plan=z.infer<typeof lighterNativeOrderSchema>;
const conditional=(type:string)=>type.startsWith('sl-')||type.startsWith('tp-');
export class LighterNativeOrders {
  constructor(private readonly desk:TradingDesk,private readonly client:OperationClient,private readonly markets:QuoteSource,private readonly clock:()=>number=Date.now,private readonly balances?:()=>Promise<{currency:string;available:string}[]>){}
  private authorized(plan:Plan):void{
    const status=this.desk.status();
    if(status.halted||!status.executionConfigured||this.desk.modeFor('lighter')!=='live')throw new Error('Native orders require an enabled Live Lighter connection');
    if(status.accountName!==plan.accountName||this.desk.store.connectionFingerprint(plan.accountName,'lighter')!==plan.connectionRevision)throw new Error('Reviewed account or connection revision changed; prepare a fresh native proposal');
    if(plan.proposedAt>this.clock()+5000||this.clock()-plan.proposedAt>180000)throw new Error('Native proposal expired; prepare a fresh review');
  }
  async preview(raw:unknown){
    const reviewed=await this.validate(lighterNativeOrderSchema.parse(raw));
    const dailyLimit=this.desk.status().dailyNotionalLimit;
    if(dailyLimit!==null&&new Decimal(this.desk.store.used('live',new Date(this.clock()).toISOString().slice(0,10))).plus(reviewed.estimatedNotional).gt(dailyLimit))throw new Error('Daily notional limit exceeded');
    return reviewed;
  }
  private async validate(plan:Plan){
    this.authorized(plan);
    if(plan.legs.length!=={single:1,oto:2,oco:2,otoco:3}[plan.grouping])throw new Error('Native grouping has the wrong number of legs');
    if((plan.leverage===undefined)!==(plan.marginMode===undefined))throw new Error('Review leverage and margin mode together');
    const parent=plan.legs[0]!,children=plan.grouping==='oto'||plan.grouping==='otoco'?plan.legs.slice(1):[];
    if(children.length&&(!['market','limit'].includes(parent.type)||parent.reduceOnly||new Decimal(parent.amount).lte(0)))throw new Error('Attached exits require a positive opening market or limit parent');
    if(plan.leverage!==undefined&&(plan.grouping==='oco'||parent.reduceOnly))throw new Error('Leverage requires an opening order');
    if(children.some(leg=>!conditional(leg.type)||!leg.reduceOnly||leg.side===parent.side||!new Decimal(leg.amount).eq(0)))throw new Error('Attached exits require zero amount, opposite closing side and reduce-only');
    const siblings=plan.grouping==='oco'?plan.legs:plan.grouping==='otoco'?children:[];
    if(siblings.length){
      if(new Set(siblings.map(leg=>leg.type.split('-')[0])).size!==2||!siblings.some(leg=>leg.type.startsWith('tp-'))||!siblings.some(leg=>leg.type.startsWith('sl-'))||siblings.some(leg=>!leg.reduceOnly||leg.side!==siblings[0]!.side||!new Decimal(leg.amount).eq(siblings[0]!.amount))||new Set(siblings.map(leg=>leg.expiry??null)).size!==1)throw new Error('OCO requires matching reduce-only TP and SL siblings');
      const tp=siblings.find(leg=>leg.type.startsWith('tp-'))!,sl=siblings.find(leg=>leg.type.startsWith('sl-'))!;
      if(!tp.triggerPrice||!sl.triggerPrice||(tp.side==='sell'?new Decimal(tp.triggerPrice).lte(sl.triggerPrice):new Decimal(tp.triggerPrice).gte(sl.triggerPrice)))throw new Error('OCO trigger levels contradict the closing side');
    }
    const market=(await this.markets.list('lighter','perpetual')).find(row=>row.symbol===plan.symbol);
    if(!market||this.clock()-market.updatedAt>15000||market.updatedAt>this.clock()+5000)throw new Error('Fresh market data required for native orders');
    let existingSize:string|undefined;
    if(plan.grouping==='oco'&&plan.legs.some(leg=>new Decimal(leg.amount).eq(0))){
      if(!plan.positionSize||market.marketId===undefined)throw new Error('Zero-amount OCO requires a reviewed existing position');
      const snapshot=z.object({connector_name:z.literal('lighter_perpetual'),trading_pair:z.literal(plan.symbol),account:z.object({accounts:z.array(z.object({positions:z.array(z.object({market_id:z.number().int(),position:decimal,sign:z.number().int().refine(value=>value===1||value===-1)}).passthrough())}).passthrough()).length(1)})}).parse(await this.client.perform('snapshot',{account_name:plan.accountName,connector_name:'lighter_perpetual',trading_pair:plan.symbol}));
      const positions=snapshot.account.accounts[0]!.positions.filter(row=>row.market_id===market.marketId);
      if(positions.length!==1||!new Decimal(positions[0]!.position).eq(plan.positionSize)||new Decimal(plan.positionSize).lte(0)||plan.legs.some(leg=>leg.side===(positions[0]!.sign===1?'buy':'sell')))throw new Error('Reviewed position size or closing side changed; prepare a fresh OCO');
      existingSize=plan.positionSize;
    }
    let notional=new Decimal(0),openingNotional=new Decimal(0);
    for(const [index,leg] of plan.legs.entries()){
      const isConditional=conditional(leg.type),isMarket=['market','sl-market','tp-market','twap'].includes(leg.type);
      if(isConditional!==(leg.triggerPrice!==undefined))throw new Error('Only conditional orders require trigger prices');
      if((leg.type==='twap')!==(leg.durationSeconds!==undefined))throw new Error('Only TWAP requires duration');
      if(leg.type==='twap'&&(plan.grouping!=='single'||leg.timeInForce!=='gtt'||leg.expiry!==undefined))throw new Error('TWAP requires single GTT with duration');
      if(['market','sl-market','tp-market'].includes(leg.type)&&leg.timeInForce!=='ioc')throw new Error('Market orders require IOC');
      if(leg.timeInForce==='post-only'&&!['limit','sl-limit','tp-limit'].includes(leg.type))throw new Error('Post-only requires a limit order');
      if(leg.expiry!==undefined&&(leg.expiry-this.clock()<300000||leg.expiry-this.clock()>2592000000))throw new Error('Expiry must be five minutes to thirty days away');
      if(leg.expiry!==undefined&&(leg.type==='market'||leg.type==='limit'&&leg.timeInForce==='ioc'))throw new Error('Immediate orders cannot have expiry');
      const amount=new Decimal(leg.amount).eq(0)?(children.includes(leg)?parent.amount:existingSize):leg.amount;
      if(!amount||new Decimal(amount).lte(0))throw new Error('Zero amount requires reviewed attached or existing-position protection');
      if(new Decimal(leg.price).decimalPlaces()>market.priceDecimals)throw new Error('Native price violates market precision');
      const reference=new Decimal(leg.triggerPrice??market.price),bound=new Decimal(this.desk.status().maxPriceDeviationBps).div(10000);
      if(isMarket&&(new Decimal(leg.price).minus(reference).abs().div(reference).gt(bound)||(leg.side==='buy'?new Decimal(leg.price).lt(reference):new Decimal(leg.price).gt(reference))))throw new Error('Native execution bound exceeds the reviewed protection band');
      const order={venue:'lighter' as const,marketType:'perpetual' as const,symbol:plan.symbol,side:leg.side,type:isMarket?'market' as const:'limit' as const,size:amount,...(!isMarket?{price:leg.price}:{}),reduceOnly:leg.reduceOnly,...(index===0&&plan.leverage!==undefined?{leverage:plan.leverage,marginMode:plan.marginMode}:{}),...(isConditional?{trigger:{triggerPrice:leg.triggerPrice!,triggerType:leg.type.startsWith('tp-')?'tp' as const:'sl' as const}}:{}),rationale:'Confirmed native Lighter order'};
      const preview=await this.desk.preview(order),exposure=Decimal.max(preview.notional,new Decimal(amount).mul(leg.price));notional=notional.plus(exposure);if(!leg.reduceOnly)openingNotional=openingNotional.plus(exposure);
      if(leg.type==='twap'){
        const slice=new Decimal(amount).div(new Decimal(leg.durationSeconds!).div(30).plus(1)).toDecimalPlaces(market.sizeDecimals,Decimal.ROUND_DOWN);
        await this.desk.preview({...order,size:slice.toFixed()});
      }
    }
    if(children.length&&parent.expiry!==undefined&&children.some(leg=>leg.expiry!==parent.expiry))throw new Error('Resting parent and child expiries must match');
    if(children.length&&parent.type==='limit'&&parent.timeInForce!=='ioc'&&children.some(leg=>(leg.expiry??-1)!==(parent.expiry??-1)))throw new Error('Resting parent and child expiries must match');
    this.authorized(plan);
    let availableMargin:string|null=null;
    const initialMargin=openingNotional.eq(0)?'0':plan.leverage===undefined?null:openingNotional.div(plan.leverage).toFixed();
    if(this.balances&&openingNotional.gt(0)){
      const rows=await this.balances();this.authorized(plan);
      const collateral=rows.filter(row=>row.currency==='USDC');
      if(collateral.length!==1)throw new Error('Fresh USDC available margin is unavailable');
      const available=new Decimal(collateral[0]!.available);
      if(!available.isFinite()||available.lt(0))throw new Error('Fresh USDC available margin is invalid');
      availableMargin=available.toFixed();
      if(initialMargin!==null&&new Decimal(initialMargin).gt(available))throw new Error('Native opening order exceeds fresh available margin');
    }
    return {plan,estimatedNotional:notional.toFixed(),openingNotional:openingNotional.toFixed(),initialMargin,availableMargin,marginStatus:initialMargin!==null&&availableMargin!==null?'verified' as const:'unknown' as const};
  }
  async execute(raw:unknown):Promise<{status:'accepted'|'unknown';result:unknown}>{
    const reviewed=await this.validate(lighterNativeOrderSchema.parse(raw)),plan=reviewed.plan,notional=new Decimal(reviewed.estimatedNotional),parent=plan.legs[0]!,children=plan.grouping==='oto'||plan.grouping==='otoco'?plan.legs.slice(1):[];
    this.authorized(plan);
    const fingerprint=createHash('sha256').update(JSON.stringify(plan)).digest('hex'),previous=this.desk.store.claimOperation(plan.requestId,fingerprint);
    if(previous)return previous.state==='completed'?{status:'accepted',result:previous.result}:{status:'unknown',result:{error:'Native outcome is uncertain or in progress; inspect exchange state. This request will not be retried.'}};
    let submissionAttempted=false;
    try{
      this.desk.store.reserveOperation(plan.requestId,'live',new Date(this.clock()).toISOString().slice(0,10),notional.toFixed(),this.desk.status().dailyNotionalLimit);this.authorized(plan);
      // SDK grouping positions are semantic: parent, take-profit, stop-loss.
      const ordered=plan.grouping==='otoco'?[parent,...[...children].sort((a,b)=>Number(b.type.startsWith('tp-'))-Number(a.type.startsWith('tp-')))]:plan.grouping==='oco'?[...plan.legs].sort((a,b)=>Number(b.type.startsWith('tp-'))-Number(a.type.startsWith('tp-'))):plan.legs;
      submissionAttempted=true;
      const result=z.object({status:z.literal('accepted'),grouping:z.literal(plan.grouping),connector_name:z.literal('lighter_perpetual'),trading_pair:z.literal(plan.symbol),client_order_ids:z.array(z.string().regex(/^[1-9]\d*$/)).length(plan.legs.length),tx_hash:z.string().min(1)}).passthrough().parse(await this.client.perform('native-orders',{request_id:plan.requestId,account_name:plan.accountName,connector_name:'lighter_perpetual',trading_pair:plan.symbol,grouping:plan.grouping,...(plan.leverage!==undefined?{leverage:plan.leverage,margin_mode:plan.marginMode}:{}),legs:ordered.map(leg=>({side:leg.side,type:leg.type,amount:leg.amount,price:leg.price,reduce_only:leg.reduceOnly,time_in_force:leg.timeInForce,...(leg.triggerPrice?{trigger_price:leg.triggerPrice}:{}),...(leg.expiry===undefined?{}:{expiry:leg.expiry}),...(leg.durationSeconds===undefined?{}:{duration_seconds:leg.durationSeconds})}))}));
      if(new Set(result.client_order_ids).size!==plan.legs.length)throw new Error('Native acknowledgment has duplicate identities');
      this.desk.store.finishOperation(plan.requestId,'completed',result);return {status:'accepted',result};
    }catch(error){
      if(!submissionAttempted){this.desk.store.finishOperation(plan.requestId,'unknown',{error:'Native order was blocked before submission; prepare a fresh reviewed request.'});throw error;}
      const safeReason=error instanceof Error && /^(Native order rejected: (nonce|expiry|margin|leverage|precision|trigger|minimum-size|price|authorization|exchange-rejection)|Native order rejected by exchange adapter \(HTTP 400\))$/.test(error.message)?error.message:null;
      const result={error:(safeReason?safeReason+'. ':'')+'Native submission outcome is uncertain. Inspect exchange orders; this request will not be retried.'};
      try{this.desk.store.finishOperation(plan.requestId,'unknown',result);}catch{result.error+=' Durable status could not be updated; the original request remains claimed and must not be replayed.';}
      return {status:'unknown',result};
    }
  }
}
