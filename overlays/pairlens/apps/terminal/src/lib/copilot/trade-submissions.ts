export type TradeSubmission = {
  clientOrderId: string
  market: string
  pair: string
  credentialId?: string
  mode: 'paper' | 'live'
  status: 'submitting' | 'simulated' | 'submitted' | 'unverified' | 'blocked'
  nativeClientOrderIds?: Array<string>
  txHash?: string
  orderId?: string
  error?: string
  recordedAt: number
}

// Confirmation evidence from this browser session, not exchange fill history.
// Store only projected metadata: never credentials, signer keys or raw responses.
const submissions = new Map<string, TradeSubmission>()

export function recordTradeSubmission(record: TradeSubmission): void {
  submissions.set(record.clientOrderId, { ...record })
  while (submissions.size > 25) {
    const oldest = submissions.keys().next().value
    if (oldest === undefined) break
    submissions.delete(oldest)
  }
}

export function getTradeSubmissions(): Array<TradeSubmission> {
  return [...submissions.values()]
    .sort((a, b) => b.recordedAt - a.recordedAt)
    .map((entry) => ({ ...entry }))
}
