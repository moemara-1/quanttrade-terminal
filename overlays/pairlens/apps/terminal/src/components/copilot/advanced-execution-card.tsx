import { useRef, useState } from 'react'
import { Button } from '@pairlens/ui/components/ui/button'
import { AdvancedExecutionApproval } from '@/lib/copilot/advanced-execution-orders'

export function AdvancedExecutionCard({
  advancedOrder,
}: {
  advancedOrder: unknown
}) {
  const controller = useRef<AdvancedExecutionApproval | null>(null)
  const [state, setState] = useState<
    AdvancedExecutionApproval['status'] | 'rejected'
  >('idle')
  if (!controller.current) {
    try {
      controller.current = new AdvancedExecutionApproval(advancedOrder)
    } catch {
      return (
        <p role="alert">Invalid advanced plan. Prepare a fresh proposal.</p>
      )
    }
  }
  const approval = controller.current
  const plan = approval.proposal
  async function confirm() {
    if (state !== 'idle' || approval.status !== 'idle') return
    setState('pending')
    setState(await approval.approve())
  }
  return (
    <div className="my-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
      <p className="mb-2 font-semibold">
        {plan.venue} · {plan.symbol} ·{' '}
        {plan.kind === 'chase'
          ? 'Managed Chase Limit'
          : plan.kind === 'chase-cancel' ||
              plan.kind === 'hyperliquid-twap-cancel'
            ? plan.kind === 'chase-cancel'
              ? 'Cancel managed Chase'
              : 'Cancel native TWAP'
            : 'Native TWAP'}
      </p>
      <p className="text-muted-foreground">
        Live · {plan.accountLabel ?? plan.accountName} · server account{' '}
        {plan.accountName}
      </p>
      {plan.kind !== 'chase-cancel' &&
        plan.kind !== 'hyperliquid-twap-cancel' && (
          <p className="my-2">
            {plan.side.toUpperCase()} {plan.size} base units ·{' '}
            {plan.reduceOnly ? 'Reduce only' : 'Opening order'}
          </p>
        )}
      {plan.kind !== 'chase-cancel' &&
        plan.kind !== 'hyperliquid-twap-cancel' &&
        plan.leverage !== undefined && (
          <p>
            {plan.leverage}× · {plan.marginMode}
          </p>
        )}
      {plan.kind === 'chase' ? (
        <>
          <p>
            Price band {plan.lowerPrice}–{plan.upperPrice} ·{' '}
            {plan.durationSeconds}s duration · {plan.intervalSeconds}s interval
            · at most {plan.maxAttempts} attempts ·{' '}
            {plan.postOnly ? 'Post only' : 'Limit'}
          </p>
          <p>
            Maximum cumulative submitted notional: {plan.maxTotalNotional} USDC.
          </p>
          <p className="my-2 text-amber-500">
            QuantTrade cancels and verifies each owned order before replacing
            only the remaining verified quantity. Uncertain outcomes pause the
            plan. This is managed execution, not native Chase. Expiry cancels
            owned remaining orders. Protective exits are not included.
          </p>
        </>
      ) : plan.kind === 'chase-cancel' ||
        plan.kind === 'hyperliquid-twap-cancel' ? (
        <p className="my-2 text-amber-500">
          {plan.kind === 'chase-cancel'
            ? `Request cancellation of managed Chase run ${plan.runId}; only its owned remaining order is canceled after verification.`
            : `Cancel only native TWAP ID ${plan.twapId}.`}{' '}
          Existing filled slices remain in your position. This does not close
          the position.
        </p>
      ) : (
        <>
          <p>
            {plan.durationMinutes} minutes ·{' '}
            {plan.randomize ? 'Randomized slices' : 'Regular slices'}
          </p>
          <p>
            Reference admission budget: {plan.referenceNotionalBudget} USDC.
          </p>
          <p className="my-2 text-amber-500">
            Hyperliquid runs slices with fixed 3% maximum slice slippage. There
            is no absolute future price or total quote cap. The reference budget
            is an admission estimate, not your maximum future expenditure. The
            venue may not fill the entire amount. Protective exits are not
            included.
          </p>
        </>
      )}
      <p className="text-[10px] text-muted-foreground">
        Request: {plan.requestId}
      </p>
      {state === 'idle' && (
        <>
          <p className="my-2 text-amber-500">
            One confirmation approves the entire reviewed plan. No workflow
            editor or child approvals. Expires after three minutes. Acceptance
            or registration does not mean filled.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void confirm()}>
              Confirm complete plan
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setState('rejected')}
            >
              Reject
            </Button>
          </div>
        </>
      )}
      {state === 'pending' && <p role="status">Submitting reviewed plan…</p>}
      {(state === 'accepted' || state === 'registered') && (
        <p role="status">
          {state === 'accepted'
            ? plan.kind === 'chase-cancel' ||
              plan.kind === 'hyperliquid-twap-cancel'
              ? 'Native TWAP cancellation accepted; verify venue state. Existing fills remain.'
              : 'Native TWAP accepted. Verify Hyperliquid TWAP history and slice fills.'
            : plan.kind === 'chase-cancel'
              ? 'Owned Chase cancellation requested. Read the run for verified cancellation; prior fills remain.'
              : 'Managed Chase registered. Read Chase runs for actual orders, fills and pauses.'}{' '}
          {approval.evidence}
        </p>
      )}
      {(state === 'blocked' || state === 'unknown') && (
        <p role="alert" className="mt-2 text-amber-500">
          {approval.error}
        </p>
      )}
      {state === 'rejected' && <p>Rejected. Nothing submitted.</p>}
    </div>
  )
}
