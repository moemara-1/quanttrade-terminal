import { z } from 'zod'
import {
  bridgeRequest,
  connectBrowserSession,
  isQuantTradeVenue,
  quantTradeBaseVenue,
} from './quanttrade-session'
import type { BridgeFetcher, QuantTradeVenue } from './quanttrade-session'
import type { ExchangeCredential } from '@/stores/credentials-store'

const connectionSchema = z.object({
  venue: z.enum(['hyperliquid', 'lighter']),
  connected: z.boolean(),
  spotConnected: z.boolean().optional(),
  mode: z.enum(['paper', 'live']),
  accountName: z.string().min(1),
})

/** Legacy operator references reach the same bridge account as the hosted record.
 * Keep saved vault entries intact, but provision only the canonical connection.
 * Spot and perpetual records in `connected` remain separate balance scopes.
 */
export function mergeConnectedCredentials(
  stored: Array<ExchangeCredential>,
  connected: Array<ExchangeCredential>,
): Array<ExchangeCredential> {
  const hostedVenues = new Set(
    connected.flatMap((credential) =>
      credential.serverManaged && isQuantTradeVenue(credential.market)
        ? [quantTradeBaseVenue(credential.market)]
        : [],
    ),
  )
  return [
    ...stored.filter(
      (credential) =>
        !credential.serverManaged &&
        (!isQuantTradeVenue(credential.market) ||
          !hostedVenues.has(quantTradeBaseVenue(credential.market))),
    ),
    ...connected,
  ]
}

function connectionRecord(
  connection: z.infer<typeof connectionSchema>,
  label?: string,
): ExchangeCredential {
  return {
    id: `server:${connection.venue}:${connection.accountName}`,
    market: connection.venue,
    label:
      label ||
      `${connection.venue === 'lighter' ? 'Lighter' : 'Hyperliquid'} ${connection.mode}`,
    mode: connection.mode,
    serverManaged: true,
    spotConnected: connection.spotConnected === true,
    apiKey: '',
    apiSecret: '',
    createdAt: Date.now(),
  }
}

export async function connectExchange(
  venue: QuantTradeVenue,
  fields: Record<string, string>,
  label: string,
  fetcher?: BridgeFetcher,
  mode?: 'paper' | 'live',
): Promise<ExchangeCredential> {
  venue = quantTradeBaseVenue(venue)
  let credentials: Record<string, string | number | boolean>
  if (venue === 'lighter') {
    const index = fields.lighter_perpetual_api_key_index?.trim() ?? ''
    if (
      !/^\d+$/.test(index) ||
      !Number.isSafeInteger(Number(index)) ||
      Number(index) < 4 ||
      Number(index) > 254
    )
      throw new Error('API key index must be a whole number from 4 to 254')
    credentials = {
      lighter_perpetual_l1_address:
        fields.lighter_perpetual_l1_address?.trim() ?? '',
      lighter_perpetual_api_key_index: Number(index),
      lighter_perpetual_api_private_key:
        fields.lighter_perpetual_api_private_key?.trim() ?? '',
      lighter_perpetual_account_limit:
        fields.lighter_perpetual_account_limit || 'Standard',
    }
  } else {
    credentials = {
      hyperliquid_perpetual_address:
        fields.hyperliquid_perpetual_address?.trim() ?? '',
      hyperliquid_perpetual_secret_key:
        fields.hyperliquid_perpetual_secret_key?.trim() ?? '',
      hyperliquid_perpetual_mode: 'api_wallet',
      use_vault: false,
    }
  }
  await connectBrowserSession(fetcher)
  const connection = connectionSchema.parse(
    await bridgeRequest(
      '/connections',
      { venue, credentials, ...(mode ? { mode } : {}) },
      fetcher,
    ),
  )
  if (connection.venue !== venue)
    throw new Error('Server returned a different exchange')
  if (!connection.connected)
    throw new Error('Exchange connection was not verified')
  return connectionRecord(connection, label)
}

export async function loadConnectedExchanges(
  fetcher?: BridgeFetcher,
): Promise<Array<ExchangeCredential>> {
  await connectBrowserSession(fetcher)
  const connections = connectionSchema
    .array()
    .parse(await bridgeRequest('/connections', undefined, fetcher))
  return connections
    .filter((connection) => connection.connected)
    .flatMap((connection) => {
      const credential = connectionRecord(connection)
      return connection.spotConnected
        ? [credential, spotCredential(credential)]
        : [credential]
    })
}

export function spotCredential(
  credential: ExchangeCredential,
): ExchangeCredential {
  if (!isQuantTradeVenue(credential.market))
    throw new Error('Unknown server exchange')
  const venue = quantTradeBaseVenue(credential.market)
  return {
    ...credential,
    id: credential.id.replace(`server:${venue}:`, `server:${venue}-spot:`),
    market: `${venue}-spot`,
  }
}

export async function disconnectExchange(
  venue: QuantTradeVenue,
): Promise<void> {
  await connectBrowserSession()
  await bridgeRequest(
    `/connections/${quantTradeBaseVenue(venue)}`,
    undefined,
    undefined,
    'DELETE',
  )
}
