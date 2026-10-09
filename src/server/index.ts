import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';
import { DeskStore } from './store.ts';
import { PublicMarkets } from './markets.ts';
import { HummingbotExecution } from './execution.ts';
import { TradingDesk } from './trading.ts';
import { WorkflowRuns } from './workflows.ts';
import { ProposalAgent } from './agent.ts';
import { createApp } from './app.ts';
import { NewsService } from './news.ts';
import { MarketCalendars } from './calendars.ts';
import { VenueResearch } from './research.ts';
import { HummingbotOperations, VenueOperations } from './operations.ts';
import { LiquidationCollector } from './liquidations.ts';

if (existsSync('.env')) loadEnvFile('.env');
const positiveDecimal=z.string().regex(/^[1-9]\d*(?:\.\d+)?$/);
const env=z.object({
  DESK_MODE:z.enum(['paper','live']).default('paper'),
  MAX_ORDER_NOTIONAL:positiveDecimal.default('1000'),DAILY_NOTIONAL_LIMIT:positiveDecimal.default('5000'),
  MAX_PRICE_DEVIATION_BPS:z.coerce.number().int().min(1).max(1000).default(100),
  PROPOSAL_TTL_SECONDS:z.coerce.number().int().min(15).max(600).default(120),
  HUMMINGBOT_URL:z.string().url().default('http://127.0.0.1:8000'),HUMMINGBOT_USERNAME:z.string().default(''),HUMMINGBOT_PASSWORD:z.string().default(''),
  HUMMINGBOT_ACCOUNT:z.string().regex(/^[A-Za-z0-9_-]+$/).default('desk'),
  AGENT_BASE_URL:z.string().default(''),AGENT_API_KEY:z.string().default(''),AGENT_MODEL:z.string().default(''),
  PAIRLENS_URL:z.string().url().default('http://localhost:4317'),
  ALLOWED_ORIGINS:z.string().default(''),
  WEB_SESSION_ORIGIN:z.string().default(''),WEB_SESSION_PROXY_SECRET:z.string().default(''),
  WEB_LOGIN_FILE:z.string().default(''),WEB_SESSION_FILE:z.string().default('data/web-sessions.sqlite'),
}).parse(process.env);
mkdirSync('data',{recursive:true});
function token(name:string):string {
  const path=resolve('data',name);
  if (!existsSync(path)) writeFileSync(path,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});
  return z.string().min(32).parse(readFileSync(path,'utf8').trim());
}
const store=new DeskStore(resolve('data','desk.sqlite'));
const markets=new PublicMarkets();
const liquidations=new LiquidationCollector(resolve('data','liquidations.sqlite'));
liquidations.start();
const execution=new HummingbotExecution({url:env.HUMMINGBOT_URL,username:env.HUMMINGBOT_USERNAME,password:env.HUMMINGBOT_PASSWORD,accountName:env.HUMMINGBOT_ACCOUNT});
const desk=new TradingDesk(store,markets,execution,{mode:env.DESK_MODE,accountName:env.HUMMINGBOT_ACCOUNT,maxOrderNotional:env.MAX_ORDER_NOTIONAL,
  dailyNotionalLimit:env.DAILY_NOTIONAL_LIMIT,maxPriceDeviationBps:env.MAX_PRICE_DEVIATION_BPS,proposalTtlSeconds:env.PROPOSAL_TTL_SECONDS,pairlensUrl:env.PAIRLENS_URL});
const agent=new ProposalAgent({url:env.AGENT_BASE_URL,key:env.AGENT_API_KEY,model:env.AGENT_MODEL},markets,desk);
const workflows=new WorkflowRuns(resolve('data','workflow-runs.sqlite'),desk);
workflows.startTimer();
desk.agentConfigured=agent.configured;
const operations=new VenueOperations(desk,new HummingbotOperations({url:env.HUMMINGBOT_URL,username:env.HUMMINGBOT_USERNAME,password:env.HUMMINGBOT_PASSWORD,accountName:env.HUMMINGBOT_ACCOUNT}),markets);
const app=createApp({workflows,liquidations,news:new NewsService(),calendars:new MarketCalendars(),research:new VenueResearch(),desk,markets,execution,agent,operations,operatorToken:token('operator-token'),agentToken:token('agent-token'),allowedOrigins:env.ALLOWED_ORIGINS.split(',').map(value=>value.trim()).filter(Boolean),...(env.WEB_SESSION_ORIGIN?{webSession:{origin:env.WEB_SESSION_ORIGIN,proxySecret:env.WEB_SESSION_PROXY_SECRET,sessionFile:resolve(env.WEB_SESSION_FILE),...(env.WEB_LOGIN_FILE?{loginFile:resolve(env.WEB_LOGIN_FILE)}:{})}}:{})});
const server=app.listen(4318,'127.0.0.1',()=>console.log(`QuantTrade Hummingbot bridge: http://127.0.0.1:4318 (${env.DESK_MODE}). Terminal: ${env.PAIRLENS_URL}. Operator token: ${resolve('data','operator-token')}`));
server.on('error',(error)=>{console.error(`Server could not start: ${error.message}`);liquidations.close();workflows.close();store.close();app.locals.hostedAuthClose();process.exitCode=1;});
function shutdown() {liquidations.close();workflows.close();server.close(()=>{store.close();app.locals.hostedAuthClose();process.exit(0);});setTimeout(()=>process.exit(1),5000).unref();}
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
