import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { LocalPersistenceAdapter } from '@pairlens/persistence'
import {
  bindHostedWatchlists,
  hostedWatchlistsSchema,
} from '../hosted-watchlists'
import { emitHydrate, onWrite } from '../sync-channel'
import { useWatchlistsStore } from '@/stores/watchlists-store'

const values = new Map<string, string>()
const storage: Storage = {
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
const seed = {
  activeListId: 'favorites',
  lists: [
    { id: 'favorites', name: 'Favorites', symbols: ['perp:BTC-USDC-USDC'] },
  ],
}
const remote = {
  activeListId: 'desk',
  lists: [{ id: 'desk', name: 'Desk', symbols: ['perp:PRL-USDC-USDC'] }],
}
let cleanup: Array<() => void> = []
beforeEach(() => {
  values.clear()
  useWatchlistsStore.getState().dispose()
})
afterEach(() => {
  for (const dispose of cleanup) dispose()
  cleanup = []
  useWatchlistsStore.getState().dispose()
})
async function initialize() {
  const adapter = new LocalPersistenceAdapter()
  await adapter.setWatchlists('hosted-test', seed)
  await useWatchlistsStore.getState().init(adapter, 'hosted-test')
  return adapter
}

describe('hosted watchlist binding', () => {
  test('seeds persisted state without inventing a new local edit', async () => {
    await initialize()
    const writes: Array<unknown> = []
    cleanup.push(
      onWrite((key, value) => {
        if (key === 'hosted.watchlists') writes.push(value)
      }),
    )
    cleanup.push(bindHostedWatchlists(storage))
    expect(JSON.parse(storage.getItem('pairlens:hosted.watchlists')!)).toEqual(
      seed,
    )
    expect(writes).toHaveLength(0)
    useWatchlistsStore.getState().createList('My desk')
    expect(writes).toHaveLength(1)
  })

  test('hydrates derived lookups and adapter persistence without feedback', async () => {
    const adapter = await initialize()
    const writes: Array<unknown> = []
    cleanup.push(bindHostedWatchlists(storage))
    cleanup.push(
      onWrite((key, value) => {
        if (key === 'hosted.watchlists') writes.push(value)
      }),
    )
    emitHydrate('hosted.watchlists', remote)
    expect(useWatchlistsStore.getState().state).toEqual(remote)
    expect(
      useWatchlistsStore.getState().allSymbolsSet.has('PRL-USDC-USDC'),
    ).toBe(true)
    expect(await adapter.getWatchlists('hosted-test')).toEqual(remote)
    expect(writes).toHaveLength(0)
  })

  test('applies a cloud snapshot arriving before adapter loading', async () => {
    cleanup.push(bindHostedWatchlists(storage))
    emitHydrate('hosted.watchlists', remote)
    const adapter = await initialize()
    expect(useWatchlistsStore.getState().state).toEqual(remote)
    expect(await adapter.getWatchlists('hosted-test')).toEqual(remote)
  })

  test('reload restores canonical snapshot instead of old adapter contents', async () => {
    storage.setItem('pairlens:hosted.watchlists', JSON.stringify(remote))
    await initialize()
    cleanup.push(bindHostedWatchlists(storage))
    expect(useWatchlistsStore.getState().state).toEqual(remote)
  })

  test('rejects absent active list, duplicate ids and unbounded snapshots', async () => {
    expect(
      hostedWatchlistsSchema.safeParse({ ...seed, activeListId: 'missing' })
        .success,
    ).toBe(false)
    expect(
      hostedWatchlistsSchema.safeParse({
        ...seed,
        lists: [seed.lists[0], seed.lists[0]],
      }).success,
    ).toBe(false)
    expect(
      hostedWatchlistsSchema.safeParse({
        ...seed,
        lists: [{ ...seed.lists[0], name: 'x'.repeat(201) }],
      }).success,
    ).toBe(false)
    await initialize()
    cleanup.push(bindHostedWatchlists(storage))
    emitHydrate('hosted.watchlists', { activeListId: 'missing', lists: [] })
    expect(useWatchlistsStore.getState().state).toEqual(seed)
  })
})
