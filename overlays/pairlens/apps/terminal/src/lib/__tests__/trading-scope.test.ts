import { describe, expect, test } from 'bun:test'
import {
  availableBasePercentage,
  availablePercentage,
  contractLeverageLimit,
  tradingAvailableBalance,
  tradingBalanceMap,
  validateNativeOrder,
} from '../trading-scope'

const markets = [
  'binance',
  'binance-futures',
  'bybit',
  'bybit-futures',
  'lighter',
  'lighter-spot',
  'hyperliquid',
  'hyperliquid-spot',
]
const balances = markets.flatMap((market, index) =>
  ['a', 'b'].map((account) => ({
    credentialId: `${account}@${market}`,
    market,
    currency: 'USDC',
    available: `${index}.${account === 'a' ? '003698' : '10'}`,
    total: '50',
    frozen: '1',
    updatedAt: 1,
  })),
)
describe('trading account and contract isolation', () => {
  test('no selected account cannot show any other account balance', () => {
    expect(tradingBalanceMap(balances, undefined, 'lighter').size).toBe(0)
  })
  test('every account and market combination selects only its own exact available balance', () => {
    for (const scope of balances.map((balance) => balance.credentialId)) {
      for (const market of [...markets, 'unconnected']) {
        const own = balances.find(
          (b) => b.credentialId === scope && b.market === market,
        )
        expect(
          tradingBalanceMap(balances, scope, market).get('USDC')?.available,
        ).toBe(own?.available)
      }
    }
  })
  test('per-contract leverage has no generic or previous-contract fallback', () => {
    const rows = [
      { symbol: 'BTC-USDC', maxLeverage: 50 },
      { symbol: 'PRL-USDC', maxLeverage: 3 },
      { symbol: 'UNKNOWN-USDC', maxLeverage: null },
    ]
    expect(contractLeverageLimit(rows, 'PRL-USDC-USDC')).toBe(3)
    expect(contractLeverageLimit(rows, 'BTC-USDC-USDC')).toBe(50)
    expect(contractLeverageLimit(rows, 'UNKNOWN-USDC-USDC')).toBeNull()
    expect(contractLeverageLimit(rows, 'NOTLISTED-USDC-USDC')).toBeNull()
    expect(contractLeverageLimit(rows, 'BTC-USDT-USDT')).toBeNull()
  })
})

test('contract minimums and precision reject invalid drafts without rounding', () => {
  const limits = {
    sizeDecimals: 2,
    priceDecimals: 4,
    minSize: '5',
    minNotional: '10',
  }
  expect(
    validateNativeOrder(limits, {
      size: '4.99',
      price: '2.001',
      quoteSized: false,
    }),
  ).toContain('Minimum size')
  expect(
    validateNativeOrder(limits, {
      size: '5.001',
      price: '2.001',
      quoteSized: false,
    }),
  ).toContain('2 decimal')
  expect(
    validateNativeOrder(limits, {
      size: '5',
      price: '2.00001',
      quoteSized: false,
    }),
  ).toContain('4 decimal')
  expect(
    validateNativeOrder(limits, {
      size: '5',
      price: '1.99',
      quoteSized: false,
    }),
  ).toContain('Minimum notional')
  expect(
    validateNativeOrder(limits, { size: '5', price: '2', quoteSized: false }),
  ).toBeNull()
  expect(
    validateNativeOrder(limits, { size: '10', price: '2', quoteSized: true }),
  ).toBeNull()
})

test('available funds never include locked margin or an unverified balance', () => {
  expect(tradingAvailableBalance({ available: '316.598942' })).toBe(
    '316.598942',
  )
  expect(tradingAvailableBalance({ available: '0' })).toBe('0')
  expect(tradingAvailableBalance(undefined)).toBeNull()
  expect(tradingAvailableBalance({ available: 'NaN' })).toBeNull()
  expect(tradingAvailableBalance({ available: '-1' })).toBeNull()
})

test('percentage controls never round above available and respect venue precision', () => {
  expect(availablePercentage('0.000000009', 100, 8)).toBe('')
  expect(availablePercentage('9.999', 100, 2)).toBe('9.99')
  expect(availablePercentage('20.01', 50, 2)).toBe('10')
  expect(availablePercentage('9007199254740993.123456789', 100, 9)).toBe(
    '9007199254740993.123456789',
  )
  expect(availablePercentage('1', -1, 2)).toBe('')
  expect(availablePercentage('1', 101, 2)).toBe('')
})

test('quote percentage conversion floors base precision without a float overspend', () => {
  expect(availableBasePercentage('10.01', '3', 100, 2)).toBe('3.33')
  expect(availableBasePercentage('10', '2', 50, 2)).toBe('2.5')
  expect(availableBasePercentage('1', '0', 100, 2)).toBe('')
})

test('isolated-only native ticket requires an explicit selection and never defaults cross',async()=>{
 const {nativeMarginError}=await import('../trading-scope');
 expect(nativeMarginError({onlyIsolated:true},'cross',false,false)).toContain('Isolated');
 expect(nativeMarginError({onlyIsolated:true},'isolated',true,false)).toBeNull();
 expect(nativeMarginError({onlyIsolated:true},'cross',false,true)).toBeNull();
});
