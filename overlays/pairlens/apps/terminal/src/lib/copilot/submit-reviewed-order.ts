import { assistantOrderAccount, requiresExchangeAccount } from './order-account'
import { confirmedOrderFields } from './trading-tools'
import type {
  CopilotOrderRequest,
  OrderOutcome,
} from '@/components/copilot/copilot-order-card'
import type { ExchangeCredential } from '@/stores/credentials-store'

/** The confirmation submits this reviewed order directly, never through a workflow. */
export async function submitReviewedOrder(
  request: CopilotOrderRequest,
  mode: 'paper' | 'live',
  credentials: ReadonlyArray<ExchangeCredential>,
  placeOrder: (params: Record<string, unknown>) => Promise<OrderOutcome>,
): Promise<OrderOutcome> {
  if (request.mode !== undefined && request.mode !== mode)
    throw new Error(
      'The reviewed trading mode changed. Prepare a fresh proposal.',
    )
  if (
    request.mode === 'live' &&
    requiresExchangeAccount(request.market) &&
    !request.credentialId
  )
    throw new Error(
      'The live proposal has no reviewed account. Prepare a fresh proposal.',
    )
  const account = assistantOrderAccount(
    credentials,
    request.market,
    mode,
    request.credentialId,
  )
  if (mode === 'live' && !account && requiresExchangeAccount(request.market))
    throw new Error('No live account is connected for this exchange.')
  return placeOrder({
    market: request.market,
    pair: request.pair,
    side: request.side,
    type: request.type,
    ...confirmedOrderFields(request),
    mode,
    analyticsSource: 'copilot',
    ...(request.clientOrderId ? { clientOrderId: request.clientOrderId } : {}),
    ...(account ? { credentialId: account.id } : {}),
  })
}
