import { expect, test } from 'bun:test'
import { advancedOrderCapabilities } from '../advanced-order-capabilities'

test('malformed hosted status never advertises executable capabilities', () => {
  expect(advancedOrderCapabilities({ maxPriceDeviationBps: '300' })).toEqual({
    error:
      'Capabilities could not be verified. No execution route was authorized.',
  })
})

test('native and managed routes distinguish one confirmation from atomic execution', () => {
  const result = advancedOrderCapabilities({ maxPriceDeviationBps: 100 })
  expect(result).toMatchObject({
    requiresHumanConfirmation: true,
    atomic: { available: false },
    lighterNative: {
      preparationTool: 'prepare_lighter_native_order',
      nativeTwap: true,
    },
    scale: {
      preparationTool: 'prepare_position_plan',
      implementation: 'managed',
    },
    iceberg: {
      preparationTool: 'prepare_position_plan',
      implementation: 'managed',
    },
    chase: { available: true, preparationTool: 'prepare_advanced_execution' },
    hyperliquidNativeTwap: { available: false, minimumRiskBandBps: 300 },
  })
  expect(result).toMatchObject({
    lighterNative: { nativeTwapBundledProtection: false },
    managedTwap: { bundledProtection: true, confirmationCount: 1 },
  })
})

test('explicit native risk allowance enables native TWAP while preserving full-fill protection gap', () => {
  expect(
    advancedOrderCapabilities({
      maxPriceDeviationBps: 100,
      nativeTwapRiskAllowed: true,
    }),
  ).toMatchObject({
    hyperliquidNativeTwap: {
      available: true,
      protection:
        'Managed protection after verified full entry fill; partial fills remain unprotected.',
    },
  })
})
