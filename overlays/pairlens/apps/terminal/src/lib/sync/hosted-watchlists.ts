import { z } from 'zod'

import { emitWrite, onHydrate } from './sync-channel'
import { useWatchlistsStore } from '@/stores/watchlists-store'

export const HOSTED_WATCHLISTS_KEY = 'hosted.watchlists'
const storageKey = `pairlens:${HOSTED_WATCHLISTS_KEY}`
export const hostedWatchlistsSchema = z
  .object({
    activeListId: z.string().min(1).max(128),
    lists: z
      .array(
        z.object({
          id: z.string().min(1).max(128),
          name: z.string().min(1).max(200),
          symbols: z.array(z.string().min(1).max(512)).max(5000),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine(
    (state) => state.lists.some((list) => list.id === state.activeListId),
    'Active watchlist must exist',
  )
  .refine(
    (state) =>
      new Set(state.lists.map((list) => list.id)).size === state.lists.length,
    'Watchlist ids must be unique',
  )

/** Bridges the existing persistence-backed watchlist store, without syncing credentials. */
export function bindHostedWatchlists(
  storage: Storage = localStorage,
): () => void {
  let hydrating = false
  let initialized = false
  let previous: string | undefined
  let pending: unknown
  const hydrate = (value: unknown) => {
    const parsed = hostedWatchlistsSchema.safeParse(value)
    if (!parsed.success) return
    const current = useWatchlistsStore.getState()
    if (!current.loaded || !current._persistence) {
      pending = value
      return
    }
    hydrating = true
    previous = JSON.stringify(parsed.data)
    storage.setItem(storageKey, previous)
    try {
      current.hydrateFromHostedSync(parsed.data)
    } finally {
      hydrating = false
    }
  }
  const observe = () => {
    const current = useWatchlistsStore.getState()
    if (!current.loaded || !current._persistence || hydrating) return
    if (!initialized) {
      initialized = true
      if (pending !== undefined) {
        hydrate(pending)
        pending = undefined
      } else {
        const raw = storage.getItem(storageKey)
        if (raw !== null) {
          try {
            hydrate(JSON.parse(raw))
          } catch (error) {
            console.warn(
              '[hosted-sync] Invalid local watchlist snapshot',
              error,
            )
          }
        }
      }
    }
    const parsed = hostedWatchlistsSchema.safeParse(
      useWatchlistsStore.getState().state,
    )
    if (!parsed.success) return
    const serialized = JSON.stringify(parsed.data)
    if (serialized === previous) return
    previous = serialized
    const seeded = storage.getItem(storageKey) === null
    storage.setItem(storageKey, serialized)
    // Initial adapter data is seeded at timestamp zero by the coordinator.
    // Only edits should get a fresh local-write timestamp.
    if (!seeded) emitWrite(HOSTED_WATCHLISTS_KEY, parsed.data)
  }
  const unsubscribe = useWatchlistsStore.subscribe(observe)
  const unhydrate = onHydrate((key, value) => {
    if (key === HOSTED_WATCHLISTS_KEY) hydrate(value)
  })
  observe()
  return () => {
    unsubscribe()
    unhydrate()
  }
}
