import { z } from 'zod'
import { workflowGraphSchema } from './trading-tools'

type ReviewGraph = { oco?: boolean; steps: ReadonlyArray<{ id: string; type: string; data?: Record<string, unknown> }>; edges: ReadonlyArray<{ source: string; target: string; sourceHandle?: string }> }

const finite = z.number().finite()
const entryData = { side: z.enum(['buy', 'sell', 'inherit', 'opposite']), sizeMode: z.enum(['absolute', 'percent']), size: finite.positive() }
const exitData = { sizeScope: z.enum(['parent', 'workflow']).optional(), triggerMode: z.enum(['percent', 'absolute']), triggerValue: finite.positive(), sizePercent: finite.min(1).max(100), orderType: z.enum(['market', 'limit']), limitPrice: finite.nonnegative().optional() }
const dataSchemas: Record<string, z.ZodType> = {
  trigger: z.object({}),
  'market-order': z.object(entryData),
  'limit-order': z.object({ ...entryData, priceMode: z.enum(['absolute', 'offset-percent', 'offset-absolute']), priceValue: finite }),
  'take-profit': z.object(exitData), 'stop-loss': z.object(exitData),
  condition: z.object({ conditionType: z.enum(['price-above', 'price-below', 'percent-change']), value: finite }),
  split: z.object({ branches: finite.int().min(2).max(8) }),
  wait: z.object({ duration: finite.positive(), unit: z.enum(['seconds', 'minutes', 'hours']) }),
}
const isExit = (type: string) => type === 'take-profit' || type === 'stop-loss'
function parentSignature(graph: ReviewGraph, id: string): string {
  return graph.edges.filter((edge) => edge.target === id).map((edge) => `${edge.source}:${graph.steps.find((step) => step.id === edge.source)?.type === 'condition' ? edge.sourceHandle ?? 'pass' : ''}`).sort().join('|')
}

/** Local preflight mirrors bridge graph checks; the bridge remains execution authority. */
export function workflowGraphReviewError(market: string, rawGraph: unknown): string | undefined {
  const parsed = workflowGraphSchema.safeParse(rawGraph)
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Invalid workflow graph.'
  const graph = parsed.data
  if (graph.steps.some((step) => step.id.length > 100)) return 'Workflow node IDs must contain at most 100 characters.'
  const nodes = new Map(graph.steps.map((step) => [step.id, step]))
  if (nodes.size !== graph.steps.length) return 'Duplicate workflow node IDs.'
  if (new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length) return 'Duplicate workflow edge IDs.'
  const triggers = graph.steps.filter((step) => step.type === 'trigger')
  if (triggers.length !== 1) return 'Workflow requires exactly one trigger.'
  for (const step of graph.steps) {
    if (!dataSchemas[step.type]?.safeParse(step.data).success) return `Invalid ${step.type} configuration: ${step.id}`
    if (step.type === 'condition' && (step.data.conditionType === 'percent-change' ? step.data.value === 0 : Number(step.data.value) <= 0)) return 'Condition value is invalid.'
    if (step.type === 'limit-order' && step.data.priceMode === 'absolute' && Number(step.data.priceValue) <= 0) return 'Absolute limit price must be positive.'
    if (isExit(step.type) && step.data.orderType === 'limit' && !(Number(step.data.limitPrice) > 0)) return 'Protective limit price is required.'
  }
  const indegree = new Map(graph.steps.map((step) => [step.id, 0]))
  for (const edge of graph.edges) {
    const source = nodes.get(edge.source)
    if (!source || !nodes.has(edge.target)) return 'Dangling workflow edge.'
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
    if (source.type === 'condition' && edge.sourceHandle !== undefined && !['pass', 'fail'].includes(edge.sourceHandle)) return 'Condition edge requires pass or fail handle.'
    if (source.type === 'split' && edge.sourceHandle !== undefined && !Array.from({ length: Number(source.data.branches) }, (_, index) => `branch-${index}`).includes(edge.sourceHandle)) return 'Unknown split branch.'
  }
  if ((indegree.get(triggers[0].id) ?? 0) > 0) return 'Trigger cannot have parents.'
  const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id)
  for (const id of queue) {
    for (const edge of graph.edges.filter((connection) => connection.source === id)) {
      const count = (indegree.get(edge.target) ?? 0) - 1
      indegree.set(edge.target, count)
      if (count === 0) queue.push(edge.target)
    }
  }
  if (queue.length !== graph.steps.length) return 'Workflow contains a cycle.'
  const reachable = new Set([triggers[0].id])
  for (let changed = true; changed;) {
    changed = false
    for (const edge of graph.edges) if (reachable.has(edge.source) && !reachable.has(edge.target)) { reachable.add(edge.target); changed = true }
  }
  if (graph.steps.some((step) => !reachable.has(step.id))) return 'Workflow contains unreachable nodes.'
  const exits = graph.steps.filter((step) => isExit(step.type))
  for (const exit of exits.filter((step) => step.data.sizeScope === 'workflow')) {
    const ancestors = new Set<string>()
    const pending = [exit.id]
    while (pending.length) {
      const id = pending.pop()!
      for (const edge of graph.edges.filter((connection) => connection.target === id)) if (!ancestors.has(edge.source)) { ancestors.add(edge.source); pending.push(edge.source) }
    }
    const entries = graph.steps.filter((step) => ['market-order', 'limit-order'].includes(step.type))
    if (!entries.length || entries.some((step) => !ancestors.has(step.id))) return 'Workflow-scoped protection must follow every workflow entry.'
  }
  if (market.endsWith('-spot') && exits.length) return 'Spot protective trigger orders are not verified for this connector.'
  if (!graph.oco) return undefined
  if (!exits.length) return 'OCO requires paired protective exits.'
  for (const exit of exits) {
    const matches = exits.filter((other) => other.id !== exit.id && other.type !== exit.type && other.data.sizePercent === exit.data.sizePercent && (other.data.sizeScope ?? 'parent') === (exit.data.sizeScope ?? 'parent') && parentSignature(graph, other.id) === parentSignature(graph, exit.id))
    if (matches.length !== 1) return 'OCO requires one matching TP/SL sibling with identical parents and close percentage.'
  }
  if (market === 'hyperliquid') {
    const usedEntries = new Set<string>()
    for (const tp of exits.filter((step) => step.type === 'take-profit')) {
      if (tp.data.sizeScope === 'workflow') return 'Hyperliquid entry-attached OCO protects only its own entry, not full workflow scope.'
      const parents = graph.edges.filter((edge) => edge.target === tp.id)
      if (tp.data.sizePercent !== 100) return 'Hyperliquid native OCO requires both exits to protect 100% of the entry.'
      if (parents.length !== 1) return 'Hyperliquid OCO exits must be direct siblings of their entry or one Split.'
      let entry = nodes.get(parents[0].source)
      if (entry?.type === 'split') {
        const incoming = graph.edges.filter((edge) => edge.target === entry?.id)
        entry = incoming.length === 1 ? nodes.get(incoming[0].source) : undefined
      }
      if (!entry || !['market-order', 'limit-order'].includes(entry.type)) return 'Hyperliquid native OCO requires an entry directly before its exits or one Split; existing-position OCO is unsupported.'
      if (usedEntries.has(entry.id)) return 'A Hyperliquid entry cannot own multiple native OCO pairs.'
      usedEntries.add(entry.id)
    }
  }
  return undefined
}

