import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicMarkets } from '../src/server/markets.ts';
test('Hyperliquid market mapping retains precision and normalizes percent change', async () => {
  const service = new PublicMarkets(async () => Response.json([{ universe: [{ name: 'BTC', szDecimals: 5 }] }, [{ markPx: '100', prevDayPx: '80', dayNtlVlm: '2000', funding: '0.0001', openInterest: '5' }]]));
  const markets = await service.list('hyperliquid');
  assert.equal(markets[0].symbol, 'BTC-USDC');
  assert.equal(markets[0].change24h, 25);
  assert.equal(markets[0].priceDecimals, 1);
});
test('Lighter order rows aggregate duplicate prices and preserve size decimals', async () => {
  const service = new PublicMarkets(async (url) => String(url).includes('orderBookDetails') ? Response.json({code: 200, order_book_details: [{symbol:'BTC',market_id:1,status:'active',market_type:'perp',supported_size_decimals:5,supported_price_decimals:1,min_base_amount:'0.00001',min_quote_amount:'10',mark_price:'100',daily_price_change:2,daily_quote_token_volume:1000,open_interest:20}]}) : Response.json({code:200,bids:[{price:'99',remaining_base_amount:'0.1'},{price:'99',remaining_base_amount:'0.2'}],asks:[{price:'101',remaining_base_amount:'1'}]}));
  const book = await service.book('lighter', 'BTC-USDC');
  assert.deepEqual(book.bids, [{price:'99',size:'0.3'}]);
});
test('failed public requests do not masquerade as empty markets', async () => {
  const service = new PublicMarkets(async () => new Response('rate limited', {status:429}));
  await assert.rejects(service.list('lighter'), /429/);
});
test('malformed Lighter contracts are unavailable without taking healthy contracts offline', async () => {
  const valid={symbol:'BTC',market_id:1,status:'active',market_type:'perp',supported_size_decimals:5,supported_price_decimals:1,min_base_amount:'0.00001',min_quote_amount:'10',mark_price:'100',daily_price_change:2,daily_quote_token_volume:1000,open_interest:20};
  const service=new PublicMarkets(async()=>Response.json({code:200,order_book_details:[valid,{...valid,symbol:'BAD',min_base_amount:null}]}));
  assert.deepEqual((await service.list('lighter')).map(m=>m.symbol),['BTC-USDC']);
  const broken=new PublicMarkets(async()=>Response.json({code:200,order_book_details:[{...valid,min_base_amount:null}]}));
  await assert.rejects(broken.list('lighter'),/valid contracts/i);
});
test('non-finite market values are rejected', async () => {
  const service = new PublicMarkets(async () => Response.json([{universe:[{name:'BTC',szDecimals:5}]},[{markPx:'NaN',prevDayPx:'80',dayNtlVlm:'2000',funding:'0',openInterest:'5'}]]));
  await assert.rejects(service.list('hyperliquid'));
});
test('simultaneous market readers share one upstream request', async () => {
  let calls=0;
  const service = new PublicMarkets(async () => {calls++; return Response.json([{universe:[]},[]]);});
  await Promise.all([service.list('hyperliquid'), service.list('hyperliquid')]);
  assert.equal(calls,1);
});

test('Hyperliquid spot keeps real token names and queries the exchange coin alias',async()=>{
  const requests:Record<string,unknown>[]=[];
  const service=new PublicMarkets(async(_url,init)=>{
    const body=JSON.parse(String(init?.body));requests.push(body);
    if(body.type==='spotMetaAndAssetCtxs')return Response.json([{tokens:[{name:'USDC',index:0,szDecimals:8},{name:'UBTC',index:1,szDecimals:5}],universe:[{name:'@107',index:107,tokens:[1,0]}]},[{coin:'@107',markPx:'100',prevDayPx:'80',dayNtlVlm:'2000'}]]);
    return Response.json({levels:[[{px:'99',sz:'1'}],[{px:'101',sz:'2'}]],time:Date.now()});
  });
  const markets=await service.list('hyperliquid','spot');
  assert.equal(markets[0].symbol,'UBTC-USDC');assert.equal(markets[0].quote,'USDC');assert.equal(markets[0].marketType,'spot');assert.equal(markets[0].priceDecimals,3);
  await service.book('hyperliquid','UBTC-USDC','spot');assert.equal(requests[1].coin,'@107');
});

