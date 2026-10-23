import { z } from 'zod'
import { executeClientTool } from './client-tools'
import { getScreenshot } from './screenshot-store'
import type { AssistantDeps } from './tool-deps'
import type { ToolSet } from 'ai'
import type { ChartServiceHandle } from './chart-service'
import type { FastFinancialChartRef } from '@pairlens/fast-financial-charts/types'
import { normalizePair, normalizeTimeframe } from '@/lib/copilot/tool-deps'
import { CHART_ACTION_TOOL_NAMES } from '@/lib/copilot/chart-tools'

const actionNames = new Set<string>(CHART_ACTION_TOOL_NAMES)
const targetSchema = z.object({
  market: z.string().min(1),
  pair: z.string().min(1),
  timeframe: z.string().optional(),
})
type Target = { market: string; pair: string; timeframe: string }
type Deps = Pick<AssistantDeps, 'getChart' | 'getFocus'>
type Result = {
  status:
    | 'applied'
    | 'unchanged'
    | 'requested'
    | 'unavailable'
    | 'failed'
    | 'target-mismatch'
  verified: boolean
  target: Target | null
  message: string
  drawing?: unknown
  readback?: {
    chartType: string
    priceScaleMode: string
    drawingCount: number
    indicatorCount: number
  }
}
const identity = (chart: ChartServiceHandle): Target => ({
  market: chart.market,
  pair: chart.pair,
  timeframe: chart.timeframe,
})
const matches = (
  actual: Target,
  wanted: { market?: string; pair?: string; timeframe?: string },
) =>
  (!wanted.market ||
    actual.market.toLowerCase() === wanted.market.toLowerCase()) &&
  (!wanted.pair || normalizePair(actual.pair) === normalizePair(wanted.pair)) &&
  (!wanted.timeframe ||
    (normalizeTimeframe(actual.timeframe) ?? actual.timeframe) ===
      (normalizeTimeframe(wanted.timeframe) ?? wanted.timeframe))
const state = (engine: FastFinancialChartRef) => {
  const snapshot = engine.getSnapshot()
  if (!Array.isArray(snapshot.drawings) || !Array.isArray(snapshot.indicators))
    throw new Error('Chart readback unavailable')
  return snapshot
}
const finiteArguments = (value: unknown, depth = 0): boolean => {
  if (depth > 16) return false
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value))
    return value.every((item) => finiteArguments(item, depth + 1))
  if (value && typeof value === 'object')
    return Object.values(value).every((item) =>
      finiteArguments(item, depth + 1),
    )
  return true
}
const engineMatches = (
  engine: FastFinancialChartRef,
  snapshot: ReturnType<typeof state>,
  target: Target,
) =>
  normalizePair(engine.seriesOrder()[0] ?? '') === normalizePair(target.pair) &&
  (normalizeTimeframe(snapshot.timeframe) ?? snapshot.timeframe) ===
    (normalizeTimeframe(target.timeframe) ?? target.timeframe)

