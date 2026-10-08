import { z } from 'zod';
import type { MarketType, OrderDraft, Proposal, Venue } from '../shared/types.ts';
import { parseCredentials } from './connections.ts';
import Decimal from 'decimal.js';
import type { ExecutionClient } from './trading.ts';

export interface HummingbotConfig { url: string; username: string; password: string; accountName: string }
const connectors = { hyperliquid: 'hyperliquid_perpetual', lighter: 'lighter_perpetual' };
export class HummingbotExecution implements ExecutionClient {
  readonly configured: boolean;
  constructor(private readonly config: HummingbotConfig, private readonly request: typeof fetch = fetch) {
    const url = new URL(config.url);
    if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || !['http:','https:'].includes(url.protocol)) throw new Error('Hummingbot must be a local HTTP(S) service');
    this.configured = Boolean(config.username && config.password && config.accountName);
  }
  private async post(path: string, body: unknown, timeout=15_000, method='POST'): Promise<unknown> {
    if (!this.configured) throw new Error('Hummingbot credentials are not configured');
    const result = await this.request(new URL(path, this.config.url), {method,headers:{
      'Content-Type':'application/json',Authorization:`Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
    },body:JSON.stringify(body),signal:AbortSignal.timeout(timeout),redirect:'error'});
    if (!result.ok) throw new Error(`Hummingbot returned HTTP ${result.status}`);
    return result.json();
  }
  async connect(venue:Venue,input:unknown): Promise<void> {
    const credentials=parseCredentials(venue,input);
    try {await this.post(`/quanttrade/connections/${encodeURIComponent(this.config.accountName)}/${venue}`,credentials,220_000);}
    catch {throw new Error(`Could not verify ${venue==='lighter'?'Lighter':'Hyperliquid'} credentials. Check the wallet address, API key and its account authorization, then try again.`);}
  }
  async disconnect(venue:Venue): Promise<void> {
    await this.post(`/quanttrade/connections/${encodeURIComponent(this.config.accountName)}/${venue}`,{},220_000,'DELETE');
  }
  async balances(venue:Venue,marketType:MarketType='perpetual') {
    const connector=marketType==='spot'?venue:connectors[venue];
    const result=z.record(z.record(z.array(z.object({token:z.string().min(1),units:z.union([z.number().finite(),z.string()]),available_units:z.union([z.number().finite(),z.string()])})))).parse(await this.post('/portfolio/state',{account_names:[this.config.accountName],connector_names:[connector],skip_gateway:true,refresh:true}));
    const rows=result[this.config.accountName]?.[connector];
    if (!rows) throw new Error('Exchange account balances are unavailable');
    return rows.map(row=>{
      const total=new Decimal(row.units),available=new Decimal(row.available_units);
      if (!total.isFinite() || !available.isFinite()) throw new Error('Invalid exchange account balance');
      return {currency:row.token,total:total.toString(),available:available.toString(),frozen:Decimal.max(0,total.minus(available)).toString()};
    });
  }
  async connections(): Promise<Venue[]> {
    const names=await this.connectorNames();
    return (Object.keys(connectors) as Venue[]).filter(venue=>names.includes(connectors[venue]));
  }
  async spotConnections(): Promise<Venue[]> {
    const names=await this.connectorNames();
    return (Object.keys(connectors) as Venue[]).filter(venue=>names.includes(venue));
  }
  private async connectorNames():Promise<string[]> {
    if (!this.configured) return [];
    const response=await this.request(new URL(`/accounts/${encodeURIComponent(this.config.accountName)}/credentials`,this.config.url),{headers:{Authorization:`Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`},signal:AbortSignal.timeout(15_000),redirect:'error'});
    if (!response.ok) throw new Error(`Hummingbot returned HTTP ${response.status}`);
    return z.array(z.string()).parse(await response.json());
  }
  async place(order: OrderDraft, protectionPrice?: string, requestId?:string): Promise<string> {
    // The Hyperliquid connector names USDC-collateralized perps BASE-USD.
    const tradingPair = order.venue === 'hyperliquid' && order.marketType !== 'spot' ? order.symbol.replace(/-USDC$/, '-USD') : order.symbol;
    const connectorName=order.marketType==='spot'?order.venue:connectors[order.venue];
    if ((order.leverage!==undefined||order.trigger)&&!requestId) throw new Error('Exchange state changes require a persistent request ID');
    if (order.leverage!==undefined) {
      if (order.marketType==='spot') throw new Error('Spot orders do not support leverage');
      z.object({status:z.literal('accepted')}).parse(await this.post('/quanttrade/trading/leverage',{request_id:requestId+'-lev',account_name:this.config.accountName,connector_name:connectorName,trading_pair:tradingPair,leverage:order.leverage,margin_mode:order.marginMode??'cross'}));
    }
    if (order.type === 'market' && (!protectionPrice || !new Decimal(protectionPrice).isFinite() || new Decimal(protectionPrice).lte(0))) throw new Error('Market orders require an explicit protection price');
    if (order.trigger) {
      if (order.marketType==='spot') throw new Error('Native conditional orders are not yet verified for this spot market');
      const result=z.object({status:z.literal('accepted'),exchange_order_id:z.string().optional(),client_order_id:z.union([z.string(),z.number()]).optional()}).parse(await this.post('/quanttrade/trading/trigger-orders',{request_id:requestId,account_name:this.config.accountName,connector_name:connectorName,trading_pair:tradingPair,side:order.side,amount:order.size,trigger_price:order.trigger.triggerPrice,execution_price:order.type==='market'?protectionPrice:order.price,trigger_kind:order.trigger.triggerType,is_market:order.type==='market',reduce_only:order.reduceOnly??true}));
      if (result.exchange_order_id) return 'native:'+order.venue+':'+result.exchange_order_id;
      if (result.client_order_id!==undefined) return 'native-client:'+order.venue+':'+result.client_order_id;
      throw new Error('Trigger acknowledgment is missing its exchange identifier');
    }
    const response = await this.post(order.type === 'market' ? '/quanttrade/trading/market-orders' : '/trading/orders', {account_name:this.config.accountName,connector_name:order.marketType === 'spot' ? order.venue : connectors[order.venue],trading_pair:tradingPair,
      trade_type:order.side.toUpperCase(),order_type:order.postOnly ? 'LIMIT_MAKER' : order.type.toUpperCase(),amount:order.size,...(order.type === 'market' ? {protection_price:protectionPrice} : {price:order.price}),position_action:order.reduceOnly?'CLOSE':'OPEN'});
    return z.object({order_id:z.string().min(1).max(200)}).parse(response).order_id;
  }
  async cancel(proposal: Proposal): Promise<void> {
    if (!proposal.orderId) throw new Error('Order has no exchange ID');
    if (proposal.order.trigger) {
      const tradingPair=proposal.order.venue==='hyperliquid'?proposal.order.symbol.replace(/-USDC$/,'-USD'):proposal.order.symbol;
      const prefix='native:'+proposal.order.venue+':';
      let nativeId=proposal.orderId.startsWith(prefix)?proposal.orderId.slice(prefix.length):undefined;
      if (!nativeId&&proposal.orderId.startsWith('native-client:'+proposal.order.venue+':')) {
        const clientId=proposal.orderId.slice(('native-client:'+proposal.order.venue+':').length);
        const snapshot=z.object({open_orders:z.array(z.object({client_order_index:z.union([z.string(),z.number()]),exchange_order_id:z.union([z.string(),z.number()])}))}).parse(await this.post('/quanttrade/trading/snapshot',{account_name:this.config.accountName,connector_name:connectors[proposal.order.venue],trading_pair:tradingPair}));
        const row=snapshot.open_orders.find(item=>String(item.client_order_index)===clientId);
        if (row) nativeId=String(row.exchange_order_id);
      }
      if (!nativeId) throw new Error('Trigger must be reconciled to its native order ID before cancellation');
      z.object({status:z.literal('accepted')}).parse(await this.post('/quanttrade/trading/cancel-order',{request_id:proposal.id+'-cancel',account_name:this.config.accountName,connector_name:connectors[proposal.order.venue],trading_pair:tradingPair,exchange_order_id:nativeId}));
      return;
    }
    await this.post(`/trading/${encodeURIComponent(this.config.accountName)}/${proposal.order.marketType === 'spot' ? proposal.order.venue : connectors[proposal.order.venue]}/orders/${encodeURIComponent(proposal.orderId)}/cancel`,{});
  }
  private async allPages(path: string, filters: Record<string, unknown>): Promise<{data: Record<string, unknown>[]; pagination: {has_more: false; next_cursor: null}}> {
    const schema=z.object({data:z.array(z.record(z.unknown())),pagination:z.object({has_more:z.boolean(),next_cursor:z.string().nullable().optional()})});
    const data: Record<string, unknown>[]=[];
    const cursors=new Set<string>();
    let cursor: string | undefined;
    for (let page=0;page<100;page++) {
      const result=schema.parse(await this.post(path,{...filters,...(cursor?{cursor}:{})}));
      data.push(...result.data);
      if (!result.pagination.has_more) return {data,pagination:{has_more:false,next_cursor:null}};
      const next=result.pagination.next_cursor;
      if (!next || cursors.has(next)) throw new Error('Hummingbot pagination cursor is missing or repeating');
      cursors.add(next);cursor=next;
    }
    throw new Error('Hummingbot account snapshot exceeded the pagination limit');
  }
  async account() {
    const filters = {account_names:[this.config.accountName],connector_names:[...Object.values(connectors),'hyperliquid','lighter'],limit:100};
    const [positions,orders] = await Promise.all([this.allPages('/trading/positions',filters),this.allPages('/trading/orders/active',filters)]);
    return {positions,orders};
  }
}
