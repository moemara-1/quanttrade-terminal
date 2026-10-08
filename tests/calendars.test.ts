import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketCalendars, parseAgencyCalendar } from '../src/server/calendars.ts';
const now=()=>new Date('2026-10-07T15:00:00Z');
test('earnings maps source facts, filters symbols and coalesces identical requests',async()=>{
 let calls=0; const service=new MarketCalendars(async()=>{calls++;return Response.json({status:{rCode:200},data:{rows:[{symbol:'LEVI',name:'Levi',time:'time-after-hours',epsForecast:'($0.25)',fiscalQuarterEnding:'Aug/2026'},{symbol:'RGP',name:'RGP',time:'unknown',epsForecast:'N/A'}]}});},now);
 const [a,b]=await Promise.all([service.earnings({days:'1',symbols:'LEVI'}),service.earnings({days:'1',symbols:'LEVI'})]);
 assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a.entries[0]?.epsEstimate,-0.25);assert.equal(a.entries[0]?.reportTime,'amc');assert.equal(a.entries[0]?.fiscalDateEnding,null);
 const all=await service.earnings({days:1});assert.equal(calls,1);assert.equal(all.entries[1]?.reportTime,undefined);assert.equal(all.entries[1]?.epsEstimate,null);
});
test('IPO uses only upcoming dated entries and interprets explicit price range',async()=>{
 const service=new MarketCalendars(async()=>Response.json({status:{rCode:200},data:{upcoming:{upcomingTable:{rows:[{proposedTickerSymbol:'TRXB',companyName:'TRex',expectedPriceDate:'10/09/2026',proposedSharePrice:'14.00-16.00',proposedExchange:'NASDAQ'},{proposedTickerSymbol:'BAD',companyName:'No date',expectedPriceDate:'TBD'}]}},priced:{rows:[{proposedTickerSymbol:'OLD',pricedDate:'10/09/2026'}]}}}),now);
 const result=await service.ipos({days:7});assert.equal(result.entries.length,1);assert.equal(result.entries[0]?.priceRangeHigh,16);assert.equal(result.entries[0]?.date,'2026-10-09');
});
test('agency ICS supports folded strings, UTC and Eastern DST without fabricating clocks',()=>{
 const text='BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;TZID=US-Eastern:20261008T083000\r\nSUMMARY:Consumer Price Index\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE-TIME:20261106T133000Z\r\nSUMMARY:Personal Income and Out\r\n lays\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261009\r\nSUMMARY:Day release\r\nEND:VEVENT\r\nEND:VCALENDAR';
 const rows=parseAgencyCalendar(text,'BLS');assert.equal(rows[0]?.releaseMs,Date.parse('2026-10-08T12:30:00Z'));assert.equal(rows[1]?.date,'2026-11-06');assert.equal(rows[1]?.title,'Personal Income and Outlays');assert.equal(rows[2]?.releaseMs,null);assert.equal(rows[0]?.importance,'high');
});
test('macro filters inclusive date window and retains a functioning official source',async()=>{
 const service=new MarketCalendars(async(url)=>String(url).includes('bea.gov')?new Response('unavailable',{status:503}):new Response('BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;TZID=US-Eastern:20261008T083000\nSUMMARY:Consumer Price Index\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261109\nSUMMARY:Future release\nEND:VEVENT\nEND:VCALENDAR'),now);
 const result=await service.economic({days:7});assert.equal(result.entries.length,1);assert.equal(result.start,'2026-10-07');assert.equal(result.end,'2026-10-13');assert.deepEqual(result.sources?.unavailable,['BEA']);
});
test('invalid input is rejected before requests, and total upstream failure is not an empty calendar',async()=>{
 let calls=0;const service=new MarketCalendars(async()=>{calls++;return new Response('failure',{status:503});},now);
 for(const q of [{days:'99'},{start:'2026-02-30'},{symbols:'AAPL,https://invalid'},{days:'1',url:'https://invalid'}])await assert.rejects(()=>service.earnings(q));assert.equal(calls,0);
 await assert.rejects(()=>service.economic({days:7}),/unavailable/);await assert.rejects(()=>service.earnings({days:1}),/HTTP/);
});
test('successful HTTP responses with Nasdaq error status or malformed rows fail truthfully',async()=>{
 for(const body of [{status:{rCode:400},data:{rows:[]}},{status:{rCode:200},data:null},{status:{rCode:200},data:{rows:'broken'}}])await assert.rejects(()=>new MarketCalendars(async()=>Response.json(body),now).earnings({days:1}));
});

test('calendar streams are bounded and empty Nasdaq days are legitimate',async()=>{
 let cancelled=false;const bytes=new Uint8Array(2_100_000);const oversized=new Response(new ReadableStream({start(controller){controller.enqueue(bytes);},cancel(){cancelled=true;}}));
 await assert.rejects(()=>new MarketCalendars(async()=>oversized,now).earnings({days:1}),/too large/);assert.equal(cancelled,true);
 const empty=await new MarketCalendars(async()=>Response.json({status:{rCode:200},data:{rows:null}}),now).earnings({days:1});assert.deepEqual(empty.entries,[]);
});
