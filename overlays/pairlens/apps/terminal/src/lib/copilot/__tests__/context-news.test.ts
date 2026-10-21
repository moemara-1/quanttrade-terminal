import { afterEach, expect, test } from 'bun:test'
import { api } from '../../api'
import { buildAssistantSystemPrompt } from '../../assistant-core/assistant-brain'
import { buildContextTools } from '../context-tools'
import type { CopilotToolDeps } from '../tool-deps'

const originalNews = api.getNews
afterEach(() => {
  api.getNews = originalNews
})
async function readNews() {
  const tool = buildContextTools({} as CopilotToolDeps).get_news
  return (
    tool.execute as unknown as (
      input: unknown,
      options: unknown,
    ) => Promise<Record<string, unknown>>
  )({ symbol: 'TIA', limit: 5 }, { toolCallId: 'fixture', messages: [] })
}

test('zero headline matches mean unknown catalyst with bounded full-name followup', async () => {
  api.getNews = async () => ({ articles: [] })
  const result = await readNews()
  expect(result.status).toBe('no-matches')
  expect(result.catalystAssessment).toBe('unknown')
  expect(result.coverage).toMatchObject({ exhaustive: false })
  expect(result.nextResearch).toMatchObject({ tool: 'web_search' })
  expect(JSON.stringify(result.nextResearch)).toContain('Celestia')
})

test('available news retains explicit source coverage and publication dates', async () => {
  const publishedAt = '2026-10-19T12:00:00.000Z'
  api.getNews = async () => ({
    articles: [
      {
        title: 'Celestia fixture headline',
        url: 'https://fixture.example/story',
        source: 'Fixture',
        sourceDomain: 'fixture.example',
        timePublished: publishedAt,
        authors: [],
        summary: '',
        bannerImage: null,
        topics: [],
        tickerSentiment: [],
        overallSentimentLabel: 'Neutral',
        overallSentimentScore: 0,
      },
    ],
    fetchedAt: Date.now(),
    coverage: {
      scope: 'configured-rss-headlines',
      exhaustive: false,
      sources: [{ name: 'Fixture', status: 'available' }],
      totalMatchedArticles: 1,
    },
  })
  const result = await readNews()
  expect(result.status).toBe('available')
  expect(result.articles).toMatchObject([
    { timePublished: publishedAt, source: 'Fixture' },
  ])
  expect(result.coverage).toMatchObject({
    scope: 'configured-rss-headlines',
    exhaustive: false,
    totalMatchedArticles: 1,
  })
})

test('assistant guidance never treats zero news hits as proof of no catalyst', () => {
  const prompt = buildAssistantSystemPrompt({})
  expect(prompt).toContain(
    'Zero headline matches do not prove there is no news or catalyst',
  )
  expect(prompt).toContain('publication time')
})

test('omitting a news symbol reads broad headlines rather than the on-screen coin', async () => {
  let requested: unknown
  api.getNews = async (input) => { requested=input; return {articles:[]} }
  const tool=buildContextTools({getContextInfo:()=>({pair:'BTC-USDT'})} as CopilotToolDeps).get_news
  const execute=tool.execute as unknown as (input:unknown,options:unknown)=>Promise<Record<string,unknown>>
  const result=await execute({limit:5},{toolCallId:'fixture',messages:[]})
  expect(requested).toMatchObject({tickers:undefined,limit:5})
  expect(result.symbol).toBe(null)
  expect(result.status).toBe('no-matches')
})
