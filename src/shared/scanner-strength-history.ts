import type { Venue } from './types.ts';
export type ScannerStrengthWindow='1d'|'7d'|'30d';
export interface ScannerStrengthHistoryInput {venue:Venue;symbols:string[];window:ScannerStrengthWindow}
export interface ScannerStrengthSeries {
 venue:Venue;symbol:string;base:string;status:'ok'|'partial'|'error';
 points:{time:number;changePct:number;relativeStrengthPp:number|null}[];message:string|null;
}
export interface ScannerStrengthHistorySnapshot {
 asOf:number;window:ScannerStrengthWindow;windowStart:number;windowEnd:number;benchmarkSymbol:string|null;series:ScannerStrengthSeries[];
}
