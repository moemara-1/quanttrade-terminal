import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {createApp} from '../src/server/app.ts';
import {DeskStore} from '../src/server/store.ts';
import {TradingDesk} from '../src/server/trading.ts';
import {NewsService} from '../src/server/news.ts';
test('news and schedules are routed before private auth; invalid input and source failure differ',async()=>{
 const store=new DeskStore(':memory:');const markets={list:async()=>[],book:async()=>({bids:[],asks:[],updatedAt:Date.now()}),candles:async()=>[]};
 const desk=new TradingDesk(store,markets,{configured:false,place:async()=>{throw new Error('Unexpected order');},cancel:async()=>undefined},{mode:'paper',accountName:'desk',maxOrderNotional:'1000',dailyNotionalLimit:'5000',maxPriceDeviationBps:100,proposalTtlSeconds:120,pairlensUrl:'http://localhost:4317'});
 const news=new NewsService(async()=>new Response('<rss><channel><item><title>Bitcoin</title><link>https://cointelegraph.com/news/a</link><pubDate>Wed, 07 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>'),[{url:'https://cointelegraph.com/rss',name:'Cointelegraph',domain:'cointelegraph.com',kind:'crypto'}]);
 const app=createApp({desk,markets,agent:{prepare:async()=>({summary:'none',proposal:null})},operatorToken:'operator',agentToken:'agent',news,calendars:{earnings:async()=>({entries:[],start:'2026-10-07',end:'2026-10-07',fetchedAt:'now'}),ipos:async()=>{throw new Error('upstream');},economic:async()=>({entries:[],start:'2026-10-07',end:'2026-10-07',fetchedAt:'now',sources:{available:['BLS'],unavailable:[]}})}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const addr=server.address();if(!addr||typeof addr==='string')throw new Error('No address');const base=`http://127.0.0.1:${addr.port}`;
 try{
  const response=await fetch(base+'/api/news');assert.equal(response.status,200);assert.equal(response.headers.get('www-authenticate'),null);assert.equal((await response.json()).articles.length,1);
  assert.equal((await fetch(base+'/api/news?limit=999')).status,400);
  assert.equal((await fetch(base+'/api/earnings-calendar')).status,200);
  const ipo=await fetch(base+'/api/ipo-calendar');assert.equal(ipo.status,503);assert.equal((await ipo.json()).reason,'upstream_error');
  assert.equal((await fetch(base+'/api/economic-calendar')).status,200);
  assert.equal((await fetch(base+'/api/status')).status,401);
  assert.equal((await fetch(base+'/api/news',{headers:{Origin:'https://evil.example'}})).status,403);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
test('Nginx does not shadow supplied public feeds with unavailable cloud prefix',()=>{const config=readFileSync('deployment/nginx-public.conf','utf8');assert.match(config,/location ~ \^\/api\/\(news\|earnings-calendar\|ipo-calendar\|economic-calendar\|liquidations\)\$/);assert.doesNotMatch(config,/location \^~ \/api\/ \{/);});
