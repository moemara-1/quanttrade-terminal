import { DARK_THEME_TOKENS } from '@pairlens/fast-financial-charts'
import type {
  ChartCommand,
  ChartCommandResult,
  ChartSeriesInput,
  ChartSnapshot,
  DrawingObject,
  FastFinancialChartRef,
  Timeframe,
} from '@pairlens/fast-financial-charts/types'

export function isGraphicsUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    /WebGL2 is required|webgl.*(context|unavailable|lost)|context.*lost/i.test(
      error.message,
    )
  )
}
const supportedDrawings = new Set([
  'hline',
  'vline',
  'line',
  'rectangle',
  'text',
])
export function compatibilityBucket(ts: number, timeframe: Timeframe): number {
  const date = new Date(ts)
  if (timeframe === '1M')
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  const durations = {
    '1m': 60000,
    '5m': 300000,
    '15m': 900000,
    '30m': 1800000,
    '1h': 3600000,
    '2h': 7200000,
    '4h': 14400000,
    '1d': 86400000,
    '3d': 259200000,
    '1w': 604800000,
  }
  const offset = timeframe === '1w' ? 345600000 : 0
  return (
    Math.floor((ts - offset) / durations[timeframe]) * durations[timeframe] +
    offset
  )
}
export function compatibilityDrawing(value: unknown): value is DrawingObject {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || !supportedDrawings.has(String(item.type)))
    return false
  const point = (v: unknown) =>
    !!v &&
    typeof v === 'object' &&
    'ts' in v &&
    'price' in v &&
    Number.isFinite(v.ts) &&
    Number.isFinite(v.price)
  if (item.type === 'hline') return Number.isFinite(item.price)
  if (item.type === 'vline') return Number.isFinite(item.ts)
  if (item.type === 'text')
    return point(item.point) && typeof item.content === 'string'
  if (item.type === 'line' && item.extend && item.extend !== 'none')
    return false
  return (
    Array.isArray(item.points) &&
    item.points.length === 2 &&
    item.points.every(point)
  )
}

