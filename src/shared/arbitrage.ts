import type { Proposal, TradingMode, Venue } from './types.ts';

export interface ArbitrageAccount {
  accountName:string; mode:TradingMode; connectionRevision:string|null;
  availableMargin:string; observedAt:number;
}
export interface ArbitragePlan {
  maxTotalInitialMargin?:string;
  id:string; fingerprint:string; createdAt:number; expiresAt:number;
  status:'review'|'executing'|'filled'|'partial'|'unknown'|'blocked';
  legs:[ArbitrageLeg,ArbitrageLeg];
  message:string; updatedAt:number;
}
export interface ArbitrageLeg {
  account:ArbitrageAccount; proposal:Proposal;
  fillEvidence?:{status:'filled'|'pending'|'failed';fillSize?:string;fillPrice?:string;observedAt:number};
}
export interface ArbitrageInput {
  maxTotalInitialMargin?:string;
  requestId:string; base:string; longVenue:Venue; size:string;
  leverage:number; marginMode:'cross'|'isolated';
}
