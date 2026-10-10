/** Quote exposure cap entered explicitly by the trader, never a margin deposit. */
export function workflowBudgetError(
  value: string,
  quoteAsset: string,
): string | null {
  if (value.trim() === '')
    return `Enter a total workflow exposure budget in ${quoteAsset} in the budget field above.`
  const amount = Number(value)
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ||
    value.length > 40 ||
    !Number.isFinite(amount) ||
    amount <= 0
  )
    return `The workflow budget must be a positive decimal amount in ${quoteAsset}; use digits and a decimal point.`
  return null
}


