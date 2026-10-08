import { expect, test } from 'bun:test'
import {
  createQuantTradeConnector,
  quantTradeManifest,
} from './quanttrade-connectors'
import { CREDENTIAL_SCHEMAS } from '@/stores/credentials-store'

test('exchange wizard asks for actual per-venue credentials and offers manual live trading', () => {
  expect(CREDENTIAL_SCHEMAS.hyperliquid.label).toBe('Hyperliquid')
  expect(
    CREDENTIAL_SCHEMAS.hyperliquid.fields.map((field) => field.key),
  ).toEqual([
    'hyperliquid_perpetual_address',
    'hyperliquid_perpetual_secret_key',
  ])
  expect(CREDENTIAL_SCHEMAS.lighter.fields.map((field) => field.key)).toEqual([
    'lighter_perpetual_l1_address',
    'lighter_perpetual_api_key_index',
    'lighter_perpetual_api_private_key',
    'lighter_perpetual_account_limit',
  ])
  expect(CREDENTIAL_SCHEMAS.lighter.modes).toEqual(['paper', 'live'])
})

test('server-managed slots approve through cookie without a persisted token', async () => {
  let options: RequestInit | undefined
  const connector = createQuantTradeConnector(
    quantTradeManifest('lighter'),
    async (_url, init) => {
      options = init
      return Response.json([])
    },
  )
  await connector.initialize?.({
    credentialId: 'server:lighter:desk',
    mode: 'paper',
    serverManaged: true,
  })
  await connector.execute({
    capability: 'trading:orders',
    params: { credentialId: 'server:lighter:desk', action: 'list' },
    context: {
      pair: 'BTC-USDC-USDC',
      market: 'lighter',
      timeframe: '1h',
      mode: 'paper',
      country: 'DE',
    },
  })
  expect(options?.credentials).toBe('same-origin')
  expect(options?.headers).toEqual({})
})

test('connected paper accounts read actual exchange collateral without reporting real positions as paper', async () => {
  const paths: Array<string> = []
  const connector = createQuantTradeConnector(
    quantTradeManifest('lighter'),
    async (url) => {
      paths.push(url)
      return Response.json([
        { currency: 'USDC', total: '100', available: '75', frozen: '25' },
      ])
    },
  )
  await connector.initialize?.({
    credentialId: 'server:lighter:desk',
    mode: 'paper',
    serverManaged: true,
  })
  const request = {
    params: { credentialId: 'server:lighter:desk' },
    context: {
      pair: 'BTC-USDC-USDC',
      market: 'lighter',
      timeframe: '1h',
      mode: 'paper' as const,
      country: 'DE',
    },
  }
  expect(
    await connector.execute({ ...request, capability: 'trading:balances' }),
  ).toEqual([{ currency: 'USDC', total: '100', available: '75', frozen: '25' }])
  expect(paths).toEqual(['/_quanttrade/api/connections/lighter/balances?marketType=perpetual'])
  expect(
    await connector.execute({ ...request, capability: 'trading:positions' }),
  ).toEqual([])
})
