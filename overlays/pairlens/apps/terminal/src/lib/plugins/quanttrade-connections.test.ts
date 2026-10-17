import { expect, test } from 'bun:test'
import {
  connectExchange,
  loadConnectedExchanges,
  mergeConnectedCredentials,
} from './quanttrade-connections'

test('restore counts one bridge account per venue while keeping spot and perpetual scopes distinct', () => {
  const local = {
    id: 'old',
    market: 'lighter',
    label: 'Old',
    mode: 'live' as const,
    apiKey: 'reference',
    apiSecret: '',
    createdAt: 1,
  }
  const server = {
    ...local,
    id: 'server:lighter:desk',
    apiKey: '',
    serverManaged: true,
  }
  const spot = {
    ...server,
    id: 'server:lighter-spot:desk',
    market: 'lighter-spot',
  }
  const binance = { ...local, id: 'binance', market: 'binance' }
  const hl = { ...local, id: 'hl', market: 'hyperliquid' }
  expect(
    mergeConnectedCredentials([local, binance, hl], [server, spot]),
  ).toEqual([binance, hl, server, spot])
  expect(mergeConnectedCredentials([local, binance], [])).toEqual([
    local,
    binance,
  ])
})

test('connect sends signing keys once and returns only a safe server reference', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const record = await connectExchange(
    'lighter',
    {
      lighter_perpetual_l1_address: '0xaccount',
      lighter_perpetual_api_key_index: '4',
      lighter_perpetual_api_private_key: 'sensitive-signing-key',
      lighter_perpetual_account_limit: 'Premium',
    },
    'My Lighter',
    async (url, init) => {
      calls.push({ url, init })
      return Response.json(
        url.endsWith('/session')
          ? { ok: true }
          : {
              venue: 'lighter',
              connected: true,
              spotConnected: true,
              mode: 'paper',
              accountName: 'desk',
            },
      )
    },
  )
  expect(calls.map((call) => call.url)).toEqual([
    '/_quanttrade/api/session',
    '/_quanttrade/api/connections',
  ])
  expect(JSON.parse(String(calls[1].init?.body))).toEqual({
    venue: 'lighter',
    credentials: {
      lighter_perpetual_l1_address: '0xaccount',
      lighter_perpetual_api_key_index: 4,
      lighter_perpetual_api_private_key: 'sensitive-signing-key',
      lighter_perpetual_account_limit: 'Premium',
    },
  })
  expect(record).toMatchObject({
    id: 'server:lighter:desk',
    market: 'lighter',
    label: 'My Lighter',
    serverManaged: true,
    mode: 'paper',
    apiKey: '',
    apiSecret: '',
  })
  expect(JSON.stringify(record)).not.toContain('sensitive-signing-key')
})

test('legacy perpetual connection does not create an unverified spot account', async () => {
  const records = await loadConnectedExchanges(async (url) =>
    Response.json(
      url.endsWith('/session')
        ? { ok: true }
        : [
            {
              venue: 'hyperliquid',
              connected: true,
              spotConnected: false,
              mode: 'live',
              accountName: 'desk',
            },
          ],
    ),
  )
  expect(records.map((record) => record.market)).toEqual(['hyperliquid'])
  expect(records[0].spotConnected).toBe(false)
})

test('rejects invalid key index before sending keys', async () => {
  let calls = 0
  await expect(
    connectExchange(
      'lighter',
      { lighter_perpetual_api_key_index: '3.5' },
      'Lighter',
      async () => {
        calls++
        return Response.json({})
      },
    ),
  ).rejects.toThrow('API key index')
  expect(calls).toBe(0)
})

test('verification timeout tells the user to reconcile connection status before retrying', async () => {
  await expect(
    connectExchange('hyperliquid', {}, 'HL', async (url) => {
      if (url.endsWith('/session')) return Response.json({ ok: true })
      throw new DOMException('Timed out', 'TimeoutError')
    }),
  ).rejects.toThrow('Refresh Accounts to check status before trying again')
})

test('restores only connected server accounts and rejects mismatched venue responses', async () => {
  const records = await loadConnectedExchanges(async (url) =>
    Response.json(
      url.endsWith('/session')
        ? { ok: true }
        : [
            {
              venue: 'lighter',
              connected: true,
              spotConnected: true,
              mode: 'paper',
              accountName: 'desk',
            },
            {
              venue: 'hyperliquid',
              connected: false,
              mode: 'paper',
              accountName: 'desk',
            },
          ],
    ),
  )
  expect(records.map((record) => record.market)).toEqual([
    'lighter',
    'lighter-spot',
  ])
  await expect(
    connectExchange('hyperliquid', {}, 'HL', async (url) =>
      Response.json(
        url.endsWith('/session')
          ? { ok: true }
          : {
              venue: 'lighter',
              connected: true,
              mode: 'paper',
              accountName: 'desk',
            },
      ),
    ),
  ).rejects.toThrow('different exchange')
})
