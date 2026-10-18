import { useState } from 'react'

export interface ScannerChartSeries {
  label: string
  className: string
  points: Array<{ time: number; value: number }>
}
export function ScannerHistoryChart({
  title,
  series,
  formatValue,
  unit,
}: {
  title: string
  series: Array<ScannerChartSeries>
  formatValue: (value: number) => string
  unit: string
}) {
  const [inspected, setInspected] = useState<number | null>(null)
  const points = series.flatMap((item) => item.points)
  if (points.length < 2)
    return (
      <p className="rounded-md border border-border px-3 py-8 text-center text-xs text-muted-foreground">
        Not enough observed data for {title.toLowerCase()}.
      </p>
    )
  const times = [...new Set(points.map((point) => point.time))].sort(
    (a, b) => a - b,
  )
  const minTime = times[0],
    maxTime = times.at(-1) ?? minTime
  const low = Math.min(...points.map((point) => point.value)),
    high = Math.max(...points.map((point) => point.value))
  const span = high - low || Math.max(Math.abs(high) * 0.02, 0.00001)
  const bottom = low - span * 0.08,
    top = high + span * 0.08
  const x = (time: number) =>
    50 + ((time - minTime) / (maxTime - minTime || 1)) * 700
  const y = (value: number) => 172 - ((value - bottom) / (top - bottom)) * 144
  const selected =
    inspected === null ? maxTime : times[Math.min(inspected, times.length - 1)]
  const timestamp = (value: number) =>
    new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold">{title}</h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Observed hourly data | {unit}
          </p>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {new Date(selected).toLocaleString()}
        </span>
      </div>
      <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {series.map((item) => {
          const point = item.points.find((sample) => sample.time === selected)
          return (
            <span key={item.label} className={item.className}>
              <span aria-hidden="true">- </span>
              {item.label}{' '}
              <strong className="font-mono font-medium">
                {point ? formatValue(point.value) : 'No sample'}
              </strong>
            </span>
          )
        })}
      </div>
      <svg
        className="h-[200px] w-full touch-pan-y overflow-visible"
        viewBox="0 0 800 200"
        role="img"
        aria-label={title}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const time =
            minTime +
            Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) *
              (maxTime - minTime)
          setInspected(
            times.reduce(
              (best, value, index) =>
                Math.abs(value - time) < Math.abs(times[best] - time)
                  ? index
                  : best,
              0,
            ),
          )
        }}
      >
        {[0, 0.5, 1].map((ratio) => {
          const value = bottom + (top - bottom) * ratio
          return (
            <g key={ratio}>
              <line
                x1="50"
                x2="750"
                y1={y(value)}
                y2={y(value)}
                className="stroke-border"
                strokeWidth="1"
              />
              <text
                x="45"
                y={y(value) + 3}
                textAnchor="end"
                className="fill-muted-foreground text-[9px]"
              >
                {formatValue(value)}
              </text>
            </g>
          )
        })}
        {series.map((item) => (
          <path
            key={item.label}
            d={item.points
              .map(
                (point, index) =>
                  `${index === 0 || point.time - item.points[index - 1].time > 5_400_000 ? 'M' : 'L'}${x(point.time)},${y(point.value)}`,
              )
              .join(' ')}
            className={item.className}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line
          x1={x(selected)}
          x2={x(selected)}
          y1="28"
          y2="172"
          className="stroke-muted-foreground"
          strokeWidth="1"
          strokeDasharray="3 4"
        />
        <text x="50" y="193" className="fill-muted-foreground text-[9px]">
          {timestamp(minTime)}
        </text>
        <text
          x="400"
          y="193"
          textAnchor="middle"
          className="fill-muted-foreground text-[9px]"
        >
          {timestamp(minTime + (maxTime - minTime) / 2)}
        </text>
        <text
          x="750"
          y="193"
          textAnchor="end"
          className="fill-muted-foreground text-[9px]"
        >
          {timestamp(maxTime)}
        </text>
      </svg>
      <input
        type="range"
        aria-label={`Inspect ${title.toLowerCase()}`}
        className="h-3 w-full accent-primary"
        min={0}
        max={times.length - 1}
        value={inspected ?? times.length - 1}
        onChange={(event) => setInspected(Number(event.target.value))}
      />
    </section>
  )
}
