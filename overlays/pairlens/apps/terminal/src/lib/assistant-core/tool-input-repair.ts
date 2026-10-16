import { InvalidToolInputError } from 'ai'
import { positionPlanInputSchema } from '../copilot/advanced-position-plan'
import type { ToolCallRepairFunction, ToolSet } from 'ai'

// All numeric fields in this specific schema are bounded integers. Accept only
// canonical integer literals so floating-point rounding cannot change intent.
const jsonNumber = /^-?(?:0|[1-9]\d*)$/
function numberField(value: unknown): unknown {
  if (typeof value !== 'string' || !jsonNumber.test(value)) return value
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : value
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Repair only known representation mistakes before validation, never execution.
 * The strict original schema remains authoritative; no defaults or trade values
 * are invented and exact decimal-string amounts/prices stay strings.
 */
export const repairPositionPlanToolCall: ToolCallRepairFunction<
  ToolSet
> = async ({ toolCall, error }) => {
  if (
    !InvalidToolInputError.isInstance(error) ||
    toolCall.toolName !== 'prepare_position_plan' ||
    toolCall.input.length > 32768
  )
    return null
  let raw: unknown
  try {
    raw = JSON.parse(toolCall.input)
  } catch {
    return null
  }
  if (!isRecord(raw) || positionPlanInputSchema.safeParse(raw).success)
    return null
  const repaired = { ...raw }
  repaired.leverage = numberField(raw.leverage)
  // Discriminant selects the exact numeric fields; never infer another kind.
  if (raw.kind === 'scale' || raw.kind === 'twap')
    repaired.count = numberField(raw.count)
  if (raw.kind === 'twap')
    repaired.intervalSeconds = numberField(raw.intervalSeconds)
  let takeProfits: unknown = raw.takeProfits
  if (typeof takeProfits === 'string') {
    try {
      takeProfits = JSON.parse(takeProfits)
    } catch {
      return null
    }
  }
  if (Array.isArray(takeProfits)) {
    repaired.takeProfits = takeProfits.map((leg: unknown) =>
      isRecord(leg) ? { ...leg, percent: numberField(leg.percent) } : leg,
    )
  }
  if (!positionPlanInputSchema.safeParse(repaired).success) return null
  return { ...toolCall, input: JSON.stringify(repaired) }
}
