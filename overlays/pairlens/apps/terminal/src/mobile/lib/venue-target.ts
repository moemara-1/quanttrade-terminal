// Copyright (c) 2026 Juan Ignacio Molina Estrada
// SPDX-License-Identifier: FSL-1.1-Apache-2.0
import type { MarketRef } from '@pairlens/shared/market-ref'
import { venueTargetFor } from '@/lib/venue-switch'

export function mobileVenueTarget(
  ref: MarketRef,
  market: string,
  venueClasses: ReadonlyArray<string>,
  resolvedRef?: MarketRef | null,
): MarketRef | null {
  const target = venueTargetFor({ ref, market, venueClasses, resolvedRef })
  return target.kind === 'same'
    ? ref
    : target.kind === 'unavailable'
      ? null
      : target.ref
}
