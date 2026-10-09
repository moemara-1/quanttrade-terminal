import { afterEach, describe, expect, test } from 'bun:test'
import {
  createQuantTradeConnector,
  quantTradeManifest,
} from './quanttrade-connectors'
import type { PluginExecuteParams } from '@pairlens/plugin-system/types'
import type { InstrumentPage } from '@pairlens/shared/instrument-types'
import { useCredentialsStore } from '@/stores/credentials-store'

const originalCredentials = useCredentialsStore.getState().credentials
afterEach(() => useCredentialsStore.setState({ credentials: originalCredentials }))

test('saved Lighter account reads restore its exact slot before parent provisioning', async () => {
  useCredentialsStore.setState({ credentials: [{
    id: 'server:lighter:desk', market: 'lighter', mode: 'live', label: 'Lighter live',
    serverManaged: true, apiKey: '', apiSecret: '', createdAt: 1,
  }] })
  const paths: Array<string> = []
  const plugin = createQuantTradeConnector(quantTradeManifest('lighter'), async (url) => {
    paths.push(url)
    if (url.endsWith('/account')) return Response.json({ positions: { data: [] } })
    return Response.json([{ currency: 'USDC', available: '512', frozen: '0', total: '512' }])
  })
  expect(await plugin.execute(request('trading:positions', { credentialId: 'server:lighter:desk' }))).toEqual([])
  expect(await plugin.execute(request('trading:balances', { credentialId: 'server:lighter:desk' }))).toEqual([
    { currency: 'USDC', available: '512', frozen: '0', total: '512' },
  ])
  expect(paths).toEqual(['/_quanttrade/api/account', '/_quanttrade/api/connections/lighter/balances?marketType=perpetual'])
  await plugin.destroy?.()
  await expect(plugin.execute(request('trading:balances', { credentialId: 'server:lighter:desk' }))).rejects.toThrow('disabled')
  expect(paths).toHaveLength(2)
})

test('restoration never substitutes another venue, unknown account or missing ID', async () => {
  useCredentialsStore.setState({ credentials: [{
    id: 'server:hyperliquid:desk', market: 'hyperliquid', mode: 'live', label: 'HL live',
    serverManaged: true, apiKey: '', apiSecret: '', createdAt: 1,
  }] })
  let calls = 0
  const plugin = createQuantTradeConnector(quantTradeManifest('lighter'), async () => { calls++; throw new Error('No request allowed') })
  for (const credentialId of ['server:hyperliquid:desk', 'server:lighter:unknown', undefined])
    await expect(plugin.execute(request('trading:balances', { credentialId }))).rejects.toThrow('Connect this exchange')
  expect(calls).toBe(0)
})

const context = {
  pair: 'BTC-USDC-USDC',
  market: 'hyperliquid',
  timeframe: '1h',
  mode: 'paper' as const,
  country: 'DE',
}
const request = (
  capability: PluginExecuteParams['capability'],
  params: Record<string, unknown> = {},
): PluginExecuteParams => ({ capability, params, context })
const market = {
  symbol: 'BTC-USDC',
  base: 'BTC',
  price: '60000',
  change24h: 2,
  volume24h: '1234',
  updatedAt: 123000,
}

