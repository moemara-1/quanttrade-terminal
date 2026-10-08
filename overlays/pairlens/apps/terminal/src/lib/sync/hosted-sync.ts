import { useSyncExternalStore } from 'react'
import { z } from 'zod'

import { emitHydrate, onWrite } from './sync-channel'
import { TIER1_KEYS, domainForSyncKey, isBlocked } from './sync-domains'
import {
  isDomainSyncEnabled,
  subscribeCloudSyncPreferences,
} from './sync-preferences'
import type { SyncDomainId } from './sync-domains'
import type { SyncStatus } from './sync-coordinator'
import { quantTradeFetch } from '@/lib/plugins/quanttrade-session'
import { isHosted } from '@/lib/platform'
import { hasAppServer } from '@/lib/auth-client'

export function isHostedSyncOrigin(
  protocol: string,
  hostname: string,
): boolean {
  return (
    protocol === 'https:' &&
    hostname !== 'localhost' &&
    hostname !== '127.0.0.1' &&
    hostname !== '[::1]' &&
    !hostname.endsWith('.localhost')
  )
}

export const hasHostedSync =
  isHosted &&
  !hasAppServer &&
  typeof window !== 'undefined' &&
  isHostedSyncOrigin(window.location.protocol, window.location.hostname)
export const HOSTED_SYNC_DOMAINS = new Set<SyncDomainId>([
  'preferences',
  'charts',
  'workspaces',
])
const excluded = new Set([
  'plugin-registry-settings',
  'trade:swapPresets',
  'trade:swapPresetActive',
])
const extra = new Set([
  'hosted.watchlists',
  'terminal.indicators',
  'terminal.drawings',
  'custom-workspaces',
  'terminal.layout',
  'discovery.layout',
])
const family =
  /^(?:drawing-last-[\w.-]+|terminal\.(?:chartType|layout)\.[\w-]+|discovery\.layout\.[\w-]+|workspace\.[\w-]+\.layout|workspace-vars:[\w-]+|pair-picker\.assetClass\.[\w-]+)$/

/** The server enforces this same allowlist; unknown keys are never transported. */
export function isHostedSyncKey(key: string): boolean {
  const domain = domainForSyncKey(key)
  return (
    key.length <= 160 &&
    !isBlocked(key) &&
    !excluded.has(key) &&
    domain !== null &&
    HOSTED_SYNC_DOMAINS.has(domain) &&
    (TIER1_KEYS.has(key) || extra.has(key) || family.test(key))
  )
}

const payloadSchema = z.object({
  entries: z.record(
    z.string(),
    z
      .object({ value: z.unknown(), updatedAt: z.number().int().nonnegative() })
      .transform((entry) => ({
        value: entry.value,
        updatedAt: entry.updatedAt,
      })),
  ),
})
type Entry = { value: unknown; updatedAt: number }
type Entries = Record<string, Entry>
const prefix = 'pairlens:'
const stampPrefix = 'pairlens:sync-ts:'
let status: SyncStatus = 'idle'
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const snapshot = () => status
const serverSnapshot = (): SyncStatus => 'idle'
export function useHostedSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}
function publish(next: SyncStatus) {
  status = next
  for (const listener of listeners) listener()
}

type Options = {
  storage?: Storage
  request?: typeof quantTradeFetch
  enabled?: (id: SyncDomainId) => boolean
  now?: () => number
}

/** Syncs presentation settings only. Trading credentials and automation stay local. */
export class HostedSyncCoordinator {
  private readonly storage: Storage
  private readonly request: typeof quantTradeFetch
  private readonly enabled: (id: SyncDomainId) => boolean
  private readonly now: () => number
  private readonly dirty = new Map<string, Entry>()
  private busy = false
  private stopped = false
  private debounce: ReturnType<typeof setTimeout> | undefined
  private poll: ReturnType<typeof setInterval> | undefined
  private disposers: Array<() => void> = []

  constructor(options: Options = {}) {
    this.storage = options.storage ?? localStorage
    this.request = options.request ?? quantTradeFetch
    this.enabled = options.enabled ?? isDomainSyncEnabled
    this.now = options.now ?? Date.now
  }

