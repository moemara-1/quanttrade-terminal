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

/** Stable across quote ticks; changes only when this pane's chart target changes. */
export function paneRecoveryKey(target: {
  paneId: string
  paneType: string
  pair: { pairKey: string; market: string } | null
  timeframe?: string
}): string {
  return JSON.stringify([
    target.paneId,
    target.paneType,
    target.pair ? paneInstrumentRef(target.pair) : null,
    target.timeframe ?? null,
  ])
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

/** An assistant's explicit switch targets the pane being driven, not a hidden board pin. */
export function writePaneInstrument(
  ref: MarketRef,
  owner: {
    pairSource: 'override' | 'variable' | 'global' | null
    setPaneOverride: (slot: string, value: unknown) => void
    setVariableValue: (value: unknown) => void
  } | null,
): boolean {
  const value = { pairKey: ref.id, market: ref.market }
  if (owner?.pairSource === 'override')
    owner.setPaneOverride('active-pair', value)
  else if (owner?.pairSource === 'variable') owner.setVariableValue(value)
  else return false // The route owns a following chart; leave navigation to the caller.
  return true
}

/** A new binding must never relabel the previous engine's candles. */
export function chartSnapshotReady(input: {
  hasSnapshot: boolean
  noData: boolean
  pair: string
  timeframe: string
  enginePair: string | undefined
  engineTimeframe: string | undefined
}): boolean {
  return (
    input.hasSnapshot &&
    !input.noData &&
    input.enginePair === input.pair &&
    input.engineTimeframe === input.timeframe
  )
}
