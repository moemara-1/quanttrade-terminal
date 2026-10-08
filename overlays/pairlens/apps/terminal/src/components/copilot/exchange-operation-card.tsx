import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@pairlens/ui/components/ui/button'
import { ExchangeOperationApproval } from '@/lib/copilot/exchange-operation'

const labels: Record<string, string> = {
  venue: 'Exchange',
  marketType: 'Market',
  symbol: 'Instrument',
  action: 'Operation',
  mode: 'Mode',
  leverage: 'Leverage',
  marginMode: 'Margin mode',
  amount: 'Amount',
  direction: 'Margin change',
  exchangeOrderId: 'Exchange order ID',
  price: 'Price',
  timeInForce: 'Time in force',
}

export function ExchangeOperationCard({ operation }: { operation: unknown }) {
  const controller = useRef<ExchangeOperationApproval | null>(null)
  const [state, setState] = useState<
    'idle' | 'pending' | 'accepted' | 'unknown' | 'rejected'
  >('idle')
  let invalid = false
  if (!controller.current) {
    try {
      controller.current = new ExchangeOperationApproval(operation)
    } catch {
      invalid = true
    }
  }
  if (invalid || !controller.current)
    return (
      <p role="alert" className="text-xs text-down">
        Invalid exchange proposal. Prepare a new operation.
      </p>
    )
  const proposal = controller.current.proposal
  async function approve() {
    if (
      state !== 'idle' ||
      !controller.current ||
      controller.current.status !== 'idle'
    )
      return
    setState('pending')
    const result = await controller.current.approve()
    setState(result === 'accepted' ? 'accepted' : 'unknown')
  }
  const fields = Object.entries(proposal).filter(([key]) => key !== 'requestId')
  return (
    <div className="my-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
      <p className="mb-2 font-semibold">Review exchange {proposal.action}</p>
      <dl className="space-y-1 text-muted-foreground">
        {fields.map(([name, value]) => (
          <div key={name} className="flex justify-between gap-3">
            <dt>
              {name === 'amount'
                ? proposal.action === 'margin'
                  ? 'Margin amount (USDC)'
                  : 'Size (base)'
                : (labels[name] ?? name)}
            </dt>
            <dd className="font-mono text-foreground">{String(value)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Request: {proposal.requestId}
      </p>
      {state === 'idle' && (
        <>
          <p className="my-2 flex items-center gap-1 text-[11px] text-amber-500">
            <AlertTriangle className="size-3" />
            Changes the connected live exchange account.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void approve()}>
              Approve operation
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
          Submitting approved operation…
        </p>
      )}
      {state === 'accepted' && (
        <p role="status" className="mt-2 flex items-center gap-1">
          <CheckCircle2 className="size-3" />
          Accepted. Refresh and inspect exchange orders and positions.
        </p>
      )}
      {state === 'unknown' && (
        <p role="alert" className="mt-2 text-amber-500">
          {controller.current.error}
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
