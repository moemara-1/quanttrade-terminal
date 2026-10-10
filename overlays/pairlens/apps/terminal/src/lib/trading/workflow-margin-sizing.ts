import Decimal from 'decimal.js'

type Step = { id: string; type: string; data: Record<string, unknown> }
type Graph = {
  steps: Array<Step>
  edges: Array<{ source: string; target: string }>
}
type Request = {
  graph: Graph
  margin: string
  leverage: number
  markPrice: string
  sizeDecimals: number
  side: 'buy' | 'sell'
  minSize?: string | null
  minNotional?: string | null
  maxPriceDeviationBps?: number
}
type Result =
  | { ok: false; error: string }
  | {
      ok: true
      inputSize: string
      totalEntryQuote: string
      estimatedMargin: string
      maxTotalNotional: string
      entryCount: number
      priceHeadroomPercent: 10
    }

const D = Decimal.clone({ precision: 80, maxE: 100, minE: -100 })
const entryTypes = new Set(['market-order', 'limit-order'])
const exitTypes = new Set(['stop-loss', 'take-profit'])
function invalid(message: string): never {
  throw new Error(message)
}
function numeric(value: unknown, label: string, positive = true): Decimal {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    String(value).length > 40
  )
    return invalid(`${label} must be a finite decimal number.`)
  if (typeof value === 'string' && !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
    return invalid(`${label} must use digits and a decimal point.`)
  const number = new D(value)
  if (
    !number.isFinite() ||
    number.abs().gt('1000000000000000') ||
    (positive && number.lte(0))
  )
    return invalid(`${label} is outside the supported positive range.`)
  return number
}

