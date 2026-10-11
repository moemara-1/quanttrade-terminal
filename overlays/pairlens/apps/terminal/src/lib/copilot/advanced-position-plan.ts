import Decimal from 'decimal.js'
import { z } from 'zod'

const D = Decimal.clone({ precision: 80 })
const positive = z
  .string()
  .max(40)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .refine((value) => new D(value).gt(0))
const common = {
  market: z.enum(['lighter', 'hyperliquid']),
  pair: z.string().min(3).max(100),
  side: z.enum(['buy', 'sell']),
  totalSize: positive,
  maxTotalNotional: positive,
  mode: z.enum(['live', 'paper']).optional(),
  credentialId: z.string().min(1).optional(),
  leverage: z.number().int().min(1).max(125).optional(),
  marginMode: z.enum(['cross', 'isolated']).optional(),
  stopLoss: positive.optional(),
  takeProfits: z
    .array(
      z
        .object({ price: positive, percent: z.number().int().min(1).max(100) })
        .strict(),
    )
    .min(1)
    .max(8)
    .optional(),
}
export const positionPlanInputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...common,
      kind: z.literal('scale'),
      count: z.number().int().min(2).max(40),
      lowerPrice: positive,
      upperPrice: positive,
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('iceberg'),
      displaySize: positive,
      limitPrice: positive,
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('twap'),
      count: z.number().int().min(2).max(40),
      intervalSeconds: z.number().int().min(30).max(86400),
    })
    .strict(),
])
type Limits = {
  sizeDecimals: number
  priceDecimals: number
  minSize: string
  minNotional: string
  price?: string
  maxLeverage?: number | null
}
type Node = { id: string; type: string; data: Record<string, unknown> }
type Edge = { id: string; source: string; target: string }

function exactNumber(value: Decimal): number {
  const number = value.toNumber()
  if (!Number.isFinite(number) || !new D(number).eq(value))
    throw new Error(
      'This value cannot be represented exactly by the plan engine. Use an exact native order instead.',
    )
  return number
}
function quantity(value: string, precision: number): bigint {
  const units = new D(value).mul(new D(10).pow(precision))
  if (!units.isInteger() || units.lte(0))
    throw new Error(
      `Amount allows ${precision} decimal places and must be positive.`,
    )
  return BigInt(units.toFixed(0))
}
function partition(total: bigint, weights: Array<number>): Array<bigint> {
  const sum = BigInt(weights.reduce((a, b) => a + b, 0))
  const parts = weights.map((weight) => (total * BigInt(weight)) / sum)
  let remaining = total - parts.reduce((a, b) => a + b, 0n)
  for (let i = 0; remaining > 0n; i++, remaining--) parts[i % parts.length]++
  return parts
}

