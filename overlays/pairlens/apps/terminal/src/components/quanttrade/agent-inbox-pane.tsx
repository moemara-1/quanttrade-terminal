import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@pairlens/ui/components/ui/button'
import { Input } from '@pairlens/ui/components/ui/input'
import { Label } from '@pairlens/ui/components/ui/label'
import {
  canApproveProposal,
  canCancelProposal,
  inboxProposalSchema,
  inboxRequest,
  inboxStatusSchema,
} from './inbox-api'
import type { InboxProposal, InboxStatus } from './inbox-api'
import { connectBrowserSession } from '@/lib/plugins/quanttrade-session'

export default function AgentInboxPane() {
  const [token, setToken] = useState('')
  const [input, setInput] = useState('')
  const [session, setSession] = useState<
    'loading' | 'connected' | 'unavailable'
  >('loading')
  useEffect(() => {
    let cancelled = false
    void connectBrowserSession()
      .then(() => {
        if (!cancelled) setSession('connected')
      })
      .catch(() => {
        if (!cancelled) setSession('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [])
  if (token || session === 'connected')
    return (
      <ConnectedInbox
        token={token}
        onLock={() => {
          setToken('')
          setSession('unavailable')
        }}
      />
    )
  if (session === 'loading')
    return (
      <p className="p-4 text-xs text-muted-foreground">
        Connecting your authenticated CoinTrade session…
      </p>
    )
  return (
    <form
      className="flex h-full flex-col gap-3 overflow-auto p-4 text-xs"
      onSubmit={(event) => {
        event.preventDefault()
        if (input.trim()) {
          setToken(input.trim())
          setInput('')
        }
      }}
    >
      <h2 className="text-sm font-semibold">Agent Inbox</h2>
      <p className="max-w-xl text-muted-foreground">
        Agents prepare exact trades for Hyperliquid and Lighter. Review each
        order here before Hummingbot submits it.
      </p>
      <Label htmlFor="quanttrade-operator-token">Local operator token</Label>
      <Input
        id="quanttrade-operator-token"
        type="password"
        autoComplete="off"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder="Paste from data/operator-token"
      />
      <p className="text-muted-foreground">
        The token stays in this panel's memory and clears when you close it.
        Exchange credentials stay encrypted on your CoinTrade server.
      </p>
      <Button
        type="submit"
        size="sm"
        className="self-start"
        disabled={!input.trim()}
      >
        Connect inbox
      </Button>
      <div className="mt-2 border-t pt-3 text-muted-foreground">
        <p className="font-medium text-foreground">Connect an external agent</p>
        <p className="mt-1">
          Give your agent the separate token in data/agent-token and the local
          bridge API at http://127.0.0.1:4318/api. It can POST /proposals to
          prepare trades, but cannot approve them. Keep the operator token
          private.
        </p>
      </div>
    </form>
  )
}

function ConnectedInbox({
  token,
  onLock,
}: {
  token: string
  onLock: () => void
}) {
  const [status, setStatus] = useState<InboxStatus | null>(null)
  const [proposals, setProposals] = useState<Array<InboxProposal>>([])
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const fetching = useRef(false)
  const acting = useRef(false)
  const revision = useRef(0)
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (fetching.current) return
      fetching.current = true
      const currentRevision = revision.current
      try {
        const [nextStatus, nextProposals] = await Promise.all([
          inboxRequest(token, '/status', false, signal),
          inboxRequest(token, '/proposals', false, signal),
        ])
        if (signal?.aborted || currentRevision !== revision.current) return
        setStatus(inboxStatusSchema.parse(nextStatus))
        setProposals(inboxProposalSchema.array().parse(nextProposals))
        setNow(Date.now())
        setError('')
      } catch (cause) {
        if (!signal?.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Cannot reach the local bridge.',
          )
      } finally {
        fetching.current = false
      }
    },
    [token],
  )
  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    const interval = setInterval(() => {
      setNow(Date.now())
      void refresh(controller.signal)
    }, 5000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [refresh])
  async function decide(
    proposal: InboxProposal,
    action: 'approve' | 'reject' | 'cancel',
  ) {
    if (acting.current) return
    acting.current = true
    revision.current++
    setBusy(proposal.id)
    setActionError('')
    try {
      const result = inboxProposalSchema.parse(
        await inboxRequest(token, `/proposals/${proposal.id}/${action}`, true),
      )
      revision.current++
      setProposals((current) =>
        current.map((item) => (item.id === result.id ? result : item)),
      )
      await refresh()
    } catch (cause) {
      setActionError(
        `${cause instanceof Error ? cause.message : 'Request failed.'} Refresh to inspect the stored order status before retrying.`,
      )
      await refresh()
    } finally {
      acting.current = false
      setBusy(null)
    }
  }
  return (
    <section
      className="flex h-full flex-col overflow-auto text-xs"
      aria-label="Agent trade approvals"
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b bg-background p-3">
        <div>
          <h2 className="text-sm font-semibold">Agent Inbox</h2>
          <p className="text-muted-foreground">
            Every trade requires your approval
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={onLock}
          >
            {token ? 'Lock' : 'Close'}
          </Button>
        </div>
      </div>
      <div className="space-y-3 p-3">
        {status && (
          <div className="space-y-1 border-b pb-3">
            <p className="font-medium">
              {status.venueModes
                ? Object.entries(status.venueModes)
                    .map(
                      ([venue, mode]) =>
                        `${venue === 'lighter' ? 'Lighter' : 'Hyperliquid'} ${mode.toUpperCase()}`,
                    )
                    .join(' · ')
                : status.mode.toUpperCase()}{' '}
              · Account {status.accountName}
              {status.halted ? ' · Trading halted' : ''}
            </p>
            <p className="text-muted-foreground">
              Order cap ${status.maxOrderNotional} · Daily reserved $
              {status.dailyNotionalUsed} / ${status.dailyNotionalLimit}
            </p>
            <p className="text-muted-foreground">
              {status.mode === 'paper'
                ? 'Paper limits remain open; there is no automatic fill simulation. Paper market fills omit fees and slippage.'
                : status.executionConfigured
                  ? 'Exchange credentials configured. Live limit orders only. Submitted means acknowledged, not filled.'
                  : 'Live execution unavailable. Connect your exchange in Accounts and configure the server for live execution.'}
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {actionError && (
          <p role="alert" className="text-destructive">
            {actionError}
          </p>
        )}
        {!status && !error && (
          <p role="status" className="text-muted-foreground">
            Connecting to the local bridge...
          </p>
        )}
        {status && proposals.length === 0 && (
          <p className="py-5 text-muted-foreground">
            No trade proposals yet. Connect an external agent or prepare an
            order in the terminal.
          </p>
        )}
        {proposals.map((proposal) => {
          const expired =
            proposal.status === 'pending' && proposal.expiresAt <= now
          return (
            <article key={proposal.id} className="space-y-2 rounded border p-3">
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="font-semibold">
                  {proposal.order.side.toUpperCase()} {proposal.order.size}{' '}
                  {proposal.order.symbol}
                </h3>
                <span className="font-medium">
                  {proposal.mode.toUpperCase()} ·{' '}
                  {expired ? 'expired' : proposal.status}
                </span>
              </div>
              <p>
                {proposal.order.venue === 'hyperliquid'
                  ? 'Hyperliquid'
                  : 'Lighter'}{' '}
                · {proposal.order.type.toUpperCase()}{' '}
                {proposal.order.price
                  ? `@ ${proposal.order.price}`
                  : `at market (reference ${proposal.referencePrice})`}{' '}
                · Estimated ${proposal.estimatedNotional}
              </p>
              <p>
                {proposal.order.marketType ?? 'perpetual'}
                {proposal.order.leverage
                  ? ` � ${proposal.order.leverage}� leverage`
                  : ''}
                {proposal.order.marginMode
                  ? ` � ${proposal.order.marginMode} margin`
                  : ''}
                {proposal.order.reduceOnly ? ' � Reduce-only' : ''}
                {proposal.order.postOnly ? ' � Post-only' : ''}
                {proposal.order.trigger
                  ? ` � ${proposal.order.trigger.triggerType === 'sl' ? 'Stop-loss' : 'Take-profit'} trigger @ ${proposal.order.trigger.triggerPrice}`
                  : ''}
              </p>
              <p className="text-muted-foreground">
                Account {proposal.accountName} · {proposal.source} · Expires{' '}
                {new Date(proposal.expiresAt).toLocaleString()}
              </p>
              <p className="whitespace-pre-wrap break-words">
                {proposal.order.rationale}
              </p>
              {proposal.orderId && (
                <p className="break-all text-muted-foreground">
                  Order {proposal.orderId}
                </p>
              )}
              {proposal.error && (
                <p role="alert" className="text-destructive">
                  {proposal.error}
                </p>
              )}
              {proposal.status === 'unknown' && (
                <p className="text-destructive">
                  Submission outcome is unknown. Check the exchange before
                  preparing another order.
                </p>
              )}
              {proposal.status === 'cancel-requested' && (
                <p className="text-muted-foreground">
                  Cancellation requested. Check the exchange to confirm that the
                  order has been cancelled.
                </p>
              )}
              {status && canCancelProposal(proposal, status) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || !!error}
                  onClick={() => void decide(proposal, 'cancel')}
                >
                  {busy === proposal.id
                    ? 'Requesting cancellation...'
                    : proposal.mode === 'paper'
                      ? 'Cancel paper order'
                      : 'Request cancellation'}
                </Button>
              )}
              {proposal.status === 'pending' && (
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    disabled={
                      busy !== null ||
                      !!error ||
                      !status ||
                      !canApproveProposal(proposal, status, now)
                    }
                    onClick={() => void decide(proposal, 'approve')}
                  >
                    {busy === proposal.id
                      ? 'Processing...'
                      : proposal.mode === 'live'
                        ? 'Approve live order'
                        : 'Approve paper order'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void decide(proposal, 'reject')}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
