import { expect, test } from 'bun:test'
import { buildScannerTools, scanSnapshot } from './scanner-tools'
import type { ScannerSnapshot } from '@/lib/scanners'

function snapshot(): ScannerSnapshot {
  const row = {
    venue: 'hyperliquid' as const,
    symbol: 'BTC-USDC',
    base: 'BTC',
    price: 100,
    change24h: 2,
    volume24h: 1000000,
    fundingHourly: 0.0001,
    openInterestBase: 20,
    openInterestUsd: 2000,
    relativeStrength24h: 0,
    oiToVolume: 0.002,
    observedAt: Date.now(),
  }
  return {
    asOf: Date.now(),
    refreshAfterMs: 30000,
    sources: [
      {
        id: 'hyperliquid',
        status: 'ok',
        observedAt: Date.now(),
        count: 2,
        message: null,
      },
    ],
    markets: [
      row,
      {
        ...row,
        symbol: 'ETH-USDC',
        base: 'ETH',
        relativeStrength24h: 5,
        change24h: 7,
      },
    ],
    comparisons: [],
    options: { sources: [], trades: [], overview: [], coverage: [] },
  }
}
test('assistant scanner ranks the full eligible universe, preserves exact contract and reports sample limits', () => {
  const result = scanSnapshot(snapshot(), {
    scanner: 'strength',
    limit: 1,
    venue: 'all',
    search: '',
    minVolume: 0,
    direction: 'gainers',
  })
  expect(result.total).toBe(2)
  expect(result.truncated).toBe(true)
  expect(result.rows[0]).toMatchObject({
    base: 'ETH',
    pair: 'ETH-USDC-USDC',
    venue: 'hyperliquid',
  })
  expect(result.methodology).toContain('percentage points')
})
test('assistant scanner preserves source failure rather than fabricating an empty healthy result', () => {
  const data = snapshot()
  data.sources = [
    {
      id: 'hyperliquid',
      status: 'error',
      observedAt: null,
      count: 0,
      message: 'Unavailable',
    },
  ]
  data.markets = []
  const result = scanSnapshot(data, {
    scanner: 'strength',
    limit: 10,
    venue: 'all',
    search: '',
    minVolume: 0,
    direction: 'gainers',
  })
  expect(result.unavailable).toBe('source_unavailable')
  expect(result.rows).toEqual([])
})
test('assistant scanner filters venue/search/volume before ranking and does not turn missing relative returns into zero', () => {
  const data = snapshot()
  data.markets[1]!.relativeStrength24h = null
  expect(
    scanSnapshot(data, {
      scanner: 'strength',
      limit: 10,
      venue: 'all',
      search: 'ETH',
      strengthMetric: 'relativeStrength24h',
      minVolume: 0,
      direction: 'gainers',
    }).rows,
  ).toEqual([])
  expect(
    scanSnapshot(data, {
      scanner: 'strength',
      limit: 10,
      venue: 'lighter',
      search: '',
      minVolume: 0,
      direction: 'gainers',
    }).rows,
  ).toEqual([])
})

test('raw 24h gainers and BTC-relative strength are distinct rankings across venues', () => {
  const data = snapshot()
  data.markets[0] = {
    ...data.markets[0]!,
    venue: 'lighter',
    base: 'SUI',
    symbol: 'SUI-USDC',
    change24h: 10,
    relativeStrength24h: -2,
  }
  const query = {
    scanner: 'strength' as const,
    limit: 10,
    venue: 'all' as const,
    search: '',
    minVolume: 0,
    direction: 'gainers' as const,
  }
  expect(scanSnapshot(data, query).rows[0]).toMatchObject({
    base: 'SUI',
    pair: 'SUI-USDC-USDC',
    venue: 'lighter',
  })
  expect(
    scanSnapshot(data, { ...query, strengthMetric: 'relativeStrength24h' })
      .rows[0],
  ).toMatchObject({ base: 'ETH' })
  data.markets[0]!.relativeStrength24h = null
  expect(scanSnapshot(data, query).total).toBe(2)
  expect(
    scanSnapshot(data, { ...query, strengthMetric: 'relativeStrength24h' })
      .total,
  ).toBe(1)
})

test('builder assistant scan returns exact quoted pair and partial coverage rather than an absent-market claim',()=>{
 const s=snapshot();s.sources[0]={...s.sources[0],complete:false,failedDexs:['xyz'],message:'Builder coverage incomplete'};
 s.markets=[{...s.markets[0],base:'flx:PAPER',symbol:'flx:PAPER-USDH',quote:'USDH',openInterestUsd:null}];
 const result=scanSnapshot(s,{scanner:'strength',search:'PAPER'});
 expect(result.rows[0]?.pair).toBe('flx:PAPER-USDH-USDH');expect(result.coverageComplete).toBe(false);expect(result.sources[0]?.failedDexs).toEqual(['xyz']);
});


