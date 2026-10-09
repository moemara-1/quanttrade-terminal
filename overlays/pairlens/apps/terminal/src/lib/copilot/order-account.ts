import { credentialMarketFor } from '@/lib/venues/credential-alias'
import { CREDENTIAL_SCHEMAS } from '@/stores/credentials-store'

export function requiresExchangeAccount(market: string): boolean {
  return credentialMarketFor(market) in CREDENTIAL_SCHEMAS
}

/** Never silently choose the first live account for a reviewed AI order. */
export function assistantOrderAccount<
  T extends { id: string; market: string; mode: string },
>(
  credentials: ReadonlyArray<T>,
  market: string,
  mode: 'paper' | 'live',
  credentialId?: string,
): T | undefined {
  if (credentialId) {
    const exact = credentials.find(
      (credential) => credential.id === credentialId,
    )
    if (
      !exact ||
      exact.market !== credentialMarketFor(market) ||
      exact.mode !== mode
    )
      throw new Error(
        'The reviewed exchange account is no longer connected in the reviewed mode. Ask the assistant to prepare a fresh proposal.',
      )
    return exact
  }
  const matches = credentials.filter(
    (credential) =>
      credential.market === credentialMarketFor(market) &&
      credential.mode === mode,
  )
  if (mode === 'live' && matches.length > 1)
    throw new Error(
      'Multiple live accounts are connected for this exchange. Ask which account to use and prepare a proposal with its credentialId. Nothing has been submitted.',
    )
  return matches[0]
}