describe('QuantTrade native connectors', () => {
  test('both exchanges paginate every contract and search beyond the first page', async () => {
    for (const venue of ['hyperliquid', 'lighter'] as const) {
      const catalog = Array.from({ length: 137 }, (_, i) => ({
        ...market,
        symbol: `PAIR${i}-USDC`,
        base: `PAIR${i}`,
      }))
      const plugin = createQuantTradeConnector(
        quantTradeManifest(venue),
        async () => Response.json(catalog),
      )
      const symbols: Array<string> = []
      for (let offset = 0; offset < catalog.length; offset += 50) {
        const page = (await plugin.execute(
          request('market-data:discovery', { offset, limit: 50 }),
        )) as InstrumentPage
        expect(page.total).toBe(137)
        expect(page.hasMore).toBe(offset + 50 < 137)
        expect(page.items.every((item) => item.market === venue)).toBe(true)
        symbols.push(...page.items.map((item) => item.symbol))
      }
      expect(symbols).toEqual(catalog.map((item) => `${item.symbol}-USDC`))
      expect(new Set(symbols).size).toBe(137)
      const found = (await plugin.execute(
        request('market-data:discovery:search', { query: 'PAIR136' }),
      )) as InstrumentPage
      expect(found.items.map((item) => item.symbol)).toEqual([
        'PAIR136-USDC-USDC',
      ])
    }
  })

  test('history pagination does not repeat candles after the requested boundary', async () => {
    const urls: Array<string> = []
    const plugin = createQuantTradeConnector(
      quantTradeManifest('hyperliquid'),
      async (url) => {
        urls.push(String(url))
        return Response.json([
          { time: 100, open: 1, high: 3, low: 1, close: 2, volume: 5 },
          { time: 200, open: 1, high: 3, low: 1, close: 2, volume: 5 },
        ])
      },
    )
    expect(
      await plugin.execute(
        request('market-data:history', { endTs: 150000, limit: 1 }),
      ),
    ).toMatchObject([{ ts: 100000 }])
    expect(urls[0]).toContain('endTs=150000&limit=1')
    expect(
      await plugin.execute(request('market-data:history', { endTs: 50000 })),
    ).toEqual([])
  })
  test('keeps perpetual identity and candle timestamps distinct from spot', async () => {
    const plugin = createQuantTradeConnector(
      quantTradeManifest('hyperliquid'),
      async (url) =>
        Response.json(
          String(url).includes('/candles')
            ? [{ time: 123, open: 1, high: 3, low: 1, close: 2, volume: 5 }]
            : [market],
        ),
    )
    expect(
      await plugin.execute(request('market-data:discovery')),
    ).toMatchObject({
      items: [
        { kind: 'cex-derivative', symbol: 'BTC-USDC-USDC', settle: 'USDC' },
      ],
    })
    expect(await plugin.execute(request('market-data:history'))).toEqual([
      { ts: 123000, open: 1, high: 3, low: 1, close: 2, volume: 5 },
    ])
  })
  test('fails closed before network when credential is missing or unsafe order features are set', async () => {
    let calls = 0
    const plugin = createQuantTradeConnector(
      quantTradeManifest('hyperliquid'),
      async () => {
        calls++
        return Response.json({})
      },
    )
    await expect(
      plugin.execute(request('trading:orders', { action: 'place' })),
    ).rejects.toThrow('credential')
    await plugin.initialize?.({
      credentialId: 'operator',
      apiKey: 'local-token',
      mode: 'paper',
    })
    for (const unsupported of [
      { extendedHours: true },
      { tgtCcy: 'quote_ccy' },
    ]) {
      await expect(
        plugin.execute(
          request('trading:orders', {
            action: 'place',
            credentialId: 'operator',
            ...unsupported,
          }),
        ),
      ).rejects.toThrow('not supported')
    }
    expect(calls).toBe(0)
  })
  test('preserves exact approved order and idempotency key, and refuses mode mismatch', async () => {
    let submitted: unknown
    const plugin = createQuantTradeConnector(
      quantTradeManifest('lighter'),
      async (url, init) => {
        if (String(url).endsWith('/status'))
          return Response.json({ mode: 'paper' })
        submitted = JSON.parse(String(init?.body))
        expect(new Headers(init?.headers).get('authorization')).toBe(
          'Bearer local-token',
        )
        return Response.json({
          id: 'proposal1',
          status: 'paper-open',
          mode: 'paper',
        })
      },
    )
    await plugin.initialize?.({
      credentialId: 'operator',
      apiKey: 'local-token',
      mode: 'paper',
    })
    const params = {
      action: 'place',
      credentialId: 'operator',
      clientOrderId: 'stable-id',
      mode: 'paper',
      pair: 'BTC-USDC-USDC',
      side: 'buy',
      type: 'limit',
      size: '0.001',
      price: '60000',
    }
    // The native manual ticket selects mode through credentialId and omits mode.
    const { mode: _mode, ...manualTicket } = params
    expect(
      await plugin.execute(request('trading:orders', manualTicket)),
    ).toEqual({
      success: true,
      orderId: 'proposal1',
    })
    expect(submitted).toMatchObject({
      clientOrderId: 'stable-id',
      mode: 'paper',
      order: {
        venue: 'lighter',
        symbol: 'BTC-USDC',
        size: '0.001',
        price: '60000',
      },
    })
    await expect(
      plugin.execute(request('trading:orders', { ...params, mode: 'live' })),
    ).rejects.toThrow('mode')
  })
  test('does not misreport unknown live execution as successful', async () => {
    const plugin = createQuantTradeConnector(
      quantTradeManifest('hyperliquid'),
      async (url) =>
        Response.json(
          String(url).endsWith('/status')
            ? { mode: 'live' }
            : { id: 'p1', status: 'unknown', error: 'Reconcile first' },
        ),
    )
    await plugin.initialize?.({
      credentialId: 'op',
      apiKey: 'token',
      mode: 'live',
    })
    const result = await plugin.execute(
      request('trading:orders', {
        credentialId: 'op',
        action: 'place',
        mode: 'live',
        pair: 'BTC-USDC-USDC',
        side: 'buy',
        type: 'limit',
        size: '1',
        price: '60000',
        clientOrderId: 'id',
      }),
    )
    expect(result).toMatchObject({ success: false, error: 'Reconcile first' })
  })
  test('normalizes live positions and partial fills without inventing missing fields', async () => {
    const plugin = createQuantTradeConnector(
      quantTradeManifest('hyperliquid'),
      async (url) =>
        Response.json(
          String(url).endsWith('/proposals')
            ? [
                {
                  id: 'local',
                  mode: 'live',
                  status: 'submitted',
                  orderId: 'hb1',
                  order: { venue: 'hyperliquid' },
                },
              ]
            : {
                positions: {
                  data: [
                    {
                      connector_name: 'hyperliquid_perpetual',
                      trading_pair: 'BTC-USD',
                      side: 'SHORT',
                      amount: -0.01,
                      entry_price: 60000,
                      unrealized_pnl: null,
                      leverage: null,
                    },
                  ],
                },
                orders: {
                  data: [
                    {
                      order_id: 'hb1',
                      connector_name: 'hyperliquid_perpetual',
                      trading_pair: 'BTC-USD',
                      trade_type: 'BUY',
                      order_type: 'LIMIT',
                      amount: 0.01,
                      price: 60000,
                      status: 'PARTIALLY_FILLED',
                      filled_amount: 0.003,
                      average_fill_price: null,
                      fee_paid: null,
                      fee_currency: null,
                      created_at: '2026-10-05T00:00:00Z',
                      updated_at: '2026-10-05T00:01:00Z',
                    },
                  ],
                },
              },
        ),
    )
    await plugin.initialize?.({
      credentialId: 'op',
      apiKey: 'token',
      mode: 'live',
    })
    const positions = await plugin.execute(
      request('trading:positions', { credentialId: 'op' }),
    )
    expect(positions).toEqual([
      {
        pair: 'BTC-USDC-USDC',
        side: 'short',
        contracts: 0.01,
        contractSize: 1,
        entryPrice: 60000,
      },
    ])
    expect(
      await plugin.execute(
        request('trading:orders', { credentialId: 'op', action: 'list' }),
      ),
    ).toMatchObject({
      open: [
        {
          orderId: 'local',
          pair: 'BTC-USDC-USDC',
          status: 'partially_filled',
          fillSize: '0.003',
          avgPrice: '',
          fee: '',
          feeCcy: '',
        },
      ],
      history: [],
    })
    await expect(
      plugin.execute(
        request('trading:orders', {
          credentialId: 'op',
          action: 'cancel',
          orderId: 'exchange:hb2',
        }),
      ),
    ).rejects.toThrow('outside QuantTrade')
  })
})