test('trade research brief reuses one snapshot and limits each independent ranking', async () => {
  const data = snapshot()
  data.markets = Array.from({length:40}, (_,index)=>({...data.markets[0]!,base:`C${index}`,symbol:`C${index}-USDC`,change24h:index,relativeStrength24h:40-index,fundingHourly:index/100000}))
  let reads=0
  const brief = await buildScannerTools(async()=>{reads++;return data}).get_trade_research_brief.execute!({venue:'all',search:'',minVolume:0},{toolCallId:'brief',messages:[]})
  expect(reads).toBe(1)
  expect(brief.views.gainers.rows).toHaveLength(3)
  expect(brief.views.gainers.total).toBe(40)
  expect(brief.views.gainers.truncated).toBe(true)
  expect(brief.views.losers.rows[0]).toMatchObject({base:'C0'})
  expect(brief.views.relativeStrength.rows[0]).toMatchObject({base:'C0'})
  expect(brief.views.gainers.rows[0]).toMatchObject({base:'C39',pair:'C39-USDC-USDC',venue:'hyperliquid'})
  expect(JSON.stringify(brief).length).toBeLessThanOrEqual(12000)
})

test('trade research brief scopes directional markets by venue, search and volume without aliasing builder identities', async()=>{
  const data=snapshot()
  data.sources.push({...data.sources[0]!,id:'lighter'})
  data.markets=[{...data.markets[0]!,base:'flx:PAPER',symbol:'flx:PAPER-USDH',quote:'USDH'}, {...data.markets[0]!,venue:'lighter',base:'PAPER',symbol:'PAPER-USDC',change24h:100}]
  const brief=await buildScannerTools(async()=>data).get_trade_research_brief.execute!({venue:'hyperliquid',search:'PAPER',minVolume:100},{toolCallId:'brief',messages:[]})
  expect(brief.views.gainers.total).toBe(1)
  expect(brief.views.gainers.rows[0]).toMatchObject({base:'flx:PAPER',symbol:'flx:PAPER-USDH',pair:'flx:PAPER-USDH-USDH',quote:'USDH',venue:'hyperliquid'})
  expect(brief.scope.venue).toBe('hyperliquid')
})

test('trade research brief reports stale and failed sources as unknown rather than healthy empty markets', async()=>{
  const stale=snapshot();stale.asOf=Date.now()-100000
  const staleBrief=await buildScannerTools(async()=>stale).get_trade_research_brief.execute!({venue:'all',search:'',minVolume:0},{toolCallId:'brief',messages:[]})
  expect(staleBrief.unavailable).toBe('stale_snapshot')
  expect(staleBrief.views.gainers.rows).toEqual([])
  const failed=snapshot();failed.sources[0]={...failed.sources[0]!,status:'error',observedAt:null,count:0};failed.markets=[]
  const failedBrief=await buildScannerTools(async()=>failed).get_trade_research_brief.execute!({venue:'all',search:'',minVolume:0},{toolCallId:'brief',messages:[]})
  expect(failedBrief.views.gainers.unavailable).toBe('source_unavailable')
  expect(failedBrief.views.gainers.coverageComplete).toBe(false)
  expect(failedBrief.sources[0]?.status).toBe('error')
})

test('trade research brief never truncates a huge native ID into an executable alias', async()=>{
  const data=snapshot();data.markets=[{...data.markets[0]!,symbol:'x'.repeat(30000)}]
  const brief=await buildScannerTools(async()=>data).get_trade_research_brief.execute!({venue:'all',search:'',minVolume:0},{toolCallId:'brief',messages:[]})
  expect(JSON.stringify(brief).length).toBeLessThanOrEqual(12000)
  expect(brief.views.gainers.rows).toEqual([])
  expect(brief.views.gainers.truncated).toBe(true)
  expect(brief.views.gainers.omittedForSize).toBe(1)
  expect(brief.views.gainers.total).toBe(1)
})

test('trade research brief explicitly labels funding payers without claiming measured positioning', async () => {
  const data=snapshot()
  data.markets=[0.001,-0.001,0,null].map((fundingHourly,index)=>({...data.markets[0]!,base:`PAY${index}`,symbol:`PAY${index}-USDC`,fundingHourly}))
  const brief=await buildScannerTools(async()=>data).get_trade_research_brief.execute!({venue:'all',search:'',minVolume:0},{toolCallId:'brief',messages:[]})
  const rows=Object.fromEntries(brief.views.gainers.rows.map(row=>[row.base,row]))
  expect(rows.PAY0?.fundingPayer).toBe('longs')
  expect(rows.PAY1?.fundingPayer).toBe('shorts')
  expect(rows.PAY2?.fundingPayer).toBe('none')
  expect(brief.positioningEvidence).toBe('not-measured; crowding is an absolute-funding proxy only')
  const missing=await buildScannerTools(async()=>data).get_trade_research_brief.execute!({venue:'all',search:'PAY3',minVolume:0},{toolCallId:'missing',messages:[]})
  expect(missing.views.gainers.rows[0]?.fundingPayer).toBe('unknown')
})
