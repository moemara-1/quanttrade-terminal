import { z } from 'zod'

const statusSchema = z.object({
  maxPriceDeviationBps: z.number().finite().nonnegative(),
  nativeTwapRiskAllowed: z.boolean().optional(),
})

/** Routes identify implemented preparation tools, not verified exchange fills. */
export function advancedOrderCapabilities(status: unknown) {
  const parsed = statusSchema.safeParse(status)
  if (!parsed.success)
    return {
      error:
        'Capabilities could not be verified. No execution route was authorized.',
    }
  return {
    requiresHumanConfirmation: true,
    accountRequirement:
      'Preparation must resolve the exact connected account, current revision and market. Availability here does not authorize execution or prove exchange connectivity.',
    atomic: {
      available: false,
      reason:
        'Lighter documents Atomic baskets, but its public signer exposes no verified signed all-or-none basket contract. Hyperliquid ordinary order batches return individual outcomes and provide no all-or-none basket guarantee. Do not substitute a sequential batch.',
    },
    lighterNative: {
      preparationTool: 'prepare_lighter_native_order',
      marketType: 'perpetual',
      nativeTwap: true,
      nativeTwapBundledProtection: false,
      orderTypes: [
        'market',
        'limit',
        'sl-market',
        'sl-limit',
        'tp-market',
        'tp-limit',
        'twap',
      ],
      grouping: ['single', 'oto', 'oco', 'otoco'],
      protection:
        'Native OTO/OTOCO children follow the actual entry fill. Native TWAP is single only; bundled TWAP protection is not supported by this route.',
    },
    scale: {
      preparationTool: 'prepare_position_plan',
      kind: 'scale',
      implementation: 'managed',
      venues: ['lighter', 'hyperliquid'],
      confirmation:
        'One card approves all exact child limits and optional protection; partial entry execution is possible.',
    },
    iceberg: {
      preparationTool: 'prepare_position_plan',
      kind: 'iceberg',
      implementation: 'managed',
      venues: ['lighter', 'hyperliquid'],
      confirmation:
        'One card approves the total size and display slices; each next slice waits for verified fills. This is not exchange-hidden liquidity.',
    },
    managedTwap: {
      bundledProtection: true,
      confirmationCount: 1,
      preparationTool: 'prepare_position_plan',
      kind: 'twap',
      implementation: 'managed',
      confirmation:
        'One card approves immediate and timed slices plus optional protection. Use only for explicitly managed schedules, not as a native-TWAP substitute.',
    },
    chase: {
      available: true,
      preparationTool: 'prepare_advanced_execution',
      kind: 'chase',
      implementation:
        'QuantTrade-managed cancel-verify-replace on Lighter and Hyperliquid',
      protection:
        'Optional bundled protection uses verified settled attempt fills. Uncertain cancellation or replacement pauses execution.',
    },
    hyperliquidNativeTwap: {
      available:
        parsed.data.nativeTwapRiskAllowed === true ||
        parsed.data.maxPriceDeviationBps >= 300,
      preparationTool: 'prepare_advanced_execution',
      kind: 'hyperliquid-twap',
      minimumRiskBandBps: 300,
      risk: 'Fixed 3% slice slippage; no absolute future price or quote cap; explicit user acceptance required.',
      protection:
        'Managed protection after verified full entry fill; partial fills remain unprotected.',
    },
  }
}
