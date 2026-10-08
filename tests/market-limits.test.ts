import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateMarketLeverage} from '../src/server/market-limits.ts';
test('leverage validation matrix never uses another contract limit and unknown fails closed',()=>{
 for(const cap of [1,3,10,20,40,50,100,125]){
  for(const value of [1,2,3,5,10,20,40,50,100,125]){
   if(value<=cap)assert.doesNotThrow(()=>validateMarketLeverage(value,cap));else assert.throws(()=>validateMarketLeverage(value,cap),/maximum/);
  }
 }
 for(const cap of [null,undefined,0,NaN])assert.throws(()=>validateMarketLeverage(3,cap),/unavailable/);
 assert.doesNotThrow(()=>validateMarketLeverage(undefined,null));
});
