/** Never infer a contract leverage limit from a venue-wide setting. */
export function validateMarketLeverage(leverage:number|undefined,max:number|null|undefined):void {
 if(leverage===undefined)return;
 if(max===null||max===undefined||!Number.isInteger(max)||max<1)throw new Error('Market leverage limit is unavailable; refresh the selected market');
 if(!Number.isInteger(leverage)||leverage<1||leverage>max)throw new Error(`Selected market maximum leverage is ${max}x`);
}
