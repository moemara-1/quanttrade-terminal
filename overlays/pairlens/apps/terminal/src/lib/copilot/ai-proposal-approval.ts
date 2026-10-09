import { PROPOSAL_FRESHNESS_MS } from '@/stores/trade-consent-store'

/** Fresh human approval is required even when legacy chat history saved consent. */
export function proposalApprovalError(
  proposedAt: number | undefined,
  alreadyExecuted: boolean,
  now = Date.now(),
): string | null {
  if (alreadyExecuted)
    return 'This proposal was already submitted. Check the order status before preparing another.'
  if (
    proposedAt !== undefined &&
    (!Number.isFinite(proposedAt) ||
      proposedAt > now ||
      now - proposedAt > PROPOSAL_FRESHNESS_MS)
  )
    return 'This proposal expired. Ask the assistant to prepare a fresh order.'
  return null
}
