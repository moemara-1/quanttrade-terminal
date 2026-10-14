import {validateMarketLeverage} from './market-limits.ts';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import type { HummingbotConfig } from './execution.ts';
import type { TradingDesk } from './trading.ts';
import type { QuoteSource } from './trading.ts';

const decimal=z.string().max(40).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine(value=>new Decimal(value).gt(0));
const scope={requestId:z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),venue:z.enum(['hyperliquid','lighter']),marketType:z.enum(['perpetual','spot']).default('perpetual'),symbol:z.string().min(3).max(100),mode:z.literal('live')};
export const operationSchema=z.discriminatedUnion('action',[
  z.object({...scope,action:z.literal('leverage'),leverage:z.number().int().min(1).max(125),marginMode:z.enum(['cross','isolated'])}).strict(),
  z.object({...scope,action:z.literal('margin'),amount:decimal,direction:z.enum(['add','remove'])}).strict(),
  z.object({...scope,action:z.literal('cancel'),exchangeOrderId:z.string().regex(/^[1-9]\d*$/).max(30),accountName:z.string().min(1).max(100).optional(),connectionRevision:z.string().regex(/^[a-f0-9]{64}$/).optional(),proposedAt:z.number().int().nonnegative().optional()}).strict(),
  z.object({...scope,action:z.literal('amend'),exchangeOrderId:z.string().regex(/^[1-9]\d*$/).max(30),amount:decimal,price:decimal,timeInForce:z.enum(['Gtc','Alo']).optional(),accountName:z.string().min(1).max(100).optional(),connectionRevision:z.string().regex(/^[a-f0-9]{64}$/).optional(),proposedAt:z.number().int().nonnegative().optional()}).strict(),
]).superRefine((input,context)=>{
  if(input.action!=='cancel'&&input.action!=='amend')return;
  const count=[input.accountName,input.connectionRevision,input.proposedAt].filter(value=>value!==undefined).length;
  if(count!==0&&count!==3)context.addIssue({code:'custom',message:'Reviewed cancellation requires account, connection revision and review time together'});
});
export type ExchangeOperation=z.infer<typeof operationSchema>;
export interface OperationClient {perform(action:string,payload:Record<string,unknown>):Promise<unknown>}

export class HummingbotOperations implements OperationClient {
  constructor(private readonly config:HummingbotConfig,private readonly request:typeof fetch=fetch) {
    const url=new URL(config.url);
    if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||!['http:','https:'].includes(url.protocol)) throw new Error('Hummingbot must be a local HTTP(S) service');
  }
  async perform(action:string,payload:Record<string,unknown>):Promise<unknown> {
    if (!['leverage','margin','cancel-order','amend-order','snapshot','open-orders','native-orders','hyperliquid-twap','hyperliquid-twap-cancel','hyperliquid-twap-evidence'].includes(action)) throw new Error('Unsupported exchange operation');
    const response=await this.request(new URL('/quanttrade/trading/'+(action==='native-orders'?'lighter-native-orders':action),this.config.url),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(this.config.username+':'+this.config.password).toString('base64')},body:JSON.stringify(payload),signal:AbortSignal.timeout(30_000),redirect:'error'});
    if (!response.ok) throw new Error(action==='open-orders'?`Exchange open-order read failed (HTTP ${response.status}); current orders are unavailable, not empty`:'Exchange operation failed; inspect account state before retrying');
    return response.json();
  }
}

function wireScope(input:{venue:string;marketType:string;symbol:string},accountName:string):Record<string,unknown> {
  return {account_name:accountName,connector_name:input.marketType==='spot'?input.venue:input.venue+'_perpetual',trading_pair:input.venue==='hyperliquid'&&input.marketType!=='spot'?input.symbol.replace(/-USDC$/,'-USD'):input.symbol};
}

