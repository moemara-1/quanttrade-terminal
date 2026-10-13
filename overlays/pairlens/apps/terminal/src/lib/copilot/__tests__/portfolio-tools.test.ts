import { expect, test } from 'bun:test'
import {
  buildPortfolioTools,
  readTradingAccountSettings,
} from '../portfolio-tools'
import { setCredentialAliases } from '../../venues/credential-alias'
import { recordTradeSubmission } from '../trade-submissions'
import type { AccountSettingsReaders } from '../portfolio-tools'
import type { CopilotToolDeps } from '../tool-deps'
import type { ExchangeCredential } from '@/stores/credentials-store'

test('risk read distinguishes disabled hosted caps from unknown hosted status', async () => {
  const original = globalThis.fetch
  const execute = (
    buildPortfolioTools({} as CopilotToolDeps).get_risk_limits as unknown as {
      execute: (a: unknown, b: unknown) => Promise<Record<string, unknown>>
    }
  ).execute
  try {
    globalThis.fetch = (async () =>
      Response.json({
        accountName: 'desk',
        mode: 'live',
        halted: false,
        executionConfigured: true,
        maxOrderNotional: null,
        dailyNotionalLimit: null,
        dailyNotionalUsed: '9000',
      })) as typeof fetch
    expect(await execute({}, {})).toMatchObject({
      hosted: {
        status: 'available',
        maxOrderNotional: null,
        dailyNotionalLimit: null,
        dailyNotionalUsed: '9000',
      },
    })
    globalThis.fetch = (async () =>
      Response.json({ error: 'Unavailable' }, { status: 503 })) as typeof fetch
    expect(await execute({}, {})).toMatchObject({
      hosted: { status: 'unavailable' },
    })
  } finally {
    globalThis.fetch = original
  }
})

function credential(
  market: string,
  mode: 'paper' | 'live',
  serverManaged = false,
): ExchangeCredential {
  return {
    id: `${serverManaged ? 'server' : 'local'}:${market}:desk`,
    market,
    label: `${market} account`,
    mode,
    serverManaged,
    apiKey: 'must-not-leak-key',
    apiSecret: 'must-not-leak-secret',
    passphrase: 'must-not-leak-passphrase',
    createdAt: 1,
  }
}

function readers(
  overrides: Partial<AccountSettingsReaders> = {},
): AccountSettingsReaders {
  return {
    hasAppServer: false,
    loadHostedAccounts: async () => [credential('lighter', 'live', true)],
    readLocalAccounts: async () => ({ status: 'ready', credentials: [] }),
    getUserConfig: async () => {
      throw new Error('No upstream App Server is configured')
    },
    ...overrides,
  }
}

test('hosted Lighter live account does not need an upstream App Server login', async () => {
  let profileCalls = 0
  const result = await readTradingAccountSettings(
    'lighter',
    readers({
      getUserConfig: async () => {
        profileCalls++
        throw new Error('Signed out of upstream')
      },
    }),
  )
  expect(result.tradingMode).toBe('live')
  expect(result.hostedSession.status).toBe('authenticated')
  expect(result.appServerPreferences.status).toBe('not_configured')
  expect(result.accounts).toEqual([
    {
      credentialId: 'server:lighter:desk',
      market: 'lighter',
      label: 'lighter account',
      mode: 'live',
      source: 'hosted',
    },
  ])
  expect(result.autoApproval).toEqual({ paper: false, liveMarkets: [] })
  expect(result.confirmationRequired).toBe(true)
  expect(profileCalls).toBe(0)
  expect(JSON.stringify(result)).not.toContain('must-not-leak')
  expect(JSON.stringify(result)).not.toContain('Signed out')
})

test('hosted connection failure is unavailable, never paper or a cached live account', async () => {
  const result = await readTradingAccountSettings(
    'lighter',
    readers({
      loadHostedAccounts: async () => {
        throw new Error('Session not available')
      },
      readLocalAccounts: async () => ({
        status: 'ready',
        credentials: [credential('lighter', 'live', true)],
      }),
    }),
  )
  expect(result.tradingMode).toBe('unavailable')
  expect(result.hostedSession.status).toBe('unavailable')
  expect(result.accounts).toEqual([])
  expect(JSON.stringify(result)).not.toContain('Signed out')
})

test('account modes are scoped to the requested venue instead of a global paper lock', async () => {
  const result = await readTradingAccountSettings(
    'lighter',
    readers({
      hasAppServer: true,
      getUserConfig: async () => ({
        tradingMode: 'paper',
        aiPersona: 'mentor',
      }),
      readLocalAccounts: async () => ({
        status: 'ready',
        credentials: [credential('binance', 'paper')],
      }),
    }),
  )
  expect(result.tradingMode).toBe('live')
  expect(result.tradingModeScope).toBe('lighter')
  expect(
    result.accounts.map((account) => [account.market, account.mode]),
  ).toEqual([
    ['binance', 'paper'],
    ['lighter', 'live'],
  ])
  expect(result.appServerPreferences).toEqual({
    status: 'available',
    tradingMode: 'paper',
    aiPersona: 'mentor',
  })
})

