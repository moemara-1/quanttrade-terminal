import type { ScannerSnapshot } from '@/lib/scanners'
import { useArbitrageReview } from '@/hooks/use-arbitrage-review'

const control =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-primary'
export function ArbitrageReviewForm({
  comparison,
}: {
  comparison: ScannerSnapshot['comparisons'][number]
}) {
  const review = useArbitrageReview(comparison)
  const { plan } = review
  const active = review.busy
  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <h3 className="text-sm font-semibold">Prepare paired entry</h3>
      <p className="mt-1 text-[11px] text-muted-foreground">
        One review, two venue orders. No order is sent until you confirm the
        exact pair below.
      </p>
      <p className="mt-2 text-[11px] text-amber-500">
        Existing positions may be offset or reversed. Stop-loss and take-profit
        exits are not attached automatically.
      </p>
      {!plan && (
        <>
          <div
            className="mt-3 grid gap-3"
            style={{
              gridTemplateColumns:
                'repeat(auto-fit,minmax(min(100%,160px),1fr))',
            }}
          >
            <label className="text-[11px] text-muted-foreground">
              Total margin | USDC
              <input
                className={`${control} mt-1`}
                inputMode="decimal"
                value={review.margin}
                onChange={(event) => review.setMargin(event.target.value)}
                placeholder="200"
                disabled={active}
              />
              <span className="mt-1 block text-[10px]">
                Split equally across both legs
              </span>
            </label>
            <label className="text-[11px] text-muted-foreground">
              Leverage
              <input
                className={`${control} mt-1`}
                type="number"
                min={1}
                step={1}
                value={review.leverage}
                onChange={(event) =>
                  review.setLeverage(Number(event.target.value))
                }
                disabled={active}
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
              Margin mode
              <select
                className={`${control} mt-1`}
                value={review.marginMode}
                onChange={(event) =>
                  review.setMarginMode(
                    event.target.value === 'isolated' ? 'isolated' : 'cross',
                  )
                }
                disabled={active}
              >
                <option value="cross">Cross</option>
                <option value="isolated">Isolated</option>
              </select>
            </label>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Each leg uses half the total margin x leverage, rounded down to a
            common supported base size. Live account balances, precision and
            risk limits are checked before review.
          </p>
          <button
            className="mt-3 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
            disabled={active}
            onClick={() => void review.prepare()}
          >
            {active ? 'Preparing both legs...' : 'Prepare paired entry'}
          </button>
        </>
      )}
      {review.error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {review.error}
        </p>
      )}
      {plan && (
        <div className="mt-3">
          <div className="flex flex-wrap justify-between gap-2 text-xs">
            <strong className="capitalize">{plan.status}</strong>
            <span className="text-muted-foreground">
              Review expires {new Date(plan.expiresAt).toLocaleTimeString()}
            </span>
          </div>
          <div
            className="mt-2 grid gap-2"
            style={{
              gridTemplateColumns:
                'repeat(auto-fit,minmax(min(100%,220px),1fr))',
            }}
          >
            {plan.legs.map((leg) => (
              <div
                key={leg.proposal.id}
                className="rounded-md border border-border p-3 text-xs"
              >
                <div className="flex justify-between gap-2 font-semibold">
                  <span className="capitalize">{leg.proposal.order.venue}</span>
                  <span className="uppercase">
                    {leg.proposal.order.side === 'buy' ? 'Long' : 'Short'}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-y-1 text-[11px]">
                  <dt className="text-muted-foreground">Account</dt>
                  <dd className="text-right">
                    {leg.account.accountName} | {leg.account.mode}
                  </dd>
                  <dt className="text-muted-foreground">Size</dt>
                  <dd className="text-right font-mono">
                    {leg.proposal.order.size} {comparison.base}
                  </dd>
                  <dt className="text-muted-foreground">Order</dt>
                  <dd className="text-right">
                    Market | {leg.proposal.order.leverage}x{' '}
                    {leg.proposal.order.marginMode}
                  </dd>
                  <dt className="text-muted-foreground">Est. notional</dt>
                  <dd className="text-right font-mono">
                    {leg.proposal.estimatedNotional} USDC
                  </dd>
                </dl>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {plan.message}
          </p>
          {plan.status === 'review' && (
            <>
              <p className="mt-2 text-[11px] leading-relaxed text-amber-500">
                These orders are not atomic. QuantTrade verifies the first fill
                before sending the second leg. A partial fill or uncertain
                outcome stops the pair and may leave an exposed position.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  disabled={active}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  onClick={() => void review.confirm()}
                >
                  {active ? 'Submitting paired entry...' : 'Confirm both legs'}
                </button>
                <button
                  disabled={active}
                  className="rounded-md border border-border px-3 py-2 text-xs hover:bg-accent"
                  onClick={review.reset}
                >
                  Edit plan
                </button>
              </div>
            </>
          )}
          {plan.status !== 'review' && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Check exchange positions and orders before any further action. No
              automatic retry or unwind is performed.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