/** Public engine contract for the limited non-GPU renderer. Unsupported work fails explicitly. */
export class CompatibilityChartController implements FastFinancialChartRef {
  private series: Array<ChartSeriesInput> = []
  private timeframe: Timeframe
  private drawings: Array<DrawingObject> = []
  private viewport = { startIndex: 0, endIndex: 200 }
  private width = 800
  private height = 400
  private revision = 0
  private listeners = new Set<() => void>()
  private onDrawings?: (drawings: Array<DrawingObject>) => void
  private onViewport?: (viewport: {
    startIndex: number
    endIndex: number
  }) => void
  constructor(timeframe: Timeframe) {
    this.timeframe = timeframe
  }
  getRevision = () => this.revision
  listen = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private changed() {
    this.revision++
    this.listeners.forEach((listener) => listener())
  }
  configure(
    series: Array<ChartSeriesInput>,
    timeframe: Timeframe,
    drawings?: (values: Array<DrawingObject>) => void,
    viewport?: (value: { startIndex: number; endIndex: number }) => void,
  ) {
    const reset =
      this.series[0]?.id !== series[0]?.id || this.timeframe !== timeframe
    this.series = structuredClone(series)
    this.timeframe = timeframe
    this.onDrawings = drawings
    this.onViewport = viewport
    if (reset) {
      this.drawings = []
      this.fitContent()
    } else this.changed()
  }
  resize(width: number, height: number) {
    this.width = Math.max(width - 70, 1)
    this.height = Math.max(height - 24, 1)
    this.changed()
  }
  private unsupported(): never {
    throw new Error(
      'This feature is not supported in chart compatibility mode. Retry graphics to use the full chart.',
    )
  }
  private updateDrawings(drawings: Array<DrawingObject>) {
    this.drawings = structuredClone(drawings)
    this.changed()
    this.onDrawings?.(structuredClone(drawings))
  }
  getCapabilities: FastFinancialChartRef['getCapabilities'] = () => ({
    chartTypes: ['candles'],
    compareModes: ['price'],
    priceScaleModes: ['normal'],
    drawingTools: [...supportedDrawings],
    indicatorTypes: [],
    mcpTools: [],
  })
  getSnapshot = (): ChartSnapshot => ({
    timeframe: this.timeframe,
    compareMode: 'price',
    chartType: 'candles',
    priceScaleMode: 'normal',
    viewport: { ...this.viewport },
    series: structuredClone(this.series),
    indicators: [],
    indicatorResults: [],
    drawings: structuredClone(this.drawings),
    selectedDrawingId: null,
    activeTool: null,
    hoveredBarTs: null,
    performance: {
      maxFps: 30,
      enableHiDpi: false,
      indicatorWorker: false,
      viewportMinBars: 5,
    },
    theme: DARK_THEME_TOKENS,
  })
  getMcpSchema: FastFinancialChartRef['getMcpSchema'] = () => []
  subscribe: FastFinancialChartRef['subscribe'] = () => () => undefined
  executeCommand(command: ChartCommand): ChartCommandResult {
    const fail = () => ({
      ok: false,
      error: `Command ${command.type} is not supported in chart compatibility mode.`,
    })
    switch (command.type) {
      case 'getChartState':
        return { ok: true, result: this.getSnapshot() }
      case 'getCapabilities':
        return { ok: true, result: this.getCapabilities() }
      case 'getDrawingState':
        return { ok: true, result: structuredClone(this.drawings) }
      case 'addDrawing': {
        const drawing = {
          ...command.payload,
          id: command.payload.id ?? crypto.randomUUID(),
        }
        if (
          !compatibilityDrawing(drawing) ||
          this.drawings.some((item) => item.id === drawing.id)
        )
          return fail()
        this.updateDrawings([...this.drawings, drawing])
        return { ok: true, result: structuredClone(drawing) }
      }
      case 'setDrawings':
        // Restore every saved object verbatim; unsupported geometry is retained
        // for the full renderer and must not disappear on the next supported edit.
        this.updateDrawings(command.payload.drawings)
        return { ok: true }
      case 'updateDrawing': {
        const existing = this.drawings.find(
          (item) => item.id === command.payload.id,
        )
        const drawing = {
          ...existing,
          ...command.payload.patch,
          id: command.payload.id,
        }
        if (
          !existing ||
          !compatibilityDrawing(drawing) ||
          existing.type !== drawing.type
        )
          return fail()
        this.updateDrawings(
          this.drawings.map((item) =>
            item.id === drawing.id ? drawing : item,
          ),
        )
        return { ok: true }
      }
      case 'removeDrawing':
        if (!this.drawings.some((item) => item.id === command.payload.id))
          return fail()
        this.updateDrawings(
          this.drawings.filter((item) => item.id !== command.payload.id),
        )
        return { ok: true }
      case 'clearDrawings':
        this.updateDrawings([])
        return { ok: true }
      case 'setViewport':
        this.setViewport(command.payload)
        return { ok: true }
      case 'scrollToLatest':
        this.scrollToPosition(this.data().length - 1)
        return { ok: true }
      case 'getVisibleData':
        return {
          ok: true,
          result: this.visibleBars().slice(-(command.payload?.limit ?? 500)),
        }
      case 'applyTick':
        this.applyTick(command.payload)
        return { ok: true }
      case 'applyTicks':
        this.applyTicks(command.payload.updates)
        return { ok: true }
      case 'appendBar':
        this.appendBar(command.payload)
        return { ok: true }
      case 'replaceSeries':
        this.setSeries(command.payload)
        return { ok: true }
      case 'setPriceScaleMode':
        return command.payload.mode === 'normal' ? { ok: true } : fail()
      case 'setCompareMode':
        return command.payload.compareMode === 'price' ? { ok: true } : fail()
      case 'setChartType':
        return command.payload.chartType === 'candles' ? { ok: true } : fail()
      case 'setActiveTool':
        return command.payload.tool === null ? { ok: true } : fail()
      case 'setQuoteLines':
        return fail()
      default:
        return fail()
    }
  }
  setViewport(viewport: { startIndex: number; endIndex: number }) {
    if (
      !Number.isFinite(viewport.startIndex) ||
      !Number.isFinite(viewport.endIndex) ||
      viewport.endIndex <= viewport.startIndex
    )
      return
    const span = Math.max(
      5,
      Math.min(500, viewport.endIndex - viewport.startIndex),
    )
    const end = Math.max(
      span - 1,
      Math.min(this.data().length + span / 2, viewport.endIndex),
    )
    this.viewport = { startIndex: end - span, endIndex: end }
    this.changed()
    this.onViewport?.({ ...this.viewport })
  }
  pan(bars: number) {
    this.setViewport({
      startIndex: this.viewport.startIndex + bars,
      endIndex: this.viewport.endIndex + bars,
    })
  }
  zoom(factor: number) {
    const span = (this.viewport.endIndex - this.viewport.startIndex) * factor
    this.setViewport({
      startIndex: this.viewport.endIndex - span,
      endIndex: this.viewport.endIndex,
    })
  }
  fitContent = () => {
    const end = Math.max(this.data().length - 1, 5)
    this.setViewport({ startIndex: Math.max(0, end - 200), endIndex: end })
  }
  scrollToPosition = (index: number) => {
    const span = this.viewport.endIndex - this.viewport.startIndex
    this.setViewport({ startIndex: index - span, endIndex: index })
  }
  visibleBars() {
    return this.data().slice(
      Math.max(0, Math.floor(this.viewport.startIndex)),
      Math.ceil(this.viewport.endIndex) + 1,
    )
  }
  private range() {
    const bars = this.visibleBars()
    const low = Math.min(...bars.map((bar) => bar.low))
    const high = Math.max(...bars.map((bar) => bar.high))
    const pad = Math.max((high - low) * 0.08, Math.abs(high) * 0.001, 0.000001)
    return { low: low - pad, high: high + pad }
  }
  priceToCoordinate = (price: number) => {
    if (!this.visibleBars().length) return null
    const r = this.range()
    return ((r.high - price) / (r.high - r.low)) * this.height
  }
  coordinateToPrice = (y: number) => {
    if (!this.visibleBars().length) return null
    const r = this.range()
    return r.high - (y / this.height) * (r.high - r.low)
  }
  timeToCoordinate = (ts: number) => {
    const bars = this.data()
    if (!bars.length || !Number.isFinite(ts)) return null
    const right = bars.findIndex((bar) => bar.ts >= ts)
    let index = right
    if (right < 0) {
      const step = bars.length > 1 ? bars.at(-1)!.ts - bars.at(-2)!.ts : 60000
      index = bars.length - 1 + (ts - bars.at(-1)!.ts) / Math.max(1, step)
    } else if (right === 0) {
      const step = bars.length > 1 ? bars[1].ts - bars[0].ts : 60000
      index = (ts - bars[0].ts) / Math.max(1, step)
    } else {
      index =
        right -
        1 +
        (ts - bars[right - 1].ts) /
          Math.max(1, bars[right].ts - bars[right - 1].ts)
    }
    return (
      ((index - this.viewport.startIndex) /
        (this.viewport.endIndex - this.viewport.startIndex)) *
      this.width
    )
  }
  coordinateToTime = (x: number) =>
    this.dataByIndex(
      Math.round(
        this.viewport.startIndex +
          (x / this.width) *
            (this.viewport.endIndex - this.viewport.startIndex),
      ),
    )?.ts ?? null
  data = (id?: string) =>
    this.series.find((item) => item.id === (id ?? this.series[0]?.id))?.bars ??
    []
  dataByIndex = (index: number, id?: string) => this.data(id)[index] ?? null
  pop = (count: number, id?: string) => {
    const bars = this.data(id)
    const removed = bars.splice(
      Math.max(0, bars.length - Math.max(0, count)),
    ).length
    this.changed()
    return removed
  }
  seriesOrder = () => this.series.map((item) => item.id)
  setSeriesOrder = (ids: Array<string>) => {
    this.series = ids.flatMap((id) =>
      this.series.filter((item) => item.id === id),
    )
    this.changed()
  }
  setSeries: FastFinancialChartRef['setSeries'] = (update) => {
    this.series = structuredClone(update.series)
    this.changed()
  }
  applyTick: FastFinancialChartRef['applyTick'] = (update) => {
    const bars = this.data(update.seriesId)
    const last = bars.at(-1)
    if (!last || !Number.isFinite(update.price) || !Number.isFinite(update.ts))
      return
    const ts = compatibilityBucket(update.ts, this.timeframe)
    const existing = bars.find((bar) => bar.ts === ts)
    if (existing) {
      existing.close = update.price
      existing.high = Math.max(existing.high, update.price)
      existing.low = Math.min(existing.low, update.price)
      existing.volume += update.volume ?? 0
    } else if (ts > last.ts) {
      const follow = this.viewport.endIndex >= bars.length - 2
      bars.push({
        ts,
        open: update.price,
        high: update.price,
        low: update.price,
        close: update.price,
        volume: update.volume ?? 0,
      })
      if (follow) this.pan(1)
    }
    this.changed()
  }
  applyTicks: FastFinancialChartRef['applyTicks'] = (updates) => {
    updates.forEach(this.applyTick)
  }
  appendBar: FastFinancialChartRef['appendBar'] = (update) => {
    const bars = this.data(update.seriesId)
    const index = bars.findIndex((bar) => bar.ts === update.bar.ts)
    if (index >= 0) bars[index] = { ...update.bar }
    else {
      const follow = this.viewport.endIndex >= bars.length - 2
      bars.push({ ...update.bar })
      bars.sort((a, b) => a.ts - b.ts)
      if (follow) this.pan(1)
    }
    this.changed()
  }
  takeScreenshot = () => this.unsupported()
  addPane = () => this.unsupported()
  removePane = () => false
  swapPanes = () => false
  getPaneLayout = () => ({ panes: [], layout: null })
  addPrimitive = () => this.unsupported()
  removePrimitive = () => false
  listPrimitives = () => []
  addCustomSeries = () => this.unsupported()
  removeCustomSeries = () => false
  updateCustomSeriesData = () => false
  listCustomSeries = () => []
  registerIndicatorDefinition = () => this.unsupported()
  unregisterIndicatorDefinition = () => false
}
