import { tool } from 'ai'
import { z } from 'zod'
import type { ArenaConfig, ArenaMarket } from '@/lib/llm-arena'
import { arenaMarkets, configuredArenaModel } from '@/lib/llm-arena'
import { setTradingAgentDraft } from '@/lib/trading-agent-draft'

const positive = z.number().finite().positive()
const configSchema = z.object({
  name: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(200),
  venue: z.enum(['lighter', 'hyperliquid']),
  symbol: z.string().trim().max(80).regex(/^[A-Za-z0-9_.:-]*$/),
  universe:z.object({kind:z.enum(['single','watchlist','liquid']),symbols:z.array(z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/)).min(1).max(40).optional(),maxCandidates:positive.int().max(8).default(4),ranking:z.enum(['volume','gainers','losers','movement']).default('volume')}).strict(),
  timeframe:z.enum(['1m','5m','15m','1h','4h']),
  mode: z.enum(['paper', 'live']),
  accountName: z.string().trim().min(1).max(80),
  marginMode: z.enum(['isolated', 'cross']),
  intervalMinutes: positive.int().min(1).max(1440),
  initialEquity: positive.max(100_000_000),
  marginPerTrade: positive.max(10_000_000),
  leverage: positive.int().max(100),
  maxDailyLoss: positive.max(100_000_000),
  maxDailyNotional: positive.max(100_000_000),
  maxAiSpendDaily: positive.max(1000),
  maxRunsDaily: positive.int().max(96),
  stopLossPct: positive.max(50),
  takeProfitPct: positive.max(500),
  minVolume24h: z.number().finite().nonnegative().max(1e14),
  maxAbsFundingBps: z.number().finite().nonnegative().max(10000),
  allowedSide: z.enum(['both', 'long', 'short']),
  minConfidence: z.number().finite().min(0).max(1),
  feeBps: z.number().finite().nonnegative().max(100),
  slippageBps: z.number().finite().nonnegative().max(100),
  rules: z.string().trim().min(1).max(2000),
}).partial().strict()

type DraftConfig=z.infer<typeof configSchema>
type CatalogMarket=ArenaMarket&{volume24h?:string}