test('Lighter spot and perpetual markets sharing a symbol keep separate order book IDs',async()=>{
  const urls:string[]=[];
  const common={status:'active',supported_size_decimals:4,supported_price_decimals:2,min_base_amount:'0.001',min_quote_amount:'10',daily_price_change:1,daily_quote_token_volume:100};
  const service=new PublicMarkets(async(url)=>{
    const value=String(url);urls.push(value);
    if(value.includes('filter=spot'))return Response.json({code:200,spot_order_book_details:[{...common,symbol:'ETH/USDC',market_id:2048,market_type:'spot',last_trade_price:100}]});
    if(value.includes('filter=perp'))return Response.json({code:200,order_book_details:[{...common,symbol:'ETH',market_id:0,market_type:'perp',mark_price:100,open_interest:10}]});
    return Response.json({code:200,bids:[],asks:[]});
  });
  await service.list('lighter','spot');await service.list('lighter');
  await service.book('lighter','ETH-USDC','spot');await service.book('lighter','ETH-USDC');
  assert.ok(urls.some(url=>url.includes('market_id=2048')));assert.ok(urls.some(url=>url.includes('market_id=0')));
});

test('Hyperliquid duplicate token names are excluded rather than routing to the wrong asset',async()=>{
  const service=new PublicMarkets(async()=>Response.json([{tokens:[{name:'USDC',index:0,szDecimals:8},{name:'DUP',index:1,szDecimals:2},{name:'DUP',index:2,szDecimals:2}],universe:[{name:'@1',index:1,tokens:[1,0]},{name:'@2',index:2,tokens:[2,0]}]},[{coin:'@1',markPx:'1',prevDayPx:'1',dayNtlVlm:'10'},{coin:'@2',markPx:'1',prevDayPx:'1',dayNtlVlm:'10'}]]));
  assert.deepEqual(await service.list('hyperliquid','spot'),[]);
});


test('each contract publishes its own leverage cap including PRL 3x, while unknown remains unknown',async()=>{
 const row={symbol:'PRL',market_id:1,status:'active',market_type:'perp',supported_size_decimals:2,supported_price_decimals:4,min_base_amount:'5',min_quote_amount:'10',mark_price:'2',daily_price_change:0,daily_quote_token_volume:10,open_interest:1};
 const lighter=new PublicMarkets(async()=>Response.json({code:200,order_book_details:[{...row,min_initial_margin_fraction:3333},{...row,symbol:'BTC',min_initial_margin_fraction:200},{...row,symbol:'UNKNOWN'}]}));
 const rows=await lighter.list('lighter');assert.equal(rows.find(r=>r.base==='PRL')?.maxLeverage,3);assert.equal(rows.find(r=>r.base==='BTC')?.maxLeverage,50);assert.equal(rows.find(r=>r.base==='UNKNOWN')?.maxLeverage,null);
 const hl=new PublicMarkets(async()=>Response.json([{universe:[{name:'BTC',szDecimals:5,maxLeverage:40},{name:'UNKNOWN',szDecimals:3}]},Array.from({length:2},()=>({markPx:'100',prevDayPx:'100',dayNtlVlm:'1',funding:'0',openInterest:'1'}))]));
 const mapped=await hl.list('hyperliquid');assert.equal(mapped.find(r=>r.base==='BTC')?.maxLeverage,40);assert.equal(mapped.find(r=>r.base==='UNKNOWN')?.maxLeverage,null);
});

test('historical candles request the selected boundary and exclude the cursor candle',async()=>{
 const requests:Record<string,unknown>[]=[];
 const end=Date.now()-86400000;
 const service=new PublicMarkets(async(_url,init)=>{
  const body=JSON.parse(String(init?.body));requests.push(body);
  if(body.type==='metaAndAssetCtxs') return Response.json([{universe:[{name:'BTC',szDecimals:5}]},[{markPx:'100',prevDayPx:'100',dayNtlVlm:'1',funding:'0',openInterest:'1'}]]);
  return Response.json([{t:end-3600000,o:100,h:101,l:99,c:100,v:1},{t:end,o:100,h:101,l:99,c:100,v:1}]);
 });
 const candles=await service.candles('hyperliquid','BTC-USDC','1h','perpetual',end,20);
 const request=requests[1].req as Record<string,unknown>;
 assert.equal(request.endTime,end);assert.equal(request.startTime,end-20*3600000);assert.equal(candles.length,1);
 await assert.rejects(service.candles('hyperliquid','BTC-USDC','1h','perpetual',end,1001),/limit/);
});

test('Lighter funding selects the native venue and converts eight-hour fraction to hourly',async()=>{
 const service=new PublicMarkets(async(url)=>String(url).includes('funding-rates')?Response.json({code:200,funding_rates:[{market_id:4097,exchange:'binance',rate:.8},{market_id:4097,exchange:'lighter',rate:.0008}]}):Response.json({code:200,order_book_details:[{symbol:'PRL',market_id:4097,status:'active',market_type:'perp',supported_size_decimals:2,supported_price_decimals:4,min_base_amount:'5',min_quote_amount:'10',mark_price:'2',daily_price_change:0,daily_quote_token_volume:10,open_interest:1,min_initial_margin_fraction:3333}]}));
 const [market]=await service.list('lighter');assert.equal(market.marketId,4097);assert.equal(market.fundingRate,.0001);
});
