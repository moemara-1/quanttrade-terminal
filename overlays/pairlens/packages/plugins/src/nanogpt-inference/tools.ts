import { z } from 'zod'
import { fanOutWebSearch, readSearchRequest } from '../lib/web-search'
import type { WebSearchResult } from '@pairlens/shared/plugin-types'

const BASE = 'https://api.nano-gpt.com'
const modelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  context_length: z.number().nullable().optional(),
  max_output_tokens: z.number().nullable().optional(),
  capabilities: z
    .object({
      tool_calling: z.boolean().optional(),
      reasoning: z.boolean().optional(),
      parallel_tool_calls: z.boolean().optional(),
      structured_output: z.boolean().optional(),
    })
    .optional(),
  pricing: z
    .object({
      prompt: z.number().nullable().optional(),
      completion: z.number().nullable().optional(),
      currency: z.string().optional(),
      unit: z.string().optional(),
    })
    .optional(),
  subscription: z.object({ included: z.boolean().optional() }).optional(),
})
export type NanogptModel = z.infer<typeof modelSchema>
export async function fetchNanogptModels(
  request: typeof fetch = fetch,
): Promise<Array<NanogptModel>> {
  const raw = await nanoJson(
    '/api/v1/models?detailed=true',
    undefined,
    undefined,
    request,
  )
  return z.object({ data: z.array(modelSchema) }).parse(raw).data
}
async function nanoJson(
  path: string,
  key?: string,
  body?: unknown,
  request: typeof fetch = fetch,
): Promise<unknown> {
  const response = await request(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45000),
    redirect: 'error',
  })
  if (!response.ok)
    throw new Error(
      `NanoGPT request failed (HTTP ${response.status}). Check key, balance and access.`,
    )
  const reader = response.body?.getReader()
  if (!reader) throw new Error('NanoGPT returned an empty response')
  const chunks: Array<Uint8Array> = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2_000_000) {
        await reader.cancel()
        throw new Error('NanoGPT response exceeded the supported size')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(bytes)
  try {
    return JSON.parse(key ? text.split(key).join('[redacted]') : text)
  } catch {
    throw new Error('NanoGPT returned invalid JSON')
  }
}
const searchSchema = z.object({
  data: z.array(
    z.object({
      url: z.string(),
      title: z.string().optional(),
      name: z.string().optional(),
      content: z.string().optional(),
      description: z.string().optional(),
      snippet: z.string().optional(),
    }),
  ),
})
export function mapNanogptSearch(raw: unknown): Array<WebSearchResult> {
  return searchSchema
    .parse(raw)
    .data.filter((row) => /^https?:\/\//.test(row.url))
    .map((row) => ({
      url: row.url,
      title: row.title ?? row.name ?? row.url,
      excerpt: (row.content ?? row.description ?? row.snippet ?? '').slice(
        0,
        10000,
      ),
      publishDate: null,
    }))
}
export async function nanogptWebSearch(
  params: Record<string, unknown>,
  key: string,
): Promise<unknown> {
  const { queries, maxResults } = readSearchRequest(params)
  return fanOutWebSearch(
    queries.map((q) => q.slice(0, 1000)),
    maxResults,
    async (query, limit) => {
      const raw = await nanoJson('/api/v1/data/web/search', key, {
        query,
        provider: 'linkup',
        depth: 'standard',
        outputType: 'searchResults',
      })
      return mapNanogptSearch(raw).slice(0, limit)
    },
  )
}
const toolSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('models'),
      query: z.string().max(200).optional(),
      toolsOnly: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(30),
    })
    .strict(),
  z.object({ action: z.literal('balance') }).strict(),
  z
    .object({
      action: z.literal('usage'),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      groupBy: z.enum(['day', 'model', 'day,model']).default('day'),
    })
    .strict(),
  z
    .object({
      action: z.literal('scrape'),
      urls: z.array(z.string().url()).min(1).max(5),
    })
    .strict(),
])
export async function executeNanogptTool(
  raw: unknown,
  key: string,
): Promise<unknown> {
  const p = toolSchema.parse(raw)
  if (p.action === 'models') {
    const rows = (await fetchNanogptModels()).filter(
      (row) =>
        (!p.toolsOnly || row.capabilities?.tool_calling === true) &&
        (!p.query ||
          (row.id + ' ' + (row.name ?? ''))
            .toLowerCase()
            .includes(p.query.toLowerCase())),
    )
    return {
      models: rows.slice(0, p.limit),
      total: rows.length,
      truncated: rows.length > p.limit,
    }
  }
  if (!key)
    throw new Error('Connect NanoGPT before using account or research tools')
  if (p.action === 'balance') {
    const result = await nanoJson('/api/check-balance', key, {})
    return z
      .object({ usd_balance: z.string(), nano_balance: z.string() })
      .parse(result)
  }
  if (p.action === 'usage') {
    if (Boolean(p.from) !== Boolean(p.to))
      throw new Error('Usage dates must be supplied together')
    if (p.from && p.to) {
      const from = Date.parse(p.from + 'T00:00:00Z'),
        to = Date.parse(p.to + 'T00:00:00Z')
      if (
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        new Date(from).toISOString().slice(0, 10) !== p.from ||
        new Date(to).toISOString().slice(0, 10) !== p.to ||
        from > to ||
        to - from > 365 * 86400000 ||
        to > Date.now()
      )
        throw new Error('Invalid usage date range')
    }
    const query = new URLSearchParams({
      group_by: p.groupBy,
      ...(p.from && p.to ? { from: p.from, to: p.to } : {}),
    })
    return nanoJson('/api/v1/usage?' + query, key)
  }
  const urls = p.urls.map((value) => {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.includes('.') ||
      /^(?:\d|\[)/.test(url.hostname) ||
      /(?:\.localhost|\.local|\.internal)$/.test(url.hostname)
    )
      throw new Error(
        'Research URLs must be public HTTPS sites without credentials or custom ports',
      )
    return url.href
  })
  const result = await nanoJson('/api/v1/data/url/scrape', key, {
    urls,
    stealthMode: false,
  })
  return z
    .object({
      results: z.array(
        z.object({
          url: z.string(),
          success: z.boolean(),
          title: z.string().optional(),
          markdown: z.string().optional(),
          error: z.string().optional(),
        }),
      ),
      summary: z.record(z.string(), z.unknown()).optional(),
    })
    .parse(result)
}