export function buildTradingAgentTools(deps: {
  readMarkets?: (venue: ArenaConfig['venue'], signal: AbortSignal) => Promise<Array<CatalogMarket>>
  navigate?: (route:string)=>void
  isMobile?: ()=>boolean
} = {}) {
  return {
    prepare_trading_agent: tool({
      description: 'Prepare an UNSAVED editable LM Arena strategy from a free-text description. A name and one coin are not required: choose a single contract, exact watchlist, or a bounded liquid-market universe on one venue. Proposed technical and risk defaults are editable suggestions, never already-approved settings. Ask for missing venue/model/mode/account and review scalper candle timeframe versus evaluation cadence; budgets cap calls, this is not continuous high-frequency trading. One position per agent. This tool never saves, starts, arms, evaluates or trades. Human reviews, saves paused, then separately starts. Never guarantee profitability.',
      inputSchema: z.object({ description:z.string().trim().min(1).max(2000).optional(),config: configSchema.default({}), agentId: z.string().uuid().optional() }).strict(),
      execute: async ({ config: supplied,description, agentId }) => {
        const proposedFields:Array<string>=[]
        const config:DraftConfig={...supplied}
        const propose=<TKey extends keyof DraftConfig>(key:TKey,value:DraftConfig[TKey])=>{if(config[key]===undefined){config[key]=value;proposedFields.push(key)}}
        const rules=description??config.rules
        if(rules)propose('rules',rules)
        propose('name',rules?rules.replace(/\s+/g,' ').slice(0,70):'LM Arena strategy')
        const scalper=/scalp|intraday|short.term/i.test(rules??'')
        const ranking=/gainer|pump|rising/i.test(rules??'')?'gainers' as const:/loser|declining/i.test(rules??'')?'losers' as const:/volatile|momentum|scalp|movement/i.test(rules??'')?'movement' as const:'volume' as const
        propose('timeframe',scalper?'5m':'1h');propose('intervalMinutes',scalper?5:60)
        propose('universe',config.symbol?{kind:'single',maxCandidates:1,ranking}:{kind:'liquid',maxCandidates:4,ranking})
        if(config.universe&&!config.universe.ranking)config.universe={...config.universe,ranking}
        if(config.universe?.symbols&&(config.universe.kind!=='watchlist'||new Set(config.universe.symbols).size!==config.universe.symbols.length))return {status:'needs-clarification',saved:false,armed:false,message:'Only a watchlist universe accepts symbols; every symbol must be unique.'}
        propose('marginMode','isolated');propose('allowedSide','both');propose('leverage',2)
        propose('marginPerTrade',20);propose('maxDailyLoss',20);propose('maxDailyNotional',500)
        propose('maxAiSpendDaily',1);propose('maxRunsDaily',24);propose('stopLossPct',2);propose('takeProfitPct',4)
        propose('minVolume24h',1_000_000);propose('maxAbsFundingBps',10);propose('minConfidence',.7)
        if(config.mode!=='live'){propose('initialEquity',1000);propose('feeBps',5);propose('slippageBps',5)}
        const selectedModel=configuredArenaModel();if(selectedModel)propose('model',selectedModel)
        const missingFields:Array<string>=['venue','model','mode','rules'].filter(key=>!config[key as 'venue'|'model'|'mode'|'rules'])
        if(scalper){if(supplied.timeframe===undefined)missingFields.push('timeframe');if(supplied.intervalMinutes===undefined)missingFields.push('intervalMinutes')}
        if (config.mode === 'live' && !config.accountName) missingFields.push('accountName')
        if (config.venue) {
          let markets: Array<CatalogMarket>
          try { markets = await (deps.readMarkets ?? arenaMarkets)(config.venue, AbortSignal.timeout(25000)) }
          catch { return { status: 'needs-clarification', saved: false, armed: false, message: 'The venue catalog could not be verified. No draft was created; retry the catalog read before selecting a market.' } }
          const universe=config.universe!
          const symbols=universe.kind==='single'?[config.symbol??universe.symbols?.[0]].filter((symbol):symbol is string=>Boolean(symbol)):universe.kind==='watchlist'?(universe.symbols??[]):[]
          if(universe.kind!=='liquid'&&!symbols.length)missingFields.push('universe.symbols')
          for(const symbol of symbols){
            const matches=markets.filter(market=>market.venue===config.venue&&market.symbol===symbol)
            if(matches.length!==1)return {status:'needs-clarification',saved:false,armed:false,message:'Every selected contract must match one exact current venue symbol. No watchlist member was silently dropped.'}
            const market=matches[0]
            if(config.leverage!==undefined&&(market.maxLeverage===null||config.leverage>market.maxLeverage))return {status:'needs-clarification',saved:false,armed:false,message:'Requested leverage exceeds the selected contract limit.'}
            if(market.onlyIsolated&&config.marginMode==='cross')return {status:'needs-clarification',saved:false,armed:false,message:'A selected contract supports isolated margin only.'}
          }
          if(universe.kind==='liquid'){
            const eligible=markets.filter(market=>market.venue===config.venue&&(market.quote??market.symbol.split('-').at(-1))==='USDC'&&Number.isFinite(Number(market.volume24h))&&Number(market.volume24h)>=config.minVolume24h!&&market.maxLeverage!==null&&market.maxLeverage>=config.leverage!&&!(market.onlyIsolated&&config.marginMode==='cross'))
            if(!eligible.length)missingFields.push('universe.liquidity-readiness')
          }
        }
        const requestId = crypto.randomUUID()
        setTradingAgentDraft({ requestId, config, ...(agentId ? { agentId } : {}), missingFields,proposedFields })
        const mobile=deps.isMobile?.()??(typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(max-width: 767px)').matches)
        if(!mobile)deps.navigate?.('/bots')
        return { status: 'draft', saved: false, armed: false, requestId, missingFields,proposedFields,reviewPage:'/bots',maxPositions:1,message:'LM Arena proposal ready for review. Defaults are suggestions, not approved settings. Candidate scans and model calls remain bounded by the daily budget and call cap; this is not continuous trading. Review missing fields, save paused, then start separately.' }
      },
    }),
  }
}