/** Run one command against one captured live chart, then verify that same instance. */
export function executeAssistantChartAction(
  name: string,
  input: Record<string, unknown>,
  deps: Deps,
  toolCallId?: string,
): Result {
  const handle = deps.getChart()
  const target = handle ? identity(handle) : null
  const engine = handle?.chartRef.current
  const unavailable = (message: string): Result => ({
    status: 'unavailable',
    verified: false,
    target,
    message,
  })
  if (!actionNames.has(name) || !handle || !engine || !target)
    return unavailable(
      'The target chart is not ready. No chart command was executed.',
    )
  let wanted = deps.getFocus()
  if (input.chartTarget !== undefined) {
    const expected = targetSchema.safeParse(input.chartTarget)
    if (!expected.success)
      return unavailable(
        'The expected chart target is invalid. No chart command was executed.',
      )
    wanted = expected.data
  }
  if (!matches(target, wanted))
    return {
      status: 'target-mismatch',
      verified: false,
      target,
      message:
        'The mounted chart does not match the requested chart. No chart command was executed. Switch the intended pane and read its target before drawing.',
    }
  if (!finiteArguments(input))
    return {
      status: 'failed',
      verified: false,
      target,
      message:
        'Chart arguments contain an invalid numeric value or excessively nested data. No chart command was executed.',
    }
  let attempted = false
  try {
    const published = handle.getSnapshot?.()
    if (!published)
      return unavailable(
        'The chart stream is not ready for verified changes. No chart command was executed.',
      )
    if (!matches(target, published))
      return {
        status: 'target-mismatch',
        verified: false,
        target,
        message:
          'The published chart stream does not match the intended venue, pair or timeframe. No chart command was executed.',
      }
    const before = state(engine)
    if (!engineMatches(engine, before, target))
      return {
        status: 'target-mismatch',
        verified: false,
        target,
        message:
          'The chart engine is still showing a different pair or timeframe. No chart command was executed. Wait for the intended chart to finish switching and read its state.',
      }
    attempted = true
    const receipt = executeClientTool(name, input, {
      chart: handle,
      navigate: async () => {},
      resolveMarketRef: () => null,
      toolCallId,
    })
    if (receipt?.ok === false)
      return {
        status: 'failed',
        verified: false,
        target,
        message: (
          receipt.error ?? 'The chart engine rejected this command.'
        ).slice(0, 500),
      }
    const current = deps.getChart()
    if (
      current !== handle ||
      current.chartRef.current !== engine ||
      !matches(identity(current), target)
    )
      return {
        status: 'requested',
        verified: false,
        target,
        message:
          'The chart target changed during the command. Its rendered outcome is unverified; read the exact target before another action.',
      }
    const after = state(engine)
    const publishedAfter = current.getSnapshot?.()
    if (!publishedAfter || !matches(target, publishedAfter))
      return {
        status: 'requested',
        verified: false,
        target,
        message:
          'The published chart stream changed or became unreadable during the command. Read chart state before another action.',
      }
    if (!engineMatches(engine, after, target))
      return {
        status: 'requested',
        verified: false,
        target,
        message:
          'The engine pair or timeframe changed during the command. Read the chart state before another action.',
      }
    const readback = {
      chartType: after.chartType,
      priceScaleMode: after.priceScaleMode,
      drawingCount: after.drawings.length,
      indicatorCount: after.indicators.length,
    }
    if (name === 'take_screenshot') {
      const verified = receipt?.ok === true && !!getScreenshot(toolCallId)
      return {
        status: verified ? 'applied' : 'requested',
        verified,
        target,
        readback,
        message: verified
          ? 'Captured the image for this exact chart; the image is attached to this tool call.'
          : 'The screenshot is not verified as attached.',
      }
    }
    if (name.startsWith('draw_') || name === 'annotate_chart') {
      const result = receipt?.result
      const drawing =
        result && typeof result === 'object' && 'id' in result
          ? after.drawings.find((entry) => entry.id === result.id)
          : undefined
      const sameGeometry =
        drawing &&
        result &&
        typeof result === 'object' &&
        [
          'type',
          'price',
          'ts',
          'points',
          'point',
          'content',
          'visible',
          'seriesId',
        ].every(
          (key) =>
            !(key in result) ||
            JSON.stringify(Reflect.get(drawing, key)) ===
              JSON.stringify(Reflect.get(result, key)),
        )
      const verified = receipt?.ok === true && !!sameGeometry
      return {
        status: verified ? 'applied' : 'requested',
        verified,
        target,
        readback,
        ...(verified ? { drawing } : {}),
        message: verified
          ? 'Drawing added and read back on this exact chart.'
          : 'The drawing command was requested but its state is not verified. Read the chart before issuing another drawing.',
      }
    }
    const already =
      name === 'clear_drawings'
        ? before.drawings.length === 0
        : name === 'remove_drawing'
          ? !before.drawings.some((entry) => entry.id === input.id)
          : name === 'remove_all_indicators'
            ? before.indicators.length === 0
            : name === 'remove_indicator'
              ? !before.indicators.some((entry) => entry.id === input.id)
              : name === 'set_chart_type'
                ? before.chartType === input.chartType
                : name === 'set_price_scale'
                  ? before.priceScaleMode === input.mode
                  : false
    const desired =
      name === 'clear_drawings'
        ? after.drawings.length === 0
        : name === 'remove_drawing'
          ? !after.drawings.some((entry) => entry.id === input.id)
          : name === 'remove_all_indicators'
            ? after.indicators.length === 0
            : name === 'remove_indicator'
              ? !after.indicators.some((entry) => entry.id === input.id)
              : name === 'set_chart_type'
                ? after.chartType === input.chartType
                : name === 'set_price_scale'
                  ? after.priceScaleMode === input.mode
                  : null
    const changed = JSON.stringify(before) !== JSON.stringify(after)
    const verified = desired ?? changed
    return {
      status: verified ? (already ? 'unchanged' : 'applied') : 'requested',
      verified,
      target,
      readback,
      message: verified
        ? 'The requested chart state is verified on this exact chart.'
        : 'The chart update was requested; React rendering or readback has not confirmed it. Read chart state before issuing it again.',
    }
  } catch {
    return {
      status: attempted ? 'requested' : 'unavailable',
      verified: false,
      target,
      message: attempted
        ? 'The command outcome could not be verified. Do not repeat it blindly; read the exact chart state first.'
        : 'Chart state is unreadable. No chart command was executed.',
    }
  }
}

/** Only the unified assistant owns these effects; legacy pane copilots keep forwarding. */
export function bindAssistantChartActions(tools: ToolSet, deps: Deps): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      if (!actionNames.has(name)) return [name, definition]
      const inputSchema =
        definition.inputSchema instanceof z.ZodObject
          ? definition.inputSchema.extend({
              chartTarget: targetSchema
                .optional()
                .describe(
                  'Exact target returned by get_chart_state. Mismatches are blocked before writing.',
                ),
            })
          : definition.inputSchema
      const bound: ToolSet[string] = {
        ...definition,
        inputSchema,
        execute: (input, options) =>
          Promise.resolve(
            executeAssistantChartAction(
              name,
              input && typeof input === 'object' && !Array.isArray(input)
                ? input
                : {},
              deps,
              options.toolCallId,
            ),
          ),
      }
      return [name, bound]
    }),
  )
}
