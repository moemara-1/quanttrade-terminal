import { useRef, useState } from 'react'
import { NativeTwapPermission } from './native-twap-permission'
import {
  OperationKeys,
  nativeField,
  nativeOrderId,
  parseNativeSnapshot,
  requireOperationAccepted,
} from './exchange-tools-api'
import type { NativeSnapshot } from './exchange-tools-api'
import { useMarketData } from '@/lib/market-data-provider'
import {
  bridgeRequest,
  connectBrowserSession,
  isQuantTradeVenue,
  quantTradeBaseVenue,
} from '@/lib/plugins/quanttrade-session'

export function ExchangeTools({
  market,
  pair,
  credentialId,
  mode,
  isolatedSelected,
}: {
  market: string
  pair: string
  credentialId: string
  mode: 'paper' | 'live'
  isolatedSelected: boolean
}) {
  const { placeOrder } = useMarketData()
  const [snapshot, setSnapshot] = useState<NativeSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<'add' | 'remove'>('add')
  const [kind, setKind] = useState<'sl' | 'tp'>('sl')
  const [side, setSide] = useState<'buy' | 'sell'>('sell')
  const [triggerPrice, setTriggerPrice] = useState('')
  const [executionPrice, setExecutionPrice] = useState('')
  const [triggerSize, setTriggerSize] = useState('')
  const [triggerType, setTriggerType] = useState<'market' | 'limit'>('market')
  const [editing, setEditing] = useState<string | null>(null)
  const [amendAmount, setAmendAmount] = useState('')
  const [amendPrice, setAmendPrice] = useState('')
  const [amendTimeInForce, setAmendTimeInForce] = useState<'Gtc' | 'Alo'>('Gtc')
  const keys = useRef(new OperationKeys())
  if (!isQuantTradeVenue(market)) return null
  const venue = quantTradeBaseVenue(market),
    marketType = market.endsWith('-spot') ? 'spot' : 'perpetual'
  const scope = {
    venue,
    marketType,
    symbol: marketType === 'spot' ? pair : pair.replace(/-USDC$/, ''),
  }
  const live = mode === 'live'
  const refresh = async (extra: Record<string, unknown> = {}) => {
    await connectBrowserSession()
    const next = parseNativeSnapshot(
      await bridgeRequest('/terminal/snapshot', { ...scope, ...extra }),
      venue,
      marketType,
      scope.symbol,
    )
    setSnapshot(next)
  }
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : 'Exchange request failed. Refresh exchange state before retrying.',
      )
    } finally {
      setBusy(false)
    }
  }
  const operation = async (action: string, fields: Record<string, unknown>) => {
    const payload = { ...scope, mode: 'live', action, ...fields }
    await connectBrowserSession()
    requireOperationAccepted(
      await bridgeRequest('/terminal/operations', {
        ...payload,
        requestId: keys.current.key(payload),
      }),
    )
    keys.current.complete(payload)
    setMessage('Request accepted. Refreshing exchange state…')
    await refresh()
  }
  const input =
    'min-w-0 rounded border border-border bg-background px-2 py-1 text-xs'
  const button =
    'rounded border border-border px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted'
  return (
    <details className="rounded border border-border p-2 text-xs">
      <summary className="cursor-pointer font-medium">
        Manage position and orders ·{' '}
        {venue === 'hyperliquid' ? 'Hyperliquid' : 'Lighter'} · {pair} ·{' '}
        {marketType}
      </summary>
      <div className="mt-3 space-y-3">
        {venue === 'hyperliquid' && marketType === 'perpetual' && live && (
          <NativeTwapPermission
            key={`${market}:${pair}:${credentialId}:${mode}`}
          />
        )}
        {!live && (
          <p className="text-muted-foreground">
            Select a live exchange account to manage native orders and margin.
          </p>
        )}
        {marketType === 'perpetual' && (
          <>
            <p className="text-muted-foreground">
              Collateral changes require an existing isolated position.
              Selecting Isolated in the ticket does not change the exchange
              until you submit an order; verify the position first.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Isolated margin amount in USDC"
                placeholder="Isolated margin · USDC"
                className={input + ' w-full'}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <select
                aria-label="Margin action"
                className={input}
                value={direction}
                onChange={(e) =>
                  setDirection(e.target.value === 'remove' ? 'remove' : 'add')
                }
              >
                <option value="add">Add</option>
                <option value="remove">Remove</option>
              </select>
              <button
                className={button}
                disabled={
                  !live ||
                  busy ||
                  !isolatedSelected ||
                  !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount) ||
                  Number(amount) <= 0 ||
                  !Number.isFinite(Number(amount))
                }
                onClick={() =>
                  void run(() => operation('margin', { amount, direction }))
                }
              >
                Apply
              </button>
            </div>
            <fieldset className="space-y-2 rounded border border-border p-2">
              <legend>Protect an existing position</legend>
              <p className="text-muted-foreground">
                Submit a separate reduce-only stop-loss or take-profit. These
                are not attached to the entry order; the other exit is not
                automatically cancelled.
              </p>
              <div className="flex flex-wrap gap-2">
                <select
                  aria-label="Trigger kind"
                  className={input}
                  value={kind}
                  onChange={(e) =>
                    setKind(e.target.value === 'tp' ? 'tp' : 'sl')
                  }
                >
                  <option value="sl">Stop-loss</option>
                  <option value="tp">Take-profit</option>
                </select>
                <select
                  aria-label="Closing side"
                  className={input}
                  value={side}
                  onChange={(e) =>
                    setSide(e.target.value === 'buy' ? 'buy' : 'sell')
                  }
                >
                  <option value="sell">Sell / close long</option>
                  <option value="buy">Buy / close short</option>
                </select>
              </div>
              <input
                className={input + ' w-full'}
                aria-label="Trigger size"
                placeholder="Size"
                value={triggerSize}
                onChange={(e) => setTriggerSize(e.target.value)}
              />
              <input
                className={input + ' w-full'}
                aria-label="Trigger price"
                placeholder="Trigger price"
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(e.target.value)}
              />
              <select
                aria-label="Trigger execution type"
                className={input}
                value={triggerType}
                onChange={(e) =>
                  setTriggerType(
                    e.target.value === 'limit' ? 'limit' : 'market',
                  )
                }
              >
                <option value="market">Protected market</option>
                <option value="limit">Limit</option>
              </select>
              {triggerType === 'limit' && (
                <input
                  className={input + ' w-full'}
                  aria-label="Trigger limit price"
                  placeholder="Limit price"
                  value={executionPrice}
                  onChange={(e) => setExecutionPrice(e.target.value)}
                />
              )}
              <button
                className={button}
                disabled={
                  !live ||
                  busy ||
                  !triggerPrice ||
                  !triggerSize ||
                  (triggerType === 'limit' && !executionPrice)
                }
                onClick={() =>
                  void run(async () => {
                    const result = await placeOrder({
                      market,
                      pair,
                      credentialId,
                      clientOrderId: keys.current.key({
                        ...scope,
                        action: 'trigger',
                        side,
                        type: triggerType,
                        size: triggerSize,
                        triggerPrice,
                        triggerKind: kind,
                        executionPrice:
                          triggerType === 'limit' ? executionPrice : '',
                      }),
                      mode,
                      side,
                      type: triggerType,
                      size: triggerSize,
                      ...(triggerType === 'limit'
                        ? { price: executionPrice }
                        : {}),
                      reduceOnly: true,
                      trigger: { triggerPrice, triggerType: kind },
                    })
                    if (!result.success)
                      throw new Error(
                        result.error ??
                          'Trigger submission needs reconciliation',
                      )
                    setMessage(
                      'Trigger submitted. Refresh exchange orders to verify.',
                    )
                    await refresh()
                  })
                }
              >
                Submit reduce-only {kind === 'sl' ? 'stop-loss' : 'take-profit'}
              </button>
            </fieldset>
          </>
        )}
        <button
          className={button}
          disabled={!live || busy}
          onClick={() => void run(() => refresh())}
        >
          Refresh exchange orders and fills
        </button>
        {message && (
          <p role="status" className="break-words text-muted-foreground">
            {message}
          </p>
        )}
        {snapshot && (
          <div className="space-y-3">
            {(['open_orders', 'order_history', 'fills'] as const).map(
              (section) => (
                <details key={section} open={section === 'open_orders'}>
                  <summary>
                    {section.replaceAll('_', ' ')} · {snapshot[section].length}
                  </summary>
                  <div className="max-h-64 overflow-auto">
                    {snapshot[section].map((row, index) => {
                      const raw =
                        section === 'order_history' &&
                        typeof row.order === 'object' &&
                        row.order !== null
                          ? (row.order as Record<string, unknown>)
                          : row
                      const id = nativeOrderId(venue, raw)
                      return (
                        <div
                          key={`${id ?? 'row'}:${index}`}
                          className="border-b border-border py-2"
                        >
                          <p className="font-mono">
                            {id ?? nativeField(raw, ['trade_id', 'tid'])} ·{' '}
                            {nativeField(raw, ['side', 'status'])} ·{' '}
                            {nativeField(raw, [
                              'sz',
                              'remaining_base_amount',
                              'size',
                            ])}{' '}
                            @ {nativeField(raw, ['limitPx', 'price', 'px'])}
                          </p>
                          {section === 'open_orders' && id && (
                            <div className="mt-1 flex gap-2">
                              <button
                                className={button}
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    operation('cancel', {
                                      exchangeOrderId: id,
                                    }),
                                  )
                                }
                              >
                                Cancel {id}
                              </button>
                              <button
                                className={button}
                                disabled={busy}
                                onClick={() => {
                                  setEditing(id)
                                  setAmendAmount(
                                    nativeField(raw, [
                                      'sz',
                                      'remaining_base_amount',
                                    ]),
                                  )
                                  setAmendPrice(
                                    nativeField(raw, ['limitPx', 'price']),
                                  )
                                }}
                              >
                                Amend
                              </button>
                            </div>
                          )}
                          <details>
                            <summary className="text-muted-foreground">
                              Exchange details
                            </summary>
                            <pre className="overflow-auto whitespace-pre-wrap break-all text-[10px]">
                              {JSON.stringify(row, null, 2)}
                            </pre>
                          </details>
                        </div>
                      )
                    })}
                  </div>
                </details>
              ),
            )}
            {editing && (
              <div className="space-y-2">
                <p>Amend native order {editing}</p>
                {venue === 'hyperliquid' && (
                  <label>
                    Time in force
                    <select
                      className={input}
                      value={amendTimeInForce}
                      onChange={(e) =>
                        setAmendTimeInForce(
                          e.target.value === 'Alo' ? 'Alo' : 'Gtc',
                        )
                      }
                    >
                      <option value="Gtc">Good till cancelled</option>
                      <option value="Alo">Post-only</option>
                    </select>
                  </label>
                )}
                <input
                  className={input}
                  aria-label="Amended amount"
                  value={amendAmount}
                  onChange={(e) => setAmendAmount(e.target.value)}
                />
                <input
                  className={input}
                  aria-label="Amended price"
                  value={amendPrice}
                  onChange={(e) => setAmendPrice(e.target.value)}
                />
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await operation('amend', {
                        exchangeOrderId: editing,
                        amount: amendAmount,
                        price: amendPrice,
                        ...(venue === 'hyperliquid'
                          ? { timeInForce: amendTimeInForce }
                          : {}),
                      })
                      setEditing(null)
                    })
                  }
                >
                  Submit amendment
                </button>
              </div>
            )}
            {snapshot.history_next_cursor && (
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    refresh({ historyCursor: snapshot.history_next_cursor }),
                  )
                }
              >
                Next history page
              </button>
            )}
            {snapshot.fills_next_cursor && (
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    refresh({ fillsCursor: snapshot.fills_next_cursor }),
                  )
                }
              >
                Next fills page
              </button>
            )}
            {snapshot.fills_may_have_more &&
              typeof snapshot.fills_next_start_time === 'number' && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      refresh({ startTime: snapshot.fills_next_start_time }),
                    )
                  }
                >
                  Next fills page
                </button>
              )}
            <details>
              <summary>Exchange account state</summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px]">
                {JSON.stringify(snapshot.account, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </details>
  )
}
