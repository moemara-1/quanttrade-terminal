// Copyright (c) 2026 Juan Ignacio Molina Estrada
// SPDX-License-Identifier: FSL-1.1-Apache-2.0
import type { MarketRef } from '@pairlens/shared/market-ref'
import { isPerpPairKey } from '@/lib/pairs'

/** Native perpetual APIs also accept two-part symbols; venue identity determines their class. */
export function paneInstrumentRef(pair: {
  pairKey: string
  market: string
}): MarketRef {
  const nativePerp = pair.market === 'lighter' || pair.market === 'hyperliquid'
  const parts = pair.pairKey.split('-')
  return {
    cls: nativePerp || isPerpPairKey(pair.pairKey) ? 'perp' : 'spot',
    market: pair.market,
    id:
      nativePerp && parts.length === 2 && parts.every(Boolean)
        ? `${pair.pairKey}-${parts[1]}`
        : pair.pairKey,
  }
}
/** Following the board removes every pair owner local to this pane. */
export function followBoard(pane: {
  clearPaneOverride: (slot: string) => void
  clearPaneBinding: (slot: string) => void
}) {
  pane.clearPaneOverride('active-pair')
  pane.clearPaneBinding('active-pair')
}
/** A separate timeframe provider must still use the resolved pair's own venue. */
export function paneStreamMarket(pair: { market: string }): string {
  return pair.market
}

export function writePaneTimeframe(
  value: string,
  owner: {
    override?: string
    variable?: string
    setOverride: (value: string) => void
    setVariable: (name: string, value: string) => void
  },
): void {
  if (owner.override) owner.setOverride(value)
  else if (owner.variable) owner.setVariable(owner.variable, value)
}
