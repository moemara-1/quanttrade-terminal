import type { ArenaConfig } from './llm-arena'

export type TradingAgentDraft = {
  requestId: string
  config: Partial<ArenaConfig>
  agentId?: string
  missingFields: Array<string>
  proposedFields?: Array<string>
}
let draft: TradingAgentDraft | null = null
const listeners = new Set<() => void>()
export function getTradingAgentDraft(): TradingAgentDraft | null {
  return draft ? structuredClone(draft) : null
}
export function setTradingAgentDraft(value: TradingAgentDraft): void {
  draft = structuredClone(value)
  for (const listener of listeners) listener()
}
export function subscribeTradingAgentDraft(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function takeTradingAgentDraft(): TradingAgentDraft | null {
  const value = getTradingAgentDraft()
  draft = null
  for (const listener of listeners) listener()
  return value
}
