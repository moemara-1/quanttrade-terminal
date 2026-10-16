import { z } from 'zod'
import type { TradeJournalEntry } from './api'

// Device-only manual records. These are neither exchange fills nor a PnL ledger,
// and this key intentionally does not participate in the cloud-sync bus.
export const DEVICE_TRADE_JOURNAL_KEY = 'quanttrade:device-trade-journal:v1'
const inputSchema = z.object({
  market: z.string().trim().min(1).max(100),
  pairKey: z.string().trim().min(1).max(200),
  side: z.enum(['buy', 'sell']),
  price: z.number().finite().positive(),
  quantity: z.number().finite().positive(),
  notes: z.string().max(10000).nullable().optional(),
  tags: z.array(z.string().max(100)).max(100).nullable().optional(),
})
const entrySchema = inputSchema.extend({
  id: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
})
const entriesSchema = z.array(entrySchema).max(2000)
type JournalStorage = Pick<Storage, 'getItem' | 'setItem'>
type JournalFilter = { market?: string; pairKey?: string; limit?: number }

export function createDeviceTradeJournal(
  getStorage: () => JournalStorage = () => localStorage,
) {
  function all(): Array<TradeJournalEntry> {
    try {
      const raw = getStorage().getItem(DEVICE_TRADE_JOURNAL_KEY)
      return raw === null ? [] : entriesSchema.parse(JSON.parse(raw))
    } catch {
      throw new Error(
        'The device trade journal could not be read. Its records are unavailable, not empty. Existing data was not replaced.',
      )
    }
  }
  return {
    read(params: JournalFilter = {}): Array<TradeJournalEntry> {
      const limit = z
        .number()
        .int()
        .min(1)
        .max(200)
        .parse(params.limit ?? 50)
      return all()
        .filter(
          (entry) =>
            (!params.market || entry.market === params.market) &&
            (!params.pairKey ||
              entry.pairKey.toUpperCase() === params.pairKey.toUpperCase()),
        )
        .slice(0, limit)
    },
    add(input: z.input<typeof inputSchema>): TradeJournalEntry {
      const valid = inputSchema.parse(input)
      const entries = all()
      if (entries.length >= 2000)
        throw new Error(
          'The device trade journal is full; this entry was not saved.',
        )
      const entry = { ...valid, id: crypto.randomUUID(), createdAt: Date.now() }
      const raw = JSON.stringify([entry, ...entries])
      try {
        const storage = getStorage()
        storage.setItem(DEVICE_TRADE_JOURNAL_KEY, raw)
        if (storage.getItem(DEVICE_TRADE_JOURNAL_KEY) !== raw)
          throw new Error('Storage did not retain the entry')
      } catch {
        throw new Error(
          'The trade journal entry was not saved on this device. Browser storage is unavailable or full.',
        )
      }
      return entry
    },
  }
}

export const deviceTradeJournal = createDeviceTradeJournal()
