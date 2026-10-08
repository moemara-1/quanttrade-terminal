/** These locally bridged venues require a fresh human confirmation per order. */
export function requiresAttendedTrading(market: string): boolean {
  return [
    'hyperliquid',
    'lighter',
    'hyperliquid-spot',
    'lighter-spot',
  ].includes(market.toLowerCase())
}

export function assertAttendedTrading(market: string, attended: boolean): void {
  if (requiresAttendedTrading(market) && !attended) {
    throw new Error(
      'This venue requires human confirmation for every order. Automated execution is disabled.',
    )
  }
}
