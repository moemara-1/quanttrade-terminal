import {XMLParser} from 'fast-xml-parser';
import {z} from 'zod';
export interface NewsSource {url:string;name:string;domain:string;kind:'crypto'|'markets';earnings?:boolean}
const sources:NewsSource[]=[
 {url:'https://www.coindesk.com/arc/outboundfeeds/rss',name:'CoinDesk',domain:'coindesk.com',kind:'crypto'},
 {url:'https://cointelegraph.com/rss',name:'Cointelegraph',domain:'cointelegraph.com',kind:'crypto'},
 {url:'https://feeds.content.dowjones.io/public/rss/mw_topstories',name:'MarketWatch',domain:'marketwatch.com',kind:'markets'},
 {url:'https://www.cnbc.com/id/15839135/device/rss/rss.html',name:'CNBC Earnings',domain:'cnbc.com',kind:'markets',earnings:true},
 {url:'https://www.cnbc.com/id/20409666/device/rss/rss.html',name:'CNBC Market Insider',domain:'cnbc.com',kind:'markets'}
];
const object=z.record(z.unknown());
const cryptoAliases:Record<string,string[]>={BTC:['bitcoin','btc'],ETH:['ethereum','ether','eth'],SOL:['solana','sol'],HYPE:['hyperliquid','hype'],DOGE:['dogecoin','doge'],XRP:['ripple','xrp'],BNB:['binance','bnb'],TIA:['celestia','tia'],XMR:['monero','xmr'],ZEC:['zcash','zec'],DASH:['dash','dash cryptocurrency','dash platform','dash core','dash evolution','dash network','dashpay','dash-to-anything']};
// Company names from the terminal's equity catalog. Ambiguous ticker words
// require explicit $/exchange notation; they must not tag generic prose.
const stockAliases:Record<string,string[]>={DASH:['DoorDash'],AAPL:['Apple'],NVDA:['Nvidia'],MSFT:['Microsoft'],TSLA:['Tesla'],AMZN:['Amazon'],GOOGL:['Alphabet','Google'],META:['Meta Platforms'],AVGO:['Broadcom'],AMD:['Advanced Micro Devices'],NFLX:['Netflix'],ORCL:['Oracle'],CRM:['Salesforce'],ADBE:['Adobe'],INTC:['Intel'],PLTR:['Palantir'],'BRK.B':['Berkshire Hathaway'],JPM:['JPMorgan','JPMorgan Chase'],V:['Visa'],MA:['Mastercard'],BAC:['Bank of America'],GS:['Goldman Sachs'],COIN:['Coinbase'],HOOD:['Robinhood'],MSTR:['MicroStrategy'],PYPL:['PayPal'],SOFI:['SoFi Technologies'],LLY:['Eli Lilly'],ABBV:['AbbVie'],UNH:['UnitedHealth'],JNJ:['Johnson & Johnson'],XOM:['Exxon Mobil','ExxonMobil'],CVX:['Chevron'],WMT:['Walmart'],COST:['Costco'],PG:['Procter & Gamble','Procter and Gamble'],KO:['Coca-Cola','Coca Cola'],PEP:['PepsiCo','Pepsi'],HD:['Home Depot'],DIS:['Disney'],UBER:['Uber'],ABNB:['Airbnb'],SHOP:['Shopify'],BA:['Boeing'],CAT:['Caterpillar'],GE:['GE Aerospace','General Electric'],SPY:['SPDR S&P 500 ETF'],QQQ:['Invesco QQQ'],VOO:['Vanguard S&P 500 ETF'],VTI:['Vanguard Total Market ETF'],IWM:['iShares Russell 2000'],DIA:['SPDR Dow Jones'],GLD:['SPDR Gold Shares'],TLT:['iShares 20+ Year Treasury'],ARKK:['ARK Innovation']};
const escaped=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function matches(title:string,words:string[]){return words.some(word=>new RegExp('\\b'+escaped(word)+'\\b','i').test(title));}
function normalizedTicker(value:string){
 const trimmed=value.trim(),isCrypto=/^CRYPTO:/i.test(trimmed),isStock=/^STOCKS?:/i.test(trimmed),name=trimmed.replace(/^(?:CRYPTO|STOCKS?):/i,'').replace(/[-/](?:USDC|USDT|USD)(?:[-/](?:USDC|USDT|USD))?$/i,'').toLowerCase();
 if(isStock){const stock=Object.entries(stockAliases).find(([symbol,names])=>symbol.toLowerCase()===name||names.some(alias=>alias.toLowerCase()===name));return stock?.[0]??name.toUpperCase();}
 const crypto=Object.entries(cryptoAliases).find(([symbol,names])=>symbol.toLowerCase()===name||names.some(alias=>alias.toLowerCase()===name));
 if(crypto)return 'CRYPTO:'+crypto[0];
 if(isCrypto)return 'CRYPTO:'+name.toUpperCase();
 const stock=Object.entries(stockAliases).find(([symbol,names])=>symbol.toLowerCase()===name||names.some(alias=>alias.toLowerCase()===name));
 return stock?.[0]??trimmed.toUpperCase();
}
// DASH is also DoorDash's stock ticker and an ordinary English word.
// Require project/product identity, or explicit crypto-market context.
function cryptoMention(title:string,symbol:string,names:string[],source:NewsSource){
 if(symbol!=='DASH')return matches(title,names);
 if(/\b(?:DoorDash|NASDAQ\s*:\s*DASH|NYSE\s*:\s*DASH)\b/i.test(title))return false;
 if(matches(title,names.filter(name=>name!=='dash')))return true;
 return source.kind==='crypto'&&/\bDASH\b/.test(title)&&/\b(?:price|coin|token|wallet|blockchain|cryptocurrency|masternodes?|mainnet|testnet)\b/i.test(title);
}
function stockMention(title:string,symbol:string,names:string[]){
 if(symbol==='DASH')return /\bDoorDash\b|\b(?:NASDAQ|NYSE)\s*:\s*DASH\b|\bDASH\s+(?:stock|shares)\b/i.test(title);
 if(symbol==='V'?/\b(?:Visa|VISA)\b/.test(title):matches(title,names))return true;
 const token=escaped(symbol);
 if(new RegExp('(?:\\$|\\b(?:NASDAQ|NYSE)\\s*:\\s*)'+token+'\\b','i').test(title))return true;
 return symbol.length>=3&&!['CAT','SHOP','COIN','META','SPY'].includes(symbol)&&new RegExp('\\b'+token+'\\b').test(title);
}
function headlineText(value:string){
 const named:Record<string,string>={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',ndash:'–',mdash:'—',hellip:'…'};
 let text=value.slice(0,4000);
 for(let pass=0;pass<3;pass++){
  const next=text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(entity:string,key:string)=>{
   if(!key.startsWith('#'))return named[key.toLowerCase()]??entity;
   const point=key[1]?.toLowerCase()==='x'?Number.parseInt(key.slice(2),16):Number.parseInt(key.slice(1),10);
   return point>0&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):entity;
  });
  if(next===text)break;text=next;
 }
 return text.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,500);
}
export function parseNewsRss(xml:string,source:NewsSource){
 if(Buffer.byteLength(xml)>2_000_000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Unsafe or oversized news XML');
 const parsed:unknown=new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:true}).parse(xml);
 const root=object.parse(parsed);const channel=object.parse(object.parse(root.rss).channel);
 const rows=Array.isArray(channel.item)?channel.item:channel.item?[channel.item]:[];
 return rows.slice(0,200).flatMap((raw:unknown)=>{
  const row=object.parse(raw);const title=typeof row.title==='string'?headlineText(row.title):'';
  if(!title||typeof row.link!=='string'||typeof row.pubDate!=='string')return [];
  let url:URL;try{url=new URL(row.link);}catch{return [];}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!(url.hostname===source.domain||url.hostname.endsWith('.'+source.domain)))return [];
  const date=Date.parse(row.pubDate);if(!Number.isFinite(date)||date>Date.now()+300_000)return [];
  const mentions=[...Object.entries(cryptoAliases).filter(([symbol,words])=>cryptoMention(title,symbol,words,source)).map(([symbol])=>'CRYPTO:'+symbol),...Object.entries(stockAliases).filter(([symbol,names])=>stockMention(title,symbol,names)).map(([symbol])=>symbol)];
  const topics=[{topic:source.kind==='crypto'?'blockchain':'financial_markets',relevanceScore:1}];
  if(/inflation|federal reserve|interest rate|employment|payroll|gdp|central bank|economy|recession/i.test(title))topics.push({topic:'economy_macro',relevanceScore:1});
  if(source.earnings||/earnings|quarterly results|profit|revenue|ipo/i.test(title))topics.push({topic:'earnings',relevanceScore:1});
  return [{title,url:url.href,timePublished:new Date(date).toISOString(),authors:[],summary:'',bannerImage:null,source:source.name,sourceDomain:source.domain,topics,overallSentimentScore:0,overallSentimentLabel:'Neutral',tickerSentiment:mentions.map(symbol=>({ticker:symbol,relevanceScore:1,sentimentScore:0,sentimentLabel:'Neutral'}))}];
 });
}
type Article=ReturnType<typeof parseNewsRss>[number];
const query=z.object({tickers:z.string().max(2000).optional(),topics:z.string().max(500).optional(),sort:z.enum(['LATEST','EARLIEST','RELEVANCE']).default('LATEST'),limit:z.coerce.number().int().min(1).max(200).default(50),time_from:z.string().regex(/^\d{8}T\d{4}$/).optional(),time_to:z.string().regex(/^\d{8}T\d{4}$/).optional()}).strict();
function time(value:string){const date=Date.parse(value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8)+'T'+value.slice(9,11)+':'+value.slice(11,13)+':00Z');if(!Number.isFinite(date))throw new Error('Invalid news time');return date;}
export class NewsService {
 private cache:{articles:Article[];fetchedAt:string;expires:number;availableKinds:Set<NewsSource['kind']>;sources:Array<{name:string;domain:string;kind:NewsSource['kind'];status:'available'|'unavailable'}>}|undefined;
 private pending:Promise<void>|undefined;
 constructor(private request:typeof fetch=fetch,private feeds:NewsSource[]=sources){}
 private async load(){
  if(this.cache&&this.cache.expires>Date.now())return;
  if(this.pending)return this.pending;
  this.pending=(async()=>{
   const results=await Promise.allSettled(this.feeds.map(async source=>{
    const response=await this.request(source.url,{signal:AbortSignal.timeout(12_000),headers:{'User-Agent':'QuantTrade/1.0 (public RSS reader)','Accept':'application/rss+xml, application/xml, text/xml'},redirect:'error'});
    if(!response.ok||!response.body)throw new Error('News upstream unavailable');
    const reader=response.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
    try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2_000_000)throw new Error('News feed too large');chunks.push(part.value);}}finally{await reader.cancel();}
    return parseNewsRss(Buffer.concat(chunks).toString('utf8'),source);
   }));
   const articles=results.flatMap(result=>result.status==='fulfilled'?result.value:[]);
   if(!articles.length)throw new Error('News feeds unavailable');
   const unique=new Map<string,Article>();
   for(const article of articles){
    const previous=unique.get(article.url);
    unique.set(article.url,previous?{...previous,topics:[...new Map([...previous.topics,...article.topics].map(topic=>[topic.topic,topic])).values()],tickerSentiment:[...new Map([...previous.tickerSentiment,...article.tickerSentiment].map(ticker=>[ticker.ticker,ticker])).values()]}:article);
   }
   const availableKinds=new Set(this.feeds.filter((_,index)=>results[index]?.status==='fulfilled').map(feed=>feed.kind));
   const coverageSources=this.feeds.map((feed,index)=>({name:feed.name,domain:feed.domain,kind:feed.kind,status:results[index]?.status==='fulfilled'?'available' as const:'unavailable' as const}));
   this.cache={articles:[...unique.values()].sort((a,b)=>b.timePublished.localeCompare(a.timePublished)),fetchedAt:new Date().toISOString(),expires:Date.now()+120_000,availableKinds,sources:coverageSources};
  })();
  try{await this.pending;}finally{this.pending=undefined;}
 }
 async get(raw:unknown){
  const p=query.parse(raw);await this.load();if(!this.cache)throw new Error('News unavailable');
  if(p.topics?.split(',').some(topic=>topic.trim()==='financial_markets')&&!this.cache.availableKinds.has('markets'))throw new Error('Equities news feeds unavailable');
  const tokens=[...new Set((p.tickers?.split(',')??[]).map(normalizedTicker).filter(Boolean))];
  if(tokens.includes('CRYPTO:BTC')&&tokens.includes('CRYPTO:ETH')&&!this.cache.availableKinds.has('crypto'))throw new Error('Crypto news feeds unavailable');
  const unsupportedTickers=tokens.filter(token=>token.startsWith('CRYPTO:')?!Object.hasOwn(cryptoAliases,token.slice(7)):!Object.hasOwn(stockAliases,token));
  const matchingStatus=!tokens.length?'not-requested' as const:!unsupportedTickers.length?'supported' as const:unsupportedTickers.length===tokens.length?'unsupported' as const:'partial' as const;
  let articles=this.cache.articles;
  if(tokens.length){const cryptoWire=tokens.includes('CRYPTO:BTC')&&tokens.includes('CRYPTO:ETH');articles=articles.filter(a=>cryptoWire?a.topics.some(t=>t.topic==='blockchain'):a.tickerSentiment.some(t=>tokens.includes(t.ticker)));}
  if(p.topics){const topics=p.topics.split(',').map(t=>t.trim()).filter(Boolean);articles=articles.filter(a=>topics.every(topic=>a.topics.some(t=>t.topic===topic)));}
  if(p.time_from){const min=time(p.time_from);articles=articles.filter(a=>Date.parse(a.timePublished)>=min);}
  if(p.time_to){const max=time(p.time_to)+59_999;articles=articles.filter(a=>Date.parse(a.timePublished)<=max);}
  if(p.sort==='EARLIEST')articles=[...articles].reverse();
  return {articles:articles.slice(0,p.limit),fetchedAt:this.cache.fetchedAt,coverage:{scope:'configured-rss-headlines' as const,exhaustive:false as const,matching:'headline-mentions-and-known-aliases' as const,matchingStatus,unsupportedTickers,archiveSearched:false as const,articleBodiesSearched:false as const,requestedFrom:p.time_from?new Date(time(p.time_from)).toISOString():null,requestedTo:p.time_to?new Date(time(p.time_to)+59_999).toISOString():null,normalizedTickers:tokens,sources:this.cache.sources,cachedArticleCount:this.cache.articles.length,totalMatchedArticles:articles.length,truncated:articles.length>p.limit,newestPublishedAt:this.cache.articles[0]?.timePublished??null,oldestPublishedAt:this.cache.articles.at(-1)?.timePublished??null,warning:'These are only recent headlines retained by the configured RSS feeds, not an exhaustive news search. Zero matches do not establish the absence of news or a catalyst; article bodies and sources outside these feeds were not searched.'}};
 }
}
