import { describe, expect, test } from 'bun:test'
import { activityChartSymbol, parseNativeTwapRuns, parseOpenOrders, parseWorkflowRuns, readActivityIdentity } from '../live-activity'

const revision = 'a'.repeat(64)
const identity = { accountName: 'desk', executionConfigured: true, venueModes: { lighter: 'live', hyperliquid: 'paper' }, connectionRevisions: { lighter: revision, hyperliquid: null }, connections: [{ venue: 'lighter', accountName: 'desk', connected: true, mode: 'live' }] }
describe('live activity data', () => {
  test('keeps server identity usable when exchange connections fail', async () => {
    const result = await readActivityIdentity(async (url) => url.endsWith('/status') ? Response.json(identity) : new Response('Unavailable', { status: 503 }))
    expect(result.accountName).toBe('desk')
    expect(result.connections).toEqual([])
    expect(result.connectionsError).toContain('503')
  })
  test('native TWAP receipts remain acknowledgments rather than verified running schedules', () => {
    const result = parseNativeTwapRuns({ scope: 'quanttrade-accepted-native-twap-receipts', complete: false, note: 'Lifecycle not verified', runs: [{ id: 'r', accountName: 'desk', connectionRevision: revision, venue: 'hyperliquid', marketType: 'perpetual', symbol: 'ETH-USDC', side: 'buy', size: '1', mode: 'live', twapId: '123', proposedAt: 1, status: 'accepted', currentAccount: false }] }, identity)
    expect(result.items[0].scopeMismatch).toBe(true)
    expect(result.items[0].steps[0].orderId).toBe('123')
    expect(result.warnings).toContain('Lifecycle not verified')
  })
  test('chart links require an exact selected venue catalog record', () => {
    const catalog = [{ venue: 'lighter', symbol: 'STRK-USDC' }]
    expect(activityChartSymbol('lighter', 'perpetual', 'STRK-USDC', catalog)).toBe('STRK-USDC-USDC')
    expect(activityChartSymbol('lighter', 'perpetual', 'GRAM-USDC', catalog)).toBeUndefined()
    expect(activityChartSymbol('hyperliquid', 'perpetual', 'STRK-USDC', catalog)).toBeUndefined()
  })
  test('keeps valid historical runs beside malformed rows', () => {
    const result = parseWorkflowRuns([{ id: 'run', startedAt: 1, status: 'paused', plan: { name: 'Saved plan', accountName: 'old', mode: 'live', input: { venue: 'lighter', symbol: 'GRAM-USDC' } }, states: [{ status: 'waiting-fill', orderId: '14918173922809911' }] }, {}], identity)
    expect(result.items[0].scopeMismatch).toBe(true)
    expect(result.items[0].steps[0].orderId).toBe('14918173922809911')
    expect(result.warnings.length).toBe(1)
  })
  test('rejects account mismatch rather than showing an empty book', () => {
    expect(() => parseOpenOrders({ venue: 'lighter', marketType: 'perpetual', accountName: 'other', connectionRevision: revision, scope: 'all-perpetual-markets', complete: true, orders: [] }, identity, 'lighter', 'perpetual')).toThrow('changed')
  })
  test('preserves exact identifiers and partial coverage', () => {
    const result = parseOpenOrders({ venue: 'lighter', marketType: 'perpetual', accountName: 'desk', connectionRevision: revision, scope: 'all-perpetual-markets', complete: false, error: 'Partial snapshot', orders: [{ exchangeOrderId: '14918173922809911', symbol: 'GRAM-USDC', type: 'TWAP' }] }, identity, 'lighter', 'perpetual')
    expect(result.items[0].id).toBe('14918173922809911')
    expect(result.items[0].name).toBe('TWAP')
    expect(result.warnings).toContain('Partial snapshot')
  })
  test('provider failure is an error, never empty connections', async () => {
    await expect(readActivityIdentity(async () => new Response('Unavailable', { status: 503 }))).rejects.toThrow('503')
  })
})
