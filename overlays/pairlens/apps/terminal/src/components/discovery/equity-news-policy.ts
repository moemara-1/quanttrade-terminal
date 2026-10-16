/** Select the equities wire at the provider, including market-wide headlines. */
export function equityNewsTopics(scope: 'assets' | 'macro' | 'all'): string {
  if (scope === 'macro') return 'economy_macro'
  return scope === 'assets' ? 'financial_markets,earnings' : 'financial_markets'
}
