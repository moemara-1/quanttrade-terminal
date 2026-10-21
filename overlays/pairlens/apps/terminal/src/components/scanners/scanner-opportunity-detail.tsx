import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ExternalLink, Radar, RefreshCw, X } from 'lucide-react'
import { ScannerHistoryChart } from './scanner-history-chart'
import type { ArbitrageStrategy } from '@/lib/scanner-opportunity'
import type { ReactNode } from 'react'
import type { ScannerMarket, ScannerSnapshot } from '@/lib/scanners'
import {
  comparisonForStrategy,
  fundingCarryPerThousand,
} from '@/lib/scanner-opportunity'
import {
  scannerLegLabel,
  scannerMarketPath,
  scannerPercent,
} from '@/lib/scanners'
import { fetchScannerDetail } from '@/lib/scanner-detail'
import { askAssistant } from '@/stores/assistant-store'

export type ScannerSelection =
  | {
      kind: 'arbitrage'
      strategy: ArbitrageStrategy
      comparison: ScannerSnapshot['comparisons'][number]
    }
  | { kind: 'strength'; market: ScannerMarket }
const usd = (value: number | null) =>
  value === null
    ? 'Unavailable'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: Math.abs(value) < 1 ? 6 : 2,
        notation: Math.abs(value) >= 1e6 ? 'compact' : 'standard',
      }).format(value)
const venueName = (venue: string) =>
  venue === 'hyperliquid' ? 'Hyperliquid' : 'Lighter'
const button =
  'rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary'
