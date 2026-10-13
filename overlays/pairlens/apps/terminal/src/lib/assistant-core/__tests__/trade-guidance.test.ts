// Copyright (c) 2026 Juan Ignacio Molina Estrada
// SPDX-License-Identifier: FSL-1.1-Apache-2.0
import { describe, expect, test } from 'bun:test'
import { buildAssistantSystemPrompt } from '../assistant-brain'
import { WORKFLOW_GUIDE } from '../guides'

describe('assistant trade preparation contract', () => {
  const prompt = buildAssistantSystemPrompt({ guides: [WORKFLOW_GUIDE] })

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
})
