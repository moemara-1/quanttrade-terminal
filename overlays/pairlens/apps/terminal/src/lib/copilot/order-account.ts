import { credentialMarketFor } from '@/lib/venues/credential-alias'

/** Never silently choose the first live account for a reviewed AI order. */
export function assistantOrderAccount<T extends { market: string; mode: string }>(
  credentials: ReadonlyArray<T>,
  market: string,
  mode: 'paper' | 'live',
): T | undefined {
  const matches = credentials.filter(
    (credential) =>
      credential.market === credentialMarketFor(market) &&
      credential.mode === mode,
  )
  if (mode === 'live' && matches.length > 1)
    throw new Error(
      'Multiple live accounts are connected for this exchange. Use the manual ticket to select the account; this AI order has not been submitted.',
    )
  return matches[0]
}
