// Copyright (c) 2026 Juan Ignacio Molina Estrada
// SPDX-License-Identifier: FSL-1.1-Apache-2.0
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
