import { describe, expect, test } from 'bun:test'
import {
  loadVenueCatalog,
  resolveVenueInstrument,
} from '@/lib/venue-instrument'

const rows = [
  {
    market: 'hyperliquid',
    symbol: 'BTC-USDC-USDC',
    base: 'BTC',
    quote: 'USDC',
    kind: 'cex-derivative',
    settle: 'USDC',
    contract: 'perp',
    linear: true,
  },
  {
    market: 'hyperliquid',
    symbol: '1000PEPE-USDC-USDC',
    base: '1000PEPE',
    quote: 'USDC',
    kind: 'cex-derivative',
    settle: 'USDC',
    contract: 'perp',
    linear: true,
  },
  {
    market: 'hyperliquid-spot',
    symbol: 'BTC-USDC',
    base: 'BTC',
    quote: 'USDC',
    kind: 'cex-pair',
  },
]
describe('catalog-backed venue instrument', () => {
  test('takes listed USDC contract from USDT CEX chart', () => {
    expect(
      resolveVenueInstrument(
        { cls: 'perp', market: 'binance-futures', id: 'BTC-USDT-USDT' },
        'hyperliquid',
        rows,
      ),
    ).toEqual({ cls: 'perp', market: 'hyperliquid', id: 'BTC-USDC-USDC' })
  })
  test('never substitutes scaled assets, wrong class or unknown listings', () => {
    expect(
      resolveVenueInstrument(
        { cls: 'perp', market: 'bybit-futures', id: 'PEPE-USDT-USDT' },
        'hyperliquid',
        rows,
      ),
    ).toBeNull()
    expect(
      resolveVenueInstrument(
        { cls: 'spot', market: 'binance', id: 'BTC-USDT' },
        'hyperliquid',
        rows,
      ),
    ).toBeNull()
    expect(
      resolveVenueInstrument(
        { cls: 'perp', market: 'binance-futures', id: 'ETH-USDT-USDT' },
        'hyperliquid',
        rows,
      ),
    ).toBeNull()
  })
  test('reverse hop returns native CEX contract and prefers exact quote', () => {
    const cex = [
      {
        ...rows[0],
        market: 'binance-futures',
        quote: 'USDT',
        settle: 'USDT',
        symbol: 'BTC-USDT-USDT',
      },
      { ...rows[0], market: 'binance-futures' },
    ]
    expect(
      resolveVenueInstrument(
        { cls: 'perp', market: 'hyperliquid', id: 'BTC-USDC-USDC' },
        'binance-futures',
        cex,
      )?.id,
    ).toBe('BTC-USDC-USDC')
    expect(
      resolveVenueInstrument(
        { cls: 'perp', market: 'hyperliquid', id: 'BTC-USDC-USDC' },
        'binance-futures',
        cex.slice(0, 1),
      )?.id,
    ).toBe('BTC-USDT-USDT')
  })
  test('spot returns only real listed spot key', () => {
    expect(
      resolveVenueInstrument(
        { cls: 'spot', market: 'binance', id: 'BTC-USDT' },
        'hyperliquid-spot',
        rows,
      )?.id,
    ).toBe('BTC-USDC')
  })
  test('does not map non-dollar quotes or inverse/dated contracts', () => {
    expect(
      resolveVenueInstrument(
        { cls: 'spot', market: 'binance', id: 'BTC-ETH' },
        'hyperliquid-spot',
        rows,
      ),
    ).toBeNull()
    expect(
      resolveVenueInstrument(
        { cls: 'perp', market: 'binance-futures', id: 'BTC-USDT-USDT' },
        'hyperliquid',
        [{ ...rows[0], contract: 'future' }],
      ),
    ).toBeNull()
    expect(
      resolveVenueInstrument(
        { cls: 'perp', market: 'binance-futures', id: 'BTC-USD-BTC' },
        'hyperliquid',
        rows,
      ),
    ).toBeNull()
  })
})

test('cold CEX catalog initializes via read-only history even when requested quote is absent', async () => {
  let warmed = false
  const catalog = await loadVenueCatalog(
    async () => (warmed ? rows : []),
    async () => {
      warmed = true
      throw new Error('requested quote absent')
    },
  )
  expect(catalog).toEqual(rows)
})
test('warm failure without authoritative rows stays unknown', async () => {
  await expect(
    loadVenueCatalog(
      async () => [],
      async () => {
        throw new Error('unreachable')
      },
    ),
  ).rejects.toThrow('Venue listings have not loaded yet')
})
