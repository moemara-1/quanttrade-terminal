import { afterEach, expect, test } from 'bun:test'
import { buildTradingAgentTools } from './trading-agent-tools'
import { getTradingAgentDraft, takeTradingAgentDraft } from '@/lib/trading-agent-draft'

afterEach(() => { takeTradingAgentDraft() })
test('draft review opens the desktop management route but leaves mobile navigation to its shell',async()=>{
 for(const mobile of [false,true]){
  const routes:Array<string>=[]
  const tools=buildTradingAgentTools({navigate:route=>routes.push(route),isMobile:()=>mobile})
  await tools.prepare_trading_agent.execute!({config:{name:'Draft'}},{toolCallId:'nav',messages:[]})
  expect(routes).toEqual(mobile?[]:['/bots'])
 }
})
test('conversation creates only an unsaved editable draft and reports missing risk limits', async () => {
  const tools = buildTradingAgentTools({ readMarkets: async () => [] })
  const result = await tools.prepare_trading_agent.execute!({ config: { name: 'Scalper', rules: 'Wait for my specified setup' } }, { toolCallId: 'draft', messages: [] })
  expect(result).toMatchObject({ status: 'draft', saved: false, armed: false })
  expect(getTradingAgentDraft()?.proposedFields).toContain('marginPerTrade')
  expect(getTradingAgentDraft()?.config.name).toBe('Scalper')
})

test('description-first scalper proposes a bounded liquid universe without inventing a single ticker',async()=>{
 const tools=buildTradingAgentTools({readMarkets:async()=>[{venue:'lighter',base:'BTC',symbol:'BTC-USDC',maxLeverage:10,volume24h:'2000000'}]})
 const result=await tools.prepare_trading_agent.execute!({description:'Scalp liquid markets on momentum pullbacks',config:{venue:'lighter'}},{toolCallId:'broad',messages:[]})
 expect(result).toMatchObject({status:'draft',saved:false,armed:false})
 const draft=getTradingAgentDraft()!
 expect(draft.config.name).toContain('Scalp')
 expect(draft.config.universe).toMatchObject({kind:'liquid',maxCandidates:4})
 expect(draft.config.symbol).toBeUndefined()
 expect(draft.config.timeframe).toBe('5m')
 expect(draft.missingFields).toContain('intervalMinutes')
 expect(draft.proposedFields).toContain('maxAiSpendDaily')
})

test('watchlist drafts verify every exact namespaced contract without silently dropping an invalid member',async()=>{
 const tools=buildTradingAgentTools({readMarkets:async()=>[{venue:'hyperliquid',base:'xyz:BTC',symbol:'xyz:BTC-USDC',maxLeverage:10}]})
 const result=await tools.prepare_trading_agent.execute!({description:'Trend follow my watchlist',config:{venue:'hyperliquid',universe:{kind:'watchlist',symbols:['xyz:BTC-USDC','WRONG-USDC'],maxCandidates:2}}},{toolCallId:'watch',messages:[]})
 expect(result).toMatchObject({status:'needs-clarification',saved:false,armed:false})
 expect(getTradingAgentDraft()).toBeNull()
})
test('unknown or ambiguous venue symbols never become an executable agent draft', async () => {
  const tools = buildTradingAgentTools({ readMarkets: async () => [{ venue: 'hyperliquid', base: 'para:PAPER', symbol: 'para:PAPER-USDC', maxLeverage: 3 }] })
  const result = await tools.prepare_trading_agent.execute!({ config: { name: 'Scalper', venue: 'hyperliquid', symbol: 'PAPER', leverage: 5 } }, { toolCallId: 'draft', messages: [] })
  expect(result).toMatchObject({ status: 'needs-clarification', saved: false, armed: false })
  expect(getTradingAgentDraft()).toBeNull()
})

test('complete live draft remains unsaved and rejects an isolated-only cross setting',async()=>{
 const tools=buildTradingAgentTools({readMarkets:async()=>[{venue:'hyperliquid',base:'xyz:BTC',symbol:'xyz:BTC-USDC',maxLeverage:3,onlyIsolated:true}]})
 const config={name:'User strategy',model:'selected-model',venue:'hyperliquid' as const,symbol:'xyz:BTC-USDC',mode:'live' as const,accountName:'desk',marginMode:'isolated' as const,intervalMinutes:15,initialEquity:1000,marginPerTrade:20,leverage:2,maxDailyLoss:30,maxDailyNotional:100,maxAiSpendDaily:1,maxRunsDaily:20,stopLossPct:2,takeProfitPct:4,minVolume24h:0,maxAbsFundingBps:10,allowedSide:'both' as const,minConfidence:.8,feeBps:5,slippageBps:5,rules:'Only trade when user-defined setup passes.'}
 expect(await tools.prepare_trading_agent.execute!({config},{toolCallId:'full',messages:[]})).toMatchObject({status:'draft',saved:false,armed:false,missingFields:[]})
 expect(getTradingAgentDraft()?.config.mode).toBe('live')
 const {initialEquity:_,feeBps:_fee,slippageBps:_slippage,...liveOnly}=config
 expect(await tools.prepare_trading_agent.execute!({config:liveOnly},{toolCallId:'live',messages:[]})).toMatchObject({status:'draft',missingFields:[]})
 expect(getTradingAgentDraft()?.config.initialEquity).toBeUndefined()
 takeTradingAgentDraft()
 expect(await tools.prepare_trading_agent.execute!({config:{...config,marginMode:'cross'}},{toolCallId:'invalid',messages:[]})).toMatchObject({status:'needs-clarification',saved:false,armed:false})
 expect(getTradingAgentDraft()).toBeNull()
})