export class VenueOperations {
  constructor(private readonly desk:TradingDesk,private readonly client:OperationClient,private readonly markets:QuoteSource) {}
  async execute(raw:unknown):Promise<{status:'accepted'|'unknown';result:unknown}> {
    const input=operationSchema.parse(raw);
    const accountName=this.desk.status().accountName;
    const revision=this.desk.store.connectionFingerprint(accountName,input.venue);
    const authorized=()=>{
      if((input.action==='cancel'||input.action==='amend')&&input.accountName!==undefined){
        if(input.accountName!==accountName)throw new Error('Reviewed operation account changed');
        if(input.connectionRevision!==revision)throw new Error('Reviewed operation connection changed');
        if(input.proposedAt===undefined||input.proposedAt>Date.now()+5000||Date.now()-input.proposedAt>180000)throw new Error('Reviewed operation expired; prepare a fresh review');
      }
      if(this.desk.status().accountName!==accountName||this.desk.store.connectionFingerprint(accountName,input.venue)!==revision)throw new Error('Exchange credentials changed during review');
      if(input.action!=='cancel'&&(this.desk.store.halted||this.desk.modeFor(input.venue)!=='live'))throw new Error('Execution is halted or the Live mode changed');
    };
    authorized();
    if (input.action!=='cancel'&&this.desk.modeFor(input.venue)!=='live') throw new Error('Exchange operations require a Live connection');
    if (input.action!=='cancel'&&this.desk.store.halted) throw new Error('Execution is halted');
    if (input.marketType==='spot'&&['leverage','margin'].includes(input.action)) throw new Error('Spot accounts do not have perpetual leverage or margin');
    if (input.action==='margin'&&new Decimal(input.amount).decimalPlaces()>6) throw new Error('Margin supports at most six decimal places');
    if (input.action==='leverage') {
      const market=(await this.markets.list(input.venue,input.marketType)).find(row=>row.symbol===input.symbol);
      if (!market||Date.now()-market.updatedAt>15000||market.updatedAt>Date.now()+5000) throw new Error('Fresh exchange market data is required for leverage');
      validateMarketLeverage(input.leverage,market.maxLeverage);
    }
    if (input.action==='amend') {
      const market=(await this.markets.list(input.venue,input.marketType)).find(row=>row.symbol===input.symbol);
      if (!market||Date.now()-market.updatedAt>15000||market.updatedAt>Date.now()+5000) throw new Error('Fresh exchange market data is required for amendment');
      const amount=new Decimal(input.amount),price=new Decimal(input.price);
      if (amount.decimalPlaces()>market.sizeDecimals||amount.lt(market.minSize)||price.decimalPlaces()>market.priceDecimals) throw new Error('Amendment violates exchange precision or minimum size');
      if (input.venue==='hyperliquid'&&!price.isInteger()&&price.precision()>5) throw new Error('Amendment price violates Hyperliquid precision');
      if (amount.mul(price).lt(market.minNotional)) throw new Error('Amendment is below exchange minimum notional');
      const notional=amount.mul(Decimal.max(market.price,price));
      authorized();
      const status=this.desk.status();
      if (status.maxOrderNotional !== null && notional.gt(status.maxOrderNotional)) throw new Error('Amended order notional exceeds configured limit');
      this.desk.store.reserveOperation(input.requestId,'live',new Date().toISOString().slice(0,10),notional.toString(),status.dailyNotionalLimit);
    }
    authorized();
    const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous=this.desk.store.claimOperation(input.requestId,fingerprint);
    if (previous) {
      if (previous.state==='completed') return {status:'accepted',result:previous.result};
      return {status:'unknown',result:{error:'This operation is in progress or uncertain. Inspect exchange state; it will not be resubmitted.'}};
    }
    const payload={...wireScope(input,this.desk.status().accountName),request_id:input.requestId,
      ...(input.action==='leverage'?{leverage:input.leverage,margin_mode:input.marginMode}:{}),
      ...(input.action==='margin'?{amount:input.amount,direction:input.direction}:{}),
      ...(['cancel','amend'].includes(input.action)?{exchange_order_id:'exchangeOrderId' in input?input.exchangeOrderId:undefined}:{}),
      ...(input.action==='amend'?{amount:input.amount,price:input.price,...(input.timeInForce?{time_in_force:input.timeInForce}:{})}:{}),
    };
    try {
      const action=input.action==='cancel'?'cancel-order':input.action==='amend'?'amend-order':input.action;
      const result=await this.client.perform(action,payload);
      authorized();
      z.object({status:z.literal('accepted')}).parse(result);
      this.desk.store.finishOperation(input.requestId,'completed',result);
      return {status:'accepted',result};
    } catch {
      const result={error:'Outcome is uncertain. Inspect the exchange before taking further action; this request will not be retried.'};
      this.desk.store.finishOperation(input.requestId,'unknown',result);
      return {status:'unknown',result};
    }
  }
  async snapshot(raw:unknown):Promise<unknown> {
    const input=z.object({venue:z.enum(['hyperliquid','lighter']),marketType:z.enum(['perpetual','spot']).default('perpetual'),symbol:z.string().min(3).max(100),historyCursor:z.string().max(500).optional(),fillsCursor:z.string().max(500).optional(),startTime:z.number().int().nonnegative().optional()}).strict().parse(raw);
    return this.client.perform('snapshot',{...wireScope(input,this.desk.status().accountName),...(input.historyCursor?{history_cursor:input.historyCursor}:{}),...(input.fillsCursor?{fills_cursor:input.fillsCursor}:{}),...(input.startTime===undefined?{}:{start_time:input.startTime})});
  }
  async openOrders(raw:unknown) {
    const input=z.object({venue:z.enum(['hyperliquid','lighter']),marketType:z.enum(['perpetual','spot']).default('perpetual')}).strict().parse(raw);
    const accountName=this.desk.status().accountName;
    const connectionRevision=this.desk.store.connectionFingerprint(accountName,input.venue);
    const authorized=()=>{
      if(!connectionRevision||!this.desk.status().executionConfigured)throw new Error('Verified exchange connection is required to read open orders');
      if(this.desk.status().accountName!==accountName||this.desk.store.connectionFingerprint(accountName,input.venue)!==connectionRevision)throw new Error('Exchange account or credentials changed during open-order read');
    };
    authorized();
    const connector=input.marketType==='spot'?input.venue:input.venue+'_perpetual';
    const result=z.object({connector_name:z.string(),scope:z.enum(['all-perpetual-markets','all-spot-markets','standard-perpetual-markets']),complete:z.boolean(),error:z.string().max(300).optional(),orders:z.array(z.object({symbol:z.string().min(3).max(100).regex(/^[A-Za-z0-9:_.]+-[A-Za-z0-9:_.]+$/),exchangeOrderId:z.string().max(30).regex(/^[1-9]\d*$/),side:z.enum(['buy','sell']).optional(),type:z.string().max(50).optional(),size:z.string().max(80).optional(),totalSize:decimal.optional(),price:z.string().max(80).optional(),reduceOnly:z.boolean().optional(),triggerPrice:z.string().max(80).optional()}).strict())}).strict().parse(await this.client.perform('open-orders',{account_name:accountName,connector_name:connector}));
    authorized();
    if(result.connector_name!==connector)throw new Error('Exchange open-order response does not match the reviewed market');
    const expectedScope=input.marketType==='spot'?'all-spot-markets':input.venue==='lighter'?'all-perpetual-markets':'standard-perpetual-markets';
    if(result.scope!==expectedScope)throw new Error('Exchange open-order response scope does not match the reviewed market');
    if(result.scope==='standard-perpetual-markets'&&result.complete)throw new Error('Hyperliquid standard scope cannot prove builder markets are empty');
    if(!result.complete&&!result.error)throw new Error('Incomplete open-order response requires an explicit explanation');
    const identities=new Set(result.orders.map(order=>order.exchangeOrderId));
    if(identities.size!==result.orders.length)throw new Error('Exchange open-order response contains duplicate identities');
    return {venue:input.venue,marketType:input.marketType,accountName,connectionRevision,scope:result.scope,complete:result.complete,...(result.error?{error:result.error}:{}),orders:result.orders};
  }
}
