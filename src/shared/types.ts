export type MarketType = 'perpetual' | 'spot';
export type Venue = 'hyperliquid' | 'lighter';
export type TradingMode = 'paper' | 'live';
export type OrderSide = 'buy' | 'sell';
export interface Market {
  dex?: string;
  coin?: string;
  assetId?: number;
  collateralToken?: number;
  onlyIsolated?: boolean;
  marginModes?: ('cross'|'isolated')[];
  marketId?: number;
  maxLeverage?: number | null;
  marketType?: MarketType;
  quote?: string;
  venue: Venue;
  symbol: string;
  base: string;
  price: string;
  change24h: number;
  volume24h: string;
  fundingRate: number | null;
  openInterest: string | null;
  sizeDecimals: number;
  priceDecimals: number;
  minSize: string;
  minNotional: string;
  updatedAt: number;
}
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface BookLevel { price: string; size: string }
export interface OrderBook { bids: BookLevel[]; asks: BookLevel[]; updatedAt: number }
export interface OrderDraft {
  marketType?: MarketType;
  venue: Venue;
  symbol: string;
  side: OrderSide;
  type: 'limit' | 'market';
  size: string;
  sizeUnit?: 'base'|'quote';
  quoteBudget?: string;
  price?: string;
  reduceOnly?: boolean;
  postOnly?: boolean;
  leverage?: number;
  marginMode?: 'cross'|'isolated';
  trigger?: {triggerPrice:string;triggerType:'tp'|'sl'};
  rationale: string;
}
export type ProposalStatus = 'pending' | 'rejected' | 'expired' | 'submitting' | 'submitted' | 'unknown' | 'paper-filled' | 'paper-open' | 'cancel-requested' | 'cancelled';
export interface Proposal {
  id: string;
  accountName: string;
  connectionRevision?: string | null;
  source: 'manual' | 'agent';
  mode: TradingMode;
  order: OrderDraft;
  referencePrice: string;
  estimatedNotional: string;
  createdAt: number;
  expiresAt: number;
  status: ProposalStatus;
  orderId?: string;
  error?: string;
}
export interface AuditEvent { id: number; timestamp: number; action: string; proposalId: string | null; detail: string }
export interface DeskStatus {
  nativeTwapRiskAllowed?: boolean;
  mode: TradingMode;
  venueModes?:Record<Venue,TradingMode>;
  halted: boolean;
  executionConfigured: boolean;
  agentConfigured: boolean;
  maxOrderNotional: string | null;
  dailyNotionalLimit: string | null;
  dailyNotionalUsed: string;
  maxPriceDeviationBps: number;
  proposalTtlSeconds: number;
  accountName: string;
  pairlensUrl: string;
}
export interface AgentResult { summary: string; proposal: Proposal | null }
