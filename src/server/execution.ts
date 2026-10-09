import { z } from 'zod';
import { createHash } from 'node:crypto';
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
      if (!order.marginMode) throw new Error('Changing leverage requires an explicit margin mode; choose Cross or Isolated');
      z.object({status:z.literal('accepted')}).parse(await this.post('/quanttrade/trading/leverage',{request_id:requestId+'-lev',account_name:this.config.accountName,connector_name:connectorName,trading_pair:tradingPair,leverage:order.leverage,margin_mode:order.marginMode}));
    }
    if (order.type === 'market' && (!protectionPrice || !new Decimal(protectionPrice).isFinite() || new Decimal(protectionPrice).lte(0))) throw new Error('Market orders require an explicit protection price');
    if (order.trigger) {
      if (order.marketType==='spot') throw new Error('Native conditional orders are not yet verified for this spot market');
      const result=z.object({status:z.literal('accepted'),exchange_order_id:z.string().optional(),client_order_id:z.union([z.string(),z.number()]).optional()}).parse(await this.post('/quanttrade/trading/trigger-orders',{request_id:requestId,account_name:this.config.accountName,connector_name:connectorName,trading_pair:tradingPair,side:order.side,amount:order.size,trigger_price:order.trigger.triggerPrice,execution_price:order.type==='market'?protectionPrice:order.price,trigger_kind:order.trigger.triggerType,is_market:order.type==='market',reduce_only:order.reduceOnly??true}));
      if (result.exchange_order_id) return 'native:'+order.venue+':'+result.exchange_order_id;
      if (result.client_order_id!==undefined) return 'native-client:'+order.venue+':'+result.client_order_id;
      throw new Error('Trigger acknowledgment is missing its exchange identifier');
    }
    const response = await this.post(order.type === 'market' ? '/quanttrade/trading/market-orders' : '/quanttrade/trading/orders', {account_name:this.config.accountName,connector_name:order.marketType === 'spot' ? order.venue : connectors[order.venue],trading_pair:tradingPair,
      trade_type:order.side.toUpperCase(),order_type:order.postOnly ? 'LIMIT_MAKER' : order.type.toUpperCase(),amount:order.size,...(order.type === 'market' ? {protection_price:protectionPrice} : {price:order.price}),position_action:order.reduceOnly?'CLOSE':'OPEN'},35_000);
    return z.object({order_id:z.string().min(1).max(200)}).parse(response).order_id;
  }
  async placeBracket(orders: [OrderDraft,OrderDraft], protectionPrices: [string|undefined,string|undefined], requestId: string): Promise<string> {
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) throw new Error('OCO requires a persistent request ID');
    const first=orders[0];
    if (first.venue==='hyperliquid') throw new Error('Hyperliquid native OCO requires entry-attached TP/SL in a normalTpsl bracket');
    if (orders.some(order=>order.marketType==='spot'||order.venue!==first.venue||order.symbol!==first.symbol||order.side!==first.side||order.size!==first.size||order.reduceOnly!==true||!order.trigger||order.leverage!==undefined||order.marginMode!==undefined||order.postOnly||order.sizeUnit==='quote')) throw new Error('OCO exits require the same perpetual instrument, side and exact base size; both must be reduce-only');
    if (new Set(orders.map(order=>order.trigger?.triggerType)).size!==2) throw new Error('OCO requires one take-profit and one stop-loss');
    const legs=orders.map((order,index)=>{
      const price=order.type==='market'?protectionPrices[index]:order.price;
      if (!price||!new Decimal(price).isFinite()||new Decimal(price).lte(0)||!new Decimal(order.size).isFinite()||new Decimal(order.size).lte(0)||!order.trigger||!new Decimal(order.trigger.triggerPrice).isFinite()||new Decimal(order.trigger.triggerPrice).lte(0)) throw new Error('OCO requires positive exact sizes, thresholds and execution bounds');
      return {kind:order.trigger.triggerType,trigger_price:order.trigger.triggerPrice,execution_price:price,is_market:order.type==='market'};
    });
    const tp=legs.find(leg=>leg.kind==='tp')!,sl=legs.find(leg=>leg.kind==='sl')!;
    if (first.side==='sell'?new Decimal(tp.trigger_price).lte(sl.trigger_price):new Decimal(tp.trigger_price).gte(sl.trigger_price)) throw new Error('OCO thresholds contradict position side');
    const result=z.object({status:z.literal('accepted'),grouping:z.literal('oco'),client_order_ids:z.array(z.string().regex(/^\d+$/)).length(2),tx_hash:z.string().min(1)}).parse(await this.post('/quanttrade/trading/bracket-orders',{request_id:requestId,account_name:this.config.accountName,connector_name:connectors[first.venue],trading_pair:first.symbol,side:first.side,amount:first.size,take_profit:{trigger_price:tp.trigger_price,execution_price:tp.execution_price,is_market:tp.is_market},stop_loss:{trigger_price:sl.trigger_price,execution_price:sl.execution_price,is_market:sl.is_market}},35_000));
    const ids=result.client_order_ids;
    if (new Set(ids).size!==2) throw new Error('OCO acknowledgment is missing distinct native identities; inspect exchange state');
    return 'native-oco:'+first.venue+':'+ids.join(',');
  }
  async placeEntryBracket(orders:[OrderDraft,OrderDraft,OrderDraft],protectionPrices:[string|undefined,string|undefined,string|undefined],requestId:string):Promise<{orderId:string;entryOrderId:string;fillPrice?:string;fillSize?:string}> {
    const [entry,...exits]=orders;
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) throw new Error('Entry bracket requires a persistent request ID');
    if (entry.venue!=='hyperliquid'||entry.marketType==='spot'||entry.reduceOnly||entry.trigger||entry.sizeUnit==='quote'||exits.some(exit=>exit.venue!==entry.venue||exit.symbol!==entry.symbol||exit.marketType==='spot'||exit.size!==entry.size||exit.side===entry.side||exit.reduceOnly!==true||!exit.trigger||exit.leverage!==undefined||exit.marginMode!==undefined||exit.postOnly||exit.sizeUnit==='quote')) throw new Error('Entry bracket requires one Hyperliquid perpetual entry and two same-sized opposite reduce-only exits');
    if ((entry.leverage===undefined)!==(entry.marginMode===undefined)) throw new Error('Entry bracket leverage requires an explicit margin mode');
    if (new Set(exits.map(exit=>exit.trigger?.triggerType)).size!==2) throw new Error('Entry bracket requires one TP and one SL');
    const prices=orders.map((order,index)=>order.type==='market'?protectionPrices[index]:order.price);
    if (prices.some(price=>!price||!new Decimal(price).isFinite()||new Decimal(price).lte(0))||!new Decimal(entry.size).isFinite()||new Decimal(entry.size).lte(0)) throw new Error('Entry bracket requires exact positive size and protection prices');
    const legs=exits.map((exit,index)=>({kind:exit.trigger!.triggerType,trigger_price:exit.trigger!.triggerPrice,execution_price:prices[index+1]!,is_market:exit.type==='market'}));
    const tp=legs.find(leg=>leg.kind==='tp')!,sl=legs.find(leg=>leg.kind==='sl')!;
    const reference=new Decimal(prices[0]!);
    if (![tp.trigger_price,sl.trigger_price].every(price=>new Decimal(price).isFinite()&&new Decimal(price).gt(0))||!(entry.side==='buy'?new Decimal(sl.trigger_price).lt(reference)&&reference.lt(tp.trigger_price):new Decimal(tp.trigger_price).lt(reference)&&reference.lt(sl.trigger_price))) throw new Error('Entry bracket thresholds must protect the reviewed entry side');
    const result=z.object({status:z.literal('accepted'),grouping:z.literal('normalTpsl'),order_ids:z.array(z.string().regex(/^(?:\d+|0x[0-9a-f]{32})$/)).length(3),client_order_ids:z.array(z.string().regex(/^0x[0-9a-f]{32}$/)).length(3),entry_order_id:z.string().regex(/^\d+$/),fill_price:z.string().optional(),fill_size:z.string().optional()}).parse(await this.post('/quanttrade/trading/entry-bracket-orders',{request_id:requestId,account_name:this.config.accountName,connector_name:'hyperliquid_perpetual',trading_pair:entry.symbol.replace(/-USDC$/,'-USD'),side:entry.side,amount:entry.size,entry_price:prices[0],entry_tif:entry.type==='market'?'Ioc':entry.postOnly?'Alo':'Gtc',...(entry.leverage!==undefined?{leverage:entry.leverage,margin_mode:entry.marginMode}:{}),take_profit:{trigger_price:tp.trigger_price,execution_price:tp.execution_price,is_market:tp.is_market},stop_loss:{trigger_price:sl.trigger_price,execution_price:sl.execution_price,is_market:sl.is_market}},35_000));
    if (new Set(result.order_ids).size!==3||new Set(result.client_order_ids).size!==3||result.order_ids[0]!==result.entry_order_id||(result.fill_price===undefined)!==(result.fill_size===undefined)) throw new Error('Entry bracket acknowledgment is incomplete; inspect exchange state');
    if (result.fill_price!==undefined&&result.fill_size!==undefined&&(!new Decimal(result.fill_price).isFinite()||new Decimal(result.fill_price).lte(0)||!new Decimal(result.fill_size).isFinite()||new Decimal(result.fill_size).lte(0)||new Decimal(result.fill_size).gt(entry.size))) throw new Error('Entry bracket fill acknowledgment is invalid; inspect exchange state');
    return {orderId:'native-entry-oco:hyperliquid:'+result.order_ids.join(','),entryOrderId:'native:hyperliquid:'+result.entry_order_id,...(result.fill_price?{fillPrice:result.fill_price,fillSize:result.fill_size}:{})};
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
  async orderEvidence(order:OrderDraft,orderId:string):Promise<{status:'filled'|'pending'|'failed';fillPrice?:string;fillSize?:string;error?:string}> {
    const connector=order.marketType==='spot'?order.venue:connectors[order.venue];
    const pair=order.venue==='hyperliquid'&&order.marketType!=='spot'?order.symbol.replace(/-USDC$/,'-USD'):order.symbol;
    if(orderId.startsWith('native:hyperliquid:')){
      if(order.venue!=='hyperliquid'||order.marketType==='spot')throw new Error('Native bracket evidence does not match the reviewed venue');
      const id=z.string().regex(/^[1-9]\d*$/).parse(orderId.slice('native:hyperliquid:'.length));
      return z.object({status:z.enum(['filled','pending','failed']),fillPrice:z.string().optional(),fillSize:z.string().optional(),error:z.string().optional()}).parse(await this.post('/quanttrade/trading/order-evidence',{request_id:createHash('sha256').update(orderId).digest('hex'),account_name:this.config.accountName,connector_name:connector,trading_pair:pair,exchange_order_id:id}));
    }
    const history=await this.allPages('/trading/orders/search',{account_names:[this.config.accountName],connector_names:[connector],trading_pairs:[pair],limit:100});
    const row=history.data.find(item=>item.order_id===orderId&&item.account_name===this.config.accountName&&item.connector_name===connector&&item.trading_pair===pair);
    if(!row)return {status:'pending'};
    const status=String(row.status).toUpperCase();
    if(['FAILED','CANCELED','CANCELLED'].includes(status))return {status:'failed',error:`Reviewed order is ${status.toLowerCase()}; dependent workflow steps stopped`};
    if(status!=='FILLED')return {status:'pending'};
    const size=new Decimal(String(row.filled_amount??'0')),price=new Decimal(String(row.average_fill_price??'0'));
    if(!size.isFinite()||!size.gt(0)||!price.isFinite()||!price.gt(0))throw new Error('Confirmed fill amount or price is unavailable; dependents remain blocked');
    return {status:'filled',fillSize:size.toFixed(),fillPrice:price.toFixed()};
  }
}
