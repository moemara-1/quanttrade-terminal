import { useRef } from 'react'
import type { ScannerSnapshot } from '@/lib/scanners'
import { useArbitrageReview } from '@/hooks/use-arbitrage-review'

const control =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-primary'
export function ArbitrageReviewForm({
  comparison,
  onBusyChange,
}: {
  comparison: ScannerSnapshot['comparisons'][number]
  onBusyChange?: (busy: boolean) => void
}) {
  const review = useArbitrageReview(comparison)
  const { plan } = review
  const active = review.busy
  const operationRef = useRef(false)
  const perform = async (action: () => Promise<void>) => {
    if (operationRef.current) return
    operationRef.current = true
    onBusyChange?.(true)
    try {
      await action()
    } finally {
      operationRef.current = false
      onBusyChange?.(false)
    }
  }
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold">Paired entry</h3>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Two venue orders. Review exact accounts and quantities before
        confirming.
      </p>

      {!plan && (
        <>
          <div
            className="mt-3 grid gap-2"
            style={{
              gridTemplateColumns:
                'repeat(auto-fit,minmax(min(100%,120px),1fr))',
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
                Half per venue - not per-leg notional
              </span>
              <div
                className="mt-2 flex gap-1"
                role="group"
                aria-label="Total margin presets"
              >
                {[100, 250, 500, 1000].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    disabled={active}
                    onClick={() => review.setMargin(String(amount))}
                    className="rounded border border-border px-2 py-1 text-[10px] tabular-nums hover:bg-accent disabled:opacity-50"
                  >
                    ${amount}
                  </button>
                ))}
              </div>
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
          <div className="mt-3 divide-y divide-border rounded-md border border-border">
            {[comparison.hyperliquid, comparison.lighter].map((market) => (
              <div
                key={market.venue}
                className="flex items-center justify-between gap-3 px-3 py-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <img
                      alt=""
                      className="size-4 object-contain"
                      src={`/posters/${market.venue === 'lighter' ? 'lighter-market-connector.svg' : 'hyperliquid-market-connector.png'}`}
                    />
                    {market.venue === 'lighter' ? 'Lighter' : 'Hyperliquid'}
                    <span
                      className={
                        comparison.longVenue === market.venue
                          ? 'text-primary'
                          : 'text-destructive'
                      }
                    >
                      {comparison.longVenue === market.venue
                        ? 'Long'
                        : comparison.shortVenue === market.venue
                          ? 'Short'
                          : 'Unresolved'}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    {market.symbol}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular-nums">
                    {review.leverage}x / {review.marginMode}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Equal base quantity after rounding
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 text-[10px] leading-relaxed text-muted-foreground">
            <p>
              Prepare checks account balances, market precision and risk limits.
              Each leg targets half your total margin x leverage.
            </p>
            <p className="text-amber-500">
              Existing positions can be offset or reversed. No automatic TP/SL.
              Legs execute separately, so a failed leg can leave exposure.
            </p>
          </div>
          <button
            className="mt-3 w-full rounded-md bg-primary px-4 py-2.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            disabled={active}
            onClick={() => void perform(review.prepare)}
          >
            {active ? 'Preparing both legs...' : 'Review both legs'}
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
                className="min-w-0 border-b border-border py-3 text-xs last:border-b-0"
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
                  className="flex-1 rounded-md bg-primary px-4 py-2.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  onClick={() => void perform(review.confirm)}
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
