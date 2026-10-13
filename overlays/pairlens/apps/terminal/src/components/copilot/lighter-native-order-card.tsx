import { useRef, useState } from 'react'
import { Button } from '@pairlens/ui/components/ui/button'
import {
  LighterNativeOrderApproval,
  lighterNativeAmountLabel,
} from '@/lib/copilot/lighter-native-orders'

const labels = {
  single: 'Single order',
  oto: 'Entry → one linked order',
  oco: 'Position TP/SL · cancel sibling',
  otoco: 'Entry → linked TP/SL · cancel sibling',
}
export function LighterNativeOrderCard({
  nativeOrder,
}: {
  nativeOrder: unknown
}) {
  const controller = useRef<LighterNativeOrderApproval | null>(null)
  const [state, setState] = useState<
    LighterNativeOrderApproval['status'] | 'rejected'
  >('idle')
  let invalid = false
  let invalidMessage =
    'Invalid native order proposal. Prepare a new trade. Nothing was submitted.'
  if (!controller.current) {
    try {
      controller.current = new LighterNativeOrderApproval(nativeOrder)
    } catch (cause) {
      invalid = true
      if (cause instanceof Error) invalidMessage = cause.message
    }
  }
  if (invalid || !controller.current)
    return (
      <p role="alert" className="text-xs text-down">
        {invalidMessage}
      </p>
    )
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
        Lighter · {plan.symbol} · {labels[plan.grouping]}
      </p>
      <p className="text-muted-foreground">
        Live · {plan.accountLabel ?? plan.accountName} · server account{' '}
        {plan.accountName}
      </p>
      {plan.leverage !== undefined && (
        <p className="mt-1">
          {plan.leverage}× leverage · {plan.marginMode}
        </p>
      )}
      {plan.review && (
        <p className="mt-1 text-muted-foreground">
          Estimated entry notional: {plan.review.openingNotional} USDC.{' '}
          {plan.review.marginStatus === 'verified' &&
          plan.review.initialMargin !== null &&
          plan.review.availableMargin !== null
            ? `Estimated initial margin: ${plan.review.initialMargin} USDC · available margin: ${plan.review.availableMargin} USDC. Excludes fees; checked again at submission.`
            : 'Initial margin or available margin could not be verified. Do not treat the venue maximum leverage as the selected leverage.'}
        </p>
      )}
      <ol className="my-3 space-y-3">
        {plan.legs.map((leg, index) => (
          <li key={index} className="rounded border border-border p-2">
            <p className="font-semibold">
              {index + 1}. {leg.side.toUpperCase()} · {leg.type}
            </p>
            <dl className="mt-1 space-y-1 text-muted-foreground">
              <div className="flex justify-between gap-3">
                <dt>Base amount</dt>
                <dd className="font-mono text-foreground">
                  {lighterNativeAmountLabel(plan, index)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>
                  {['market', 'twap', 'sl-market', 'tp-market'].includes(
                    leg.type,
                  )
                    ? 'Price bound'
                    : 'Limit price'}
                </dt>
                <dd className="font-mono text-foreground">{leg.price}</dd>
              </div>
              {leg.triggerPrice && (
                <div className="flex justify-between gap-3">
                  <dt>Trigger price</dt>
                  <dd className="font-mono text-foreground">
                    {leg.triggerPrice}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt>Reduce only</dt>
                <dd>{leg.reduceOnly ? 'Yes' : 'No'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Time in force</dt>
                <dd>{leg.timeInForce}</dd>
              </div>
              {leg.durationSeconds && (
                <div className="flex justify-between gap-3">
                  <dt>TWAP duration</dt>
                  <dd>{leg.durationSeconds} seconds</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt>Expiry</dt>
                <dd>
                  {leg.expiry
                    ? new Date(leg.expiry).toISOString()
                    : 'Venue default'}
                </dd>
              </div>
            </dl>
            {!/[1-9]/.test(leg.amount) && (
              <p className="mt-2 text-amber-500">
                {plan.grouping === 'oco'
                  ? `Whole-position exit: reviewed current size ${plan.positionSize}. Native coverage changes with later position additions and reductions.`
                  : 'Entry-linked size: Lighter derives this child amount from the entry fill. It does not protect earlier or unrelated position size.'}
              </p>
            )}
          </li>
        ))}
      </ol>
      <p className="text-[10px] text-muted-foreground">
        Request: {plan.requestId}
      </p>
      {state === 'idle' && (
        <>
          <p className="my-2 text-amber-500">
            Confirm sends this complete native plan to the reviewed live
            account. No workflow editor is required. This proposal expires after
            three minutes. Acceptance does not mean filled.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void confirm()}>
              Confirm native order
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
      {state === 'pending' && (
        <p role="status" className="mt-2">
          Submitting approved native order…
        </p>
      )}
      {state === 'accepted' && (
        <div role="status" className="mt-2 space-y-1">
          <p>
            Native submission accepted. Check Lighter orders and fills to verify
            execution.
          </p>
          {approval.evidence?.txHash && (
            <p className="break-all font-mono">
              Transaction: {approval.evidence.txHash}
            </p>
          )}
          {approval.evidence?.orderIds && (
            <p className="break-all font-mono">
              Native client order IDs: {approval.evidence.orderIds.join(', ')}
            </p>
          )}
        </div>
      )}
      {(state === 'blocked' || state === 'unknown') && (
        <p role="alert" className="mt-2 text-amber-500">
          {approval.error}
        </p>
      )}
      {state === 'rejected' && (
        <p className="mt-2 text-muted-foreground">
          Rejected. Nothing was submitted.
        </p>
      )}
    </div>
  )
}
