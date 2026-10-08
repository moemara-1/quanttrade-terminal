import { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchNanogptModels } from '@pairlens/plugins/all'
import {
  filterNanogptModels,
  nanogptPriceLabel,
  nanogptToolLabel,
  withCatalogCancellation,
} from './nanogpt-model-picker-data'
import type { NanogptModel } from '@pairlens/plugins/all'

const EMPTY_MODELS: Array<NanogptModel> = []

function ModelDetails({ model }: { model: NanogptModel }) {
  const tokens = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value)
      ? `${value.toLocaleString()} tokens`
      : 'Not reported'
  return (
    <div className="space-y-1 text-xs">
      <p>
        {nanogptToolLabel(model)}
        {model.capabilities?.reasoning === true ? ' · Reasoning' : ''}
        {model.capabilities?.parallel_tool_calls === true
          ? ' · Parallel tools'
          : ''}
        {model.capabilities?.structured_output === true
          ? ' · Structured output'
          : ''}
      </p>
      <p className="text-muted-foreground">
        Context: {tokens(model.context_length)} · Maximum output:{' '}
        {tokens(model.max_output_tokens)}
      </p>
      <p className="text-muted-foreground">
        {nanogptPriceLabel(model.pricing)}
      </p>
      {model.subscription?.included !== undefined && (
        <p className="text-muted-foreground">
          {model.subscription.included
            ? 'Included in subscription catalog'
            : 'Not included in subscription catalog'}
        </p>
      )}
    </div>
  )
}

export function NanogptModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (modelId: string) => void
  disabled: boolean
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [toolsOnly, setToolsOnly] = useState(false)
  const catalog = useQuery({
    queryKey: ['nanogpt', 'public-model-catalog'],
    queryFn: ({ signal }) =>
      fetchNanogptModels(withCatalogCancellation(signal)),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const models = catalog.data ?? EMPTY_MODELS
  const found = useMemo(
    () => filterNanogptModels(models, query, toolsOnly),
    [models, query, toolsOnly],
  )
  const selected = models.find((model) => model.id === value)
  return (
    <section
      className="space-y-2 rounded-lg border p-3"
      aria-label="NanoGPT model catalog"
      aria-busy={catalog.isFetching}
    >
      <p className="text-xs text-muted-foreground" id={`${id}-help`}>
        Choose a model below or edit the model ID above. Tool calling lets the
        agent research and prepare trades; execution still requires your
        approval.
      </p>
      <label htmlFor={`${id}-search`} className="block text-xs font-medium">
        Search NanoGPT models
      </label>
      <input
        id={`${id}-search`}
        className="h-8 w-full rounded-md border bg-background px-2 text-xs"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault()
        }}
        disabled={disabled}
        placeholder="Model name or ID"
        aria-describedby={`${id}-help`}
      />
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={toolsOnly}
          onChange={(e) => setToolsOnly(e.target.checked)}
          disabled={disabled}
        />
        Tool-calling models only
      </label>
      {catalog.isPending && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading model catalog…
        </p>
      )}
      {catalog.isError && (
        <div role="alert" className="space-y-1 text-xs">
          <p>
            {catalog.data
              ? 'Catalog refresh failed. Showing previously fetched metadata.'
              : 'Could not load the catalog. You can still enter a model ID manually.'}
          </p>
          <button
            type="button"
            className="rounded border px-2 py-1"
            disabled={disabled || catalog.isFetching}
            onClick={() => void catalog.refetch()}
          >
            Retry catalog
          </button>
        </div>
      )}
      {catalog.data && (
        <>
          <p role="status" className="text-[11px] text-muted-foreground">
            {found.total} matches · Showing {found.items.length}
            {found.total > found.items.length
              ? ' · Narrow your search for more results'
              : ''}
          </p>
          <ul
            className="max-h-56 space-y-1 overflow-y-auto"
            aria-label="Matching NanoGPT models"
          >
            {found.items.map((model) => (
              <li key={model.id}>
                <button
                  type="button"
                  aria-pressed={value === model.id}
                  disabled={disabled}
                  onClick={() => onChange(model.id)}
                  className={`w-full rounded-md border px-2 py-2 text-left text-xs hover:bg-muted/60 disabled:opacity-50 ${value === model.id ? 'border-primary bg-primary/10' : 'border-border'}`}
                >
                  <span className="block font-medium">
                    {model.name ?? model.id}
                  </span>
                  <span className="block break-all font-mono text-[10px] text-muted-foreground">
                    {model.id}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {nanogptToolLabel(model)} ·{' '}
                    {nanogptPriceLabel(model.pricing)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {found.total === 0 && (
            <p className="text-xs text-muted-foreground">
              No matching models. Change the search or turn off the tool filter.
            </p>
          )}
        </>
      )}
      {selected ? (
        <div className="space-y-1 border-t pt-2">
          <p className="text-xs font-medium">
            Selected: {selected.name ?? selected.id}
          </p>
          <ModelDetails model={selected} />
          {selected.capabilities?.tool_calling !== true && (
            <p className="text-xs text-muted-foreground">
              {selected.capabilities?.tool_calling === false
                ? 'This model supports chat, but cannot call agent tools.'
                : 'Tool support is not reported. Choose a model marked Tool calling for agent tasks.'}
            </p>
          )}
        </div>
      ) : value && catalog.data ? (
        <p className="text-xs text-muted-foreground">
          Manual model ID; this ID is not in the current catalog.
        </p>
      ) : null}
      {catalog.dataUpdatedAt > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Provider metadata fetched{' '}
          {new Date(catalog.dataUpdatedAt).toLocaleTimeString()}. Prices use the
          provider’s reported units.
        </p>
      )}
    </section>
  )
}