/** Pure preparation: native child limits, managed fill dependencies, one human approval. */
export function compilePositionPlan(raw: unknown, limits: Limits) {
  const input = positionPlanInputSchema.parse(raw)
  if (
    !Number.isInteger(limits.sizeDecimals) ||
    limits.sizeDecimals < 0 ||
    limits.sizeDecimals > 30 ||
    !Number.isInteger(limits.priceDecimals) ||
    limits.priceDecimals < 0 ||
    limits.priceDecimals > 30
  )
    throw new Error('Verified market precision is required.')
  if ((input.leverage !== undefined) !== (input.marginMode !== undefined))
    throw new Error('Choose leverage and margin mode together.')
  if (
    input.leverage !== undefined &&
    (limits.maxLeverage == null ||
      !Number.isFinite(limits.maxLeverage) ||
      input.leverage > limits.maxLeverage)
  )
    throw new Error(
      `The requested leverage exceeds the verified market cap (${limits.maxLeverage ?? 'unavailable'}). Nothing was submitted.`,
    )
  if (
    input.takeProfits &&
    input.takeProfits.reduce((sum, tp) => sum + tp.percent, 0) !== 100
  )
    throw new Error(
      'Take-profit percentages must cover exactly 100% of the new entries.',
    )
  const total = quantity(input.totalSize, limits.sizeDecimals)
  const tick = new D(10).pow(limits.sizeDecimals)
  let groups: Array<{ units: bigint; price: Decimal }>
  if (input.kind === 'scale') {
    const low = new D(input.lowerPrice),
      high = new D(input.upperPrice)
    if (low.gte(high))
      throw new Error('Scale requires a lower price below the upper price.')
    if (
      [low, high].some(
        (price) =>
          price.decimalPlaces() > limits.priceDecimals ||
          (input.market === 'hyperliquid' &&
            !price.isInteger() &&
            price.precision() > 5),
      )
    )
      throw new Error('Scale endpoints violate the exchange price precision.')
    const units = partition(total, Array(input.count).fill(1))
    groups = units.map((amount, index) => ({
      units: amount,
      price: low
        .plus(
          high
            .minus(low)
            .mul(index)
            .div(input.count - 1),
        )
        .toDecimalPlaces(limits.priceDecimals, Decimal.ROUND_DOWN),
    }))
  } else if (input.kind === 'iceberg') {
    const display = quantity(input.displaySize, limits.sizeDecimals)
    if (display > total)
      throw new Error('Displayed quantity cannot exceed the total quantity.')
    const count = (total + display - 1n) / display
    if (count > 40n)
      throw new Error('Use at most 40 managed iceberg slices in one plan.')
    groups = Array.from({ length: Number(count) }, (_, index) => ({
      units:
        index === Number(count) - 1 ? total - display * BigInt(index) : display,
      price: new D(input.limitPrice),
    }))
  } else {
    if (!limits.price || !positive.safeParse(limits.price).success)
      throw new Error('Managed TWAP needs a fresh reference price.')
    groups = partition(total, Array(input.count).fill(1)).map((units) => ({
      units,
      price: new D(limits.price!),
    }))
  }
  const levels = input.takeProfits ?? []
  if (groups.length * Math.max(1, levels.length) > 80)
    throw new Error(
      'The plan exceeds 80 entry allocations. Reduce the slice or target count.',
    )
  const steps: Array<Node> = [{ id: 'trigger', type: 'trigger', data: {} }]
  const edges: Array<Edge> = []
  const connect = (source: string, target: string) =>
    edges.push({ id: `${source}-to-${target}`, source, target })
  const validatePrice = (price: Decimal) => {
    if (
      price.lte(0) ||
      price.decimalPlaces() > limits.priceDecimals ||
      (input.market === 'hyperliquid' &&
        !price.isInteger() &&
        price.precision() > 5)
    )
      throw new Error('A reviewed price violates the exchange precision.')
  }
  let gross = new D(0),
    previous: Array<string> = ['trigger']
  for (const [groupIndex, group] of groups.entries()) {
    validatePrice(group.price)
    const allocations = levels.length
      ? partition(
          group.units,
          levels.map((tp) => tp.percent),
        )
      : [group.units]
    const current: Array<string> = []
    let scheduledParent = 'trigger'
    if (input.kind === 'twap' && groupIndex > 0) {
      scheduledParent = `wait-${groupIndex}`
      steps.push({
        id: scheduledParent,
        type: 'wait',
        data: { duration: groupIndex * input.intervalSeconds, unit: 'seconds' },
      })
      connect('trigger', scheduledParent)
    }
    for (const [index, units] of allocations.entries()) {
      const size = new D(units.toString()).div(tick)
      if (
        size.lt(limits.minSize) ||
        size.mul(group.price).lt(limits.minNotional)
      )
        throw new Error(
          'A child allocation is below the exchange minimum. Increase total size or use fewer slices/targets.',
        )
      const id = levels.length
        ? `entry-${groupIndex + 1}-${index + 1}`
        : `entry-${groupIndex + 1}`
      current.push(id)
      steps.push({
        id,
        type: input.kind === 'twap' ? 'market-order' : 'limit-order',
        data: {
          side: 'inherit',
          sizeMode: 'absolute',
          size: exactNumber(size),
          ...(input.kind === 'twap'
            ? {}
            : { priceMode: 'absolute', priceValue: exactNumber(group.price) }),
        },
      })
      for (const parent of input.kind === 'iceberg'
        ? previous
        : [scheduledParent])
        connect(parent, id)
      gross = gross.plus(
        size.mul(group.price).mul(input.kind === 'twap' ? '1.10' : '1'),
      )
      const tp = levels[index]
      for (const [kind, rawPrice] of [
        ['stop-loss', input.stopLoss],
        ['take-profit', tp?.price],
      ] as const) {
        if (!rawPrice) continue
        const price = new D(rawPrice)
        validatePrice(price)
        const higher =
          input.side === 'buy' ? kind === 'take-profit' : kind === 'stop-loss'
        if (higher ? price.lte(group.price) : price.gte(group.price))
          throw new Error(
            `${kind} must be on the correct side of every entry price.`,
          )
        const exitId = `${id}-${kind}`
        steps.push({
          id: exitId,
          type: kind,
          data: {
            triggerMode: 'absolute',
            triggerValue: exactNumber(price),
            sizePercent: 100,
            orderType: 'market',
          },
        })
        connect(id, exitId)
        // Include execution headroom in the reviewed gross cap, not just entry margin.
        gross = gross.plus(size.mul(price).mul('1.10'))
      }
    }
    previous = current
  }
  if (gross.gt(input.maxTotalNotional))
    throw new Error(
      `The complete plan requires a gross order cap of at least ${gross.toFixed()} USDC, including protective exits. Nothing was submitted.`,
    )
  const graph = { oco: Boolean(input.stopLoss && levels.length), steps, edges }
  const title =
    input.kind === 'scale'
      ? 'Scale'
      : input.kind === 'iceberg'
        ? 'Iceberg'
        : 'Managed TWAP'
  return {
    market: input.market,
    pair: input.pair,
    side: input.side,
    mode: input.mode,
    credentialId: input.credentialId,
    type: input.kind === 'twap' ? ('market' as const) : ('limit' as const),
    size: exactNumber(new D(input.totalSize)),
    exactSize: input.totalSize,
    ...(input.kind === 'twap'
      ? {}
      : {
          price: exactNumber(groups[0].price),
          exactPrice: groups[0].price.toFixed(),
        }),
    leverage: input.leverage,
    marginMode: input.marginMode,
    reason: `${title}: ${input.totalSize} total base units, ${groups.length} slices. QuantTrade manages dependencies; child orders and paired protection are submitted to the reviewed venue. This is a managed plan. Protective exits do not cancel other entry slices. This is not an atomic basket or an exchange-hidden quantity.`,
    workflow: {
      name: `${title} position plan`,
      maxTotalNotional: input.maxTotalNotional,
      graph,
    },
  }
}