test('native reduce-only market close preserves size and attended request key', async () => {
  let body: Record<string, unknown> = {}
  const plugin = createQuantTradeConnector(
    quantTradeManifest('lighter'),
    async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ id: 'close', status: 'submitted', mode: 'live' })
    },
  )
  await plugin.initialize?.({
    credentialId: 'operator',
    apiKey: 'local-token',
    mode: 'live',
  })
  await plugin.execute(
    request('trading:orders', {
      action: 'place',
      credentialId: 'operator',
      clientOrderId: 'close-id',
      pair: 'BTC-USDC-USDC',
      side: 'sell',
      type: 'market',
      size: '0.01',
      reduceOnly: true,
    }),
  )
  expect(body).toMatchObject({
    clientOrderId: 'close-id',
    order: { type: 'market', reduceOnly: true, size: '0.01', side: 'sell' },
  })
  expect((body.order as Record<string, unknown>).price).toBeUndefined()
})

test('spot discovery and orders preserve the actual quote and avoid perpetual aliases', async () => {
  const bodies: Array<Record<string, unknown>> = []
  const plugin = createQuantTradeConnector(
    quantTradeManifest('hyperliquid', 'spot'),
    async (url, init) => {
      if (String(url).includes('/public/markets'))
        return Response.json([
          { ...market, symbol: 'PURR-USDC', base: 'PURR', quote: 'USDC' },
        ])
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ id: 'spot1', status: 'submitted', mode: 'live' })
    },
  )
  await plugin.initialize?.({
    credentialId: 'operator',
    apiKey: 'token',
    mode: 'live',
  })
  const page = (await plugin.execute(
    request('market-data:discovery'),
  )) as InstrumentPage
  expect(page.items[0]).toMatchObject({
    kind: 'cex-pair',
    market: 'hyperliquid-spot',
    symbol: 'PURR-USDC',
    quote: 'USDC',
  })
  await plugin.execute(
    request('trading:orders', {
      action: 'place',
      credentialId: 'operator',
      clientOrderId: 'spot-id',
      pair: 'PURR-USDC',
      side: 'buy',
      type: 'market',
      size: '1',
    }),
  )
  expect(bodies[0]).toMatchObject({
    order: {
      venue: 'hyperliquid',
      marketType: 'spot',
      symbol: 'PURR-USDC',
      type: 'market',
    },
  })
  await expect(
    plugin.execute(
      request('trading:orders', {
        action: 'place',
        credentialId: 'operator',
        reduceOnly: true,
      }),
    ),
  ).rejects.toThrow('Spot orders')
})

test('both venues discover their actual contracts from familiar CEX query formats', async () => {
  for (const venue of ['hyperliquid', 'lighter'] as const) {
    for (const type of ['perpetual', 'spot'] as const) {
      const plugin = createQuantTradeConnector(
        quantTradeManifest(venue, type),
        async () =>
          Response.json([
            market,
            { ...market, symbol: '1000BTC-USDC', base: '1000BTC' },
          ]),
      )
      for (const query of [
        'BTCUSDT',
        'BTC/USDT',
        'BTC USDT',
        'BTC-USDT-USDT',
        'bitcoin',
      ]) {
        const page = (await plugin.execute(
          request('market-data:discovery:search', { query }),
        )) as InstrumentPage
        expect(page.items.map((item) => item.symbol)).toEqual([
          type === 'spot' ? 'BTC-USDC' : 'BTC-USDC-USDC',
        ])
        expect(page.items[0].market).toBe(
          type === 'spot' ? `${venue}-spot` : venue,
        )
      }
      const unrelated = (await plugin.execute(
        request('market-data:discovery:search', { query: 'BTCETH' }),
      )) as InstrumentPage
      expect(unrelated.items).toHaveLength(0)
    }
  }
})
