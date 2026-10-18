import Decimal from 'decimal.js';
import type {ArbitrageAccount} from '../shared/arbitrage.ts';
import type {Venue,TradingMode} from '../shared/types.ts';

interface Readers {
 state(venue:Venue):{accountName:string;mode:TradingMode;connectionRevision:string|null};
 connections():Promise<Venue[]>;
 balances(venue:Venue):Promise<Array<{currency:string;available:string}>>;
}
/** Verify the configured account with a fresh collateral read, without reconnecting it. */
export async function readArbitrageAccount(venue:Venue,readers:Readers,clock:()=>number=Date.now):Promise<ArbitrageAccount>{
 const initial=readers.state(venue);
 if(initial.mode==='paper')return{...initial,availableMargin:'0',observedAt:clock()};
 if(!initial.connectionRevision||!/^[a-f0-9]{64}$/.test(initial.connectionRevision))throw Error('A verified exchange connection is required for both arbitrage legs');
 if(!(await readers.connections()).includes(venue))throw Error('The arbitrage exchange account is not connected');
 const balances=await readers.balances(venue);
 const current=readers.state(venue);
 if(current.accountName!==initial.accountName||current.mode!==initial.mode||current.connectionRevision!==initial.connectionRevision)throw Error('The arbitrage account connection changed during its balance read');
 const collateral=balances.filter(row=>row.currency==='USDC'||row.currency==='USD');
 if(collateral.length!==1)throw Error('Available arbitrage collateral is unavailable or ambiguous');
 const available=new Decimal(collateral[0].available);
 if(!available.isFinite()||available.lt(0))throw Error('Available arbitrage collateral is invalid');
 return{...current,availableMargin:available.toFixed(),observedAt:clock()};
}