/** Estimate this reviewed graph only. The 10% future-price cushion is not a fill guarantee. */
export function sizeWorkflowFromMargin(request: Request): Result {
  try {
    const { graph, sizeDecimals, side } = request
    const margin = numeric(request.margin, 'Total margin')
    const leverage = numeric(request.leverage, 'Leverage')
    const mark = numeric(request.markPrice, 'Current price')
    if (
      !leverage.isInteger() ||
      leverage.gt(1000) ||
      !Number.isInteger(sizeDecimals) ||
      sizeDecimals < 0 ||
      sizeDecimals > 18
    )
      return invalid('Use supported leverage and exchange amount precision.')
    const deviation = numeric(
      request.maxPriceDeviationBps ?? 0,
      'Execution price allowance',
      false,
    )
    if (deviation.lt(0) || deviation.gt(10000))
      return invalid('Execution price allowance is invalid.')
    if (
      !graph ||
      !Array.isArray(graph.steps) ||
      !Array.isArray(graph.edges) ||
      graph.steps.length > 100 ||
      graph.edges.length > 200
    )
      return invalid('Workflow is too large for automatic margin sizing.')
    const byId = new Map<string, Step>()
    const parents = new Map<string, string>()
    const children = new Map<string, Array<string>>()
    for (const step of graph.steps) {
      if (
        !step ||
        typeof step.id !== 'string' ||
        !step.id ||
        byId.has(step.id) ||
        !step.data ||
        typeof step.data !== 'object'
      )
        return invalid('Workflow contains invalid or duplicate nodes.')
      if (
        !['trigger', 'wait', 'split', ...entryTypes, ...exitTypes].includes(
          step.type,
        )
      )
        return invalid(
          'Automatic margin sizing does not support conditions. Review this workflow in the editor.',
        )
      byId.set(step.id, step)
      children.set(step.id, [])
    }
    for (const edge of graph.edges) {
      if (
        !byId.has(edge.source) ||
        !byId.has(edge.target) ||
        parents.has(edge.target)
      )
        return invalid(
          'Workflow has missing nodes or joining paths. Automatic sizing requires one parent per node.',
        )
      parents.set(edge.target, edge.source)
      children.get(edge.source)!.push(edge.target)
    }
    const roots = graph.steps.filter((step) => step.type === 'trigger')
    if (roots.length !== 1 || parents.has(roots[0].id))
      return invalid('Workflow requires one parentless trigger.')
    const ordered: Array<Step> = []
    const queue = [roots[0].id]
    const seen = new Set<string>()
    for (const id of queue) {
      if (seen.has(id)) return invalid('Workflow contains a cycle.')
      seen.add(id)
      ordered.push(byId.get(id)!)
      queue.push(...children.get(id)!)
    }
    if (ordered.length !== graph.steps.length)
      return invalid('Workflow contains unreachable nodes or a cycle.')
    const coefficients = new Map<string, Decimal>()
    const referencePrices = new Map<string, Decimal>()
    const afterExit = new Set<string>()
    const prices = new Map<string, Decimal>()
    let coefficientSum = new D(0)
    let quoteCoefficient = new D(0)
    let entryCount = 0
    for (const step of ordered) {
      const parentId = parents.get(step.id)
      let coefficient = parentId ? coefficients.get(parentId)! : new D(1)
      const reference = parentId ? referencePrices.get(parentId)! : mark
      let nextReference = reference
      let price = mark
      if (parentId && afterExit.has(parentId)) afterExit.add(step.id)
      if (entryTypes.has(step.type)) {
        if (afterExit.has(step.id))
          return invalid(
            'An entry follows an exit. Review the workflow before automatic sizing.',
          )
        if (
          step.data.sizeMode !== 'percent' ||
          !['inherit', side].includes(String(step.data.side))
        )
          return invalid(
            'Automatic margin sizing requires percentage entries in the selected trade direction.',
          )
        coefficient = coefficient
          .mul(numeric(step.data.size, 'Entry percentage'))
          .div(100)
        if (step.type === 'limit-order') {
          const value = numeric(step.data.priceValue, 'Limit price', false)
          if (step.data.priceMode === 'absolute') price = value
          else if (step.data.priceMode === 'offset-percent')
            price = mark.mul(new D(1).plus(value.div(100)))
          else if (step.data.priceMode === 'offset-absolute')
            price = mark.plus(value)
          else return invalid('Limit order price mode is invalid.')
          if (price.lte(0))
            return invalid('Computed limit price must be positive.')
          price = D.max(mark, price)
        }
        nextReference = price
        coefficientSum = coefficientSum.plus(coefficient)
        quoteCoefficient = quoteCoefficient.plus(coefficient.mul(price))
        entryCount++
      } else if (exitTypes.has(step.type)) {
        if (afterExit.has(step.id))
          return invalid(
            'An exit follows another exit. Its size depends on future fills; review this workflow in the editor.',
          )
        afterExit.add(step.id)
        const percent = numeric(step.data.sizePercent, 'Exit percentage')
        if (percent.lt(1) || percent.gt(100))
          return invalid('Exit percentage must be between 1 and 100.')
        coefficient = coefficient.mul(percent).div(100)
        const value = numeric(step.data.triggerValue, 'Exit trigger')
        const gain = (step.type === 'take-profit') === (side === 'buy')
        const trigger =
          step.data.triggerMode === 'absolute'
            ? value
            : step.data.triggerMode === 'percent'
              ? reference.mul(new D(1).plus(value.div(100).mul(gain ? 1 : -1)))
              : invalid('Exit trigger mode is invalid.')
        if (trigger.lte(0))
          return invalid('Computed exit trigger must be positive.')
        price = D.max(mark, trigger)
        if (step.data.orderType === 'limit')
          price = D.max(
            price,
            numeric(step.data.limitPrice, 'Exit limit price'),
          )
        else if (step.data.orderType !== 'market')
          return invalid('Exit order type is invalid.')
      } else if (step.type === 'wait') {
        numeric(step.data.duration, 'Wait duration')
        if (!['seconds', 'minutes', 'hours'].includes(String(step.data.unit)))
          return invalid('Wait unit is invalid.')
      } else if (step.type === 'split') {
        const branches = numeric(step.data.branches, 'Split branches')
        if (!branches.isInteger() || branches.lt(2) || branches.gt(8))
          return invalid('Split requires between 2 and 8 branches.')
      }
      if (
        !coefficient.isFinite() ||
        coefficient.gt('1e15') ||
        coefficient.lt('1e-30')
      )
        return invalid(
          'Workflow percentages exceed the supported sizing range.',
        )
      coefficients.set(step.id, coefficient)
      referencePrices.set(step.id, nextReference)
      prices.set(step.id, price)
    }
    if (!entryCount || coefficientSum.lte(0))
      return invalid('Workflow has no opening orders to size from margin.')
    const target = margin.mul(leverage)
    const input = target
      .div(quoteCoefficient)
      .toDecimalPlaces(sizeDecimals, D.ROUND_DOWN)
    const sizes = new Map<string, Decimal>()
    let entryQuote = new D(0)
    let grossQuote = new D(0)
    for (const step of ordered) {
      const parentId = parents.get(step.id)
      let size = parentId ? sizes.get(parentId)! : input
      if (entryTypes.has(step.type))
        size = size
          .mul(String(step.data.size))
          .div(100)
          .toDecimalPlaces(sizeDecimals, D.ROUND_DOWN)
      if (exitTypes.has(step.type))
        size = size
          .mul(String(step.data.sizePercent))
          .div(100)
          .toDecimalPlaces(sizeDecimals, D.ROUND_DOWN)
      if (
        (entryTypes.has(step.type) || exitTypes.has(step.type)) &&
        size.lte(0)
      )
        return invalid(
          'An order rounds to zero. Increase total margin or revise workflow percentages.',
        )
      if (entryTypes.has(step.type) || exitTypes.has(step.type)) {
        if (request.minSize && size.lt(numeric(request.minSize, 'Minimum size', false)))
          return invalid(`Order ${step.id} is below the exchange minimum size. Increase total margin.`)
        if (request.minNotional && size.mul(prices.get(step.id)!).lt(numeric(request.minNotional, 'Minimum notional', false)))
          return invalid(`Order ${step.id} is below the exchange minimum notional. Increase total margin.`)
      }
      sizes.set(step.id, size)
      if (entryTypes.has(step.type))
        entryQuote = entryQuote.plus(size.mul(prices.get(step.id)!))
      if (entryTypes.has(step.type) || exitTypes.has(step.type))
        grossQuote = grossQuote.plus(size.mul(prices.get(step.id)!))
    }
    // Use unrounded coefficients for the reviewed cap, so exchange rounding cannot shrink its safety cushion.
    let capQuote = new D(0)
    for (const step of ordered)
      if (entryTypes.has(step.type) || exitTypes.has(step.type))
        capQuote = capQuote.plus(
          target
            .div(quoteCoefficient)
            .mul(coefficients.get(step.id)!)
            .mul(prices.get(step.id)!),
        )
    const cap = D.max(capQuote, grossQuote)
      .mul(new D(1).plus(deviation.div(10000)))
      .mul('1.1')
      .toDecimalPlaces(8, D.ROUND_UP)
    if (!cap.isFinite() || cap.gt('1e15') || entryQuote.gt(target))
      return invalid('Workflow budget exceeds the supported range.')
    return {
      ok: true,
      inputSize: input.toFixed(),
      totalEntryQuote: entryQuote.toFixed(),
      estimatedMargin: entryQuote.div(leverage).toFixed(),
      maxTotalNotional: cap.toFixed(),
      entryCount,
      priceHeadroomPercent: 10,
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'Workflow could not be sized safely.',
    }
  }
}
