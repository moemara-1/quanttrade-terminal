import type { Venue } from './types.ts';

/** All timestamps are milliseconds; all funding rates are signed fractions, not percentages. */
export interface ScannerFundingPoint { time:number; rate:number }
export interface ScannerPricePoint { time:number; close:number; changePct:number; btcChangePct:number|null; relativeStrengthPp:number|null }
export interface ScannerVenueDetail {
 venue:Venue; symbol:string; currentFundingHourly:number|null; projected24hFunding:number|null;
 funding:{status:'ok'|'partial'|'error';samples:ScannerFundingPoint[];sampleCount:number;expectedSamples:number;observedSum:number|null;actual24h:number|null;message:string|null};
 price:{status:'ok'|'partial'|'error';points:ScannerPricePoint[];message:string|null};
}
export interface ScannerDetailSnapshot {
 asOf:number; base:string; windowStart:number; windowEnd:number; refreshAfterMs:number; venues:ScannerVenueDetail[];
}
