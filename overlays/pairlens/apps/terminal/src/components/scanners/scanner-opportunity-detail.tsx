import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, Radar, RefreshCw } from 'lucide-react'
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
        maximumFractionDigits: value < 1 ? 6 : 2,
        notation: value >= 1e6 ? 'compact' : 'standard',
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
}: {
  selection: ScannerSelection
  onBack: () => void
  actionArea?: ReactNode
}) {
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
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3">
        <button
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" />
          Back to scanners
        </button>
        <button
          className={button}
          onClick={() =>
            askAssistant(
              `Read-only scanner research for exact base ${base}, venue ${venue}, strategy ${selection.kind === 'arbitrage' ? selection.strategy : 'strength'}. Read get_scanner_detail and current quote/order book for the exact listed venues. Explain the actual observed 24h history separately from constant-rate projections. Compare strengths, weaknesses, liquidity and funding risks using verified data. Fees and slippage are unknown unless independently verified. Do not invent scores or profitability. Do not prepare proposals, place orders, or change positions unless I separately ask.`,
              { send: true },
            )
          }
        >
          Analyze with assistant
        </button>
        <button
          className={button}
          aria-label="Refresh opportunity history"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw
            className={`size-3.5 ${query.isFetching ? 'animate-spin' : ''}`}
          />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
        <div className="mb-4 flex items-center gap-3">
          <Radar className="size-5 shrink-0 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">
              {base}{' '}
              <span className="text-xs font-normal text-muted-foreground">
                {comparison
                  ? selection.kind === 'arbitrage' &&
                    selection.strategy === 'mark'
                    ? 'Mark-gap arbitrage review'
                    : 'Funding arbitrage review'
                  : 'Strength detail'}
              </span>
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {comparison ? 'Hyperliquid + Lighter' : venueName(venue)} | Public
              market data
              {detail
                ? ` | Read ${new Date(detail.asOf).toLocaleTimeString()}`
                : ''}
            </p>
          </div>
        </div>
        {comparison &&
          selection.kind === 'arbitrage' &&
          selection.strategy === 'mark' && (
            <p className="mb-3 rounded-md border border-border p-3 text-xs text-muted-foreground">
              Price-gap strategy: long the lower indicative mark and short the
              higher mark. This is not an executable spread or guaranteed
              profit.{' '}
              {(comparison.fundingGapHourly ?? 0) < 0
                ? 'Selected legs currently pay net funding before costs.'
                : 'Funding carry may change before or after entry.'}
            </p>
          )}
        {comparison && (
          <dl className="mb-4 grid grid-cols-2 gap-x-4 border-y border-border">
            <Metric
              label="Signed funding carry / hour"
              value={scannerPercent(comparison.fundingGapHourly, true)}
              note={
                selection.kind === 'arbitrage' && selection.strategy === 'mark'
                  ? 'For the selected lower-mark long / higher-mark short'
                  : 'Lower funding long / higher funding short'
              }
            />
            <Metric
              label="Indicative mark gap"
              value={scannerPercent(comparison.markGapPct)}
              note="Percentage of midpoint; not executable profit"
            />
          </dl>
        )}
        {comparison && (
          <dl className="mb-4 grid grid-cols-1 gap-x-4 border-b border-border pb-2 sm:grid-cols-2">
            <Metric
              label="Flat-rate 24h carry per $1,000/leg"
              value={signedUsd(projectedCarry)}
              note="Before fees; assumes unchanged funding and constant dollar exposure"
            />
            <Metric
              label="Historical 24h carry per $1,000/leg"
              value={signedUsd(historicalCarry)}
              note={
                historicalCarry === null
                  ? 'Requires complete observations from both venues in the same 24h window'
                  : 'Gross historical illustration at constant exposure, not your actual PnL'
              }
            />
          </dl>
        )}
        <div
          className="mb-4 grid gap-3"
          style={{
            gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))',
          }}
        >
          {markets.map((market) => (
            <section
              className="min-w-0 rounded-lg border border-border bg-card p-3"
              key={market.venue}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-xs font-semibold">
                  <img
                    alt=""
                    className="size-4 object-contain"
                    src={`/posters/${market.venue === 'lighter' ? 'lighter-market-connector.svg' : 'hyperliquid-market-connector.png'}`}
                  />
                  {venueName(market.venue)}
                </h3>
                {comparison && (
                  <span className="rounded border border-border px-2 py-0.5 text-[10px]">
                    {scannerLegLabel(
                      market.venue,
                      comparison.longVenue,
                      'funding',
                    )}
                  </span>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3">
                <Metric label="Mark price" value={usd(market.price)} />
                <Metric
                  label="24h change"
                  value={scannerPercent(market.change24h)}
                />
                <Metric
                  label="Funding / hour"
                  value={scannerPercent(market.fundingHourly, true)}
                />
                <Metric
                  label="vs BTC (24h)"
                  value={
                    market.relativeStrength24h === null
                      ? 'Unavailable'
                      : `${market.relativeStrength24h.toFixed(2)} pp`
                  }
                />
                <Metric
                  label="24h quote volume"
                  value={usd(market.volume24h)}
                />
                <Metric
                  label="Open interest"
                  value={usd(market.openInterestUsd)}
                />
              </dl>
              <p
                className={`mt-1 text-[10px] ${Date.now() - market.observedAt > 90_000 ? 'text-amber-500' : 'text-muted-foreground'}`}
              >
                {Date.now() - market.observedAt > 90_000
                  ? 'Stale snapshot'
                  : 'Snapshot'}{' '}
                | {new Date(market.observedAt).toLocaleString()}
              </p>
              <a
                href={scannerMarketPath(market)}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                Open {market.base} chart
                <ExternalLink className="size-3" />
              </a>
            </section>
          ))}
        </div>
        {actionArea && <div className="mb-4">{actionArea}</div>}
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
            {query.error.message} Current snapshot metrics remain above; history
            is unavailable.
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
              Actual sums use completed hourly observations. Scenario = current
              hourly funding x 24 if unchanged; it is not historical performance
              or a forecast. Positive rates mean longs pay shorts. Fees and
              slippage are not included.
            </p>
          </section>
        )}
        <details className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer">Execution & risk</summary>
          <p className="mt-2 max-w-prose text-[11px] leading-relaxed">
            Markets, liquidity, funding and collateral are separate on each
            venue. Price differences are indicative marks. Fees, spread,
            slippage and liquidation can exceed funding income. Two venue orders
            do not execute atomically; a failed leg can leave directional
            exposure. Historical charts do not authorize an order.
          </p>
        </details>
      </div>
    </div>
  )
}
