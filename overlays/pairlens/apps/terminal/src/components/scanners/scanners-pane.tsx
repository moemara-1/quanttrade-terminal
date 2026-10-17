import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, RefreshCw, ScanLine } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ScannerMarket, ScannerSnapshot } from '@/lib/scanners'
import {
  SCANNER_QUERY_KEY,
  fetchScannerSnapshot,
  fetchScannerSparkline,
  filterScannerMarkets,
  scannerLegLabel,
  scannerMarketPath,
  scannerPercent,
} from '@/lib/scanners'

const money = (value: number | null) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: value < 1 ? 6 : 2,
        notation: value >= 1e6 ? 'compact' : 'standard',
      }).format(value)
const number = (value: number | null) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 2,
        notation: Math.abs(value) >= 1e6 ? 'compact' : 'standard',
      }).format(value)
const time = (value: number) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const control =
  'rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-primary'
type Section = 'arbitrage' | 'crowding' | 'strength' | 'options'
function VenueLink({
  market,
  label,
}: {
  market: ScannerMarket
  label?: string
}) {
  return (
    <a
      className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary"
      href={scannerMarketPath(market)}
    >
      <img
        alt=""
        className="size-3.5 object-contain"
        src={`/posters/${market.venue === 'lighter' ? 'lighter-market-connector.svg' : 'hyperliquid-market-connector.png'}`}
      />
      {label ?? (market.venue === 'lighter' ? 'Lighter' : 'Hyperliquid')}
    </a>
  )
}
function Card({
  title,
  description,
  children,
  open,
  expanded,
}: {
  title: string
  description: string
  children: ReactNode
  open: () => void
  expanded: boolean
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <ScanLine className="size-3.5 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      <div className="px-3 pt-2 pb-1">
        {children}
        <details className="border-t border-border py-2 text-[10px] text-muted-foreground">
          <summary className="w-fit cursor-pointer hover:text-foreground">
            Methodology & coverage
          </summary>
          <p className="mt-2 max-w-prose leading-relaxed">{description}</p>
        </details>
      </div>
      {!expanded && (
        <button
          className="flex w-full items-center justify-between border-t border-border px-3 py-2 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary"
          onClick={open}
        >
          View all{' '}
          {title === 'Arbitrage scanner'
            ? 'arbitrage'
            : title === 'Strength scanner'
              ? 'strength'
              : title === 'Funding & crowding'
                ? 'funding'
                : 'options'}
          <ArrowRight className="size-3" />
        </button>
      )}
    </section>
  )
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="py-5 text-center text-xs text-muted-foreground">{children}</p>
  )
}
function Sparkline({ market }: { market: ScannerMarket }) {
  const query = useQuery({
    queryKey: ['scanner-preview-candles', market.venue, market.symbol],
    queryFn: ({ signal }) => fetchScannerSparkline(market, signal),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
  return query.data ? (
    <svg
      role="img"
      aria-label={`${market.base} recent hourly closes`}
      className="h-6 w-[72px] shrink-0 text-muted-foreground"
      viewBox="0 0 72 24"
    >
      <path
        d={query.data}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  ) : null
}
function ReportSummary({ rows }: { rows: Array<ScannerMarket> }) {
  const gainers = rows.filter((row) => row.change24h > 0).length
  const losers = rows.filter((row) => row.change24h < 0).length
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-y border-border py-2 text-[11px]">
      <span>
        <strong>{rows.length}</strong> markets
      </span>
      <span className="text-green-500">{gainers} up</span>
      <span className="text-red-400">{losers} down</span>
      <span className="text-muted-foreground">
        24h volume{' '}
        {money(rows.reduce((total, row) => total + row.volume24h, 0))}
      </span>
    </div>
  )
}
function MarketResults({ rows }: { rows: Array<ScannerMarket> }) {
  return (
    <>
      <ReportSummary rows={rows} />
      <div className="max-h-[65vh] overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[900px] text-left text-xs tabular-nums">
          <thead className="sticky top-0 z-10 bg-card text-[10px] text-muted-foreground">
            <tr>
              {[
                '#',
                'Market',
                'Mark price',
                '24h move',
                'vs BTC (pp)',
                'Funding / h',
                'OI USD',
                'OI / volume',
                '24h volume',
                'Observed',
              ].map((title) => (
                <th
                  className="whitespace-nowrap px-3 py-2 font-medium"
                  key={title}
                >
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                className="border-t border-border hover:bg-accent/40"
                key={`${row.venue}:${row.symbol}`}
              >
                <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                <td className="px-3 py-2">
                  <a
                    className="font-semibold hover:underline"
                    href={scannerMarketPath(row)}
                  >
                    {row.base}
                  </a>
                  <div>
                    <VenueLink market={row} />
                  </div>
                </td>
                <td className="px-3 py-2 font-mono">{money(row.price)}</td>
                <td
                  className={`px-3 py-2 font-mono ${row.change24h >= 0 ? 'text-green-500' : 'text-red-400'}`}
                >
                  {scannerPercent(row.change24h)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {number(row.relativeStrength24h)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {scannerPercent(row.fundingHourly, true)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {money(row.openInterestUsd)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {number(row.oiToVolume)}
                  {row.oiToVolume === null ? '' : 'x'}
                </td>
                <td className="px-3 py-2 font-mono">{money(row.volume24h)}</td>
                <td
                  className="whitespace-nowrap px-3 py-2 text-muted-foreground"
                  title={new Date(row.observedAt).toLocaleString()}
                >
                  {time(row.observedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No markets match these filters.</Empty>}
      </div>
    </>
  )
}
function ArbitrageResults({
  rows,
  mode,
}: {
  rows: ScannerSnapshot['comparisons']
  mode: 'funding' | 'mark'
}) {
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 border-y border-border py-2 text-[11px]">
        <span>
          <strong>{rows.length}</strong> matched markets
        </span>
        <span className="text-muted-foreground">
          {mode === 'funding'
            ? 'Ranked by hourly funding difference'
            : 'Ranked by mark gap (% of midpoint)'}
        </span>
        <span className="text-muted-foreground">
          Both legs meet volume filter
        </span>
      </div>
      <div className="max-h-[65vh] overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[1100px] text-left text-xs tabular-nums">
          <thead className="sticky top-0 z-10 bg-card text-[10px] text-muted-foreground">
            <tr>
              {[
                '#',
                'Market',
                'Funding gap / h',
                'Mark gap',
                'Hyperliquid mark',
                'Lighter mark',
                'HL funding / h',
                'Lighter funding / h',
                'HL 24h volume',
                'Lighter 24h volume',
                'Compare legs',
              ].map((title) => (
                <th
                  key={title}
                  className="whitespace-nowrap px-3 py-2 font-medium"
                >
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                className="border-t border-border hover:bg-accent/40"
                key={row.base}
              >
                <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                <td className="px-3 py-2 font-semibold">{row.base}</td>
                <td className="px-3 py-2 font-mono">
                  {scannerPercent(row.fundingGapHourly, true)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {scannerPercent(row.markGapPct)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {money(row.hyperliquid.price)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {money(row.lighter.price)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {scannerPercent(row.hyperliquid.fundingHourly, true)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {scannerPercent(row.lighter.fundingHourly, true)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {money(row.hyperliquid.volume24h)}
                </td>
                <td className="px-3 py-2 font-mono">
                  {money(row.lighter.volume24h)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col items-start gap-1">
                    <VenueLink
                      market={row.hyperliquid}
                      label={`${scannerLegLabel('hyperliquid', mode === 'funding' ? row.longVenue : row.lowerMarkVenue, mode)} | HL`}
                    />
                    <VenueLink
                      market={row.lighter}
                      label={`${scannerLegLabel('lighter', mode === 'funding' ? row.longVenue : row.lowerMarkVenue, mode)} | Lighter`}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <Empty>No matching comparison in this snapshot.</Empty>
        )}
      </div>
    </>
  )
}
export function ScannersPane() {
  const [expanded, setExpanded] = useState<Section | null>(null)
  const [search, setSearch] = useState('')
  const [venue, setVenue] = useState('all')
  const [minVolume, setMinVolume] = useState(0)
  const [arb, setArb] = useState<'funding' | 'mark'>('funding')
  const [strength, setStrength] = useState<'gainers' | 'losers' | 'relative'>(
    'gainers',
  )
  const [options, setOptions] = useState<'blocks' | 'overview'>('blocks')
  const query = useQuery({
    queryKey: SCANNER_QUERY_KEY,
    queryFn: ({ signal }) => fetchScannerSnapshot(signal),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  })
  const data = query.data
  const allMarkets = filterScannerMarkets(
    data?.markets ?? [],
    search,
    venue,
    minVolume,
  )
  const comparisons = (data?.comparisons ?? [])
    .filter(
      (row) =>
        filterScannerMarkets(
          [row.hyperliquid, row.lighter],
          search,
          'all',
          minVolume,
        ).length === 2,
    )
    .sort(
      (a, b) =>
        Math.abs(arb === 'funding' ? (b.fundingGapHourly ?? 0) : b.markGapPct) -
        Math.abs(arb === 'funding' ? (a.fundingGapHourly ?? 0) : a.markGapPct),
    )
  const crowds = allMarkets
    .filter((row) => row.fundingHourly !== null)
    .sort(
      (a, b) => Math.abs(b.fundingHourly ?? 0) - Math.abs(a.fundingHourly ?? 0),
    )
  const strengths = allMarkets
    .filter(
      (row) => strength !== 'relative' || row.relativeStrength24h !== null,
    )
    .sort((a, b) =>
      strength === 'losers'
        ? a.change24h - b.change24h
        : strength === 'relative'
          ? (b.relativeStrength24h ?? -Infinity) -
            (a.relativeStrength24h ?? -Infinity)
          : b.change24h - a.change24h,
    )
  const limit = <T,>(rows: Array<T>) => (expanded ? rows : rows.slice(0, 3))
  const failures = [
    ...(data?.sources ?? []),
    ...(data?.options.sources ?? []),
  ].filter((row) => row.status === 'error' || row.message !== null)
  const optionBlocks =
    data?.options.trades.filter(
      (row) =>
        !search || row.instrument.toUpperCase().includes(search.toUpperCase()),
    ) ?? []
  const optionsUnavailable =
    !!data &&
    data.options.sources.filter((row) => row.id.endsWith('-trades')).length >
      0 &&
    data.options.sources
      .filter((row) => row.id.endsWith('-trades'))
      .every((row) => row.status === 'error')
  const stale = !!data && Date.now() - data.asOf > 90_000
  const tabs = (
    items: Array<[string, string]>,
    value: string,
    onChange: (value: string) => void,
  ) => (
    <div className="mb-2 flex flex-wrap gap-1" role="group">
      {items.map(([id, label]) => (
        <button
          key={id}
          aria-pressed={value === id}
          className={`${control} ${value === id ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  )
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3">
        <div>
          <h1 className="text-sm font-semibold">Discovery scanners</h1>
          <p className="text-[11px] text-muted-foreground">
            Lighter · Hyperliquid · Deribit{' '}
            {data ? `· Read ${time(data.asOf)}` : ''}
          </p>
        </div>
        <button
          aria-label="Refresh scanners"
          className={control}
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw
            className={`size-3.5 ${query.isFetching ? 'animate-spin' : ''}`}
          />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {expanded && (
          <button
            className="mb-3 flex items-center gap-2 text-xs hover:underline"
            onClick={() => setExpanded(null)}
          >
            <ArrowLeft className="size-3" />
            All scanners
          </button>
        )}
        <div className="mb-3 flex flex-wrap gap-2">
          <input
            aria-label="Search scanner symbols"
            className={`${control} min-w-0 flex-1`}
            placeholder="Search symbols…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="Scanner venue"
            className={control}
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
          >
            <option value="all">Both venues</option>
            <option value="lighter">Lighter</option>
            <option value="hyperliquid">Hyperliquid</option>
          </select>
          <select
            aria-label="Minimum 24 hour quote volume"
            className={control}
            value={minVolume}
            onChange={(e) => setMinVolume(Number(e.target.value))}
          >
            <option value={0}>Any volume</option>
            <option value={1000000}>24h ≥ $1m</option>
            <option value={10000000}>24h ≥ $10m</option>
          </select>
        </div>
        {query.isPending && (
          <Empty>Reading public markets and options tape…</Empty>
        )}
        {query.isError && (
          <p
            role="alert"
            className="mb-3 rounded border border-border p-3 text-xs text-destructive"
          >
            {query.error.message}{' '}
            {data ? 'Last successful snapshot remains below.' : ''}
          </p>
        )}
        {stale && (
          <p role="status" className="mb-3 text-xs text-amber-500">
            Stale snapshot · last read {time(data.asOf)}. Do not use this as a
            live quote.
          </p>
        )}
        {data && (
          <details className="mb-2 text-[10px] text-muted-foreground">
            <summary className="w-fit cursor-pointer">
              Source coverage | {data.markets.length} perpetual markets
            </summary>
            <p className="mt-1">
              {[...data.sources, ...data.options.sources]
                .filter((row) => row.status === 'ok')
                .map((row) => `${row.id}: ${row.count}`)
                .join(' | ')}
            </p>
          </details>
        )}
        {failures.length > 0 && (
          <details className="mb-3 text-xs text-muted-foreground">
            <summary>
              Partial coverage · {failures.length} source coverage warnings
            </summary>
            {failures.map((row) => (
              <p className="py-1" key={row.id}>
                {row.id}: {row.message ?? 'Unavailable'}
              </p>
            ))}
          </details>
        )}
        {data && (
          <div
            className="grid min-w-0 gap-3"
            style={{
              gridTemplateColumns: expanded
                ? 'minmax(0, 1fr)'
                : 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
            }}
          >
            {(!expanded || expanded === 'arbitrage') && (
              <Card
                title="Arbitrage scanner"
                description="Hourly funding differences and indicative mark gaps (% of midpoint). Positive funding: longs pay shorts. Gaps exclude fees, slippage and execution costs. Always compares both venues; minimum volume applies to both legs."
                expanded={!!expanded}
                open={() => setExpanded('arbitrage')}
              >
                {tabs(
                  [
                    ['funding', 'Funding'],
                    ['mark', 'Mark gaps'],
                  ],
                  arb,
                  (value) => setArb(value === 'mark' ? 'mark' : 'funding'),
                )}
                {expanded ? (
                  <ArbitrageResults
                    rows={comparisons.filter(
                      (row) => arb === 'mark' || row.fundingGapHourly !== null,
                    )}
                    mode={arb}
                  />
                ) : (
                  limit(
                    comparisons.filter(
                      (row) => arb === 'mark' || row.fundingGapHourly !== null,
                    ),
                  ).map((row) => (
                    <div
                      className="border-t border-border py-2 first:border-0"
                      key={row.base}
                    >
                      <div className="flex justify-between gap-2 text-xs">
                        <strong>{row.base}</strong>
                        <span className="font-mono tabular-nums">
                          {arb === 'funding'
                            ? scannerPercent(row.fundingGapHourly, true)
                            : scannerPercent(row.markGapPct)}
                          {arb === 'funding' ? ' / h' : ''}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <VenueLink
                          market={row.hyperliquid}
                          label={`${scannerLegLabel('hyperliquid', arb === 'funding' ? row.longVenue : row.lowerMarkVenue, arb)} · HL`}
                        />
                        <VenueLink
                          market={row.lighter}
                          label={`${scannerLegLabel('lighter', arb === 'funding' ? row.longVenue : row.lowerMarkVenue, arb)} · Lighter`}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        HL {money(row.hyperliquid.price)} · Lighter{' '}
                        {money(row.lighter.price)}
                      </p>
                    </div>
                  ))
                )}
                {comparisons.length === 0 && (
                  <Empty>No matching comparison in this snapshot.</Empty>
                )}
              </Card>
            )}
            {(!expanded || expanded === 'crowding') && (
              <Card
                title="Funding & crowding"
                description="Ranked by absolute hourly funding. OI / 24h quote volume is a crowding proxy, not order-book imbalance or options skew."
                expanded={!!expanded}
                open={() => setExpanded('crowding')}
              >
                {expanded ? (
                  <MarketResults
                    rows={crowds.filter((row) => row.fundingHourly !== null)}
                  />
                ) : (
                  limit(crowds.filter((row) => row.fundingHourly !== null)).map(
                    (row) => (
                      <div
                        className="flex items-center justify-between gap-3 border-t border-border py-2 first:border-0"
                        key={`${row.venue}:${row.symbol}`}
                      >
                        <div>
                          <a
                            className="text-xs font-semibold hover:underline"
                            href={scannerMarketPath(row)}
                          >
                            {row.base}
                          </a>
                          <div>
                            <VenueLink market={row} />
                          </div>
                        </div>
                        <div className="text-right text-xs">
                          <div className="font-mono">
                            {scannerPercent(row.fundingHourly, true)} / h
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            OI / vol {number(row.oiToVolume)}
                            {row.oiToVolume === null ? '' : '×'}
                          </div>
                        </div>
                      </div>
                    ),
                  )
                )}
                {crowds.length === 0 && (
                  <Empty>No markets match these filters.</Empty>
                )}
              </Card>
            )}
            {(!expanded || expanded === 'strength') && (
              <Card
                title="Strength scanner"
                description="24h market moves. BTC-relative strength is the percentage-point difference from BTC on the same venue. This is not a trade recommendation."
                expanded={!!expanded}
                open={() => setExpanded('strength')}
              >
                {tabs(
                  [
                    ['gainers', 'Gainers'],
                    ['losers', 'Losers'],
                    ['relative', 'vs BTC'],
                  ],
                  strength,
                  (value) =>
                    setStrength(
                      value === 'losers'
                        ? 'losers'
                        : value === 'relative'
                          ? 'relative'
                          : 'gainers',
                    ),
                )}
                {expanded ? (
                  <MarketResults rows={strengths} />
                ) : (
                  limit(strengths).map((row) => (
                    <div
                      className="flex justify-between gap-2 border-t border-border py-2 first:border-0"
                      key={`${row.venue}:${row.symbol}`}
                    >
                      <div>
                        <a
                          href={scannerMarketPath(row)}
                          className="text-xs font-semibold hover:underline"
                        >
                          {row.base}
                        </a>
                        <div>
                          <VenueLink market={row} />
                        </div>
                      </div>
                      <Sparkline market={row} />
                      <div className="text-right text-xs">
                        <div className="font-mono">{money(row.price)}</div>
                        <div
                          className={
                            row.change24h >= 0
                              ? 'text-green-500'
                              : 'text-red-400'
                          }
                        >
                          {scannerPercent(row.change24h)} 24h
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          BTC{' '}
                          {row.relativeStrength24h === null
                            ? '—'
                            : `${row.relativeStrength24h > 0 ? '+' : ''}${row.relativeStrength24h.toFixed(2)} pp`}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                {strengths.length === 0 && (
                  <Empty>No markets match these filters.</Empty>
                )}
              </Card>
            )}
            {(!expanded || expanded === 'options') && (
              <Card
                title="Options desk · Deribit"
                description="BTC / ETH native options. Actual block-trade legs only; taker buy/sell does not establish investor intent. Venue and quote-volume filters apply to perpetual scanners only."
                expanded={!!expanded}
                open={() => setExpanded('options')}
              >
                {tabs(
                  [
                    ['blocks', 'Block legs'],
                    ['overview', 'Market overview'],
                  ],
                  options,
                  (value) =>
                    setOptions(value === 'overview' ? 'overview' : 'blocks'),
                )}
                {options === 'blocks' ? (
                  <>
                    {limit(optionBlocks).map((row) => (
                      <div
                        className="border-t border-border py-2 first:border-0"
                        key={row.id}
                      >
                        <div className="flex justify-between gap-2 text-xs">
                          <strong className="break-all">
                            {row.instrument}
                          </strong>
                          <span className="shrink-0 font-mono">
                            {money(row.premiumUsd)}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Est. premium USD · {row.side} taker ·{' '}
                          {number(row.amount)} {row.currency} ·{' '}
                          {new Date(row.timestamp).toLocaleString()}
                        </p>
                        <details className="mt-1 text-[10px] text-muted-foreground">
                          <summary>
                            Block {row.blockId}
                            {row.legCount
                              ? ` · ${row.legCount} reported legs`
                              : ''}
                          </summary>
                          <p>
                            Trade {row.id} · premium {row.price} {row.currency}{' '}
                            · IV {row.iv === null ? '—' : `${row.iv}%`}. USD
                            premium uses index price; this is not underlying
                            notional.
                          </p>
                        </details>
                      </div>
                    ))}
                    {optionBlocks.length === 0 && (
                      <Empty>
                        {optionsUnavailable
                          ? 'Block tape unavailable. Refresh to retry.'
                          : search
                            ? 'No block legs match this search.'
                            : 'No identified block legs in this sample. This does not mean no blocks traded.'}
                      </Empty>
                    )}
                  </>
                ) : (
                  data.options.overview.map((row) => (
                    <div
                      className="border-t border-border py-2 first:border-0"
                      key={row.currency}
                    >
                      <strong className="text-xs">
                        {row.currency} · {row.contracts} listed contracts
                      </strong>
                      <dl className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                        <dt className="text-muted-foreground">
                          24h call / put volume
                        </dt>
                        <dd className="text-right">
                          {number(row.callVolume24h)} /{' '}
                          {number(row.putVolume24h)}
                        </dd>
                        <dt className="text-muted-foreground">
                          Call / put open interest
                        </dt>
                        <dd className="text-right">
                          {number(row.callOpenInterest)} /{' '}
                          {number(row.putOpenInterest)}
                        </dd>
                        <dt className="text-muted-foreground">
                          Put / call volume ratio
                        </dt>
                        <dd className="text-right">
                          {number(row.putCallVolumeRatio)}
                        </dd>
                      </dl>
                    </div>
                  ))
                )}
                {options === 'overview' &&
                  data.options.overview.length === 0 && (
                    <Empty>
                      Options overview unavailable. Check source coverage above.
                    </Empty>
                  )}
                <details className="mt-2 border-t border-border pt-2 pb-2 text-[10px] leading-relaxed text-muted-foreground">
                  <summary className="w-fit cursor-pointer">
                    Sampled tape coverage
                  </summary>
                  Public trade sample, not an exhaustive block feed.{' '}
                  {data.options.coverage.map((row) => (
                    <p key={row.currency}>
                      {row.currency}: {row.sampledTrades} recent trades sampled
                      {row.oldestTimestamp
                        ? ` since ${new Date(row.oldestTimestamp).toLocaleString()}`
                        : ''}
                      {row.hasMore ? ' · more trades outside sample' : ''}.
                    </p>
                  ))}
                </details>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
