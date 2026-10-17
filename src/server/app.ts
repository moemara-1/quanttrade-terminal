import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { HostedAuth, readWebCredentials, type WebCredentials } from './hosted-auth.ts';
import type { TradingDesk } from './trading.ts';
import type { MarketService } from './markets.ts';
import type { ProposalAgent } from './agent.ts';
import type { HummingbotExecution } from './execution.ts';
import type { NewsService } from './news.ts';
import type { MarketCalendars } from './calendars.ts';
import type { VenueResearch } from './research.ts';
import type { VenueOperations } from './operations.ts';
import { validateSyncEntries } from './sync-state.ts';
import type { LiquidationCollector } from './liquidations.ts';
import type { WorkflowRuns } from './workflows.ts';
import { parseCredentials } from './connections.ts';
import type { LighterNativeOrders } from './lighter-native-orders.ts';
import type { HyperliquidNativeTwap } from './hyperliquid-native-twap.ts';
import type { ChasePlans } from './chase-plans.ts';
import type { AdvancedProtection } from './advanced-protection.ts';
import {NanoGptJobs,NanoGptJobError} from './nanogpt-jobs.ts';

interface Services {
  nanogptJobs?:NanoGptJobs;
  advancedProtection?:Pick<AdvancedProtection,'get'>;
  hyperliquidNativeTwap?:Pick<HyperliquidNativeTwap,'execute'|'evidence'> & Partial<Pick<HyperliquidNativeTwap,'list'>>;
  chasePlans?:Pick<ChasePlans,'start'|'list'|'cancel'|'cancelReviewed'>;
  lighterNativeOrders?:Pick<LighterNativeOrders,'execute'> & Partial<Pick<LighterNativeOrders,'preview'>>;
  workflows?:Pick<WorkflowRuns,'start'|'list'|'cancel'|'pauseVenue'> & Partial<Pick<WorkflowRuns,'pause'>>;
  liquidations?: Pick<LiquidationCollector,'get'>;
  news?: Pick<NewsService,'get'>;
  calendars?: Pick<MarketCalendars,'earnings'|'ipos'|'economic'>;
  research?: Pick<VenueResearch,'execute'>;
  operations?:Pick<VenueOperations,'execute'|'snapshot'> & Partial<Pick<VenueOperations,'openOrders'>>;
  desk: TradingDesk; markets: MarketService; agent: Pick<ProposalAgent,'prepare'>;
  execution?: Pick<HummingbotExecution,'account'|'connect'|'connections'|'disconnect'|'balances'> & Partial<Pick<HummingbotExecution,'spotConnections'|'verifiedConnectionRevision'>>; operatorToken: string; agentToken: string;
  allowedOrigins?: string[];
  webSession?: {origin:string;proxySecret:string;loginFile?:string;sessionFile?:string;credentials?:()=>WebCredentials};
}
function matches(value: string, expected: string): boolean {
  return timingSafeEqual(createHash('sha256').update(value).digest(),createHash('sha256').update(expected).digest());
}
const venueSchema=z.enum(['hyperliquid','lighter']);
const symbolSchema=z.string().min(1).max(60);
const marketTypeSchema=z.enum(['perpetual','spot']).default('perpetual');
export function createApp(services: Services) {
  if (!services.operatorToken || !services.agentToken || matches(services.operatorToken,services.agentToken)) throw new Error('Operator and agent tokens must be distinct and nonempty');
  const {desk,markets,agent}=services;
  const allowedOrigins=new Set(['http://127.0.0.1:4317','http://localhost:4317','http://127.0.0.1:4318','http://localhost:4318']);
  for (const value of services.allowedOrigins ?? []) {
    const origin=new URL(value);
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname!=='/' || origin.origin!==value) throw new Error('Configure an exact origin without credentials, path or query');
    if (origin.protocol!=='https:' && !(origin.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(origin.hostname))) throw new Error('Public terminal origins require HTTPS');
    allowedOrigins.add(value);
  }
  const app=express();
  const settings=services.webSession;
  const hostedAuth=settings?new HostedAuth({sessionFile:settings.sessionFile??':memory:',...(settings.credentials?{credentials:settings.credentials}:settings.loginFile?{credentials:()=>readWebCredentials(settings.loginFile!)}:{})}):undefined;
  const nanogptJobs=services.nanogptJobs??new NanoGptJobs();
  app.locals.hostedAuthClose=()=>{hostedAuth?.close();nanogptJobs.close();};
  const cookieName='qt_operator';
  if (services.webSession && (!allowedOrigins.has(services.webSession.origin) || !services.webSession.origin.startsWith('https://') || services.webSession.proxySecret.length<32)) throw new Error('Hosted sessions require an allowed HTTPS origin and a strong proxy secret');
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    const hostname=req.hostname;
    if (!['127.0.0.1','localhost','[::1]'].includes(hostname)) {res.status(403).json({error:'Local access only'});return;}
    const origin=req.get('Origin');
    if (origin && !allowedOrigins.has(origin)) {res.status(403).json({error:'Origin is not allowed'});return;}
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
    next();
  });
  app.get('/api/health',(_req,res)=>res.json({ok:true,service:'quanttrade-bridge'}));
  let dataWindow=Date.now(),dataBudget=0,dataInFlight=0;
  const publicData:RequestHandler=(_req,res,next)=>{
    if(Date.now()-dataWindow>=60_000){dataWindow=Date.now();dataBudget=0;}
    if(dataBudget>=240||dataInFlight>=16){res.set('Retry-After','60').status(429).json({error:'Data rate limit reached'});return;}
    dataBudget++;dataInFlight++;res.once('finish',()=>{dataInFlight--;});next();
  };
  const feeds=[['news',()=>services.news?.get.bind(services.news),'news_unavailable'],
    ['earnings-calendar',()=>services.calendars?.earnings.bind(services.calendars),'earnings_calendar_unavailable'],
    ['ipo-calendar',()=>services.calendars?.ipos.bind(services.calendars),'ipo_calendar_unavailable'],
    ['economic-calendar',()=>services.calendars?.economic.bind(services.calendars),'economic_calendar_unavailable']] as const;
  for(const [path,method,error] of feeds){
    app.get('/api/'+path,publicData,async(req,res)=>{
      const execute=method();
      if(!execute){res.status(503).json({error,reason:'not_configured',fetchedAt:new Date().toISOString()});return;}
      try{res.json(await execute(req.query));}catch(failure){
        if(failure instanceof z.ZodError){res.status(400).json({error:'Invalid feed parameters'});return;}
        res.status(503).json({error,reason:'upstream_error',fetchedAt:new Date().toISOString()});
      }
    });
  }

  app.get('/api/liquidations',publicData,async(req,res)=>{
    if(!services.liquidations){res.status(503).json({error:'liquidations_unavailable',reason:'collecting',fetchedAt:new Date().toISOString()});return;}
    const result=await services.liquidations.get(req.query);
    if('error' in result)res.status(result.reason==='not_tracked'?404:503);
    res.json(result);
  });

  let researchWindow=Date.now(),researchBudget=0,researchInFlight=0;
  app.get('/api/public/research',async(req,res)=>{
    if(!services.research){res.status(503).json({error:'Venue research unavailable'});return;}
    if(Date.now()-researchWindow>=60_000){researchWindow=Date.now();researchBudget=0;}
    if(researchBudget>=60||researchInFlight>=4){res.set('Retry-After','60').status(429).json({error:'Venue research rate limit reached; retry later'});return;}
    researchBudget++;researchInFlight++;
    try {res.json(await services.research.execute(req.query));} finally {researchInFlight--;}
  });
  app.get('/api/public/markets',async(req,res)=>res.json(await markets.list(venueSchema.parse(req.query.venue),marketTypeSchema.parse(req.query.marketType))));
  app.get('/api/public/candles',async(req,res)=>res.json(await markets.candles(venueSchema.parse(req.query.venue),symbolSchema.parse(req.query.symbol),z.string().default('1h').parse(req.query.interval),marketTypeSchema.parse(req.query.marketType),z.coerce.number().int().nonnegative().optional().parse(req.query.endTs),z.coerce.number().int().min(1).max(1000).optional().parse(req.query.limit))));
  app.get('/api/public/book',async(req,res)=>res.json(await markets.book(venueSchema.parse(req.query.venue),symbolSchema.parse(req.query.symbol),marketTypeSchema.parse(req.query.marketType))));
  const sessionCookie=(req:express.Request)=>req.get('Cookie')?.split(';').map(value=>value.trim()).find(value=>value.startsWith(cookieName+'='))?.slice(cookieName.length+1)??'';
  const validSession=(req:express.Request)=>!!hostedAuth?.valid(sessionCookie(req));
  const originCheck:RequestHandler=(req,res,next)=>{if(!settings||req.get('Origin')!==settings.origin){res.status(403).json({error:'Sign-in requires the terminal origin'});return;}next();};
  const issueSession=(res:express.Response,remember:boolean)=>{
    const token=hostedAuth!.issue(remember);
    res.cookie(cookieName,token,{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:(remember?30*24:12)*60*60*1000});
    res.clearCookie(cookieName,{httpOnly:true,secure:true,sameSite:'strict',path:'/_quanttrade/api'});
    res.json({ok:true});
  };
  const loginWindows=new Map<string,{start:number;count:number}>();
  app.post('/api/login',originCheck,express.json({limit:'4kb'}),(req,res)=>{
    if(!hostedAuth||(!settings?.credentials&&!settings?.loginFile)){res.status(503).json({error:'Password sign-in is not configured'});return;}
    const now=Date.now();for(const [key,value] of loginWindows)if(now-value.start>=15*60_000)loginWindows.delete(key);
    // All hosted requests arrive from the local proxy: use a shared budget rather than trusting client IP headers.
    const key=req.socket.remoteAddress??'local';let window=loginWindows.get(key);
    if(!window){if(loginWindows.size>=100){res.set('Retry-After','900').status(429).json({error:'Sign-in unavailable; try again later'});return;}window={start:now,count:0};loginWindows.set(key,window);}
    if(++window.count>20){res.set('Retry-After','900').status(429).json({error:'Too many sign-in attempts; try again later'});return;}
    const parsed=z.object({username:z.string().min(1).max(128),password:z.string().min(1).max(1024),remember:z.boolean().default(false)}).strict().safeParse(req.body);
    if(!parsed.success||!hostedAuth.authenticate(parsed.data.username,parsed.data.password)){res.status(401).json({error:'Invalid username or password'});return;}
    issueSession(res,parsed.data.remember);
  });
  app.get('/api/session',(req,res)=>{if(!validSession(req)){res.status(401).json({error:'Sign in to QuantTrade'});return;}res.json({ok:true});});
  app.get('/api/session-check',(req,res)=>{res.status(validSession(req)?204:401).end();});
  app.delete('/api/session',originCheck,(req,res)=>{hostedAuth?.revoke(sessionCookie(req));res.clearCookie(cookieName,{httpOnly:true,secure:true,sameSite:'strict',path:'/'});res.clearCookie(cookieName,{httpOnly:true,secure:true,sameSite:'strict',path:'/_quanttrade/api'});res.json({ok:true});});
  app.post('/api/session',originCheck,(req,res)=>{
    if(validSession(req)){res.json({ok:true});return;}
    if(!settings||!hostedAuth||!matches(req.get('X-QuantTrade-Session-Secret')??'',settings.proxySecret)){res.status(401).json({error:'Sign in to QuantTrade first'});return;}
    issueSession(res,false);
  });
  const windows=new Map<string,{start:number;count:number}>();
  app.use('/api',(req,res,next)=>{
    const header=req.get('Authorization')??'';
    const token=header.startsWith('Bearer ')?header.slice(7):'';
    const cookie=req.get('Cookie')?.split(';').map(value=>value.trim()).find(value=>value.startsWith(cookieName+'='))?.slice(cookieName.length+1)??'';
    const cookieAuthenticated=!header && !!hostedAuth?.valid(cookie);
    const role=matches(token,services.operatorToken)?'operator':matches(token,services.agentToken)?'agent':cookieAuthenticated?'operator':null;
    if (!role) {res.status(401).json({error:services.webSession&&!header?'Your QuantTrade session has expired. Sign in to reconnect your exchange.':'Enter the operator token from data/operator-token to unlock the desk.'});return;}
    if (cookieAuthenticated && !['GET','HEAD'].includes(req.method) && req.get('Origin')!==services.webSession?.origin) {res.status(403).json({error:'Operator actions require the terminal origin'});return;}
    res.locals.role=role;
    res.locals.aiOwner=createHash('sha256').update(cookieAuthenticated?cookie:token).digest('hex');
    // Background inference polling cannot exhaust the trading control budget.
    const rateKey=req.path.startsWith('/ai/nanogpt/')?`${role}:ai`:role;
    const now=Date.now(); let window=windows.get(rateKey);
    if (!window || now-window.start>=60_000) {window={start:now,count:0};windows.set(rateKey,window);}
    if (++window.count>240) {res.status(429).json({error:'Too many requests; wait a minute.'});return;}
    if (req.method==='POST' && !req.is('application/json')) {res.status(415).json({error:'Use application/json'});return;}
    next();
  });
  const inferenceOperator:RequestHandler=(_req,res,next)=>{if(res.locals.role!=='operator'){res.status(403).json({error:'Inference requires the operator session'});return;}next();};
  const inferenceFailure=(res:express.Response,error:unknown)=>res.status(error instanceof NanoGptJobError?error.status:400).json({error:error instanceof NanoGptJobError?error.message:'Invalid inference request'});
  app.post('/api/ai/nanogpt/jobs',inferenceOperator,express.json({limit:'2mb'}),(req,res)=>{
    try{res.status(201).json({id:nanogptJobs.start(String(res.locals.aiOwner),req.body)});}catch(error){inferenceFailure(res,error);}
  });
  app.get('/api/ai/nanogpt/jobs/:id',inferenceOperator,async(req,res)=>{
    let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    const disconnect=()=>{void reader?.cancel().catch(()=>undefined);};res.once('close',disconnect);
    try{
      const raw=req.query.offset??'0';if(typeof raw!=='string'||!/^\d+$/.test(raw))throw new NanoGptJobError(400,'Invalid inference response offset');
      const response=nanogptJobs.read(String(res.locals.aiOwner),String(req.params.id),Number(raw));
      if(!response){res.set('Retry-After','1').status(202).end();return;}
      res.status(response.status).set('Content-Type',response.headers.get('Content-Type')??'application/octet-stream');
      if(response.headers.has('X-QuantTrade-AI-Upstream'))res.set('X-QuantTrade-AI-Upstream','1');
      res.flushHeaders();reader=response.body?.getReader();
      if(reader)while(!res.destroyed){const chunk=await reader.read();if(chunk.done)break;if(!res.write(chunk.value))await new Promise<void>(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});}
      res.end();
    }catch(error){if(res.headersSent)res.destroy();else inferenceFailure(res,error);}
    finally{res.off('close',disconnect);reader?.releaseLock();}
  });
  app.delete('/api/ai/nanogpt/jobs/:id',inferenceOperator,(req,res)=>{try{nanogptJobs.cancel(String(res.locals.aiOwner),String(req.params.id));res.status(204).end();}catch(error){inferenceFailure(res,error);}});
  app.use('/api/ai/nanogpt',((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(typeof error==='object'&&error!==null&&'status' in error&&error.status===413?413:400).json({error:'Invalid inference request'});}) satisfies ErrorRequestHandler);
  app.use('/api/sync-state',express.json({limit:'512kb'}));
  app.use(express.json({limit:'32kb'}));
  const operator: RequestHandler=(_req,res,next)=>{
    if (res.locals.role!=='operator') {res.status(403).json({error:'Human operator approval is required for this action'});return;}
    next();
  };
  app.get('/api/status',(_req,res)=>res.json({...desk.status(),connectionRevisions:{lighter:desk.store.connectionFingerprint(desk.status().accountName,'lighter'),hyperliquid:desk.store.connectionFingerprint(desk.status().accountName,'hyperliquid')}}));
  app.get('/api/sync-state',operator,(_req,res)=>res.json({entries:desk.store.syncEntries()}));
  app.put('/api/sync-state',operator,(req,res)=>{
    const input=z.object({entries:z.unknown()}).strict().parse(req.body);
    res.json({entries:desk.store.mergeSyncEntries(validateSyncEntries(input.entries))});
  });
  app.get('/api/connections',operator,async(_req,res)=>{
    if (!services.execution) {res.status(503).json({error:'Exchange service is unavailable'});return;}
    const connected=await services.execution.connections();
    const spotConnected=await services.execution.spotConnections?.();
    res.json((['hyperliquid','lighter'] as const).map(venue=>({venue,connected:!connecting.has(venue) && connected.includes(venue),...(spotConnected?{spotConnected:!connecting.has(venue)&&spotConnected.includes(venue)}:{}),mode:desk.modeFor(venue),accountName:desk.status().accountName})));
  });
  app.get('/api/connections/:venue/balances',operator,async(req,res)=>{
    if (!services.execution) {res.status(503).json({error:'Exchange service is unavailable'});return;}
    res.json(await services.execution.balances(venueSchema.parse(req.params.venue),marketTypeSchema.parse(req.query.marketType)));
  });
  const connecting=new Set<string>();
  app.post('/api/connections/lighter/recover',operator,async(req,res)=>{
    const input=z.object({accountName:z.string().min(1).max(128)}).strict().parse(req.body);
    const account=desk.status().accountName;
    if(input.accountName!==account||desk.modeFor('lighter')!=='live'||!desk.status().executionConfigured){res.status(409).json({error:'Existing live Lighter account does not match this preparation',submissionAttempted:false});return;}
    if(connecting.size){res.status(409).json({error:'An exchange connection is being updated',submissionAttempted:false});return;}
    const existing=desk.store.connectionFingerprint(account,'lighter');
    if(existing){res.json({venue:'lighter',accountName:account,connectionRevision:existing,connected:true,mode:'live'});return;}
    if(!services.execution?.verifiedConnectionRevision){res.status(503).json({error:'Existing connection verification is unavailable',submissionAttempted:false});return;}
    connecting.add('lighter');
    try {
      const revision=z.string().regex(/^[a-f0-9]{64}$/).parse(await services.execution.verifiedConnectionRevision('lighter'));
      if(desk.status().accountName!==account||desk.modeFor('lighter')!=='live'||desk.store.connectionFingerprint(account,'lighter')!==null)throw Error('Account or connection changed during recovery');
      // Recovery grants fresh preparation only; previously paused plans stay paused.
      services.workflows?.pauseVenue('lighter');
      desk.store.setConnectionFingerprint(account,'lighter',revision);
      desk.store.record('connection-revision-recovered',null,account+':lighter');
      res.json({venue:'lighter',accountName:account,connectionRevision:revision,connected:true,mode:'live'});
    } finally {connecting.delete('lighter');}
  });
  // Persist only hashes after verification, scoped to this execution account.
  // Identical reconnects after a bridge restart are not credential changes.
  app.post('/api/connections',operator,async(req,res)=>{
    if (!services.execution) {res.status(503).json({error:'Exchange service is unavailable'});return;}
    const input=z.object({venue:venueSchema,credentials:z.unknown(),mode:z.enum(['paper','live']).optional()}).strict().parse(req.body);
    const credentials=parseCredentials(input.venue,input.credentials);
    const fingerprint=createHash('sha256').update(JSON.stringify(credentials)).digest('hex');
    if (connecting.size) {res.status(409).json({error:'An exchange connection is already being updated'});return;}
    connecting.add(input.venue);
    try {
      const unchanged=desk.store.connectionFingerprint(desk.status().accountName,input.venue)===fingerprint && (await services.execution.connections()).includes(input.venue);
      const spotConnected=await services.execution.spotConnections?.();
      const repairSpot=unchanged && spotConnected!==undefined && !spotConnected.includes(input.venue);
      if (!unchanged || (input.mode && input.mode!==desk.modeFor(input.venue))) services.workflows?.pauseVenue(input.venue);
      if (!unchanged) {
        desk.store.setConnectionFingerprint(desk.status().accountName,input.venue,null);
        await services.execution.connect(input.venue,credentials);
        desk.store.setConnectionFingerprint(desk.status().accountName,input.venue,fingerprint);
      }
      else if(repairSpot) {
        // The atomic bundle restores its previous files on failure. Repairing a
        // missing spot connector does not invalidate the verified perpetual key.
        await services.execution.connect(input.venue,credentials);
      }
      if (input.mode) desk.setVenueMode(input.venue,input.mode);
      const connected=(await services.execution.connections()).includes(input.venue);
      const verifiedSpot=(await services.execution.spotConnections?.())?.includes(input.venue)??false;
      res.json({venue:input.venue,connected,spotConnected:verifiedSpot,mode:desk.modeFor(input.venue),accountName:desk.status().accountName});
    } finally {connecting.delete(input.venue);}
  });
  app.delete('/api/connections/:venue',operator,async(req,res)=>{
    if (!services.execution) {res.status(503).json({error:'Exchange service is unavailable'});return;}
    const venue=venueSchema.parse(req.params.venue);
    if (connecting.size) {res.status(409).json({error:'An exchange connection is already being updated'});return;}
    connecting.add(venue);
    desk.store.setConnectionFingerprint(desk.status().accountName,venue,null);
    services.workflows?.pauseVenue(venue);
    try {await services.execution.disconnect(venue);res.json({venue,connected:false,mode:desk.status().mode,accountName:desk.status().accountName});}
    finally {connecting.delete(venue);}
  });
  app.get('/api/markets',async(req,res)=>res.json(await markets.list(venueSchema.parse(req.query.venue))));
  app.get('/api/candles',async(req,res)=>res.json(await markets.candles(venueSchema.parse(req.query.venue),symbolSchema.parse(req.query.symbol),z.string().default('1h').parse(req.query.interval))));
  app.get('/api/book',async(req,res)=>res.json(await markets.book(venueSchema.parse(req.query.venue),symbolSchema.parse(req.query.symbol))));
  app.get('/api/proposals',(_req,res)=>res.json(desk.store.list()));
  app.get('/api/audit',operator,(_req,res)=>res.json(desk.store.audit()));
  app.get('/api/account',operator,async(_req,res)=>{
    if (!services.execution || !desk.status().executionConfigured) {res.status(503).json({error:'Live account access is not configured'});return;}
    res.json(await services.execution.account());
  });
  app.post('/api/proposals',async(req,res)=>res.status(201).json(await desk.propose(req.body,res.locals.role==='agent'?'agent':'manual')));
  app.post('/api/terminal/orders',operator,async(req,res)=>{
    if(connecting.size){res.status(409).json({error:'Exchange credentials are being updated; prepare a fresh order afterwards',submissionAttempted:false});return;}
    const input=z.object({clientOrderId:z.string().min(1).max(128),mode:z.enum(['paper','live']),order:z.unknown()}).strict().parse(req.body);
    res.json(await desk.confirm(input.clientOrderId,input.mode,input.order));
  });
  app.get('/api/workflow-runs',operator,(_req,res)=>res.json(services.workflows?.list()??[]));
  app.post('/api/workflow-runs',operator,async(req,res)=>{
    if(!services.workflows){res.status(503).json({error:'Workflow execution is unavailable'});return;}
    if(connecting.size){res.status(409).json({error:'Exchange credentials are being updated; prepare a fresh plan afterwards'});return;}
    res.json(await services.workflows.start(req.body));
  });
  app.post('/api/workflow-runs/:id/cancel',operator,(req,res)=>{
    if(!services.workflows){res.status(503).json({error:'Workflow execution is unavailable'});return;}
    const fingerprint=z.object({fingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional()}).parse(req.body??{}).fingerprint;
    res.json(services.workflows.cancel(z.string().min(1).max(100).parse(req.params.id),fingerprint));
  });
  app.post('/api/workflow-runs/:id/pause',operator,(req,res)=>{
    if(!services.workflows?.pause){res.status(503).json({error:'Workflow management is unavailable'});return;}
    const {fingerprint}=z.object({fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);
    res.json(services.workflows.pause(z.string().min(1).max(100).parse(req.params.id),fingerprint));
  });
  app.post('/api/terminal/operations',operator,async(req,res)=>{
    if(connecting.size){res.status(409).json({error:'Exchange credentials are being updated; wait for the connection before changing exchange settings',submissionAttempted:false});return;}
    if (!services.operations) {res.status(503).json({error:'Exchange operations are unavailable'});return;}
    res.json(await services.operations.execute(req.body));
  });
  app.post('/api/terminal/lighter-native-preview',operator,async(req,res)=>{
    if(!services.lighterNativeOrders?.preview){res.status(503).json({error:'Native Lighter preview is unavailable',submissionAttempted:false});return;}
    if(connecting.size){res.status(409).json({error:'Exchange credentials are being updated; prepare a fresh native plan afterwards',submissionAttempted:false});return;}
    try{res.json(await services.lighterNativeOrders.preview(req.body));}
    catch(error){
      const message=error instanceof z.ZodError?error.issues.map(issue=>`${issue.path.join('.')||'request'}: ${issue.message}`).join('; '):error instanceof Error?error.message:'Native order validation failed before submission';
      res.status(400).json({error:message,submissionAttempted:false});
    }
  });
  app.post('/api/terminal/lighter-native-orders',operator,async(req,res)=>{
    if(!services.lighterNativeOrders){res.status(503).json({error:'Native Lighter execution is unavailable',submissionAttempted:false});return;}
    if(connecting.size){res.status(409).json({error:'Exchange credentials are being updated; prepare a fresh native plan afterwards',submissionAttempted:false});return;}
    try{res.json(await services.lighterNativeOrders.execute(req.body));}
    catch(error){
      const message=error instanceof z.ZodError?error.issues.map(issue=>`${issue.path.join('.')||'request'}: ${issue.message}`).join('; '):error instanceof Error?error.message:'Native order validation failed before submission';
      res.status(400).json({error:message,submissionAttempted:false});
    }
  });
  app.post('/api/terminal/hyperliquid-twap',operator,async(req,res)=>{
    if(!services.hyperliquidNativeTwap){res.status(503).json({error:'Native Hyperliquid TWAP is unavailable',submissionAttempted:false});return;}
    if(connecting.size){res.status(409).json({error:'Exchange credentials are being updated; prepare a fresh plan afterwards',submissionAttempted:false});return;}
    try{res.json(await services.hyperliquidNativeTwap.execute(req.body));}
    catch(error){res.status(400).json({error:error instanceof Error?error.message:'Native TWAP validation failed',submissionAttempted:false});}
  });
  app.put('/api/terminal/native-twap-policy',operator,(req,res)=>{
    if(connecting.size){res.status(409).json({error:'Exchange connection is being updated'});return;}
    try{
      const plan=z.object({requestId:z.string().uuid(),proposedAt:z.number().int(),accountName:z.string().min(1),connectionRevision:z.string().regex(/^[a-f0-9]{64}$/),mode:z.literal('live'),venue:z.literal('hyperliquid'),enabled:z.boolean(),acceptFixedSlippageBps:z.literal(300)}).strict().parse(req.body);
      if(plan.proposedAt>Date.now()+5000||Date.now()-plan.proposedAt>180000)throw new Error('Permission review expired');
      if(desk.status().accountName!==plan.accountName||desk.modeFor('hyperliquid')!=='live'||!desk.status().executionConfigured||desk.store.connectionFingerprint(plan.accountName,'hyperliquid')!==plan.connectionRevision)throw new Error('Reviewed account or connection changed');
      const previous=desk.store.claimOperation(plan.requestId,createHash('sha256').update(JSON.stringify(plan)).digest('hex'));
      if(previous){if(previous.state!=='completed')throw new Error('Permission update interrupted; refresh permission');res.json(previous.result);return;}
      desk.store.setNativeTwapRiskAllowed(plan.accountName,plan.connectionRevision,plan.enabled);
      const result={enabled:plan.enabled,accountName:plan.accountName,connectionRevision:plan.connectionRevision};
      desk.store.finishOperation(plan.requestId,'completed',result);res.json(result);
    }catch(error){res.status(400).json({error:error instanceof Error?error.message:'Invalid permission review'});}
  });
  app.post('/api/terminal/chase-plans',operator,async(req,res)=>{
    if(!services.chasePlans){res.status(503).json({error:'Managed Chase is unavailable',submissionAttempted:false});return;}
    if(connecting.size){res.status(409).json({error:'Exchange credentials are being updated; prepare a fresh plan afterwards',submissionAttempted:false});return;}
    try{res.json({status:'registered',run:await services.chasePlans.start(req.body)});}
    catch(error){res.status(400).json({error:error instanceof Error?error.message:'Chase plan validation failed',submissionAttempted:false});}
  });
  app.get('/api/chase-plans',operator,(_req,res)=>res.json({runs:services.chasePlans?.list()??[]}));
  app.get('/api/terminal/native-twap-runs',operator,(_req,res)=>{
    if(!services.hyperliquidNativeTwap?.list){res.status(503).json({error:'Native TWAP receipt history is unavailable'});return;}
    res.json(services.hyperliquidNativeTwap.list());
  });
  app.get('/api/advanced-protection',operator,(req,res)=>{
    if(!services.advancedProtection)throw Error('Advanced protection service is unavailable');
    const run=services.advancedProtection.get(z.string().uuid().parse(req.query.requestId));
    if(run.input.accountName!==desk.status().accountName||desk.modeFor(run.input.venue)!=='live'||desk.store.connectionFingerprint(run.input.accountName,run.input.venue)!==run.input.connectionRevision)throw Error('Reviewed protection account, mode or connection changed');
    res.json({run});
  });
  app.post('/api/terminal/chase-cancel',operator,(_req,res)=>{
    if(!services.chasePlans){res.status(503).json({error:'Managed Chase is unavailable',submissionAttempted:false});return;}
    if(connecting.size){res.status(409).json({error:'Exchange connection is being updated',submissionAttempted:false});return;}
    try{res.json({status:'cancellation-requested',run:services.chasePlans.cancelReviewed(_req.body)});}
    catch(error){res.status(400).json({error:error instanceof Error?error.message:'Chase cancellation validation failed',submissionAttempted:false});}
  });
  app.post('/api/terminal/hyperliquid-twap-evidence',operator,async(req,res)=>{
    if(!services.hyperliquidNativeTwap){res.status(503).json({error:'Native TWAP evidence is unavailable'});return;}
    res.json(await services.hyperliquidNativeTwap.evidence(req.body));
  });
  app.post('/api/chase-plans/:id/cancel',operator,(req,res)=>{
    if(!services.chasePlans){res.status(503).json({error:'Managed Chase is unavailable'});return;}
    if(connecting.size){res.status(409).json({error:'Exchange connection is being updated'});return;}
    res.json(services.chasePlans.cancel(z.string().uuid().parse(req.params.id)));
  });
  app.post('/api/terminal/snapshot',operator,async(req,res)=>{
    if (!services.operations) {res.status(503).json({error:'Exchange account access is unavailable'});return;}
    res.json(await services.operations.snapshot(req.body));
  });
  app.post('/api/terminal/open-orders',operator,async(req,res)=>{
    if(!services.operations?.openOrders){res.status(503).json({error:'Exchange open-order reader is unavailable'});return;}
    if(connecting.size){res.status(409).json({error:'Exchange credentials are being updated; wait before reading current orders'});return;}
    try{res.json(await services.operations.openOrders(req.body));}
    catch(error){res.status(error instanceof z.ZodError?400:503).json({error:error instanceof z.ZodError?'Invalid native open-order request or response':error instanceof Error?error.message:'Exchange open-order read failed; current orders are unavailable, not empty'});}
  });
  app.post('/api/proposals/:id/approve',operator,async(req,res)=>{
    if(connecting.size){res.status(409).json({error:'Exchange credentials are being updated; prepare a fresh proposal afterwards',submissionAttempted:false});return;}
    res.json(await desk.approve(z.string().uuid().parse(req.params.id)));
  });
  app.post('/api/proposals/:id/reject',operator,(req,res)=>res.json(desk.reject(z.string().uuid().parse(req.params.id))));
  app.post('/api/proposals/:id/cancel',operator,async(req,res)=>res.json(await desk.cancel(z.string().uuid().parse(req.params.id))));
  app.post('/api/halt',operator,(req,res)=>res.json(desk.setHalted(z.object({halted:z.boolean()}).strict().parse(req.body).halted)));
  app.post('/api/agent',async(req,res)=>{
    const input=z.object({prompt:z.string().trim().min(1).max(4000),venue:venueSchema,symbol:symbolSchema,marketType:z.enum(['perpetual','spot']).default('perpetual')}).strict().parse(req.body);
    res.json(await agent.prepare(input.prompt,input.venue,input.symbol,input.marketType));
  });
  app.use('/api',(_req,res)=>res.status(404).json({error:'API route not found'}));
  app.get('/',(_req,res)=>res.redirect(desk.status().pairlensUrl));
  const errorHandler: ErrorRequestHandler=(error:unknown,_req,res,_next)=>{
    if (error instanceof z.ZodError) {res.status(400).json({error:error.issues.map((issue)=>`${issue.path.join('.')||'request'}: ${issue.message}`).join('; ')});return;}
    res.status(400).json({error:error instanceof Error?error.message:'Request failed'});
  };
  app.use(errorHandler);
  return app;
}
