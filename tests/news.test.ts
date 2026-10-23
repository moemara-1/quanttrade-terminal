import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NewsService,parseNewsRss} from '../src/server/news.ts';
const source={url:'https://www.coindesk.com/arc/outboundfeeds/rss/',name:'CoinDesk',domain:'coindesk.com',kind:'crypto' as const};
const xml='<rss><channel><item><title><![CDATA[Bitcoin &amp; Ethereum rally]]></title><link>https://www.coindesk.com/story</link><pubDate>Wed, 07 Oct 2026 12:00:00 GMT</pubDate><description>full copyrighted body</description></item><item><title>unsafe</title><link>javascript:alert(1)</link><pubDate>Wed, 07 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>';
test('RSS maps safe headlines, source, UTC and ticker metadata without copying article body',()=>{const items=parseNewsRss(xml,source);assert.equal(items.length,1);assert.equal(items[0].title,'Bitcoin & Ethereum rally');assert.equal(items[0].timePublished,'2026-10-07T12:00:00.000Z');assert.equal(items[0].summary,'');assert.equal(items[0].tickerSentiment[0].ticker,'CRYPTO:BTC');});
test('XML entities and oversized documents are rejected',()=>{assert.throws(()=>parseNewsRss('<!DOCTYPE rss [<!ENTITY a "bad">]><rss/>',source));assert.throws(()=>parseNewsRss('x'.repeat(2_000_001),source));});

test('Celestia aliases and bare crypto ticker requests resolve the same attributed headlines',async()=>{
 const payload=headline('Celestia expands data availability network','coindesk.com');
 const service=new NewsService(async()=>new Response(payload),[source]);
 for(const tickers of ['TIA','CRYPTO:TIA','TIA-USDC-USDC','TIA/USDC','Celestia',' celestia ']){
  const result=await service.get({tickers});
  assert.equal(result.articles.length,1,tickers);
  assert(result.articles[0].tickerSentiment.some(t=>t.ticker==='CRYPTO:TIA'));
 }
 const bitcoin=new NewsService(async()=>new Response(xml),[source]);
 assert.equal((await bitcoin.get({tickers:'BTC'})).articles.length,1);
 assert.equal((await bitcoin.get({tickers:'Bitcoin'})).articles.length,1);
 assert(!parseNewsRss(headline('TIAA publishes its retirement outlook','coindesk.com'),source)[0].tickerSentiment.some(t=>t.ticker==='CRYPTO:TIA'));
});

test('zero matches report the bounded non-exhaustive headline feed coverage',async()=>{
 const failed={...source,name:'Unavailable fixture',url:'https://unavailable.example/rss'};
 const service=new NewsService(async url=>String(url).includes('unavailable')?new Response('',{status:503}):new Response(xml),[source,failed]);
 const result=await service.get({tickers:'TIA'});
 assert.equal(result.articles.length,0);
 assert.equal(result.coverage.exhaustive,false);
 assert.equal(result.coverage.scope,'configured-rss-headlines');
 assert.equal(result.coverage.totalMatchedArticles,0);
 assert.equal(result.coverage.sources.filter(s=>s.status==='unavailable').length,1);
 assert.match(result.coverage.warning,/not.*absence|does not.*absence/i);
});

test('available market-publisher crypto headlines survive a crypto-source outage',async()=>{
 const service=new NewsService(async url=>String(url).includes('coindesk')?new Response('',{status:503}):new Response(headline('Celestia draws institutional attention')),[source,markets]);
 const result=await service.get({tickers:'TIA'});
 assert.equal(result.articles.length,1);
 assert.equal(result.articles[0].source,'MarketWatch');
 assert.equal(result.coverage.exhaustive,false);
});
test('coalesces requests, sorts and filters tickers/time then honors page limit',async()=>{let calls=0;const service=new NewsService(async()=>{calls++;return new Response(xml);},[source]);const [a,b]=await Promise.all([service.get({tickers:'CRYPTO:BTC',limit:'1'}),service.get({})]);assert.equal(calls,1);assert.equal(a.articles.length,1);assert.equal(b.articles.length,1);assert.equal((await service.get({tickers:'AAPL'})).articles.length,0);assert.equal((await service.get({time_to:'20261007T1100'})).articles.length,0);assert.equal(calls,1);await assert.rejects(service.get({limit:'999'}));});
test('partial source failure preserves real headlines; total failure remains unavailable',async()=>{const service=new NewsService(async(url)=>String(url).includes('coindesk')?new Response(xml):new Response('',{status:503}),[source,{...source,url:'https://example.org/rss'}]);assert.equal((await service.get({})).articles.length,1);await assert.rejects(new NewsService(async()=>new Response('',{status:503}),[source]).get({}));});

