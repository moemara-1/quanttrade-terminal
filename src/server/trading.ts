import {validateMarketLeverage} from './market-limits.ts';
import { createHash, randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import type { DeskStatus, Market, OrderDraft, Proposal, TradingMode, Venue } from '../shared/types.ts';
import { DeskStore } from './store.ts';

const decimal = z.string().max(40).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine((value) => new Decimal(value).gt(0), 'Must be greater than zero');
export const orderSchema = z.object({
  venue: z.enum(['hyperliquid', 'lighter']), marketType: z.enum(['perpetual','spot']).optional(), symbol: z.string().regex(/^[A-Za-z0-9:_.]+-[A-Za-z0-9:_.]+$/).max(100),
  side: z.enum(['buy', 'sell']), type: z.enum(['limit', 'market']), size: decimal,
  sizeUnit:z.enum(['base','quote']).optional(),quoteBudget:decimal.optional(),
  price: decimal.optional(), reduceOnly: z.boolean().optional(), postOnly: z.boolean().optional(),
  leverage:z.number().int().min(1).max(125).optional(),marginMode:z.enum(['cross','isolated']).optional(),
  trigger:z.object({triggerPrice:decimal,triggerType:z.enum(['tp','sl'])}).strict().optional(),
  rationale: z.string().trim().min(1).max(2000),
}).strict().superRefine((order, ctx) => {
  if (order.sizeUnit==='quote' && order.marketType!=='spot') ctx.addIssue({code:z.ZodIssueCode.custom,message:'Quote-sized orders require a spot market'});
  if (order.quoteBudget && (order.marketType!=='spot'||order.side!=='buy')) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Quote budget only applies to spot buys'});
  if (order.postOnly && order.type !== 'limit') ctx.addIssue({code:z.ZodIssueCode.custom,message:'Post-only requires a limit order'});
  if (order.marketType !== 'spot' && !order.symbol.endsWith('-USDC')) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Perpetual contracts require USDC quote'});
  if (order.marketType === 'spot' && order.reduceOnly) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Spot orders cannot be reduce-only'});
  if (order.marketType === 'spot' && (order.leverage!==undefined||order.marginMode!==undefined)) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Spot orders do not support perpetual leverage or margin'});
  if (order.marketType==='spot'&&order.trigger) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Native conditional orders are not yet verified for this spot market'});
  if (order.marginMode!==undefined&&order.leverage===undefined) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Changing margin mode requires an explicit leverage'});
  if (order.leverage!==undefined&&order.marginMode===undefined) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Changing leverage requires an explicit margin mode; choose Cross or Isolated'});
  if (order.trigger&&order.postOnly) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Trigger orders cannot be post-only'});
  if (order.type === 'limit' && !order.price) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Limit price is required' });
  if (order.type === 'market' && order.price) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Market orders must not include a limit price' });
});
export interface ExecutionClient {
  configured: boolean;
  place(order: OrderDraft, protectionPrice?: string, requestId?:string): Promise<string>;
  cancel(order: Proposal): Promise<void>;
  placeBracket?(orders:[OrderDraft,OrderDraft],protectionPrices:[string|undefined,string|undefined],requestId:string):Promise<string>;
  placeEntryBracket?(orders:[OrderDraft,OrderDraft,OrderDraft],protectionPrices:[string|undefined,string|undefined,string|undefined],requestId:string):Promise<{orderId:string;entryOrderId:string;fillPrice?:string;fillSize?:string}>;
  orderEvidence?(order:OrderDraft,orderId:string):Promise<{status:'filled'|'pending'|'failed';fillPrice?:string;fillSize?:string;error?:string}>;
}
export interface DeskConfig {
  mode: TradingMode;
  accountName: string;
  maxOrderNotional: string;
  dailyNotionalLimit: string;
  maxPriceDeviationBps: number;
  proposalTtlSeconds: number;
  pairlensUrl: string;
}
export interface QuoteSource { list(venue: Venue, marketType?: OrderDraft['marketType']): Promise<Market[]> }

export class TradingDesk {
  agentConfigured = false;
  constructor(readonly store: DeskStore, private readonly markets: QuoteSource, private readonly execution: ExecutionClient,
    private readonly config: DeskConfig, private readonly clock: () => number = Date.now) {}

  private day(): string { return new Date(this.clock()).toISOString().slice(0, 10); }
  modeFor(venue:Venue):TradingMode {return this.store.venueMode(venue)??this.config.mode;}
  setVenueMode(venue:Venue,mode:TradingMode):void {this.store.setVenueMode(venue,mode);}
  private scoped(mode:TradingMode):TradingDesk {return new TradingDesk(this.store,this.markets,this.execution,{...this.config,mode},this.clock);}
  status(): DeskStatus {
    return { ...this.config,venueModes:{hyperliquid:this.modeFor('hyperliquid'),lighter:this.modeFor('lighter')}, halted: this.store.halted, executionConfigured: this.execution.configured,
      agentConfigured: this.agentConfigured, dailyNotionalUsed: this.store.used(this.config.mode, this.day()) };
  }
  setHalted(halted: boolean): DeskStatus { this.store.halted = halted; return this.status(); }

  // Only the operator endpoint calls this, after the native terminal's attended confirmation.
  async confirm(clientOrderId: string, mode: TradingMode, input: unknown): Promise<Proposal> {
    const order = orderSchema.parse(input);
    if (mode !== this.modeFor(order.venue)) throw new Error('Terminal trading mode does not match the connected exchange mode');
    if (mode !== this.config.mode) return this.scoped(mode).confirm(clientOrderId,mode,order);
    const fingerprint = createHash('sha256').update(JSON.stringify({ mode, account: this.config.accountName, order })).digest('hex');
    const existing = this.store.claimTerminal(clientOrderId, fingerprint);
    if (existing) return this.store.get(existing);
    const proposal = await this.propose(order, 'manual');
    this.store.bindTerminal(clientOrderId, proposal.id);
    return this.approve(proposal.id);
  }

  async preview(input: unknown): Promise<{order:OrderDraft;notional:string}> {
    const order=orderSchema.parse(input);
    if (order.sizeUnit==='quote') throw new Error('Workflow orders must specify the exact base amount');
    const market=await this.quote(order);
    return {order,notional:this.validate(order,market,'manual')};
  }
  async currentMarket(input:unknown):Promise<Market>{return this.quote(orderSchema.parse(input));}
  async confirmBracket(requestId:string,mode:TradingMode,raw:[OrderDraft,OrderDraft]):Promise<{status:'submitted'|'paper-open'|'unknown';estimatedNotional:string;orderId?:string;error?:string}> {
    const orders=raw.map(order=>orderSchema.parse(order)) as [OrderDraft,OrderDraft];
    if(this.store.halted||orders.some(order=>this.modeFor(order.venue)!==mode))throw new Error('Execution halted or reviewed OCO mode changed');
    if(orders.some(order=>order.venue!==orders[0].venue||order.symbol!==orders[0].symbol||order.marketType==='spot'||!order.reduceOnly||!order.trigger)||new Set(orders.map(order=>order.trigger?.triggerType)).size!==2)throw new Error('OCO requires matching reduce-only perpetual TP and SL exits');
    const quotes=await Promise.all(orders.map(order=>this.quote(order)));
    const amount=orders.reduce((sum,order,index)=>sum.plus(this.validate(order,quotes[index],'manual')),new Decimal(0)).toFixed();
    const fingerprint=createHash('sha256').update(JSON.stringify({mode,account:this.config.accountName,orders})).digest('hex');
    const previous=this.store.claimOperation(requestId,fingerprint);
    if(previous){if(previous.state==='completed')return previous.result as {status:'submitted'|'paper-open';estimatedNotional:string;orderId:string};return {status:'unknown',estimatedNotional:amount,error:'Grouped order outcome uncertain; inspect exchange before another proposal'};}
    try{
      this.store.reserveOperation(requestId,mode,this.day(),amount,this.config.dailyNotionalLimit);
      if(this.store.halted||this.modeFor(orders[0].venue)!==mode)throw new Error('Execution authorization changed');
      if(mode==='live'&&(!this.execution.configured||!this.execution.placeBracket))throw new Error('Native OCO execution is unavailable');
      const orderId=mode==='paper'?`paper-oco-${requestId}`:await this.execution.placeBracket!(orders,orders.map((order,index)=>order.type==='market'?this.marketProtection(order,quotes[index]):undefined) as [string|undefined,string|undefined],requestId);
      const result={status:mode==='paper'?'paper-open' as const:'submitted' as const,estimatedNotional:amount,orderId};
      this.store.finishOperation(requestId,'completed',result);return result;
    }catch{
      const result={status:'unknown' as const,estimatedNotional:amount,error:'Native OCO outcome uncertain; reconcile exchange orders. This request will not be retried.'};this.store.finishOperation(requestId,'unknown',result);return result;
    }
  }
  async orderEvidence(order:OrderDraft,orderId:string,mode:TradingMode):Promise<{status:'filled'|'pending'|'failed';fillPrice?:string;fillSize?:string;error?:string}> {
    if(mode==='live'){if(!this.execution.orderEvidence)throw new Error('Live fill reconciliation is unavailable');return this.execution.orderEvidence(order,orderId);}
    const market=await this.quote(order),price=new Decimal(market.price);
    const crossed=order.trigger?((order.side==='sell')===(order.trigger.triggerType==='tp')?price.gte(order.trigger.triggerPrice):price.lte(order.trigger.triggerPrice)):order.type==='market'||(order.side==='buy'?price.lte(order.price!):price.gte(order.price!));
    return crossed?{status:'filled',fillPrice:market.price,fillSize:order.size}:{status:'pending'};
  }
  async confirmEntryBracket(requestId:string,mode:TradingMode,raw:[OrderDraft,OrderDraft,OrderDraft]):Promise<{status:'submitted'|'paper-open'|'unknown';estimatedNotional:string;orderId?:string;entryOrderId?:string;fillPrice?:string;fillSize?:string;error?:string}> {
    const orders=raw.map(order=>orderSchema.parse(order)) as [OrderDraft,OrderDraft,OrderDraft];
    if(this.store.halted||orders.some(order=>this.modeFor(order.venue)!==mode))throw new Error('Execution halted or reviewed bracket mode changed');
    if(orders.some(order=>order.venue!=='hyperliquid'||order.symbol!==orders[0].symbol||order.marketType==='spot')||orders[0].reduceOnly||orders[0].trigger||orders.slice(1).some(order=>!order.reduceOnly||!order.trigger||order.side===orders[0].side||order.size!==orders[0].size)||new Set(orders.slice(1).map(order=>order.trigger?.triggerType)).size!==2)throw new Error('Native entry OCO requires one exact Hyperliquid entry and matching opposite reduce-only TP/SL exits');
    const quotes=await Promise.all(orders.map(order=>this.quote(order)));
    const amount=orders.reduce((sum,order,index)=>sum.plus(this.validate(order,quotes[index],'manual')),new Decimal(0)).toFixed();
    const fingerprint=createHash('sha256').update(JSON.stringify({mode,account:this.config.accountName,orders})).digest('hex');
    const previous=this.store.claimOperation(requestId,fingerprint);
    if(previous){if(previous.state==='completed')return previous.result as {status:'submitted'|'paper-open';estimatedNotional:string;orderId:string;entryOrderId:string};return {status:'unknown',estimatedNotional:amount,error:'Bracket outcome uncertain; inspect exchange before another proposal'};}
    try{
      this.store.reserveOperation(requestId,mode,this.day(),amount,this.config.dailyNotionalLimit);
      if(this.store.halted||this.modeFor(orders[0].venue)!==mode)throw new Error('Execution authorization changed');
      if(mode==='live'&&(!this.execution.configured||!this.execution.placeEntryBracket))throw new Error('Native entry OCO execution is unavailable');
      const native=mode==='paper'?{orderId:`paper-oco-${requestId}`,entryOrderId:`paper-entry-${requestId}`}:await this.execution.placeEntryBracket!(orders,orders.map((order,index)=>order.type==='market'?this.marketProtection(order,quotes[index]):undefined) as [string|undefined,string|undefined,string|undefined],requestId);
      const result={status:mode==='paper'?'paper-open' as const:'submitted' as const,estimatedNotional:amount,...native};this.store.finishOperation(requestId,'completed',result);return result;
    }catch{const result={status:'unknown' as const,estimatedNotional:amount,error:'Native entry bracket outcome uncertain; reconcile exchange orders. This request will not be retried.'};this.store.finishOperation(requestId,'unknown',result);return result;}
  }

  private async quote(order: OrderDraft): Promise<Market> {
    const market = (await this.markets.list(order.venue,order.marketType ?? 'perpetual')).find((item) => item.symbol === order.symbol);
    if (!market) throw new Error('Market is unavailable on the selected venue');
    if (!Number.isFinite(market.updatedAt) || this.clock() - market.updatedAt > 15_000 || market.updatedAt > this.clock() + 5000) throw new Error('Market feed is stale');
    if (!new Decimal(market.price).isFinite() || new Decimal(market.price).lte(0)) throw new Error('Invalid market price');
    return market;
  }
  private validate(order: OrderDraft, market: Market, source:'manual'|'agent'='agent'): string {

    validateMarketLeverage(order.leverage,market.maxLeverage);
    const size = new Decimal(order.size);
    if (size.decimalPlaces() > market.sizeDecimals || size.lt(market.minSize)) throw new Error('Order size violates venue precision or minimum size');
    const price = new Decimal(order.price ?? market.price);
    if (order.type === 'limit') {
      if (price.decimalPlaces() > market.priceDecimals) throw new Error('Limit price violates venue precision');
      if (order.venue === 'hyperliquid' && !price.isInteger() && price.precision() > 5) throw new Error('Hyperliquid non-integer price supports at most five significant digits');
      if (!order.trigger&&source==='agent'&&price.minus(market.price).abs().div(market.price).mul(10_000).gt(this.config.maxPriceDeviationBps)) throw new Error('Limit price is outside the configured market price band');
    }
    if (order.trigger) {
      const trigger=new Decimal(order.trigger.triggerPrice);
      if (trigger.decimalPlaces()>market.priceDecimals || (order.venue==='hyperliquid'&&!trigger.isInteger()&&trigger.precision()>5)) throw new Error('Trigger price violates exchange precision');
      if (order.type==='limit'&&price.minus(trigger).abs().div(trigger).mul(10_000).gt(this.config.maxPriceDeviationBps)) throw new Error('Trigger limit execution price is outside its configured protection band');
    }
    // Use the higher of mark and limit to conservatively bound order size, including sells.
    const reference=order.trigger?.triggerPrice??market.price;
    const upperPrice = order.type === 'market' ? Decimal.max(market.price,new Decimal(reference).mul(new Decimal(1).plus(new Decimal(this.config.maxPriceDeviationBps).div(10_000)))) : Decimal.max(price, market.price);
    const notional = size.mul(upperPrice);
    if (order.quoteBudget && size.mul(order.type==='market' ? this.marketProtection(order,market) : price).gt(order.quoteBudget)) throw new Error('Market moved beyond the approved quote budget; prepare a new order');
    if (size.mul(price).lt(market.minNotional)) throw new Error('Order is below venue minimum notional');
    if (notional.gt(this.config.maxOrderNotional)) throw new Error('Order notional exceeds the configured limit');
    return notional.toFixed();
  }
  private marketProtection(order: OrderDraft, market: Market): string {
    const buy = order.side === 'buy';
    const rounding = buy ? Decimal.ROUND_DOWN : Decimal.ROUND_UP;
    const multiplier = new Decimal(1).plus(new Decimal(this.config.maxPriceDeviationBps).div(10_000).mul(buy ? 1 : -1));
    let price = new Decimal(order.trigger?.triggerPrice??market.price).mul(multiplier).toDecimalPlaces(market.priceDecimals, rounding);
    if (order.venue === 'hyperliquid' && !price.isInteger()) price = price.toSignificantDigits(5, rounding);
    if (price.lte(0)) throw new Error('Market protection price must be positive');
    return price.toFixed();
  }
  async propose(input: unknown, source: 'manual' | 'agent'): Promise<Proposal> {
    let order = orderSchema.parse(input);
    const mode=this.modeFor(order.venue);
    if (mode!==this.config.mode) return this.scoped(mode).propose(order,source);
    const market = await this.quote(order);
    if(order.sizeUnit==='quote') {
      const quoteAmount=order.size;
      const conversionPrice=order.type==='limit' ? order.price : order.side==='buy' ? this.marketProtection(order,market) : market.price;
      if(!conversionPrice) throw new Error('Quote-sized limit orders require a price');
      order={...order,size:new Decimal(quoteAmount).div(conversionPrice).toDecimalPlaces(market.sizeDecimals,Decimal.ROUND_DOWN).toFixed(),sizeUnit:'base',...(order.side==='buy'?{quoteBudget:quoteAmount}:{})};
    }
    const estimatedNotional = this.validate(order, market, source);
    const createdAt = this.clock();
    const proposal: Proposal = { id: randomUUID(), accountName: this.config.accountName, source, mode: this.config.mode, order,
      referencePrice: market.price, estimatedNotional, createdAt, expiresAt: createdAt + this.config.proposalTtlSeconds * 1000, status: 'pending' };
    this.store.save(proposal, 'proposal-created');
    return proposal;
  }
  async approve(id: string): Promise<Proposal> {
    if (this.store.halted) throw new Error('Execution is halted');
    const original = this.store.get(id);
    const mode=this.modeFor(original.order.venue);
    if (mode!==this.config.mode) return this.scoped(mode).approve(id);
    if (original.status !== 'pending') throw new Error('Only pending proposals can be approved');
    if (original.mode !== this.config.mode) throw new Error('Proposal trading mode no longer matches this session');
    if (original.accountName !== this.config.accountName) throw new Error('Proposal execution account no longer matches this session');
    if (original.expiresAt <= this.clock()) {
      original.status = 'expired'; this.store.save(original, 'proposal-expired'); throw new Error('Proposal expired; prepare a new one');
    }
    if (original.mode === 'live' && !this.execution.configured) throw new Error('Hummingbot execution is not configured');
    const market = await this.quote(original.order);
    const notional = this.validate(original.order, market, original.source);
    if (new Decimal(market.price).minus(original.referencePrice).abs().div(original.referencePrice).mul(10_000).gt(this.config.maxPriceDeviationBps)) throw new Error('Market price moved beyond the approval tolerance; prepare a new proposal');
    if (original.expiresAt <= this.clock()) throw new Error('Proposal expired while checking market data');
    const proposal = this.store.reserve(id, this.config.mode, this.day(), notional, this.config.dailyNotionalLimit);
    if (proposal.mode === 'paper') {
      proposal.status = proposal.order.type === 'market' && !proposal.order.trigger ? 'paper-filled' : 'paper-open';
      proposal.orderId = `paper-${id}`;
      this.store.save(proposal, proposal.status);
      return proposal;
    }
    try {
      proposal.orderId = await this.execution.place(proposal.order, proposal.order.type === 'market' ? this.marketProtection(proposal.order, market) : undefined,proposal.id);
      proposal.status = 'submitted';
      this.store.save(proposal, 'exchange-submitted');
    } catch {
      // A request may have reached the exchange even if its response did not reach us.
      proposal.status = 'unknown';
      proposal.error = 'Submission outcome is uncertain. Inspect Hummingbot and the exchange. This proposal cannot be retried.';
      this.store.save(proposal, 'exchange-outcome-unknown');
    }
    return proposal;
  }
  reject(id: string): Proposal {
    const proposal = this.store.get(id);
    if (proposal.status !== 'pending') throw new Error('Only pending proposals can be rejected');
    proposal.status = 'rejected'; this.store.save(proposal, 'proposal-rejected'); return proposal;
  }
  async cancel(id: string): Promise<Proposal> {
    const proposal = this.store.get(id);
    if (proposal.mode === 'paper' && proposal.status === 'paper-open') {
      proposal.status = 'cancelled'; this.store.save(proposal, 'paper-cancelled'); return proposal;
    }
    if (proposal.accountName !== this.config.accountName || proposal.status !== 'submitted' || !proposal.orderId) throw new Error('Only submitted orders from the current account can be cancelled');
    proposal.status = 'cancel-requested'; this.store.save(proposal, 'cancellation-requested');
    try { await this.execution.cancel(proposal); }
    catch { proposal.error = 'Cancellation outcome is uncertain. Inspect the exchange before assuming this order is cancelled.'; this.store.save(proposal, 'cancellation-uncertain'); }
    // Hummingbot acknowledges the request, not the completed cancellation.
    return proposal;
  }
}
