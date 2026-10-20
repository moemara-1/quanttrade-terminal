import type { Venue } from './types.ts';

export interface ScannerSource {
  complete?: boolean;
  failedDexs?: string[];
  id: string;
  status: 'ok' | 'error';
  observedAt: number | null;
  count: number;
  message: string | null;
}
export interface ScannerMarket {
  quote?: string;
  dex?: string;
  venue: Venue;
  symbol: string;
  base: string;
  price: number;
  change24h: number;
  volume24h: number;
  fundingHourly: number | null;
  openInterestBase: number | null;
  openInterestUsd: number | null;
  relativeStrength24h: number | null;
  oiToVolume: number | null;
  observedAt: number;
}
export interface ScannerComparison {
  base: string;
  hyperliquid: ScannerMarket;
  lighter: ScannerMarket;
  fundingGapHourly: number | null;
  longVenue: Venue | null;
  shortVenue: Venue | null;
  markGapPct: number;
  lowerMarkVenue: Venue | null;
  higherMarkVenue: Venue | null;
}
export interface OptionBlockTrade {
  id: string;
  blockId: string;
  instrument: string;
  currency: 'BTC' | 'ETH';
  timestamp: number;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  premiumUsd: number | null;
  indexPrice: number | null;
  iv: number | null;
  optionType: 'call' | 'put';
  strike: number;
  expiry: string;
  legCount: number | null;
}
export interface OptionOverview {
  currency: 'BTC' | 'ETH';
  observedAt: number;
  contracts: number;
  callOpenInterest: number;
  putOpenInterest: number;
  callVolume24h: number;
  putVolume24h: number;
  putCallVolumeRatio: number | null;
}
export interface OptionTapeCoverage {
  currency: 'BTC' | 'ETH';
  sampledTrades: number;
  hasMore: boolean;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
}
export interface OptionsSnapshot {
  sources: ScannerSource[];
  trades: OptionBlockTrade[];
  overview: OptionOverview[];
  coverage: OptionTapeCoverage[];
}
export interface ScannerSnapshot {
  asOf: number;
  refreshAfterMs: number;
  sources: ScannerSource[];
  markets: ScannerMarket[];
  comparisons: ScannerComparison[];
  options: OptionsSnapshot;
}