function Metric({
  label,
  value,
  note,
}: {
  label: string
  value: ReactNode
  note?: string
}) {
  return (
    <div className="min-w-0 py-2">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-sm tabular-nums">{value}</dd>
      {note && <p className="mt-1 text-[10px] text-muted-foreground">{note}</p>}
    </div>
  )
}
export function ScannerOpportunityDetail({
  selection,
  onBack,
  actionArea,
  active = true,
  busy = false,
}: {
  selection: ScannerSelection
  onBack: () => void
  actionArea?: ReactNode
  active?: boolean
  busy?: boolean
}) {
  const [tab, setTab] = useState<'overview' | 'history' | 'trade'>(
    selection.kind === 'arbitrage' ? 'trade' : 'overview',
  )
  const headingRef = useRef<HTMLHeadingElement>(null)
  const panelId = useId()
  useEffect(() => {
    if (active) headingRef.current?.focus()
  }, [active])
  const [chart, setChart] = useState<'price' | 'relative' | 'funding'>('price')
  const comparison =
    selection.kind === 'arbitrage'
      ? comparisonForStrategy(selection.comparison, selection.strategy)
      : null
  const markets = comparison
    ? [comparison.hyperliquid, comparison.lighter]
    : selection.kind === 'strength'
      ? [selection.market]
      : []
  const base = markets[0]?.base ?? ''
  const venue = selection.kind === 'strength' ? selection.market.venue : 'all'
  const query = useQuery({
    queryKey: ['scanner-detail', base, venue],
    queryFn: ({ signal }) => fetchScannerDetail(base, venue, signal),
    enabled: active,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const detail = query.data
  const historical = detail?.venues ?? []
  const selectedLong = comparison?.longVenue
    ? markets.find((market) => market.venue === comparison.longVenue)
    : undefined
  const selectedShort = comparison?.shortVenue
    ? markets.find((market) => market.venue === comparison.shortVenue)
    : undefined
  const projectedCarry = fundingCarryPerThousand(
    selectedLong?.fundingHourly ?? null,
    selectedShort?.fundingHourly ?? null,
    24,
  )
  const historicalCarry = fundingCarryPerThousand(
    historical.find((item) => item.venue === comparison?.longVenue)?.funding
      .actual24h ?? null,
    historical.find((item) => item.venue === comparison?.shortVenue)?.funding
      .actual24h ?? null,
    1,
  )
  const signedUsd = (value: number | null) =>
    value === null ? 'Unavailable' : `${value > 0 ? '+' : ''}${usd(value)}`

  const chartMode = comparison
    ? chart === 'funding'
      ? 'funding'
      : 'price'
    : chart === 'relative'
      ? 'relative'
      : 'price'
  const series = historical.map((item) => ({
    label: venueName(item.venue),
    className: item.venue === 'hyperliquid' ? 'text-primary' : 'text-amber-400',
    points:
      chartMode === 'funding'
        ? item.funding.samples.map((point) => ({
            time: point.time,
            value: point.rate,
          }))
        : item.price.points.flatMap((point) =>
            chartMode === 'relative'
              ? point.relativeStrengthPp === null
                ? []
                : [{ time: point.time, value: point.relativeStrengthPp }]
              : [
                  {
                    time: point.time,
                    value: comparison ? point.changePct : point.close,
                  },
                ],
          ),
  }))
  const tabs = [
    ...(comparison ? ['trade'] : []),
    'overview',
    'history',
  ] as Array<'overview' | 'history' | 'trade'>
  return (
    <div
      className="mx-auto flex h-full min-h-0 w-full max-w-none flex-col bg-background text-foreground"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          if (!busy) onBack()
        }
      }}
    >
      <header className="shrink-0 border-b border-border px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="flex items-center gap-2 text-base font-semibold outline-none"
            >
              <Radar className="size-4 shrink-0 text-primary" />
              {comparison ? 'Review arbitrage' : base}
              <span className="truncate text-[11px] font-normal text-muted-foreground">
                {comparison
                  ? selection.kind === 'arbitrage' &&
                    selection.strategy === 'mark'
                    ? `${base} / Mark gap`
                    : `${base} / Funding pair`
                  : 'Strength'}
              </span>
            </h2>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {comparison ? 'Hyperliquid + Lighter' : venueName(venue)}
              {detail
                ? ` | Read ${new Date(detail.asOf).toLocaleTimeString()}`
                : ''}
            </p>
          </div>
          <button
            aria-label="Close opportunity details"
            title={
              busy
                ? 'Wait for the current request to finish'
                : 'Close details (Esc)'
            }
            disabled={busy}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            onClick={onBack}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div
            className="flex min-w-0 gap-1"
            role="tablist"
            aria-label="Opportunity sections"
          >
            {tabs.map((item) => (
              <button
                type="button"
                key={item}
                data-tab={item}
                role="tab"
                id={`${panelId}-${item}-tab`}
                aria-controls={`${panelId}-${item}`}
                aria-selected={tab === item}
                tabIndex={tab === item ? 0 : -1}
                className={`rounded-md px-3 py-1.5 text-xs capitalize ${tab === item ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setTab(item)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault()
                    const next =
                      tabs[
                        (tabs.indexOf(item) +
                          (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) %
                          tabs.length
                      ]
                    setTab(next)
                    event.currentTarget.parentElement
                      ?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)
                      ?.focus()
                  }
                }}
              >
                {item === 'trade'
                  ? 'Review'
                  : item === 'overview'
                    ? 'Details'
                    : 'History'}
              </button>
            ))}
          </div>
          <button
            className="rounded p-1.5 text-muted-foreground hover:bg-accent"
            aria-label="Refresh opportunity history"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw
              className={`size-3.5 ${query.isFetching ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        <section
          role="tabpanel"
          id={`${panelId}-overview`}
          aria-labelledby={`${panelId}-overview-tab`}
          hidden={tab !== 'overview'}
        >
          <div className="divide-y divide-border rounded-md border border-border">
            {markets.map((market) => (
              <div key={market.venue} className="px-3 py-2.5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-1.5 text-xs font-medium">
                      <img
                        alt=""
                        className="size-3.5 object-contain"
                        src={`/posters/${market.venue === 'lighter' ? 'lighter-market-connector.svg' : 'hyperliquid-market-connector.png'}`}
                      />
                      {venueName(market.venue)}
                    </h3>
                    {comparison && (
                      <span className="mt-1 block text-[10px] text-muted-foreground">
                        {scannerLegLabel(
                          market.venue,
                          comparison.longVenue,
                          'funding',
                        )}
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-xs tabular-nums">
                      {usd(market.price)}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Mark
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-xs tabular-nums">
                      {scannerPercent(market.fundingHourly, true)}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Funding / h
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                  <span>
                    24h {scannerPercent(market.change24h)} | Vol{' '}
                    {usd(market.volume24h)}
                  </span>
                  <a
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    href={scannerMarketPath(market)}
                  >
                    Chart
                    <ExternalLink className="size-2.5" />
                  </a>
                </div>
                <p
                  className={`mt-1 text-[9px] ${Date.now() - market.observedAt > 90_000 ? 'text-amber-500' : 'text-muted-foreground'}`}
                >
                  {Date.now() - market.observedAt > 90_000
                    ? 'Stale snapshot'
                    : 'Snapshot'}{' '}
                  {new Date(market.observedAt).toLocaleTimeString()}
                </p>
              </div>
            ))}
          </div>
          {comparison ? (
            <>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 border-b border-border pb-2">
                <Metric
                  label="Funding carry / hour"
                  value={scannerPercent(comparison.fundingGapHourly, true)}
                />
                <Metric
                  label="Indicative mark gap"
                  value={scannerPercent(comparison.markGapPct)}
                />
                <Metric
                  label="Flat-rate 24h / $1,000 per leg"
                  value={signedUsd(projectedCarry)}
                />
                <Metric
                  label="Historical 24h / $1,000 per leg"
                  value={signedUsd(historicalCarry)}
                />
              </dl>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                Gross illustrations before fees at constant dollar exposure.
                Flat-rate assumes unchanged funding; historical needs complete
                same-window observations. Neither is your actual PnL.
              </p>
              {selection.kind === 'arbitrage' &&
                selection.strategy === 'mark' && (
                  <p className="mt-2 text-[10px] leading-relaxed text-amber-500">
                    Lower-mark long / higher-mark short. Marks are not
                    executable spreads.
                    {(comparison.fundingGapHourly ?? 0) < 0
                      ? ' Selected legs currently pay net funding.'
                      : ''}
                  </p>
                )}
              <button
                className="mt-3 flex w-full items-center justify-between rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                onClick={() => setTab('trade')}
              >
                Review paired entry
                <ArrowRight className="size-3.5" />
              </button>
            </>
          ) : (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 border-b border-border pb-2">
              <Metric
                label="24h change"
                value={scannerPercent(markets[0]?.change24h ?? null)}
              />
              <Metric
                label="vs BTC (24h)"
                value={
                  markets[0]?.relativeStrength24h === null
                    ? 'Unavailable'
                    : `${markets[0]?.relativeStrength24h?.toFixed(2)} pp`
                }
              />
              <Metric
                label="Open interest"
                value={usd(markets[0]?.openInterestUsd ?? null)}
              />
              <Metric
                label="OI / 24h volume"
                value={
                  markets[0]?.oiToVolume === null
                    ? 'Unavailable'
                    : `${markets[0]?.oiToVolume?.toFixed(2)}x`
                }
              />
            </dl>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={button} onClick={() => setTab('history')}>
              Explore 24h history
            </button>
            <button
              className={button}
              onClick={() =>
                askAssistant(
                  `Read-only scanner research for exact base ${base}, venue ${venue}, strategy ${selection.kind === 'arbitrage' ? selection.strategy : 'strength'}. Read get_scanner_detail and current quote/order book for the exact listed venues. Explain actual observed 24h history separately from constant-rate projections. Compare strengths, weaknesses, liquidity and funding risks using verified data. Fees and slippage are unknown unless independently verified. Do not invent scores or profitability. Do not prepare proposals, place orders, or change positions unless I separately ask.`,
                  { send: true },
                )
              }
            >
              Analyze with assistant
            </button>
          </div>
        </section>
        <section
          role="tabpanel"
          id={`${panelId}-history`}
          aria-labelledby={`${panelId}-history-tab`}
          hidden={tab !== 'history'}
        >
          <div
            className="mb-3 flex flex-wrap gap-1"
            role="group"
            aria-label="Opportunity chart"
          >
            {(comparison
              ? [
                  ['price', 'Price performance'],
                  ['funding', 'Funding history'],
                ]
              : [
                  ['price', 'Price history'],
                  ['relative', 'vs BTC history'],
                ]
            ).map(([id, label]) => (
              <button
                key={id}
                className={`${button} ${chartMode === id ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
                aria-pressed={chartMode === id}
                onClick={() =>
                  setChart(
                    id === 'funding'
                      ? 'funding'
                      : id === 'relative'
                        ? 'relative'
                        : 'price',
                  )
                }
              >
                {label}
              </button>
            ))}
          </div>
          {query.isPending && (
            <p
              role="status"
              className="rounded-lg border border-border py-12 text-center text-xs text-muted-foreground"
            >
              Reading actual 24h history...
            </p>
          )}
          {query.isError && (
            <p
              role="alert"
              className="mb-3 rounded-md border border-border p-3 text-xs text-destructive"
            >
              {query.error.message} Current snapshot metrics remain above;
              history is unavailable.
            </p>
          )}
          {detail && (
            <>
              <ScannerHistoryChart
                title={
                  chartMode === 'funding'
                    ? 'Last 24 completed hours: funding'
                    : chartMode === 'relative'
                      ? '24h performance relative to BTC'
                      : comparison
                        ? '24h price performance'
                        : '24h price history'
                }
                series={series}
                unit={
                  chartMode === 'funding'
                    ? 'signed hourly rate'
                    : chartMode === 'relative'
                      ? 'percentage points'
                      : comparison
                        ? 'change from first observed close'
                        : 'USD'
                }
                formatValue={(value) =>
                  chartMode === 'funding'
                    ? scannerPercent(value, true)
                    : chartMode === 'relative'
                      ? `${value.toFixed(2)} pp`
                      : comparison
                        ? scannerPercent(value)
                        : usd(value)
                }
              />
              <p className="mt-2 text-[10px] text-muted-foreground">
                {new Date(detail.windowStart).toLocaleString()} to{' '}
                {new Date(detail.windowEnd).toLocaleString()}. Gaps are missing
                observations, not flat rates.
              </p>
              {historical.map(
                (item) =>
                  (chartMode === 'funding'
                    ? item.funding.message
                    : item.price.message) && (
                    <p
                      key={item.venue}
                      className="mt-1 text-[11px] text-amber-500"
                    >
                      {venueName(item.venue)}:{' '}
                      {chartMode === 'funding'
                        ? item.funding.message
                        : item.price.message}
                    </p>
                  ),
              )}
            </>
          )}
          {comparison && detail && (
            <section className="mt-4 rounded-lg border border-border bg-card p-3">
              <h3 className="mb-2 text-xs font-semibold">
                Actual funding vs flat-rate scenario
              </h3>
              <div className="overflow-auto">
                <table className="w-full min-w-[480px] text-left text-xs">
                  <thead className="text-[10px] text-muted-foreground">
                    <tr>
                      {[
                        'Venue',
                        'Observed hours',
                        'Actual 24h sum',
                        'Partial observed sum',
                        'Next 24h scenario',
                      ].map((label) => (
                        <th className="px-2 py-2 font-medium" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {historical.map((item) => (
                      <tr className="border-t border-border" key={item.venue}>
                        <td className="px-2 py-2">{venueName(item.venue)}</td>
                        <td className="px-2 py-2">
                          {item.funding.sampleCount}/
                          {item.funding.expectedSamples}
                        </td>
                        <td className="px-2 py-2 font-mono">
                          {scannerPercent(item.funding.actual24h, true)}
                        </td>
                        <td className="px-2 py-2 font-mono">
                          {item.funding.actual24h === null
                            ? scannerPercent(item.funding.observedSum, true)
                            : 'Full coverage'}
                        </td>
                        <td className="px-2 py-2 font-mono">
                          {scannerPercent(item.projected24hFunding, true)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                Actual sums use completed hourly observations. Scenario =
                current hourly funding x 24 if unchanged; it is not historical
                performance or a forecast. Positive rates mean longs pay shorts.
                Fees and slippage are not included.
              </p>
            </section>
          )}
        </section>
        <section
          role="tabpanel"
          id={`${panelId}-trade`}
          aria-labelledby={`${panelId}-trade-tab`}
          hidden={tab !== 'trade'}
        >
          {comparison && (
            <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border pb-3">
              <div>
                <p className="text-[10px] text-muted-foreground">
                  Net funding / hour
                </p>
                <p
                  className={`mt-1 text-sm font-semibold tabular-nums ${(comparison.fundingGapHourly ?? 0) < 0 ? 'text-destructive' : 'text-primary'}`}
                >
                  {scannerPercent(comparison.fundingGapHourly, true)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">
                  Observed 24h / $1,000 per leg
                </p>
                <p className="mt-1 text-sm font-medium tabular-nums">
                  {signedUsd(historicalCarry)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">
                  Mark gap before costs
                </p>
                <p className="mt-1 text-sm font-medium tabular-nums">
                  {scannerPercent(comparison.markGapPct)}
                </p>
              </div>
            </div>
          )}
          {actionArea}
        </section>
        <details className="mt-3 border-t border-border pt-2 text-[10px] text-muted-foreground">
          <summary className="w-fit cursor-pointer">
            Methodology & execution risk
          </summary>
          <p className="mt-2 leading-relaxed">
            Positive funding means longs pay shorts. Mark gaps exclude fees,
            spread and slippage. Historical sums use completed hours; projected
            rates assume no change. Separate exchange collateral and liquidation
            risk remain. Paired orders are not atomic; a failed leg may leave
            exposure.
          </p>
        </details>
      </div>
    </div>
  )
}
