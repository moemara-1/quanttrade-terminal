import test from 'node:test';
import assert from 'node:assert/strict';
import { HummingbotExecution } from '../src/server/execution.ts';
import type { Market } from '../src/shared/types.ts';
const market:Market={venue:'hyperliquid',symbol:'para:PAPER-USDC',base:'para:PAPER',quote:'USDC',marketType:'perpetual',dex:'para',coin:'para:PAPER',assetId:180038,collateralToken:0,onlyIsolated:true,marginModes:['isolated'],maxLeverage:3,price:'1',change24h:0,volume24h:'1',fundingRate:0,openInterest:'1',sizeDecimals:0,priceDecimals:5,minSize:'1',minNotional:'10',updatedAt:Date.now()};
const config={url:'http://localhost:8000',username:'u',password:'p',accountName:'desk'};
test('builder readiness verifies exact metadata and connector pair case without any write',async()=>{
 let calls=0;
 const c=new HummingbotExecution(config,async(url,init)=>{calls++;assert.equal(new URL(String(url)).pathname,'/quanttrade/trading/builder-market-readiness');const b=JSON.parse(String(init?.body));assert.equal(b.trading_pair,'PARA:PAPER-USD');assert.equal(b.coin,'para:PAPER');assert.equal(b.asset_id,180038);return Response.json({...b,ready:true});});
 await c.validateBuilderMarket(market,'desk','a'.repeat(64));assert.equal(calls,1);
 await assert.rejects(c.validateBuilderMarket(market,'other','a'.repeat(64)),/account/);
 await assert.rejects(c.validateBuilderMarket(market,'desk',null),/connection/);
 await assert.rejects(c.validateBuilderMarket({...market,collateralToken:1},'desk','a'.repeat(64)),/USDC/);assert.equal(calls,1);
});
test('builder readiness refuses a stale response or wrong asset identity',async()=>{
 for(const change of [{asset_id:38},{coin:'PAPER'},{connection_revision:'b'.repeat(64)},{max_leverage:5}]){
 const c=new HummingbotExecution(config,async(_url,init)=>Response.json({...JSON.parse(String(init?.body)),ready:true,...change}));
 await assert.rejects(c.validateBuilderMarket(market,'desk','a'.repeat(64)),/metadata|identity/);
 }
});
test('builder order payload uses connector uppercase pair while canonical market remains unchanged',async()=>{
 const c=new HummingbotExecution(config,async(_url,init)=>{assert.equal(JSON.parse(String(init?.body)).trading_pair,'PARA:PAPER-USD');return Response.json({order_id:'test-only'});});
 await c.place({venue:'hyperliquid',symbol:'para:PAPER-USDC',side:'buy',type:'limit',price:'1',size:'10',rationale:'fixture'});
 assert.equal(market.symbol,'para:PAPER-USDC');
});

test('builder collateral read is exact DEX-scoped and never falls back to core portfolio',async()=>{
 let calls=0;
 const c=new HummingbotExecution(config,async(url,init)=>{calls++;assert.equal(new URL(String(url)).pathname,'/quanttrade/trading/builder-available-collateral');const b=JSON.parse(String(init?.body));assert.deepEqual(b,{account_name:'desk',trading_pair:'PARA:PAPER-USD'});return Response.json({...b,verified:true,coin:'para:PAPER',dex:'para',collateral_token:0,currency:'USDC',available:'150',account_mode:'disabled',scope:'dex'});});
 assert.deepEqual(await c.hyperliquidAvailableCollateral('para:PAPER-USDC'),[{currency:'USDC',available:'150'}]);assert.equal(calls,1);
});
test('unverified builder collateral and mismatched metadata cannot become zero or core funds',async()=>{
 for(const changes of [{scope:'shared-usdc'},{available:'NaN'},{coin:'xyz:PAPER'},{trading_pair:'PAPER-USD'},{account_mode:'unifiedAccount'}]){
 const c=new HummingbotExecution(config,async(_url,init)=>Response.json({...JSON.parse(String(init?.body)),verified:true,coin:'para:PAPER',dex:'para',collateral_token:0,currency:'USDC',available:'150',account_mode:'disabled',scope:'dex',...changes}));
 await assert.rejects(c.hyperliquidAvailableCollateral('para:PAPER-USDC'),/unverified/);
 }
 let calls=0;const c=new HummingbotExecution(config,async()=>{calls++;return new Response('',{status:400});});
 await assert.rejects(c.hyperliquidAvailableCollateral('para:PAPER-USDC'),/unverified/);assert.equal(calls,1);
});