test('mixed accounts without a selected venue have per-account modes', async () => {
  const result = await readTradingAccountSettings(
    undefined,
    readers({
      readLocalAccounts: async () => ({
        status: 'ready',
        credentials: [credential('binance', 'paper')],
      }),
    }),
  )
  expect(result.tradingMode).toBe('per-account')
  expect(result.tradingModeScope).toBe('connected-accounts')
})

test('upstream profile errors do not change a saved CEX account mode', async () => {
  setCredentialAliases([['binance-futures', 'binance']])
  try {
    const result = await readTradingAccountSettings(
      'binance-futures',
      readers({
        hasAppServer: true,
        loadHostedAccounts: async () => [],
        readLocalAccounts: async () => ({
          status: 'ready',
          credentials: [credential('binance', 'live')],
        }),
      }),
    )
    expect(result.tradingMode).toBe('live')
    expect(result.appServerPreferences.status).toBe('unavailable')
    expect(result.localCredentials.status).toBe('ready')
  } finally {
    setCredentialAliases([])
  }
})

test('sealed local credentials cannot report a stale account as available', async () => {
  const result = await readTradingAccountSettings(
    'binance',
    readers({
      readLocalAccounts: async () => ({
        status: 'sealed',
        credentials: [credential('binance', 'live')],
      }),
    }),
  )
  expect(result.tradingMode).toBe('unavailable')
  expect(result.localCredentials.status).toBe('sealed')
  expect(result.accounts.map((account) => account.market)).toEqual(['lighter'])
})

test('an unrelated live venue cannot provide the mode for a disconnected exchange', async () => {
  const result = await readTradingAccountSettings('hyperliquid', readers())
  expect(result.tradingMode).toBe('unavailable')
})

test('failed hosted and local reads provide no inferred trading mode or raw error details', async () => {
  const fail = async (): Promise<never> => {
    throw new Error('must-not-leak-access-key')
  }
  const result = await readTradingAccountSettings(
    'lighter',
    readers({ loadHostedAccounts: fail, readLocalAccounts: fail }),
  )
  expect(result.tradingMode).toBe('unavailable')
  expect(result.localCredentials.status).toBe('error')
  expect(JSON.stringify(result)).not.toContain('must-not-leak')
})

async function readSubmissions(clientOrderId: string) {
  const tool = buildPortfolioTools({} as CopilotToolDeps).get_trade_submissions
  return (
    tool as unknown as {
      execute: (a: unknown, b: unknown) => Promise<Record<string, unknown>>
    }
  ).execute({ clientOrderId }, { toolCallId: 'test', messages: [] })
}

test('submission read without confirmation evidence stays unknown rather than pending or placed', async () => {
  expect(await readSubmissions('portfolio-test-not-confirmed')).toMatchObject({
    status: 'unknown',
    submissions: [],
  })
})

test('submission read returns actual reviewed mode and observed result independently of account settings', async () => {
  const evidence = {
    clientOrderId: 'portfolio-test-confirmed-paper',
    market: 'lighter',
    pair: 'PRL-USDC-USDC',
    mode: 'paper' as const,
    status: 'simulated' as const,
    orderId: 'paper-order',
    recordedAt: 1,
  }
  recordTradeSubmission(evidence)
  expect(await readSubmissions(evidence.clientOrderId)).toMatchObject({
    status: 'recorded',
    submissions: [evidence],
  })
})

test('exchange orders read fails closed instead of reporting an empty book', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('Offline')
  }) as typeof fetch
  try {
    const tools = buildPortfolioTools({} as CopilotToolDeps)
    const execute = (
      tools as unknown as Record<
        string,
        {
          execute: (a: unknown, b: unknown) => Promise<Record<string, unknown>>
        }
      >
    ).get_exchange_open_orders.execute
    const result = await execute(
      { venue: 'lighter', marketType: 'perpetual' },
      {},
    )
    expect(result.status).toBe('unavailable')
    expect(result).not.toHaveProperty('orders')
  } finally {
    globalThis.fetch = original
  }
})

test('complete exchange book preserves large native IDs and partial scope remains explicit', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    Response.json({
      venue: 'lighter',
      marketType: 'perpetual',
      accountName: 'desk',
      connectionRevision: 'a'.repeat(64),
      scope: 'all-perpetual-markets',
      complete: false,
      error: 'Incomplete mapping',
      orders: [{ symbol: 'GRASS-USDC', exchangeOrderId: '14918173922809911' }],
    })) as typeof fetch
  try {
    const tools = buildPortfolioTools({} as CopilotToolDeps)
    const execute = (
      tools.get_exchange_open_orders as unknown as {
        execute: (a: unknown, b: unknown) => Promise<Record<string, unknown>>
      }
    ).execute
    const result = await execute(
      { venue: 'lighter', marketType: 'perpetual' },
      {},
    )
    expect(result.status).toBe('available')
    expect(result.complete).toBe(false)
    expect(result.orders).toEqual([
      { symbol: 'GRASS-USDC', exchangeOrderId: '14918173922809911' },
    ])
    expect(String(result.note)).toContain('Partial')
  } finally {
    globalThis.fetch = original
  }
})
