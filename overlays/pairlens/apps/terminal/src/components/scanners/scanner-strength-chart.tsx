import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ScannerMarket } from '@/lib/scanners'
import { fetchScannerStrengthHistory } from '@/lib/scanner-strength-history'

const colors = [
  '#34d399',
  '#60a5fa',
  '#fbbf24',
  '#c084fc',
  '#fb7185',
  '#22d3ee',
  '#a3e635',
  '#f97316',
]
const choice =
  'min-h-8 rounded px-2 text-[10px] focus-visible:outline-2 focus-visible:outline-primary'
export function ScannerStrengthChart({
  markets,
}: {
  markets: Array<ScannerMarket>
}) {
  const [venue, setVenue] = useState<'lighter' | 'hyperliquid'>(
    markets[0]?.venue ?? 'lighter',
  )
  const [window, setWindow] = useState<'1d' | '7d' | '30d'>('7d')
  const [relative, setRelative] = useState(true)
  const [highlight, setHighlight] = useState<string | null>(null)
  const symbols = [
    ...new Set(
      markets.filter((row) => row.venue === venue).map((row) => row.symbol),
    ),
  ].slice(0, 8)
  const identity = symbols.join(',')
  const query = useQuery({
    queryKey: ['scanner-strength-history', venue, window, identity],
    queryFn: ({ signal }) =>
      fetchScannerStrengthHistory({ venue, window, symbols }, signal),
    enabled: symbols.length > 0,
    staleTime: 60000,
    refetchInterval: 120000,
    refetchIntervalInBackground: false,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const series = query.data?.series ?? []
  const visible = series.map((row) => ({
    ...row,
    points: row.points
      .map((point) => ({
        time: point.time,
        value: relative ? point.relativeStrengthPp : point.changePct,
      }))
      .filter(
        (point): point is { time: number; value: number } =>
          point.value !== null,
      ),
  }))
  const points = visible.flatMap((row) => row.points)
  const minTime = query.data?.windowStart ?? 0,
    maxTime = query.data?.windowEnd ?? 1
  const values = points.map((point) => point.value)
  const low = Math.min(0, ...values),
    high = Math.max(0, ...values),
    range = high - low || 1
  const padding = range * 0.08
  const y = (value: number) =>
    176 - ((value - low + padding) / (range + padding * 2)) * 154
  const x = (time: number) =>
    42 + ((time - minTime) / Math.max(1, maxTime - minTime)) * 590
  const cadence = window === '30d' ? 86400000 : 3600000
  return (
    <section className="mb-3 min-w-0 rounded-lg bg-muted/25 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold">
            {relative ? 'Relative strength vs BTC' : 'Price return'} ·{' '}
            {window === '1d'
              ? '24 hours'
              : window === '7d'
                ? '7 days'
                : '30 days'}
          </h3>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {symbols.length} sampled contracts · completed closes ·{' '}
            {relative
              ? 'percentage-point difference from BTC'
              : 'normalized from the window opening close'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <select
            aria-label="Strength history venue"
            value={venue}
            onChange={(event) =>
              setVenue(
                event.target.value === 'hyperliquid'
                  ? 'hyperliquid'
                  : 'lighter',
              )
            }
            className="min-h-8 rounded border border-border/60 bg-background px-2 text-[10px]"
          >
            <option value="lighter">Lighter</option>
            <option value="hyperliquid">Hyperliquid</option>
          </select>
          <div
            className="flex rounded bg-background/60"
            role="group"
            aria-label="Strength history window"
          >
            {(['1d', '7d', '30d'] as const).map((value) => (
              <button
                type="button"
                className={`${choice} ${window === value ? 'bg-accent' : ''}`}
                onClick={() => setWindow(value)}
                aria-pressed={window === value}
                key={value}
              >
                {value.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`${choice} border border-border/60`}
            aria-pressed={relative}
            onClick={() => setRelative(!relative)}
          >
            {relative ? 'vs BTC' : 'Raw return'}
          </button>
        </div>
      </div>
      {query.isPending && symbols.length > 0 ? (
        <p
          role="status"
          className="py-12 text-center text-xs text-muted-foreground"
        >
          Reading actual price history…
        </p>
      ) : query.isError ? (
        <p
          role="alert"
          className="py-8 text-center text-xs text-muted-foreground"
        >
          History could not be loaded. Current snapshot remains available below.
        </p>
      ) : points.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          No comparable history returned for these contracts. Try another venue
          or raw return.
        </p>
      ) : (
        <>
          <div
            className="mt-3 flex flex-wrap gap-x-3 gap-y-1"
            aria-label="Chart series"
          >
            {visible.map((row, index) => (
              <button
                type="button"
                key={row.symbol}
                className="inline-flex min-h-7 items-center gap-1.5 text-[10px]"
                onMouseEnter={() => setHighlight(row.symbol)}
                onMouseLeave={() => setHighlight(null)}
                onFocus={() => setHighlight(row.symbol)}
                onBlur={() => setHighlight(null)}
                onClick={() =>
                  setHighlight(highlight === row.symbol ? null : row.symbol)
                }
                aria-pressed={highlight === row.symbol}
              >
                <span
                  className="h-0.5 w-3"
                  style={{ background: colors[index % colors.length] }}
                />
                {row.base}
                <span className="font-mono text-muted-foreground">
                  {row.points.at(-1)?.value.toFixed(1) ?? '—'}
                  {relative ? ' pp' : '%'}
                </span>
              </button>
            ))}
          </div>
          <svg
            role="img"
            aria-label={`${relative ? 'BTC-relative strength' : 'Price return'} history for ${visible.length} contracts on ${venue}`}
            className="mt-1 h-52 w-full"
            viewBox="0 0 680 208"
            preserveAspectRatio="none"
          >
            {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
              const value = low + (high - low) * fraction
              return (
                <g key={fraction}>
                  <line
                    x1="42"
                    x2="632"
                    y1={y(value)}
                    y2={y(value)}
                    stroke="currentColor"
                    className="text-border"
                    strokeDasharray={value === 0 ? undefined : '2 4'}
                  />
                  <text
                    x="34"
                    y={y(value) + 3}
                    textAnchor="end"
                    className="fill-muted-foreground text-[9px]"
                  >
                    {value.toFixed(0)}
                    {relative ? 'pp' : '%'}
                  </text>
                </g>
              )
            })}
            {visible.map((row, index) => (
              <path
                key={row.symbol}
                d={row.points
                  .map(
                    (point, pointIndex) =>
                      `${pointIndex === 0 || point.time - row.points[pointIndex - 1].time > cadence * 1.5 ? 'M' : 'L'}${x(point.time).toFixed(1)},${y(point.value).toFixed(1)}`,
                  )
                  .join(' ')}
                fill="none"
                stroke={colors[index % colors.length]}
                strokeWidth={highlight === row.symbol ? 2.4 : 1.3}
                opacity={highlight && highlight !== row.symbol ? 0.5 : 1}
              >
                <title>
                  {row.symbol}: {row.points.length} observed closes
                </title>
              </path>
            ))}
            {[0, 0.5, 1].map((fraction) => (
              <text
                key={fraction}
                x={42 + 590 * fraction}
                y="201"
                textAnchor={
                  fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'
                }
                className="fill-muted-foreground text-[9px]"
              >
                {new Date(
                  minTime + (maxTime - minTime) * fraction,
                ).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </text>
            ))}
          </svg>
          <p className="mt-1 text-[9px] text-muted-foreground">
            {series.filter((row) => row.status !== 'ok').length
              ? `${series.filter((row) => row.status !== 'ok').length} contracts have partial or unavailable history. `
              : ''}
            Gaps are not interpolated. This sampled chart does not represent
            every market in the screener.
          </p>
        </>
      )}
      {query.data && (
        <p className="mt-1 text-[9px] text-muted-foreground">
          Through {new Date(query.data.windowEnd).toLocaleString()} - fetched{' '}
          {new Date(query.data.asOf).toLocaleTimeString()}
        </p>
      )}
    </section>
  )
}
