export function ArenaEquity({
  points,
}: {
  points: Array<{ at: number; equity: number }>
}) {
  if (points.length < 2)
    return (
      <p className="py-5 text-xs text-muted-foreground">
        Equity history appears after the server records two paper snapshots.
      </p>
    )
  const min = Math.min(...points.map((point) => point.equity))
  const max = Math.max(...points.map((point) => point.equity))
  const span = max - min || 1
  const start = points[0].at
  const duration = points.at(-1)!.at - start || 1
  const path = points
    .map(
      (point, index) =>
        `${index ? 'L' : 'M'}${(((point.at - start) / duration) * 600).toFixed(2)},${(88 - ((point.equity - min) / span) * 76).toFixed(2)}`,
    )
    .join(' ')
  return (
    <figure className="min-w-0" aria-label="Recorded paper equity history">
      <svg
        viewBox="0 0 600 100"
        className="h-24 w-full"
        role="img"
        aria-label={`Paper equity from ${points[0].equity.toFixed(2)} to ${points.at(-1)!.equity.toFixed(2)} USD`}
        preserveAspectRatio="none"
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          className="text-primary"
        />
      </svg>
      <figcaption className="flex justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{new Date(start).toLocaleString()}</span>
        <span>{new Date(points.at(-1)!.at).toLocaleString()}</span>
      </figcaption>
    </figure>
  )
}
