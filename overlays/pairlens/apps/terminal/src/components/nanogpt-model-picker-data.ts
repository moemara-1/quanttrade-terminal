import type { NanogptModel } from '@pairlens/plugins/all'

export function filterNanogptModels(
  models: Array<NanogptModel>,
  query: string,
  toolsOnly: boolean,
  limit = 40,
): { items: Array<NanogptModel>; total: number } {
  const search = query.trim().toLowerCase()
  const matches = models.filter(
    (model) =>
      (!toolsOnly || model.capabilities?.tool_calling === true) &&
      (!search ||
        `${model.id} ${model.name ?? ''}`.toLowerCase().includes(search)),
  )
  return {
    items: matches.slice(0, Math.max(1, Math.min(40, limit))),
    total: matches.length,
  }
}
export function nanogptToolLabel(model: NanogptModel): string {
  return model.capabilities?.tool_calling === true
    ? 'Tool calling'
    : model.capabilities?.tool_calling === false
      ? 'Chat only'
      : 'Tool support not reported'
}
export function nanogptPriceLabel(pricing: NanogptModel['pricing']): string {
  const price = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? String(value)
      : 'not reported'
  const input = price(pricing?.prompt),
    output = price(pricing?.completion)
  if (input === 'not reported' && output === 'not reported')
    return 'Pricing not reported'
  const unit =
    pricing?.unit === 'per_million_tokens'
      ? '1M tokens'
      : pricing?.unit?.replaceAll('_', ' ')
  const suffix =
    pricing?.currency && unit
      ? ` ${pricing.currency} / ${unit}`
      : pricing?.currency
        ? ` ${pricing.currency} · unit not reported`
        : unit
          ? ` · currency not reported / ${unit}`
          : ' · currency and unit not reported'
  return `Input ${input} · Output ${output}${suffix}`
}

export function withCatalogCancellation(
  signal: AbortSignal,
  request: typeof fetch = fetch,
): typeof fetch {
  return (input, init) =>
    request(input, {
      ...init,
      signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
    })
}