  start(): void {
    this.disposers.push(onWrite((key, value) => this.markDirty(key, value)))
    this.disposers.push(
      subscribeCloudSyncPreferences(() => {
        void this.sync()
      }),
    )
    this.poll = setInterval(() => {
      void this.sync()
    }, 30000)
    if (typeof window !== 'undefined') {
      const focus = () => {
        void this.sync()
      }
      window.addEventListener('focus', focus)
      this.disposers.push(() => window.removeEventListener('focus', focus))
    }
    void this.sync()
  }

  private allowed(key: string): boolean {
    const domain = domainForSyncKey(key)
    return isHostedSyncKey(key) && domain !== null && this.enabled(domain)
  }

  markDirty(key: string, value: unknown): void {
    if (!isHostedSyncKey(key) || this.stopped) return
    const updatedAt = Math.max(
      this.now(),
      (Number(this.storage.getItem(stampPrefix + key)) || 0) + 1,
    )
    this.storage.setItem(stampPrefix + key, String(updatedAt))
    this.dirty.set(key, { value, updatedAt })
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      void this.sync()
    }, 500)
  }

  private localEntries(): Entries {
    const entries: Entries = {}
    for (let i = 0; i < this.storage.length; i++) {
      const storedKey = this.storage.key(i)
      if (!storedKey?.startsWith(prefix) || storedKey.startsWith(stampPrefix))
        continue
      const key = storedKey.slice(prefix.length)
      if (!this.allowed(key)) continue
      const raw = this.storage.getItem(storedKey)
      if (raw === null) continue
      try {
        // Unstamped initial data is older than any server edit, but is seeded
        // when the server has no copy. Never stamp it as a new edit on login.
        entries[key] = {
          value: JSON.parse(raw),
          updatedAt: Number(this.storage.getItem(stampPrefix + key)) || 0,
        }
      } catch {
        publish('error')
      }
    }
    for (const [key, entry] of this.dirty)
      if (this.allowed(key)) entries[key] = entry
    return entries
  }

  private apply(entries: Entries): void {
    for (const [key, entry] of Object.entries(entries)) {
      if (!this.allowed(key) || this.stopped) continue
      const pending = this.dirty.get(key)
      const localTime = Number(this.storage.getItem(stampPrefix + key)) || 0
      if (
        (this.storage.getItem(prefix + key) === null ||
          entry.updatedAt > localTime) &&
        (!pending || entry.updatedAt > pending.updatedAt)
      ) {
        this.storage.setItem(prefix + key, JSON.stringify(entry.value))
        this.storage.setItem(stampPrefix + key, String(entry.updatedAt))
        emitHydrate(key, entry.value)
      }
      if (pending && entry.updatedAt >= pending.updatedAt)
        this.dirty.delete(key)
    }
  }

  async sync(): Promise<void> {
    if (this.busy || this.stopped) return
    if (![...HOSTED_SYNC_DOMAINS].some(this.enabled)) {
      publish('idle')
      return
    }
    this.busy = true
    publish('syncing')
    try {
      const response = await this.request('/_quanttrade/api/sync-state', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) throw new Error(`Sync HTTP ${response.status}`)
      const remote = payloadSchema.parse(await response.json()).entries
      this.apply(remote)
      if (this.stopped) return
      const entries = Object.fromEntries(
        Object.entries(this.localEntries()).filter(
          ([key, entry]) =>
            !remote[key] || entry.updatedAt > remote[key].updatedAt,
        ),
      )
      if (Object.keys(entries).length) {
        const pushed = await this.request('/_quanttrade/api/sync-state', {
          method: 'PUT',
          credentials: 'same-origin',
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries }),
        })
        if (!pushed.ok) throw new Error(`Sync HTTP ${pushed.status}`)
        this.apply(payloadSchema.parse(await pushed.json()).entries)
      }
      if (!this.stopped) publish('synced')
    } catch {
      if (!this.stopped) publish('error')
    } finally {
      this.busy = false
    }
  }

  destroy(): void {
    this.stopped = true
    if (this.debounce) clearTimeout(this.debounce)
    if (this.poll) clearInterval(this.poll)
    for (const dispose of this.disposers) dispose()
  }
}
