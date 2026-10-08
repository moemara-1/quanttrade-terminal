// Copyright (c) 2026 Juan Ignacio Molina Estrada
// SPDX-License-Identifier: FSL-1.1-Apache-2.0
import { useQueries } from '@tanstack/react-query'
import { z } from 'zod'
import { readCachedVenueListings } from '@pairlens/plugins/ccxt-connector'
import { readCachedFuturesListings } from '@pairlens/plugins/ccxt-futures-connector'
import {
  marketServesClass,
  normalizeInstrumentClass,
} from '@pairlens/shared/market-ref'
import type { MarketRef } from '@pairlens/shared/market-ref'

import type { MarketOption } from '@/hooks/use-available-markets'
import { useMarketData } from '@/lib/market-data-provider'
import { usePairlens } from '@/lib/pairlens-provider'
import {
  isQuantTradeVenue,
  loadVenueCatalog,
  resolveVenueInstrument,
} from '@/lib/venue-instrument'
import { sameAssetInClass } from '@/lib/market-ref/cross-class'

const rowSchema = z.object({
  market: z.string(),
  symbol: z.string(),
  base: z.string(),
  quote: z.string(),
  kind: z.string(),
  settle: z.string().optional(),
  contract: z.string().optional(),
  linear: z.boolean().optional(),
})
export type VenueInstrumentTarget = {
  status: 'checking' | 'listed' | 'unavailable' | 'unknown'
  ref: MarketRef | null
}

/** Resolve bridge switches against real public listings, sharing catalog requests across pickers. */
export function useVenueInstrumentTargets(
  ref: MarketRef | null,
  options: ReadonlyArray<MarketOption>,
): Record<string, VenueInstrumentTarget> {
  const { pluginManager, pluginStateVersion } = usePairlens()
  const { probeVenueHistory } = useMarketData()
  const targets = options.filter((option) =>
    Boolean(
      ref &&
      (ref.cls === 'spot' || ref.cls === 'perp') &&
      option.assetClasses.some(
        (value) => value === 'crypto-spot' || value === 'crypto-perp',
      ) &&
      option.value !== ref.market &&
      (isQuantTradeVenue(ref.market) || isQuantTradeVenue(option.value)),
    ),
  )
  const queries = useQueries({
    queries: targets.map((option) => ({
      queryKey: [
        'venue-switch-catalog',
        option.value,
        pluginStateVersion,
        isQuantTradeVenue(option.value) ? '' : ref?.id,
      ],
      staleTime: 60_000,
      retry: 1,
      queryFn: async () => {
        if (isQuantTradeVenue(option.value)) {
          const plugin = pluginManager
            .getActivePlugins()
            .find((candidate) =>
              candidate.manifest.capabilities.some(
                (cap) =>
                  cap.id === 'market-data:discovery' &&
                  cap.markets.includes(option.value),
              ),
            )
          if (!plugin) throw new Error('Venue connector unavailable')
          const page = await plugin.execute({
            capability: 'market-data:discovery',
            params: { market: option.value, limit: 10_000 },
            context: { ...pluginManager.getContext(), market: option.value },
          })
          return z.object({ items: z.array(rowSchema) }).parse(page).items
        }
        const readTable = async () => {
          const [spot, perps] = await Promise.all([
            readCachedVenueListings([option.value]),
            readCachedFuturesListings(),
          ])
          const table = [
            ...spot.flatMap((venue) =>
              venue.listings.map((row) => ({
                ...row,
                market: venue.venue,
                kind: 'cex-pair',
              })),
            ),
            ...perps
              .filter((venue) => venue.venue === option.value)
              .flatMap((venue) =>
                venue.listings.map((row) => ({
                  ...row,
                  market: venue.venue,
                  kind: 'cex-derivative',
                  contract: 'perp',
                  linear: row.quote === row.settle,
                })),
              ),
          ]
          return table
        }
        return loadVenueCatalog(readTable, async () => {
          if (!ref || option.desktopOnly) return
          let pair = ref.id
          if (!marketServesClass(option.assetClasses, ref.cls)) {
            for (const declared of option.assetClasses) {
              const cls = normalizeInstrumentClass(declared)
              const converted = cls
                ? sameAssetInClass(ref.id, ref.cls, cls)
                : null
              if (converted) {
                pair = converted
                break
              }
            }
          }
          await probeVenueHistory(option.value, pair, '1h', 1)
        })
      },
    })),
  })
  const result: Record<string, VenueInstrumentTarget> = {}
  targets.forEach((option, index) => {
    const query = queries[index]
    if (!ref || !query) return
    let source = ref
    if (!marketServesClass(option.assetClasses, ref.cls)) {
      const cls = option.assetClasses
        .map(normalizeInstrumentClass)
        .find((value) => value && sameAssetInClass(ref.id, ref.cls, value))
      const id = cls ? sameAssetInClass(ref.id, ref.cls, cls) : null
      if (!cls || !id) {
        result[option.value] = { status: 'unavailable', ref: null }
        return
      }
      source = { ...ref, cls, id }
    }
    if (query.isPending) {
      result[option.value] = { status: 'checking', ref: null }
      return
    }
    if (query.isError) {
      result[option.value] = { status: 'unknown', ref: null }
      return
    }
    const target = resolveVenueInstrument(
      source,
      option.value,
      query.data ?? [],
    )
    result[option.value] = {
      status: target ? 'listed' : 'unavailable',
      ref: target,
    }
  })
  return result
}
