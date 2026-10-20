import type { BalanceRecord } from '@/stores/balances-store'

export function nativeMarginError(limits:{onlyIsolated?:boolean}|null,mode:'cross'|'isolated',explicit:boolean,reduceOnly:boolean):string|null {
  return !reduceOnly&&limits?.onlyIsolated&&(!explicit||mode!=='isolated')
    ? 'This market supports Isolated margin only. Select Isolated before submitting.'
    : null
}

/** A missing or mismatched account is never permission to merge balances. */
export function tradingBalanceMap(
  balances: ReadonlyArray<BalanceRecord>,
  scope: string | undefined,
  market: string,
): Map<string, BalanceRecord> {
  return new Map(
    balances
      .filter(
        (balance) =>
          scope && balance.credentialId === scope && balance.market === market,
      )
      .map((balance) => [balance.currency, balance]),
  )
}

export function contractLeverageLimit(
  rows: ReadonlyArray<{ symbol: string; maxLeverage?: number | null }>,
  pair: string,
): number | null {
  const symbol = pair.endsWith('-USDC-USDC') ? pair.slice(0, -5) : pair
  const limit = rows.find((row) => row.symbol === symbol)?.maxLeverage
  return typeof limit === 'number' && Number.isFinite(limit) && limit >= 1
    ? Math.floor(limit)
    : null
}
export type NativeOrderLimits = {
  sizeDecimals?: number | null
  priceDecimals?: number | null
  minSize?: string | null
  minNotional?: string | null
}
function decimal(value: string): { value: bigint; scale: number } | null {
  if (!/^\d+(?:\.\d+)?$/.test(value) || value.length > 100) return null
  const [whole, fraction = ''] = value.split('.')
  return { value: BigInt(whole + fraction), scale: fraction.length }
}
function below(
  a: { value: bigint; scale: number },
  b: { value: bigint; scale: number },
): boolean {
  const scale = Math.max(a.scale, b.scale)
  return (
    a.value * 10n ** BigInt(scale - a.scale) <
    b.value * 10n ** BigInt(scale - b.scale)
  )
}
export function validateNativeOrder(
  limits: NativeOrderLimits | null,
  order: {
    size: string
    price?: string
    referencePrice?: string
    quoteSized: boolean
  },
): string | null {
  if (!limits || !order.size) return null
  const amount = decimal(order.size)
  if (!amount || amount.value <= 0n) return 'Enter a positive decimal amount'
  const precision = (order.size.split('.')[1] ?? '').replace(/0+$/, '').length
  if (
    !order.quoteSized &&
    limits.sizeDecimals != null &&
    precision > limits.sizeDecimals
  )
    return `Size allows ${limits.sizeDecimals} decimal places`
  const minimumSize = limits.minSize ? decimal(limits.minSize) : null
  if (!order.quoteSized && minimumSize && below(amount, minimumSize))
    return `Minimum size: ${limits.minSize}`
  const priceValue = order.price ?? order.referencePrice
  const price = priceValue ? decimal(priceValue) : null
  if (order.price && !price) return 'Enter a positive decimal price'
  if (
    order.price &&
    limits.priceDecimals != null &&
    (order.price.split('.')[1] ?? '').replace(/0+$/, '').length >
      limits.priceDecimals
  )
    return `Price allows ${limits.priceDecimals} decimal places`
  const notional = order.quoteSized
    ? amount
    : price
      ? { value: amount.value * price.value, scale: amount.scale + price.scale }
      : null
  const minimum = limits.minNotional ? decimal(limits.minNotional) : null
  if (notional && minimum && below(notional, minimum))
    return `Minimum notional: ${limits.minNotional} USDC`
  return null
}

/** Spendable funds only; a missing balance is unknown, never invented zero. */
export function tradingAvailableBalance(
  balance: Pick<BalanceRecord, 'available'> | undefined,
): string | null {
  if (!balance || !/^\d+(?:\.\d+)?$/.test(balance.available)) return null
  return Number.isFinite(Number(balance.available)) ? balance.available : null
}

/** Floor a balance percentage to the venue tick; never overspend through float rounding. */
export function availablePercentage(
  available: string,
  percent: number,
  decimals = 8,
): string {
  const amount = decimal(available)
  if (
    !amount ||
    !Number.isInteger(percent) ||
    percent < 0 ||
    percent > 100 ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 30
  )
    return ''
  const units =
    (amount.value * BigInt(percent) * 10n ** BigInt(decimals)) /
    (100n * 10n ** BigInt(amount.scale))
  if (units <= 0n) return ''
  const raw = units.toString().padStart(decimals + 1, '0')
  return decimals
    ? `${raw.slice(0, -decimals)}.${raw.slice(-decimals)}`.replace(/\.?0+$/, '')
    : raw
}

/** Percentage of quote funds converted to base units, floored to an executable quantity tick. */
export function availableBasePercentage(
  quote: string,
  price: string,
  percent: number,
  decimals = 8,
): string {
  const funds = decimal(quote),
    rate = decimal(price)
  if (
    !funds ||
    !rate ||
    rate.value <= 0n ||
    !Number.isInteger(percent) ||
    percent < 0 ||
    percent > 100 ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 30
  )
    return ''
  const units =
    (funds.value * BigInt(percent) * 10n ** BigInt(rate.scale + decimals)) /
    (100n * rate.value * 10n ** BigInt(funds.scale))
  if (units <= 0n) return ''
  const raw = units.toString().padStart(decimals + 1, '0')
  return decimals
    ? `${raw.slice(0, -decimals)}.${raw.slice(-decimals)}`.replace(/\.?0+$/, '')
    : raw
}
