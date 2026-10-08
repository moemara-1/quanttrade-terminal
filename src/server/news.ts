import {XMLParser} from 'fast-xml-parser';
import {z} from 'zod';
export interface NewsSource {url:string;name:string;domain:string;kind:'crypto'|'markets'}
const sources:NewsSource[]=[
 {url:'https://www.coindesk.com/arc/outboundfeeds/rss',name:'CoinDesk',domain:'coindesk.com',kind:'crypto'},
 {url:'https://cointelegraph.com/rss',name:'Cointelegraph',domain:'cointelegraph.com',kind:'crypto'},
 {url:'https://feeds.content.dowjones.io/public/rss/mw_topstories',name:'MarketWatch',domain:'marketwatch.com',kind:'markets'}
];
const object=z.record(z.unknown());
const aliases:Record<string,string[]>={BTC:['bitcoin','btc'],ETH:['ethereum','ether','eth'],SOL:['solana','sol'],HYPE:['hyperliquid','hype'],DOGE:['dogecoin','doge'],XRP:['ripple','xrp'],BNB:['binance','bnb'],AAPL:['apple','aapl'],NVDA:['nvidia','nvda'],MSFT:['microsoft','msft'],TSLA:['tesla','tsla'],AMZN:['amazon','amzn'],GOOGL:['alphabet','google','googl']};
export function parseNewsRss(xml:string,source:NewsSource){
 if(Buffer.byteLength(xml)>2_000_000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Unsafe or oversized news XML');
 const parsed:unknown=new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:true}).parse(xml);
 const root=object.parse(parsed);const channel=object.parse(object.parse(root.rss).channel);
 const rows=Array.isArray(channel.item)?channel.item:channel.item?[channel.item]:[];
 return rows.slice(0,200).flatMap((raw:unknown)=>{
  const row=object.parse(raw);const title=typeof row.title==='string'?row.title.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim().slice(0,500):'';
  if(!title||typeof row.link!=='string'||typeof row.pubDate!=='string')return [];
  let url:URL;try{url=new URL(row.link);}catch{return [];}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!(url.hostname===source.domain||url.hostname.endsWith('.'+source.domain)))return [];
  const date=Date.parse(row.pubDate);if(!Number.isFinite(date)||date>Date.now()+300_000)return [];
  const mentions=Object.entries(aliases).filter(([,words])=>words.some(word=>new RegExp('\\b'+word+'\\b','i').test(title)));
  const topics=[{topic:source.kind==='crypto'?'blockchain':'financial_markets',relevanceScore:1}];
  if(/inflation|federal reserve|interest rate|employment|payroll|gdp|central bank|economy|recession/i.test(title))topics.push({topic:'economy_macro',relevanceScore:1});
  if(/earnings|quarterly results|profit|revenue|ipo/i.test(title))topics.push({topic:'earnings',relevanceScore:1});
  return [{title,url:url.href,timePublished:new Date(date).toISOString(),authors:[],summary:'',bannerImage:null,source:source.name,sourceDomain:source.domain,topics,overallSentimentScore:0,overallSentimentLabel:'Neutral',tickerSentiment:mentions.map(([symbol])=>({ticker:['AAPL','NVDA','MSFT','TSLA','AMZN','GOOGL'].includes(symbol)?symbol:'CRYPTO:'+symbol,relevanceScore:1,sentimentScore:0,sentimentLabel:'Neutral'}))}];
 });
}
type Article=ReturnType<typeof parseNewsRss>[number];
const query=z.object({tickers:z.string().max(2000).optional(),topics:z.string().max(500).optional(),sort:z.enum(['LATEST','EARLIEST','RELEVANCE']).default('LATEST'),limit:z.coerce.number().int().min(1).max(200).default(50),time_from:z.string().regex(/^\d{8}T\d{4}$/).optional(),time_to:z.string().regex(/^\d{8}T\d{4}$/).optional()}).strict();
function time(value:string){const date=Date.parse(value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8)+'T'+value.slice(9,11)+':'+value.slice(11,13)+':00Z');if(!Number.isFinite(date))throw new Error('Invalid news time');return date;}
export class NewsService {
 private cache:{articles:Article[];fetchedAt:string;expires:number}|undefined;
 private pending:Promise<void>|undefined;
 constructor(private request:typeof fetch=fetch,private feeds:NewsSource[]=sources){}
 private async load(){
  if(this.cache&&this.cache.expires>Date.now())return;
  if(this.pending)return this.pending;
  this.pending=(async()=>{
   const results=await Promise.allSettled(this.feeds.map(async source=>{
    const response=await this.request(source.url,{signal:AbortSignal.timeout(12_000),headers:{'User-Agent':'CoinTrade/1.0 (public RSS reader)','Accept':'application/rss+xml, application/xml, text/xml'},redirect:'error'});
    if(!response.ok||!response.body)throw new Error('News upstream unavailable');
    const reader=response.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
    try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2_000_000)throw new Error('News feed too large');chunks.push(part.value);}}finally{await reader.cancel();}
    return parseNewsRss(Buffer.concat(chunks).toString('utf8'),source);
   }));
   const articles=results.flatMap(result=>result.status==='fulfilled'?result.value:[]);
   if(!articles.length)throw new Error('News feeds unavailable');
   this.cache={articles:[...new Map(articles.map(a=>[a.url,a])).values()].sort((a,b)=>b.timePublished.localeCompare(a.timePublished)),fetchedAt:new Date().toISOString(),expires:Date.now()+120_000};
  })();
  try{await this.pending;}finally{this.pending=undefined;}
 }
 async get(raw:unknown){
  const p=query.parse(raw);await this.load();if(!this.cache)throw new Error('News unavailable');
  let articles=this.cache.articles;
  if(p.tickers){const tokens=p.tickers.split(',');const cryptoWire=tokens.includes('CRYPTO:BTC')&&tokens.includes('CRYPTO:ETH');articles=articles.filter(a=>cryptoWire?a.topics.some(t=>t.topic==='blockchain'):a.tickerSentiment.some(t=>tokens.includes(t.ticker)));}
  if(p.topics){const topics=p.topics.split(',');articles=articles.filter(a=>a.topics.some(t=>topics.includes(t.topic)));}
  if(p.time_from){const min=time(p.time_from);articles=articles.filter(a=>Date.parse(a.timePublished)>=min);}
  if(p.time_to){const max=time(p.time_to)+59_999;articles=articles.filter(a=>Date.parse(a.timePublished)<=max);}
  if(p.sort==='EARLIEST')articles=[...articles].reverse();
  return {articles:articles.slice(0,p.limit),fetchedAt:this.cache.fetchedAt};
 }
}