function hasEntryAncestor(graph: ReviewGraph, id: string): boolean {
  const visited = new Set<string>()
  const pending = graph.edges.filter((edge) => edge.target === id).map((edge) => edge.source)
  while (pending.length) {
    const parent = pending.pop()!
    if (visited.has(parent)) continue
    visited.add(parent)
    const step = graph.steps.find((node) => node.id === parent)
    if (step?.type === 'market-order' || step?.type === 'limit-order') return true
    pending.push(...graph.edges.filter((edge) => edge.target === parent).map((edge) => edge.source))
  }
  return false
}

/** Review the actual selected grouping without promising unknown fill prices. */
export function workflowOcoReview(market: string, graph?: ReviewGraph): string {
  const independent = graph && !graph.oco ? 'TP/SL orders are independent when native OCO pairing is off. Filling one exit does not cancel the other. Each exit follows its own graph connections.' : ''
  if (graph?.steps.some((step) => isExit(step.type) && step.data?.sizeScope === 'workflow')) return `${independent ? `${independent} ` : ''}Workflow-scoped exits use the combined verified workflow entry fills and their weighted average fill price. They exclude any existing position from before this run. Protection is submitted only after all entries finish; the position is not protected until the exits are accepted.`
  if (market === 'lighter' && graph?.steps.some((step) => ['take-profit', 'stop-loss'].includes(step.type) && !hasEntryAncestor(graph, step.id)))
    return `${independent ? `${independent} ` : ''}These exits have no entry-order parent. They can submit before the scheduled entries and require an existing position. Percentage targets use the upstream graph reference quote, not a future entry fill. Connect the exits after the intended entry if they should protect that fill; QuantTrade does not change saved connections automatically.`
  if (independent) return independent
  if (market === 'hyperliquid') return 'Hyperliquid submits the entry and paired TP/SL together as an exchange-native bracket. Required graph: market or limit entry, optional Split, then two matching 100% TP/SL exits. Percentage targets use the entry limit price or a fresh quote before submission; they are not recalculated from the later fill. The server validates the complete grouping before sending the entry.'
  if (market === 'lighter') return 'Lighter submits paired exchange-native TP/SL exits after the entry fill is confirmed. Percentage targets use the actual parent fill. The entry is submitted separately and is not protected until the paired exits are accepted.'
  return 'Native OCO is supported only for Lighter and Hyperliquid perpetual workflows; spot OCO is unavailable.'
}
