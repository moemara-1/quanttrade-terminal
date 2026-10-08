import { describe, expect, test } from 'bun:test'
import {
  HostedSyncCoordinator,
  isHostedSyncKey,
  isHostedSyncOrigin,
} from '../hosted-sync'

function storage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  }
}
const response = (
  entries: Record<string, { value: unknown; updatedAt: number }>,
) => Response.json({ entries })

describe('private hosted presentation sync', () => {
  test('hosted sync excludes local development and nonsecure origins', () => {
    expect(isHostedSyncOrigin('https:', 'quanttrade.azurestore.shop')).toBe(
      true,
    )
    for (const hostname of [
      'localhost',
      '127.0.0.1',
      '[::1]',
      'preview.localhost',
    ])
      expect(isHostedSyncOrigin('https:', hostname)).toBe(false)
    expect(isHostedSyncOrigin('http:', 'quanttrade.azurestore.shop')).toBe(
      false,
    )
  })
  test('only supports presentation keys, never credentials, trust or automation', () => {
    for (const key of [
      'terminal.market',
      'terminal.drawings',
      'terminal.layout.perp',
      'workspace.desk.layout',
      'workspace-vars:desk',
      'drawing-last-trend',
    ])
      expect(isHostedSyncKey(key)).toBe(true)
    for (const key of [
      'security.lock',
      'pairlens:keychain:x',
      'credentials-store:x',
      'custom-publisher-keys',
      'plugin-registry-settings',
      'trade:swapPresets',
      'assistant.conversations',
      'workflows',
      'notification-rules',
      '__proto__',
      'workspace.a/b.layout',
    ])
      expect(isHostedSyncKey(key)).toBe(false)
  })

  test('initial local data cannot overwrite a newer remote layout', async () => {
    const local = storage()
    local.setItem('pairlens:terminal.layout.perp', JSON.stringify(['old']))
    const remote = {
      'terminal.layout.perp': { value: ['new'], updatedAt: 100 },
    }
    let sent: unknown
    const coordinator = new HostedSyncCoordinator({
      storage: local,
      enabled: () => true,
      request: async (_url, init) => {
        if (init?.body) sent = JSON.parse(String(init.body))
        return response(remote)
      },
    })
    await coordinator.sync()
    expect(JSON.parse(local.getItem('pairlens:terminal.layout.perp')!)).toEqual(
      ['new'],
    )
    expect(sent).toBeUndefined()
    coordinator.destroy()
  })

  test('seeds unstamped initial data without manufacturing a recent timestamp', async () => {
    const local = storage()
    local.setItem('pairlens:terminal.market', '"lighter"')
    let sent: unknown
    const coordinator = new HostedSyncCoordinator({
      storage: local,
      enabled: () => true,
      request: async (_url, init) => {
        if (init?.body) sent = JSON.parse(String(init.body))
        return response({})
      },
    })
    await coordinator.sync()
    expect(sent).toEqual({
      entries: { 'terminal.market': { value: 'lighter', updatedAt: 0 } },
    })
    coordinator.destroy()
  })

  test('paused sync makes no requests', async () => {
    let calls = 0
    const coordinator = new HostedSyncCoordinator({
      storage: storage(),
      enabled: () => false,
      request: async () => {
        calls++
        return response({})
      },
    })
    coordinator.markDirty('terminal.market', 'lighter')
    await coordinator.sync()
    expect(calls).toBe(0)
    coordinator.destroy()
  })

  test('disabled domains neither upload nor hydrate and secrets never upload', async () => {
    const local = storage()
    local.setItem('pairlens:terminal.drawings', '[]')
    local.setItem('pairlens:credentials-store:x', '"secret"')
    let puts = 0
    const coordinator = new HostedSyncCoordinator({
      storage: local,
      enabled: (id) => id === 'preferences',
      request: async (_url, init) => {
        if (init?.method === 'PUT') puts++
        return response({
          'terminal.drawings': { value: ['remote'], updatedAt: 100 },
          'security.lock': { value: false, updatedAt: 100 },
        })
      },
    })
    await coordinator.sync()
    expect(puts).toBe(0)
    expect(local.getItem('pairlens:terminal.drawings')).toBe('[]')
    expect(local.getItem('pairlens:security.lock')).toBeNull()
    coordinator.destroy()
  })

  test('failed upload preserves local edits for retry', async () => {
    const local = storage()
    let failed = true
    const sent: Array<unknown> = []
    const coordinator = new HostedSyncCoordinator({
      storage: local,
      enabled: () => true,
      now: () => 200,
      request: async (_url, init) => {
        if (init?.method === 'PUT') {
          sent.push(JSON.parse(String(init.body)))
          if (failed) return new Response('', { status: 503 })
        }
        return response({})
      },
    })
    coordinator.markDirty('terminal.market', 'lighter')
    await coordinator.sync()
    failed = false
    await coordinator.sync()
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    coordinator.destroy()
  })

  test('pausing while fetch is in flight blocks hydration and upload', async () => {
    const local = storage()
    let enabled = true
    let puts = 0
    const coordinator = new HostedSyncCoordinator({
      storage: local,
      enabled: () => enabled,
      request: async (_url, init) => {
        if (init?.method === 'PUT') puts++
        enabled = false
        return response({
          'terminal.market': { value: 'lighter', updatedAt: 100 },
        })
      },
    })
    await coordinator.sync()
    expect(local.getItem('pairlens:terminal.market')).toBeNull()
    expect(puts).toBe(0)
    coordinator.destroy()
  })
})