const markets={url:'https://feeds.marketwatch.com/marketwatch/topstories/',name:'MarketWatch',domain:'marketwatch.com',kind:'markets' as const};
function headline(title:string,domain='marketwatch.com'){return `<rss><channel><item><title><![CDATA[${title}]]></title><link>https://${domain}/story</link><pubDate>Wed, 07 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>`;}
test('decodes hexadecimal, decimal, named and double-escaped headline entities as text',()=>{
 const [item]=parseNewsRss(headline('Apple&#x2019;s &amp;#8217; results &ldquo;beat&rdquo; &#128200;'),markets);
 assert.equal(item.title,'Apple’s ’ results “beat” 📈');
 assert.doesNotThrow(()=>parseNewsRss(headline('Invalid &#x110000; &#xD800;'),markets));
});
test('tags genuine non-tech equities and escapes dotted tickers without common-word false matches',()=>{
 const [item]=parseNewsRss(headline('PepsiCo, JPMorgan, Coca-Cola, Berkshire Hathaway and Eli Lilly report earnings'),markets);
 for(const symbol of ['PEP','JPM','KO','BRK.B','LLY'])assert(item.tickerSentiment.some(t=>t.ticker===symbol),symbol);
 const [generic]=parseNewsRss(headline('A strategy for a cat shop and a new visa'),markets);
 for(const symbol of ['MSTR','CAT','SHOP','V'])assert(!generic.tickerSentiment.some(t=>t.ticker===symbol),symbol);
 assert(parseNewsRss(headline('BRK.B and $V rise'),markets)[0].tickerSentiment.some(t=>t.ticker==='BRK.B'));
 assert(!parseNewsRss(headline('BRKxB rises'),markets)[0].tickerSentiment.some(t=>t.ticker==='BRK.B'));
});
test('equities wire keeps untagged market-wide news and excludes crypto-native Tesla stories',async()=>{
 const service=new NewsService(async url=>new Response(String(url).includes('coindesk')?headline('Tokenized Tesla rises','coindesk.com'):headline('Wall Street stocks rise as Treasury yields fall')),[source,markets]);
 const feed=await service.get({topics:'financial_markets'});
 assert.equal(feed.articles.length,1);assert.equal(feed.articles[0].source,'MarketWatch');
 assert.equal(feed.articles[0].tickerSentiment.length,0);
});
test('combined topic filters require every requested topic, not crypto profit headlines',async()=>{
 const service=new NewsService(async url=>new Response(String(url).includes('coindesk')?headline('Tesla token revenue soars','coindesk.com'):headline('PepsiCo quarterly earnings rise')),[source,markets]);
 const feed=await service.get({topics:'financial_markets,earnings'});
 assert.equal(feed.articles.length,1);assert.equal(feed.articles[0].source,'MarketWatch');
 assert.equal((await service.get({topics:'financial_markets,economy_macro'})).articles.length,0);
});
test('a surviving crypto feed cannot disguise complete equities feed failure as an empty wire',async()=>{
 const service=new NewsService(async url=>String(url).includes('coindesk')?new Response(xml):new Response('',{status:503}),[source,markets]);
 assert.equal((await service.get({tickers:'CRYPTO:BTC,CRYPTO:ETH'})).articles.length,1);
 await assert.rejects(service.get({topics:'financial_markets'}),/unavailable/i);
});
test('deduplicated publisher stories retain earnings classification from either feed',async()=>{
 const service=new NewsService(async()=>new Response(headline('PepsiCo outlook improves')),[{...markets,earnings:true},markets]);
 const result=await service.get({topics:'financial_markets,earnings'});
 assert.equal(result.articles.length,1);
});

test('DASH project products resolve as crypto without tagging DoorDash or ordinary dash phrases',async()=>{
 for(const title of ['Dash Platform 5.0 release schedule announced','DashPay wallet adds payment feature','Dash-to-Anything product update','DASH price rallies on crypto wallet adoption']){
  const service=new NewsService(async()=>new Response(headline(title,'coindesk.com')),[source]);
  for(const tickers of ['DASH','CRYPTO:DASH','DASH-USDC-USDC','Dash cryptocurrency','DashPay']){
   const result=await service.get({tickers});assert.equal(result.articles.length,1,`${title} / ${tickers}`);
   assert(result.articles[0].tickerSentiment.some(t=>t.ticker==='CRYPTO:DASH'));
   assert(!result.articles[0].tickerSentiment.some(t=>t.ticker==='DASH'));
  }
 }
 for(const title of ['DoorDash shares rise after earnings','NASDAQ:DASH stock upgrade','A dash of optimism returns to crypto markets','A DASH for cash lifts markets']){
  const item=parseNewsRss(headline(title),markets)[0];assert(!item.tickerSentiment.some(t=>t.ticker==='CRYPTO:DASH'),title);
 }
});

test('explicit stock:DASH and DoorDash requests remain equity news rather than Dash cryptocurrency',async()=>{
 const service=new NewsService(async()=>new Response(headline('DoorDash shares rise after earnings')),[markets]);
 for(const tickers of ['STOCK:DASH','STOCKS:DASH','DoorDash']){
  const result=await service.get({tickers});assert.equal(result.articles.length,1,tickers);assert.deepEqual(result.coverage.normalizedTickers,['DASH']);
 }
 assert.equal((await service.get({tickers:'CRYPTO:DASH'})).articles.length,0);
});

test('unsupported ticker matching and retained headline lookback remain explicit for zero matches',async()=>{
 const service=new NewsService(async()=>new Response(xml),[source]);
 const missing=await service.get({tickers:'CRYPTO:UNSUPPORTED',time_from:'20261001T0000',time_to:'20261008T0000'});
 assert.deepEqual(missing.coverage.unsupportedTickers,['CRYPTO:UNSUPPORTED']);
 assert.equal(missing.coverage.matchingStatus,'unsupported');
 assert.equal(missing.coverage.archiveSearched,false);assert.equal(missing.coverage.articleBodiesSearched,false);
 assert.equal(missing.coverage.requestedFrom,'2026-10-01T00:00:00.000Z');assert.equal(missing.coverage.requestedTo,'2026-10-08T00:00:59.999Z');
 assert.equal(missing.coverage.oldestPublishedAt,'2026-10-07T12:00:00.000Z');
 const dash=await service.get({tickers:'DASH'});assert.equal(dash.coverage.matchingStatus,'supported');assert.equal(dash.articles.length,0);assert.equal(dash.coverage.exhaustive,false);
});
