// Copyright (c) 2026 Juan Ignacio Molina Estrada
// SPDX-License-Identifier: FSL-1.1-Apache-2.0
type PreparationSteps = {
  steps: ReadonlyArray<{
    toolResults: ReadonlyArray<{ toolName: string; output: unknown }>
  }>
}

const TRADE_PREPARATION_TOOLS = new Set([
  'place_order',
  'prepare_lighter_native_order',
  'prepare_position_plan',
  'prepare_advanced_execution',
  'prepare_exchange_operation',
  'cancel_order',
])

/** One model correction is enough; never spend the turn looping on malformed trade calls. */
export function repeatedPreparationFailure({
  steps,
}: {
  steps: ReadonlyArray<{
    toolCalls: ReadonlyArray<{ toolName: string; invalid?: boolean }>
  }>
}): boolean {
  if (steps.length < 2) return false
  const recent = steps.slice(-2)
  return recent.every((step) =>
    step.toolCalls.some(
      (call) =>
        TRADE_PREPARATION_TOOLS.has(call.toolName) && call.invalid === true,
    ),
  )
}

/** A ready card is the handoff to the human, not another model/tool turn. */
export function tradePreparationReady({ steps }: PreparationSteps): boolean {
  return (
    steps
      .at(-1)
      ?.toolResults.some(
        ({ toolName, output }) =>
          TRADE_PREPARATION_TOOLS.has(toolName) &&
          typeof output === 'object' &&
          output !== null &&
          'status' in output &&
          output.status === 'awaiting_confirmation',
      ) ?? false
  )
}
