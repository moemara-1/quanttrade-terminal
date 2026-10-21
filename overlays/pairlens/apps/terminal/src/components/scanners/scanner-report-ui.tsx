import { useState } from 'react'
import { ArrowLeftRight, ArrowRight, ChevronRight } from 'lucide-react'
import { ScannerStrengthChart } from './scanner-strength-chart'
import type { ScannerMarket, ScannerSnapshot } from '@/lib/scanners'
import type { FundingRateUnit } from '@/lib/scanner-opportunity'
import {
  comparisonForStrategy,
  projectedFundingRate,
} from '@/lib/scanner-opportunity'
import { scannerMarketPath, scannerPercent } from '@/lib/scanners'

type Comparison = ScannerSnapshot['comparisons'][number]
const control =
  'min-h-8 rounded-md border border-border/70 bg-background px-2 py-1 text-[11px] focus-visible:outline-2 focus-visible:outline-primary'
const usd = (value: number | null) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: Math.abs(value) < 1 ? 6 : 2,
        notation: Math.abs(value) >= 1e6 ? 'compact' : 'standard',
      }).format(value)
const price = (row: ScannerMarket) =>
  (row.quote ?? 'USDC') === 'USDC'
    ? usd(row.price)
    : `${new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 }).format(row.price)} ${row.quote}`
const signed = (value: number | null) =>
  value === null
    ? 'text-muted-foreground'
    : value >= 0
      ? 'text-emerald-400'
      : 'text-red-400'
const volume = (row: ScannerMarket) =>
  `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, notation: 'compact' }).format(row.volume24h)} ${row.quote ?? 'USDC'}`
const venueName = (venue: string | null) =>
  venue === 'hyperliquid'
    ? 'Hyperliquid'
    : venue === 'lighter'
      ? 'Lighter'
      : '—'
const venueShort = (venue: string | null) =>
  venue === 'hyperliquid' ? 'HL' : venue === 'lighter' ? 'Lighter' : '—'
