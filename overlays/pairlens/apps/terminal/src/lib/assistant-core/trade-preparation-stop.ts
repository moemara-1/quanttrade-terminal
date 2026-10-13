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
