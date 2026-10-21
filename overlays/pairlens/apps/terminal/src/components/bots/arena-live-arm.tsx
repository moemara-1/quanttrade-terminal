import { useState } from 'react'
import { Button } from '@pairlens/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@pairlens/ui/components/ui/dialog'
import { agentMoney, agentUniverse } from './arena-agent-detail'
import type { ArenaAccount, ArenaBot } from '@/lib/llm-arena'

export function ArenaLiveArm({
  bot,
  account,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  bot: ArenaBot
  account?: ArenaAccount
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  const [accepted, setAccepted] = useState(false)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Arm live agent</DialogTitle>
          <DialogDescription>
            Autonomous orders use real funds on your connected account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <p className="font-medium">
            {bot.config.name} · {bot.config.venue} ·{' '}
            {account?.accountName ?? 'Account unavailable'}
          </p>
          <p>{agentUniverse(bot)} · one position at a time</p>
          <dl className="grid grid-cols-2 gap-2">
            <dt>Margin per entry</dt>
            <dd>
              {agentMoney(bot.config.marginPerTrade)} · {bot.config.leverage}×{' '}
              {bot.config.marginMode}
            </dd>
            <dt>Daily loss cap</dt>
            <dd>{agentMoney(bot.config.maxDailyLoss)}</dd>
            <dt>Daily order budget</dt>
            <dd>{agentMoney(bot.config.maxDailyNotional)}</dd>
            <dt>Stop / take profit</dt>
            <dd>
              {bot.config.stopLossPct}% / {bot.config.takeProfitPct}%
            </dd>
          </dl>
          <p className="text-muted-foreground">
            The order budget counts entries, protective orders and closes, not
            margin. This is the existing desk account, not a new dedicated
            wallet. Pausing stops decisions; accepted native protection remains
            on the venue. The NanoGPT key lease lasts up to 24 hours.
          </p>
          <label className="flex items-start gap-2 rounded-md border border-border p-3">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              disabled={busy}
            />
            <span>
              I authorize this agent to place live orders within these reviewed
              limits on this account.
            </span>
          </label>
          {!account && (
            <p role="alert">Reconnect and verify this account before arming.</p>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={busy || !accepted || !account}
              onClick={onConfirm}
            >
              {busy ? 'Arming…' : 'Arm live agent'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
export function ArenaCloseReview({
  bot,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  bot: ArenaBot
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close live agent position</DialogTitle>
          <DialogDescription>
            Review this real-money action before submitting.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          {bot.activeSymbol ?? bot.config.symbol} · {bot.config.venue} ·{' '}
          {bot.live?.accountName} · {bot.live?.position?.side}{' '}
          {bot.live?.position?.size}
        </p>
        <p className="text-xs text-muted-foreground">
          QuantTrade verifies the owned position before submitting a reduce-only
          close. Check the resulting receipt before repeating this action.
        </p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            {busy ? 'Submitting…' : 'Confirm live close'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
