import type { PairResultFilter } from './pair-result-filter'
import { useAvailableMarkets } from '@/hooks/use-available-markets'

export function PairResultFilters({
  value,
  onChange,
}: {
  value: PairResultFilter
  onChange: (value: PairResultFilter) => void
}) {
  const { markets } = useAvailableMarkets()
  return (
    <div className="flex flex-col gap-1 px-3 py-2 border-b">
      <select
        aria-label="Filter exchange"
        value={value.venue}
        onChange={(event) => onChange({ ...value, venue: event.target.value })}
        className="h-8 rounded border bg-background px-2 text-xs"
      >
        <option value="all">All venues</option>
        {markets
          .filter((market) => !market.desktopOnly)
          .map((market) => (
            <option key={market.value} value={market.value}>
              {market.label}
            </option>
          ))}
      </select>
      <div className="flex gap-1" aria-label="Filter market type">
        {(
          [
            ['all', 'All types'],
            ['crypto', 'Spot'],
            ['crypto-perp', 'Perpetual'],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={value.cls === id}
            onClick={() => onChange({ ...value, cls: id })}
            className={
              value.cls === id
                ? 'rounded border border-primary/40 bg-primary/10 px-2 py-1 text-xs text-primary'
                : 'rounded border px-2 py-1 text-xs text-muted-foreground'
            }
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
