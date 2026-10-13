import { z } from 'zod'
import {  useQuery } from '@tanstack/react-query'
import type {UseQueryResult} from '@tanstack/react-query';
import { quantTradeFetch } from '@/lib/plugins/quanttrade-session'

type Venue = 'lighter' | 'hyperliquid'
type MarketType = 'perpetual' | 'spot'
type Request = (url: string, init?: RequestInit) => Promise<Response>
const venueSchema = z.enum(['lighter', 'hyperliquid'])
const modeSchema = z.enum(['live', 'paper'])
const orderSchema = z.object({ venue: venueSchema, symbol: z.string().min(1), marketType: z.enum(['perpetual', 'spot']).optional(), side: z.string().optional(), size: z.string().optional() })
const stepSchema = z.object({ status: z.string(), nodeId: z.string().optional(), orderId: z.string().optional(), error: z.string().optional() })
const statusSchema = z.object({ accountName: z.string().min(1), executionConfigured: z.boolean(), venueModes: z.record(z.string(), modeSchema), connectionRevisions: z.record(z.string(), z.string().nullable()) })
const connectionSchema = z.object({ venue: venueSchema, accountName: z.string(), connected: z.boolean(), spotConnected: z.boolean().optional(), mode: modeSchema })
export type ActivityIdentity = z.infer<typeof statusSchema> & { connections: Array<z.infer<typeof connectionSchema>>; connectionsError?: string }
export interface ActivityRow {
  id: string; kind: 'workflow' | 'chase' | 'order' | 'native-twap'; name: string; venue: Venue; symbol: string; chartSymbol?: string; marketType: MarketType; accountName: string; mode: 'paper' | 'live'; status: string; startedAt?: number; side?: string; size?: string; price?: string; triggerPrice?: string; reduceOnly?: boolean; error?: string; steps: Array<{ id: string; status: string; orderId?: string; error?: string }>; scopeMismatch: boolean
}
type Parsed = { items: Array<ActivityRow>; warnings: Array<string> }
export interface ActivitySection extends Parsed { loading: boolean; error: string | null; updatedAt: number | null; stale: boolean }
async function read(path: string, request: Request, signal?: AbortSignal, body?: unknown): Promise<unknown> {
  const response = await quantTradeFetch('/_quanttrade/api/' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }, request)
  if (!response.ok) throw Error(`Activity read failed (${response.status}); data is unavailable, not empty.`)
  return response.json()
}
export async function readActivityIdentity(request: Request = fetch, signal?: AbortSignal): Promise<ActivityIdentity> {
  const [status, connections] = await Promise.allSettled([read('status', request, signal), read('connections', request, signal)])
  if (status.status === 'rejected') throw status.reason
  const parsed = statusSchema.parse(status.value)
  try {
    if (connections.status === 'rejected') throw connections.reason
    const connected = z.array(connectionSchema).parse(connections.value)
    if (connected.some((connection) => connection.accountName !== parsed.accountName || connection.mode !== parsed.venueModes[connection.venue])) throw Error('Exchange account changed during activity read.')
    return { ...parsed, connections: connected }
  } catch (cause) {
    return { ...parsed, connections: [], connectionsError: cause instanceof Error ? cause.message : 'Exchange connections could not be verified.' }
  }
}
export function activityChartSymbol(venue: Venue, marketType: MarketType, symbol: string, catalog: Array<{venue: string; symbol: string}>): string | undefined {
  const matches = catalog.filter(row => row.venue === venue && (row.symbol === symbol || marketType === 'perpetual' && `${row.symbol}-USDC` === symbol))
  return matches.length === 1 ? marketType === 'perpetual' ? `${matches[0].symbol}-USDC` : matches[0].symbol : undefined
}
export function parseNativeTwapRuns(raw: unknown, identity: ActivityIdentity): Parsed {
  const result = z.object({scope: z.literal('quanttrade-accepted-native-twap-receipts'), complete: z.literal(false), note: z.string(), runs: z.array(z.unknown())}).parse(raw)
  const schema = z.object({id: z.string(), accountName: z.string(), connectionRevision: z.string(), venue: z.literal('hyperliquid'), marketType: z.literal('perpetual'), symbol: z.string(), side: z.string(), size: z.string(), mode: z.literal('live'), twapId: z.string().regex(/^[1-9]\d*$/), proposedAt: z.number(), status: z.literal('accepted'), currentAccount: z.boolean()})
  const items: Array<ActivityRow> = [], warnings = [result.note]
  result.runs.forEach((rawRun, index) => {
    const parsed = schema.safeParse(rawRun)
    if (!parsed.success) { warnings.push(`Native TWAP receipt ${index + 1} could not be verified.`); return }
    const run = parsed.data
    items.push({...run, kind: 'native-twap', name: 'Native Hyperliquid TWAP receipt', scopeMismatch: !run.currentAccount || mismatch(run.accountName, run.venue, run.mode, run.connectionRevision, identity), steps: [{id: 'Native TWAP', status: 'accepted; lifecycle not verified', orderId: run.twapId}]})
  })
  return {items, warnings}
}
function mismatch(accountName: string, venue: Venue, mode: string, revision: string | undefined, identity: ActivityIdentity) {
  return accountName !== identity.accountName || mode !== identity.venueModes[venue] || (mode === 'live' && revision !== identity.connectionRevisions[venue])
}
const workflowSchema = z.object({ id: z.string(), startedAt: z.number(), status: z.string(), error: z.string().optional(), plan: z.object({ name: z.string(), accountName: z.string(), mode: modeSchema, connectionRevision: z.string().optional(), input: orderSchema.optional(), steps: z.array(z.object({ order: orderSchema })).optional() }), states: z.array(stepSchema) })
export function parseWorkflowRuns(raw: unknown, identity: ActivityIdentity): Parsed {
  const rows = z.array(z.unknown()).parse(raw), items: Array<ActivityRow> = [], warnings: Array<string> = []
  rows.forEach((row, index) => {
    const parsed = workflowSchema.safeParse(row)
    if (!parsed.success) { warnings.push(`Workflow record ${index + 1} could not be read.`); return }
    const run = parsed.data, order = run.plan.input ?? run.plan.steps?.[0]?.order
    if (!order) { warnings.push(`Workflow ${run.id} has no reviewed instrument.`); return }
    items.push({ id: run.id, kind: 'workflow', name: run.plan.name, ...order, marketType: order.marketType ?? 'perpetual', accountName: run.plan.accountName, mode: run.plan.mode, status: run.status, startedAt: run.startedAt, error: run.error, scopeMismatch: mismatch(run.plan.accountName, order.venue, run.plan.mode, run.plan.connectionRevision, identity), steps: run.states.map((state, i) => ({ ...state, id: state.nodeId ?? String(i + 1) })) })
  })
  return { items, warnings }
}
const chaseSchema = z.object({ id: z.string(), startedAt: z.number(), status: z.string(), error: z.string().optional(), plan: orderSchema.extend({ accountName: z.string(), mode: z.literal('live'), connectionRevision: z.string() }), attempts: z.array(z.object({ phase: z.string(), orderId: z.string().optional(), exchangeId: z.string().optional() })) })
export function parseChaseRuns(raw: unknown, identity: ActivityIdentity): Parsed {
  const rows = z.object({ runs: z.array(z.unknown()) }).parse(raw).runs, items: Array<ActivityRow> = [], warnings: Array<string> = []
  rows.forEach((row, index) => {
    const parsed = chaseSchema.safeParse(row)
    if (!parsed.success) { warnings.push(`Chase record ${index + 1} could not be read.`); return }
    const run = parsed.data
    items.push({ ...run.plan, id: run.id, kind: 'chase', name: 'Chase limit', marketType: 'perpetual', status: run.status, startedAt: run.startedAt, error: run.error, scopeMismatch: mismatch(run.plan.accountName, run.plan.venue, run.plan.mode, run.plan.connectionRevision, identity), steps: run.attempts.map((attempt, i) => ({ id: String(i + 1), status: attempt.phase, orderId: attempt.exchangeId ?? attempt.orderId })) })
  })
  return { items, warnings }
}
const nativeOrderSchema = z.object({ exchangeOrderId: z.string().regex(/^[1-9]\d*$/), symbol: z.string().min(1), type: z.string().optional(), side: z.string().optional(), size: z.string().optional(), price: z.string().optional(), triggerPrice: z.string().optional(), reduceOnly: z.boolean().optional() })
export function parseOpenOrders(raw: unknown, identity: ActivityIdentity, venue: Venue, marketType: MarketType): Parsed {
  const result = z.object({ venue: venueSchema, marketType: z.enum(['perpetual', 'spot']), accountName: z.string(), connectionRevision: z.string(), scope: z.string(), complete: z.boolean(), error: z.string().optional(), orders: z.array(z.unknown()) }).parse(raw)
  if (result.accountName !== identity.accountName || result.venue !== venue || result.marketType !== marketType || result.connectionRevision !== identity.connectionRevisions[venue]) throw Error('Exchange account or connection changed; discard this order snapshot.')
  const expectedScope = marketType === 'spot' ? 'all-spot-markets' : venue === 'lighter' ? 'all-perpetual-markets' : 'standard-perpetual-markets'
  if (result.scope !== expectedScope) throw Error('Exchange order coverage does not match the requested market.')
  const warnings = result.complete ? [] : [result.error ?? 'Order coverage is incomplete.']
  if (venue === 'hyperliquid') warnings.push('Hyperliquid builder markets and native TWAP schedules are not included in this order list.')
  const items: Array<ActivityRow> = []
  const ids = new Set<string>()
  result.orders.forEach((row, index) => {
    const parsed = nativeOrderSchema.safeParse(row)
    if (!parsed.success || ids.has(parsed.data.exchangeOrderId)) { warnings.push(`${venue} order record ${index + 1} could not be read.`); return }
    const order = parsed.data; ids.add(order.exchangeOrderId)
    items.push({ ...order, id: order.exchangeOrderId, kind: 'order', name: order.type ?? 'Exchange order', venue, marketType, accountName: identity.accountName, mode: 'live', status: 'open', steps: [], scopeMismatch: false })
  })
  return { items, warnings }
}
function section(query: UseQueryResult<Parsed, Error>, enabled: boolean): ActivitySection {
  return { items: query.data?.items ?? [], warnings: query.data?.warnings ?? [], loading: enabled && query.isFetching, error: query.error?.message ?? null, updatedAt: query.dataUpdatedAt || null, stale: Boolean(query.data && query.isError) }
}
export function useLiveActivity() {
  const identity = useQuery({ queryKey: ['quanttrade-live-activity-identity'], queryFn: ({ signal }) => readActivityIdentity(fetch, signal), refetchInterval: 15000, retry: false })
  const scope = identity.data, enabled = Boolean(scope && !identity.isError)
  const scopeKey = scope ? JSON.stringify([scope.accountName, scope.venueModes, scope.connectionRevisions, scope.connections]) : null
  const options = { enabled, refetchInterval: 15000, retry: false, staleTime: 10000 } as const
  const workflows = useQuery({ ...options, queryKey: ['quanttrade-live-workflows', scopeKey], queryFn: async ({ signal }) => parseWorkflowRuns(await read('workflow-runs', fetch, signal), scope!) })
  const chase = useQuery({ ...options, queryKey: ['quanttrade-live-chase', scopeKey], queryFn: async ({ signal }) => parseChaseRuns(await read('chase-plans', fetch, signal), scope!) })
  const nativeTwap = useQuery({ ...options, queryKey: ['quanttrade-live-native-twap', scopeKey], queryFn: async ({ signal }) => parseNativeTwapRuns(await read('terminal/native-twap-runs', fetch, signal), scope!) })
  const catalogs = useQuery({ ...options, staleTime: 60000, refetchInterval: 60000, queryKey: ['quanttrade-live-activity-catalog', scopeKey], queryFn: async ({ signal }) => {
    const values = await Promise.allSettled((['lighter', 'hyperliquid'] as const).flatMap(venue => (['perpetual', 'spot'] as const).map(async marketType => ({venue, marketType, rows: z.array(z.object({venue: z.string(), symbol: z.string()})).parse(await read(`public/markets?venue=${venue}&marketType=${marketType}`, fetch, signal))}))))
    return values.flatMap(value => value.status === 'fulfilled' ? [value.value] : [])
  } })
  const orders = useQuery({ ...options, queryKey: ['quanttrade-live-orders', scopeKey], queryFn: async ({ signal }) => {
    const targets = scope!.executionConfigured ? scope!.connections.flatMap((connection) => connection.connected && scope!.connectionRevisions[connection.venue] ? [{ venue: connection.venue, marketType: 'perpetual' as const }, ...(connection.spotConnected ? [{ venue: connection.venue, marketType: 'spot' as const }] : [])] : []) : []
    const results = await Promise.allSettled(targets.map(async (target) => parseOpenOrders(await read('terminal/open-orders', fetch, signal, target), scope!, target.venue, target.marketType)))
    const items: Array<ActivityRow> = [], warnings: Array<string> = []
    results.forEach((result, index) => { if (result.status === 'fulfilled') { items.push(...result.value.items); warnings.push(...result.value.warnings) } else warnings.push(`${targets[index].venue} ${targets[index].marketType}: ${result.reason instanceof Error ? result.reason.message : 'Order read failed.'}`) })
    if (targets.length && results.every((result) => result.status === 'rejected')) throw Error(warnings.join(' '))
    if (scope!.connectionsError) warnings.push(scope!.connectionsError)
    if (!targets.length) warnings.push('No verified exchange connection is available for an order read; the book is unknown, not empty.')
    return { items, warnings }
  } })
  const identityError = identity.error?.message ?? null
  const wrap = (query: UseQueryResult<Parsed, Error>) => {
    const result = section(query, enabled)
    result.items = result.items.map(row => ({...row, chartSymbol: activityChartSymbol(row.venue, row.marketType, row.symbol, catalogs.data?.find(catalog => catalog.venue === row.venue && catalog.marketType === row.marketType)?.rows ?? [])}))
    if (identity.isPending) result.loading = true
    return identityError ? { ...result, error: identityError, stale: Boolean(result.updatedAt) } : result
  }
  return { workflows: wrap(workflows), chase: wrap(chase), nativeTwap: wrap(nativeTwap), orders: wrap(orders), identity: scope ?? null, isRefreshing: identity.isFetching || workflows.isFetching || chase.isFetching || nativeTwap.isFetching || orders.isFetching, refresh: async () => { const result = await identity.refetch(); if (!result.isError && result.data && JSON.stringify([result.data.accountName, result.data.venueModes, result.data.connectionRevisions, result.data.connections]) === scopeKey) await Promise.all([workflows.refetch(), chase.refetch(), nativeTwap.refetch(), orders.refetch(), catalogs.refetch()]) } }
}
