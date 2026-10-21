// Copyright (c) 2026 Juan Ignacio Molina Estrada
// SPDX-License-Identifier: FSL-1.1-Apache-2.0
import { describe, expect, test } from 'bun:test'
import { buildAssistantSystemPrompt } from '../assistant-brain'
import { WORKFLOW_GUIDE } from '../guides'

describe('assistant trade preparation contract', () => {
  const prompt = buildAssistantSystemPrompt({ guides: [WORKFLOW_GUIDE] })

  test('prevents argument-format speculation and repeated rejected trade calls', () => {
    expect(prompt).toContain('Send tool arguments as typed JSON')
    expect(prompt).toContain(
      'Do not speculate about XML, harness internals or alternate tool syntax',
    )
    expect(prompt).toContain('correct it once')
  })

  test('protected TWAP requires explicit managed disclosure and preserves native-only intent', () => {
    expect(prompt).toContain('Native Lighter TWAP cannot attach a TP/SL ladder')
    expect(WORKFLOW_GUIDE).toContain(
      'Never silently substitute a managed TWAP for a native-only request',
    )
  })

  test('prepares explicit instructions without restarting research or asking again', () => {
    expect(prompt).toContain(
      'Explicit execution requests take priority over further research',
    )
    expect(prompt).toContain(
      'Do not ask whether to prepare after the user already asked to open',
    )
  })

  test('preserves venue identity and distinguishes margin sizing from base quantity', () => {
    expect(prompt).toContain(
      'half my cash means half the verified available collateral as margin',
    )
    expect(prompt).toContain(
      'Never infer leverage from maximum leverage or initial margin requirements',
    )
    expect(prompt).toContain('Never replace W with WIF or S with SOL')
  })

  test('uses correct entry attachment and stops guard failure bypass', () => {
    expect(prompt).toContain('Entry plus stop-loss alone uses OTO')
    expect(prompt).toContain('Connection revisions do not expire with time')
    expect(prompt).toContain(
      'Never switch to a workflow to bypass a connection, account, revision or risk error',
    )
    expect(WORKFLOW_GUIDE).toContain(
      'OCO is for two protective exits, never an entry plus a stop-loss',
    )
  })

  test('reports protection as verified conditional coverage, never guaranteed execution', () => {
    expect(prompt).toContain('Stop-limit orders can trigger without filling')
    expect(prompt).toContain('do not count the same position quantity twice')
    expect(prompt).toContain('Never promise that cancel-then-replace has no protection gap')
  })

  test('does not promise chat monitoring or confuse old runs with current orders', () => {
    expect(prompt).toContain('A chat response does not schedule future monitoring')
    expect(prompt).toContain('Historical paused runs do not establish the state of a current trade')
    expect(prompt).toContain('Workflows → Activity has reviewed Pause and Stop actions')
    expect(prompt).toContain('Pausing or stopping a managed plan does not cancel its existing exchange orders')
  })

  test('grounds risk reward in actual weighted exits and remaining quantities', () => {
    expect(prompt).toContain('Compute reward and risk from exact quantities and weighted exit allocations')
    expect(prompt).toContain('funding sign: positive means longs pay shorts; negative means shorts pay longs')
  })
})