function VenueIcon({ venue }: { venue: ScannerMarket['venue'] }) {
  return (
    <img
      alt=""
      className="size-3.5 shrink-0 object-contain"
      src={`/posters/${venue === 'lighter' ? 'lighter-market-connector.svg' : 'hyperliquid-market-connector.png'}`}
    />
  )
}
function Direction({ row }: { row: Comparison }) {
  return row.longVenue && row.shortVenue ? (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
      <span>
        <span className="text-emerald-400">Long</span>{' '}
        {venueShort(row.longVenue)}
      </span>
      <ArrowLeftRight className="size-2.5" />
      <span>
        <span className="text-red-400">Short</span> {venueShort(row.shortVenue)}
      </span>
    </span>
  ) : (
    <span className="text-[10px] text-muted-foreground">
      No directional spread
    </span>
  )
}
export function CompactArbitrageRow({
  comparison,
  mode,
  onReview,
}: {
  comparison: Comparison
  mode: 'funding' | 'mark'
  onReview: () => void
}) {
  const row = comparisonForStrategy(comparison, mode)
  return (
    <button
      type="button"
      onClick={onReview}
      aria-label={`Review ${row.base} arbitrage`}
      className="group block w-full border-t border-border/60 py-2.5 text-left first:border-0 hover:bg-accent/30 focus-visible:outline-2 focus-visible:outline-primary"
    >
      <div className="flex items-center justify-between gap-2">
        <strong className="text-xs">{row.base}</strong>
        <span
          className={`font-mono text-xs tabular-nums ${signed(mode === 'funding' ? row.fundingGapHourly : row.markGapPct)}`}
        >
          {scannerPercent(
            mode === 'funding' ? row.fundingGapHourly : row.markGapPct,
            mode === 'funding',
          )}
          <span className="ml-1 text-[9px] font-normal text-muted-foreground">
            {mode === 'funding' ? '/ h net' : 'mark gap'}
          </span>
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-3 text-[10px] tabular-nums">
        {[row.hyperliquid, row.lighter].map((m) => (
          <span key={m.venue} className="flex min-w-0 items-center gap-1.5">
            <VenueIcon venue={m.venue} />
            <span className="text-muted-foreground">{venueShort(m.venue)}</span>
            <span
              className={`ml-auto font-mono ${mode === 'funding' ? signed(m.fundingHourly) : ''}`}
            >
              {mode === 'funding'
                ? scannerPercent(m.fundingHourly, true)
                : price(m)}
            </span>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <Direction row={row} />
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground group-hover:text-foreground">
          Review
          <ChevronRight className="size-3" />
        </span>
      </div>
    </button>
  )
}
export function ArbitrageResults({
  rows,
  mode,
  onReview,
}: {
  rows: ScannerSnapshot['comparisons']
  mode: 'funding' | 'mark'
  onReview: (row: Comparison) => void
}) {
  const [rateUnit, setRateUnit] = useState<FundingRateUnit>('hourly')
  const [size, setSize] = useState('1000')
  const notional = Number(size)
  const validSize = Number.isFinite(notional) && notional > 0
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex items-center gap-1 rounded-md bg-muted/40 p-0.5"
          role="group"
          aria-label="Funding rate display"
        >
          {(['hourly', '8h', 'apr'] as const).map((unit) => (
            <button
              type="button"
              key={unit}
              aria-pressed={rateUnit === unit}
              onClick={() => setRateUnit(unit)}
              className={`min-h-8 rounded px-3 text-[11px] ${rateUnit === unit ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
            >
              {unit === 'hourly' ? 'Hourly' : unit === '8h' ? '8H' : 'APR'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
          Size per leg · USDC
          <input
            className={`${control} w-28 font-mono text-right`}
            inputMode="decimal"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            aria-label="Arbitrage estimate size per leg"
          />
        </label>
      </div>
      <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground">
        {rows.length} matched markets ·{' '}
        {rateUnit === 'hourly'
          ? 'Current hourly rates'
          : rateUnit === '8h'
            ? '8H = hourly × 8'
            : 'Simple APR = hourly × 24 × 365'}{' '}
        · Estimated daily carry assumes today’s rates remain constant, before
        fees. It is not settled 24h funding.
      </p>
      <div className="max-h-[65vh] overflow-auto rounded-md border border-border/60">
        <table className="w-full min-w-[940px] text-left text-[11px] tabular-nums">
          <thead className="sticky top-0 z-10 bg-card text-[10px] text-muted-foreground">
            <tr>
              {[
                'Market',
                'Hyperliquid',
                'Lighter',
                mode === 'funding' ? 'Net funding ↓' : 'Funding carry',
                'Mark gap',
                'Min. OI',
                'Min. 24h volume',
                'Est. carry / day',
                '',
              ].map((title, index) => (
                <th
                  className="whitespace-nowrap px-3 py-2.5 font-medium"
                  key={`${title}:${index}`}
                >
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((comparison) => {
              const row = comparisonForStrategy(comparison, mode)
              const oi =
                row.hyperliquid.openInterestUsd === null ||
                row.lighter.openInterestUsd === null
                  ? null
                  : Math.min(
                      row.hyperliquid.openInterestUsd,
                      row.lighter.openInterestUsd,
                    )
              const carry =
                validSize && row.fundingGapHourly !== null
                  ? row.fundingGapHourly * 24 * notional
                  : null
              return (
                <tr
                  key={`${row.hyperliquid.symbol}:${row.lighter.symbol}`}
                  className="border-t border-border/50 hover:bg-accent/30"
                >
                  <td className="px-3 py-2.5">
                    <strong className="text-xs">{row.base}</strong>
                    <div className="mt-1">
                      <Direction row={row} />
                    </div>
                  </td>
                  {[row.hyperliquid, row.lighter].map((m) => (
                    <td key={m.venue} className="px-3 py-2.5">
                      <div className={`font-mono ${signed(m.fundingHourly)}`}>
                        {scannerPercent(
                          projectedFundingRate(m.fundingHourly, rateUnit),
                          true,
                        )}
                      </div>
                      <div className="mt-1 text-[9px] text-muted-foreground">
                        {price(m)}
                      </div>
                    </td>
                  ))}
                  <td
                    className={`px-3 py-2.5 font-mono font-medium ${signed(row.fundingGapHourly)}`}
                  >
                    {scannerPercent(
                      projectedFundingRate(row.fundingGapHourly, rateUnit),
                      true,
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono">
                    {scannerPercent(row.markGapPct)}
                  </td>
                  <td className="px-3 py-2.5 font-mono">{usd(oi)}</td>
                  <td className="px-3 py-2.5 font-mono">
                    {usd(
                      Math.min(
                        row.hyperliquid.volume24h,
                        row.lighter.volume24h,
                      ),
                    )}
                  </td>
                  <td className={`px-3 py-2.5 font-mono ${signed(carry)}`}>
                    {usd(carry)}
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      className={`${control} inline-flex items-center gap-1 whitespace-nowrap`}
                      onClick={() => onReview(comparison)}
                    >
                      Review
                      <ArrowRight className="size-3" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!rows.length && (
          <p className="p-5 text-center text-xs text-muted-foreground">
            No matching comparison in this snapshot.
          </p>
        )}
      </div>
    </>
  )
}
function InterestMap({ rows }: { rows: Array<ScannerMarket> }) {
  const ranked = [...rows]
    .filter((row) => (row.openInterestUsd ?? 0) > 0)
    .sort((a, b) => (b.openInterestUsd ?? 0) - (a.openInterestUsd ?? 0))
    .slice(0, 12)
  type Tile = {
    row: ScannerMarket
    x: number
    y: number
    width: number
    height: number
  }
  const tiles: Array<Tile> = []
  function place(
    items: Array<ScannerMarket>,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    if (!items.length) return
    if (items.length === 1) {
      tiles.push({ row: items[0], x, y, width, height })
      return
    }
    const total = items.reduce(
      (sum, row) => sum + (row.openInterestUsd ?? 0),
      0,
    )
    let split = 1,
      weight = items[0].openInterestUsd ?? 0
    while (
      split < items.length - 1 &&
      weight + (items[split].openInterestUsd ?? 0) / 2 < total / 2
    ) {
      weight += items[split].openInterestUsd ?? 0
      split++
    }
    const fraction = total > 0 ? weight / total : split / items.length
    if (width >= height) {
      place(items.slice(0, split), x, y, width * fraction, height)
      place(
        items.slice(split),
        x + width * fraction,
        y,
        width * (1 - fraction),
        height,
      )
    } else {
      place(items.slice(0, split), x, y, width, height * fraction)
      place(
        items.slice(split),
        x,
        y + height * fraction,
        width,
        height * (1 - fraction),
      )
    }
  }
  place(ranked, 0, 0, 600, 190)
  return (
    <section className="min-w-0 rounded-lg bg-muted/25 p-3">
      <h3 className="text-xs font-semibold">Open-interest map</h3>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Top {ranked.length} venue contracts · area = reported OI · color = 24h
        return.
      </p>
      {tiles.length ? (
        <svg
          role="img"
          aria-label="Open interest weighted market map"
          viewBox="0 0 600 190"
          className="mt-3 h-48 w-full"
        >
          {tiles.map(({ row, x, y, width, height }) => (
            <g key={`${row.venue}:${row.symbol}`}>
              <title>
                {row.base} · {venueName(row.venue)} · OI{' '}
                {usd(row.openInterestUsd)} · 24h {scannerPercent(row.change24h)}
              </title>
              <rect
                x={x + 1}
                y={y + 1}
                width={Math.max(0, width - 2)}
                height={Math.max(0, height - 2)}
                rx="4"
                fill={row.change24h >= 0 ? '#34d399' : '#fb7185'}
                opacity={Math.min(0.65, 0.12 + Math.abs(row.change24h) / 40)}
              />
              {width > 70 && height > 30 && (
                <>
                  <text
                    x={x + 8}
                    y={y + 17}
                    className="fill-foreground text-[11px] font-medium"
                  >
                    {row.base}
                  </text>
                  {height > 55 && (
                    <text
                      x={x + 8}
                      y={y + height - 9}
                      className="fill-foreground text-[10px]"
                    >
                      {scannerPercent(row.change24h)}
                    </text>
                  )}
                </>
              )}
            </g>
          ))}
        </svg>
      ) : (
        <p className="py-12 text-center text-xs text-muted-foreground">
          Open interest is unavailable for this selection.
        </p>
      )}
    </section>
  )
}
export function MarketResults({
  rows,
  onReview,
  kind = 'strength',
}: {
  rows: Array<ScannerMarket>
  onReview?: (market: ScannerMarket) => void
  kind?: 'strength' | 'crowding'
}) {
  const [tab, setTab] = useState<'overview' | 'screener'>('screener')
  const gainers = rows.filter((row) => row.change24h > 0).length
  const losers = rows.filter((row) => row.change24h < 0).length
  const leaders = [...rows]
    .sort((a, b) =>
      kind === 'strength'
        ? b.change24h - a.change24h
        : Math.abs(b.fundingHourly ?? 0) - Math.abs(a.fundingHourly ?? 0),
    )
    .slice(0, 6)
  const measure = (row: ScannerMarket) =>
    kind === 'strength' ? row.change24h : (row.fundingHourly ?? 0)
  const maxValue = Math.max(
    ...leaders.map((row) => Math.abs(measure(row))),
    1e-12,
  )
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/60">
        <div
          className="flex gap-4"
          role="group"
          aria-label="Scanner report view"
        >
          {(['overview', 'screener'] as const).map((value) => (
            <button
              type="button"
              className={`min-h-10 border-b-2 px-1 text-xs capitalize ${tab === value ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
              key={value}
            >
              {value}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {rows.length} venue markets · {gainers} up / {losers} down
        </span>
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ScannerStrengthChart markets={rows} />
        <div className="mb-3">
          <InterestMap rows={rows} />
        </div>
      </div>
      {tab === 'overview' ? (
        <section className="rounded-lg bg-muted/25 p-3">
          <h3 className="text-xs font-semibold">
            {kind === 'strength' ? '24h momentum leaders' : 'Funding extremes'}
          </h3>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {kind === 'strength'
              ? 'Current price change, not a forward signal.'
              : 'Current hourly rate; positive means longs pay shorts.'}
          </p>
          <div className="mt-3 grid gap-x-6 gap-y-2 md:grid-cols-2">
            {leaders.map((row) => (
              <a
                key={`${row.venue}:${row.symbol}`}
                href={scannerMarketPath(row)}
                className="flex items-center gap-2 text-[11px] hover:text-primary"
              >
                <VenueIcon venue={row.venue} />
                <span className="w-20 shrink-0 truncate font-medium">
                  {row.base}
                </span>
                <span className="h-1.5 flex-1 rounded bg-muted">
                  <span
                    className={`block h-full rounded ${measure(row) >= 0 ? 'bg-emerald-400/70' : 'bg-red-400/70'}`}
                    style={{
                      width: `${Math.max(2, Math.min(100, (Math.abs(measure(row)) / maxValue) * 100))}%`,
                    }}
                  />
                </span>
                <span
                  className={`w-20 text-right font-mono ${signed(measure(row))}`}
                >
                  {scannerPercent(measure(row), kind === 'crowding')}
                </span>
              </a>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground">
            Each row is a venue contract; the same asset may appear twice.
            Sector rotation and whale-flow claims require sources that are not
            included in this snapshot.
          </p>
        </section>
      ) : (
        <div className="max-h-[65vh] overflow-auto rounded-md border border-border/60">
          <table className="w-full min-w-[900px] text-left text-[11px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-card text-[10px] text-muted-foreground">
              <tr>
                {[
                  '#',
                  'Asset',
                  'Price',
                  '24h',
                  'RS vs BTC · pp',
                  'Funding / h',
                  'Open interest',
                  'OI / volume',
                  '24h volume',
                  ...(onReview ? [''] : []),
                ].map((title, index) => (
                  <th
                    className="whitespace-nowrap px-3 py-2.5 font-medium"
                    key={`${title}:${index}`}
                  >
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  className="border-t border-border/50 hover:bg-accent/30"
                  key={`${row.venue}:${row.symbol}`}
                >
                  <td className="px-3 py-2 text-muted-foreground">
                    {index + 1}
                  </td>
                  <td className="px-3 py-2">
                    <a
                      className="font-medium hover:underline"
                      href={scannerMarketPath(row)}
                    >
                      {row.base}
                    </a>
                    <div className="mt-1 flex items-center gap-1 text-[9px] text-muted-foreground">
                      <VenueIcon venue={row.venue} />
                      {venueName(row.venue)}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono">{price(row)}</td>
                  <td
                    className={`px-3 py-2 font-mono ${signed(row.change24h)}`}
                  >
                    {scannerPercent(row.change24h)}
                  </td>
                  <td
                    className={`px-3 py-2 font-mono ${signed(row.relativeStrength24h)}`}
                  >
                    {row.relativeStrength24h === null
                      ? '—'
                      : `${row.relativeStrength24h > 0 ? '+' : ''}${row.relativeStrength24h.toFixed(2)}`}
                  </td>
                  <td
                    className={`px-3 py-2 font-mono ${signed(row.fundingHourly)}`}
                  >
                    {scannerPercent(row.fundingHourly, true)}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {usd(row.openInterestUsd)}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {row.oiToVolume === null
                      ? '—'
                      : `${row.oiToVolume.toFixed(2)}×`}
                  </td>
                  <td className="px-3 py-2 font-mono">{volume(row)}</td>
                  {onReview && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        aria-label={`Review ${row.base} strength`}
                        className={control}
                        onClick={() => onReview(row)}
                      >
                        Review
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="p-5 text-center text-xs text-muted-foreground">
              No markets match these filters.
            </p>
          )}
        </div>
      )}
    </>
  )
}
