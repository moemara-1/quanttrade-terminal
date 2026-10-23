import {
  Component,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode, RefObject } from 'react'
import type {
  ChartSeriesInput,
  DrawingObject,
  FastFinancialChartRef,
  Timeframe,
} from '@pairlens/fast-financial-charts/types'
import {
  CompatibilityChartController,
  compatibilityDrawing,
  isGraphicsUnavailable,
} from '@/lib/compatibility-chart'

/** Catch only renderer availability failures; unrelated defects retain normal error reporting. */
export class ChartGraphicsBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error('[Chart graphics]', error)
  }
  render() {
    if (this.state.error) {
      if (!isGraphicsUnavailable(this.state.error)) throw this.state.error
      return this.props.fallback
    }
    return this.props.children
  }
}

export function CompatibilityChart({
  chartRef,
  series,
  timeframe,
  onReady,
  onDrawingsChange,
  onViewportChange,
}: {
  chartRef: RefObject<FastFinancialChartRef | null>
  series: Array<ChartSeriesInput>
  timeframe: Timeframe
  onReady?: () => void
  onDrawingsChange?: (values: Array<DrawingObject>) => void
  onViewportChange?: (value: { startIndex: number; endIndex: number }) => void
}) {
  const clipId = useId()
  const [controller] = useState(
    () => new CompatibilityChartController(timeframe),
  )
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 400 })
  const dragging = useRef<{ x: number; span: number } | null>(null)
  useSyncExternalStore(
    controller.listen,
    controller.getRevision,
    controller.getRevision,
  )
  useLayoutEffect(() => {
    controller.configure(series, timeframe, onDrawingsChange, onViewportChange)
  }, [controller, series, timeframe, onDrawingsChange, onViewportChange])
  useLayoutEffect(() => {
    chartRef.current = controller
    onReady?.()
    return () => {
      if (chartRef.current === controller) chartRef.current = null
    }
  }, [chartRef, controller, onReady])
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const resize = () => {
      const box = element.getBoundingClientRect()
      const next = {
        width: Math.max(box.width, 100),
        height: Math.max(box.height, 100),
      }
      setSize(next)
      controller.resize(next.width, next.height)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      controller.zoom(event.deltaY > 0 ? 1.15 : 0.85)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => {
      observer.disconnect()
      element.removeEventListener('wheel', wheel)
    }
  }, [controller])
  const snapshot = controller.getSnapshot()
  const bars = controller.visibleBars()
  const y = (price: number) => controller.priceToCoordinate(price) ?? 0
  const x = (ts: number) => controller.timeToCoordinate(ts) ?? -10000
  const width = size.width - 70
  const height = size.height - 24
  const barWidth = Math.max(
    1,
    Math.min(
      12,
      (width / (snapshot.viewport.endIndex - snapshot.viewport.startIndex)) *
        0.7,
    ),
  )
  const latest = controller.data().at(-1)
  const hiddenCount = snapshot.drawings.filter(
    (drawing) => !compatibilityDrawing(drawing),
  ).length
  return (
    <div
      ref={host}
      className="relative h-full w-full overflow-hidden bg-background"
    >
      <div className="absolute left-2 top-1 z-10 text-xs text-muted-foreground">
        Compatibility chart · candles and basic drawings
        {hiddenCount > 0
          ? ` · ${hiddenCount} advanced drawings saved, not rendered`
          : null}
      </div>
      <svg
        width={size.width}
        height={size.height}
        role="img"
        aria-label={`${series[0]?.id ?? 'Market'} candlestick chart, compatibility mode`}
        style={{ touchAction: 'none' }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          dragging.current = {
            x: event.clientX,
            span: snapshot.viewport.endIndex - snapshot.viewport.startIndex,
          }
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return
          const delta =
            ((dragging.current.x - event.clientX) / width) *
            dragging.current.span
          dragging.current.x = event.clientX
          controller.pan(delta)
        }}
        onPointerUp={() => {
          dragging.current = null
        }}
        onPointerCancel={() => {
          dragging.current = null
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect width={width} height={height} />
          </clipPath>
        </defs>
        {Array.from({ length: 5 }, (_, index) => {
          const py = ((index + 1) * height) / 6
          const price = controller.coordinateToPrice(py)
          return (
            <g key={index}>
              <line x1={0} x2={width} y1={py} y2={py} stroke="#ffffff12" />
              <text x={width + 5} y={py + 4} fill="#9ca3af" fontSize={10}>
                {price?.toPrecision(6)}
              </text>
            </g>
          )
        })}
        <g clipPath={`url(#${clipId})`}>
          {bars.map((bar) => {
            const color = bar.close >= bar.open ? '#00c98b' : '#ef5350'
            return (
              <g key={bar.ts}>
                <line
                  x1={x(bar.ts)}
                  x2={x(bar.ts)}
                  y1={y(bar.high)}
                  y2={y(bar.low)}
                  stroke={color}
                />
                <rect
                  x={x(bar.ts) - barWidth / 2}
                  y={Math.min(y(bar.open), y(bar.close))}
                  width={barWidth}
                  height={Math.max(1, Math.abs(y(bar.open) - y(bar.close)))}
                  fill={color}
                />
              </g>
            )
          })}
          {snapshot.drawings
            .filter((drawing) => drawing.visible !== false)
            .map((drawing) => {
              const common = {
                stroke: drawing.color ?? '#60a5fa',
                strokeWidth: drawing.lineWidth ?? 1,
                strokeDasharray:
                  drawing.lineStyle === 'dashed'
                    ? '6 4'
                    : drawing.lineStyle === 'dotted'
                      ? '2 3'
                      : undefined,
              }
              if (drawing.type === 'hline')
                return (
                  <line
                    key={drawing.id}
                    x1={0}
                    x2={width}
                    y1={y(drawing.price)}
                    y2={y(drawing.price)}
                    {...common}
                  />
                )
              if (drawing.type === 'vline')
                return (
                  <line
                    key={drawing.id}
                    y1={0}
                    y2={height}
                    x1={x(drawing.ts)}
                    x2={x(drawing.ts)}
                    {...common}
                  />
                )
              if (drawing.type === 'text')
                return (
                  <text
                    key={drawing.id}
                    x={x(drawing.point.ts)}
                    y={y(drawing.point.price)}
                    fill={drawing.color}
                    fontSize={drawing.fontSize ?? 12}
                  >
                    {drawing.content}
                  </text>
                )
              if (drawing.type === 'line')
                return (
                  <line
                    key={drawing.id}
                    x1={x(drawing.points[0].ts)}
                    x2={x(drawing.points[1].ts)}
                    y1={y(drawing.points[0].price)}
                    y2={y(drawing.points[1].price)}
                    {...common}
                  />
                )
              if (drawing.type === 'rectangle')
                return (
                  <rect
                    key={drawing.id}
                    x={Math.min(...drawing.points.map((point) => x(point.ts)))}
                    y={Math.min(
                      ...drawing.points.map((point) => y(point.price)),
                    )}
                    width={Math.abs(
                      x(drawing.points[1].ts) - x(drawing.points[0].ts),
                    )}
                    height={Math.abs(
                      y(drawing.points[1].price) - y(drawing.points[0].price),
                    )}
                    fill={drawing.fillColor ?? drawing.color}
                    fillOpacity={drawing.fillOpacity ?? 0.12}
                    {...common}
                  />
                )
              return null
            })}
          {latest && (
            <line
              x1={0}
              x2={width}
              y1={y(latest.close)}
              y2={y(latest.close)}
              stroke="#00c98b"
              strokeDasharray="4 3"
            />
          )}
        </g>
        {latest && (
          <text
            x={width + 5}
            y={y(latest.close) - 4}
            fill="#00c98b"
            fontSize={10}
          >
            {latest.close.toPrecision(6)}
          </text>
        )}
        {bars
          .filter(
            (_, index) =>
              index % Math.max(1, Math.floor(bars.length / 5)) === 0,
          )
          .map((bar) => (
            <text
              key={bar.ts}
              x={x(bar.ts)}
              y={size.height - 5}
              fill="#9ca3af"
              fontSize={10}
            >
              {new Date(bar.ts).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </text>
          ))}
      </svg>
    </div>
  )
}
