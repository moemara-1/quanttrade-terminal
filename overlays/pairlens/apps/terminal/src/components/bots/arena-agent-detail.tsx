import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@pairlens/ui/components/ui/button'
import { Badge } from '@pairlens/ui/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@pairlens/ui/components/ui/dropdown-menu'
import { ArenaEquity } from './arena-equity'
import type { ArenaBot } from '@/lib/llm-arena'

export const agentMoney = (value: number | null | undefined) =>
  value == null
    ? 'Unknown'
    : value.toLocaleString(undefined, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
      })
export const agentTime = (value: number | null | undefined) =>
  value == null ? '—' : new Date(value).toLocaleString()
const aiMoney = (value: number) =>
  value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })
export const agentUniverse = (bot: ArenaBot) =>
  bot.config.universe.kind === 'single'
    ? bot.config.symbol
    : bot.config.universe.kind === 'watchlist'
      ? `${bot.config.universe.symbols?.length ?? 0} watched markets`
      : 'Eligible USDC markets'
export type AgentAction =
  | 'start'
  | 'pause'
  | 'evaluate'
  | 'close-position'
  | 'archive'

export function ArenaAgentDetail({
  bot,
  busy,
  liveAvailable,
  liveClose,
  onEdit,
  onAction,
}: {
  bot: ArenaBot
  busy: boolean
  liveAvailable: boolean
  liveClose: boolean
  onEdit: () => void
  onAction: (action: AgentAction) => void
}) {
  const [tab, setTab] = useState<'summary' | 'activity' | 'rules'>('summary')
  const live = bot.config.mode === 'live'
  const running = bot.status === 'running'
  const position = live ? bot.live?.position : bot.paper.position
  const outstanding =
    live && Boolean(bot.live?.receipt && bot.live.receipt.status !== 'flat')
  const uncertain =
    live &&
    (bot.live?.receipt?.status === 'uncertain' ||
      bot.live?.receipt?.status === 'pending')
  return (
    <article className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-card">
      <header className="shrink-0 px-3 pb-2 pt-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium">{bot.config.name}</h2>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {bot.config.model} · {position ? bot.activeSymbol ?? agentUniverse(bot) : agentUniverse(bot)}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className={live ? 'text-amber-500' : ''}>
              {live ? 'Live' : 'Paper'}
            </Badge>
            <span className="text-[10px] capitalize text-muted-foreground">
              {bot.status.replaceAll('-', ' ')}
            </span>
          </div>
        </div>
        {bot.reason && (
          <p
            role="status"
            className="mt-2 rounded bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed"
          >
            {bot.reason}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            className="min-h-9 px-2.5 text-xs"
            size="sm"
            variant={running ? 'secondary' : 'default'}
            disabled={
              busy ||
              bot.archived ||
              (!running && live && (!liveAvailable || Boolean(uncertain)))
            }
            onClick={() => onAction(running ? 'pause' : 'start')}
          >
            {running ? 'Pause' : live ? 'Review & arm live' : 'Start agent'}
          </Button>
          <Button
            className="min-h-9 px-2.5 text-xs"
            size="sm"
            variant="ghost"
            disabled={busy || running || bot.archived}
            onClick={onEdit}
          >
            Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground">
              Manage
              <ChevronDown className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                className="min-h-9 text-xs"
                disabled={busy || !running}
                onClick={() => onAction('evaluate')}
              >
                Evaluate now · AI spend
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-9 text-xs"
                disabled={
                  busy || !position || bot.archived || (live && !liveClose)
                }
                onClick={() => onAction('close-position')}
              >
                {live ? 'Review live close' : 'Close paper position'}
              </DropdownMenuItem>
              {live && !liveClose && (
                <p className="px-2 py-1 text-[10px] text-muted-foreground">
                  Live closes are unavailable here; use the terminal or venue.
                </p>
              )}
              <DropdownMenuItem
                className="min-h-9 text-xs"
                disabled={
                  busy || running || Boolean(position) || Boolean(outstanding)
                }
                onClick={() => onAction('archive')}
              >
                {bot.archived ? 'Restore agent' : 'Archive agent'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <nav
        className="flex shrink-0 gap-1 border-b border-border/40 px-2"
        aria-label="Agent details"
      >
        {(['summary', 'activity', 'rules'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
            className={`min-h-9 px-3 text-xs capitalize ${tab === value ? 'border-b border-primary font-medium' : 'text-muted-foreground'}`}
          >
            {value}
          </button>
        ))}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
        {tab === 'summary' && (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(live
                ? [
                    ['Account equity', agentMoney(bot.live?.equity)],
                    [
                      'Account available',
                      agentMoney(bot.live?.availableMargin),
                    ],
                    [
                      'Daily entry exposure',
                      `${agentMoney(bot.live?.daily.notional)} / ${agentMoney(bot.config.maxDailyNotional)}`,
                    ],
                    [
                      'Protection receipt',
                      bot.live?.receipt?.status ?? 'Not verified',
                    ],
                  ]
                : [
                    ['Paper equity', agentMoney(bot.paper.equity)],
                    [
                      'Paper P&L',
                      agentMoney(bot.paper.equity - bot.config.initialEquity),
                    ],
                    [
                      'Closed / winning trades',
                      `${bot.paper.closedTrades} / ${bot.paper.winningTrades}`,
                    ],
                    ['Max drawdown', `${bot.paper.maxDrawdownPct.toFixed(2)}%`],
                  ]
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 break-words font-mono text-xs tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {!live && <ArenaEquity points={bot.equityCurve} />}
            <div className="grid grid-cols-2 gap-3 border-y border-border/40 py-2 text-xs">
              <div>
                <p className="text-[10px] text-muted-foreground">
                  Daily AI budget
                </p>
                <p className="font-mono">
                  {aiMoney(bot.daily.aiSpent)} /{' '}
                  {agentMoney(bot.config.maxAiSpendDaily)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">
                  Next decision
                </p>
                <p className="text-[11px]">{agentTime(bot.nextWakeAt)}</p>
              </div>
            </div>
            <section>
              <h3 className="text-xs font-medium">
                {live ? 'Last verified venue position' : 'Paper position'}
              </h3>
              {position ? (
                <p className="mt-1 break-words font-mono text-xs">
                  {bot.activeSymbol ?? agentUniverse(bot)} · {position.side} ·{' '}
                  {position.size} · entry {position.entryPrice}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  {live && bot.live?.observedAt == null
                    ? 'No verified account snapshot yet.'
                    : 'Flat at the last verified read.'}
                </p>
              )}
              {live && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {bot.live?.accountName ??
                    bot.config.accountName ??
                    'Account not bound'}{' '}
                  · {bot.config.venue} · observed{' '}
                  {agentTime(bot.live?.observedAt)}
                </p>
              )}
            </section>
            {bot.lastScan && (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Last scan {agentTime(bot.lastScan.at)} · {bot.lastScan.eligible}
                /{bot.lastScan.total} eligible · {bot.lastScan.considered}{' '}
                considered · ranking {bot.config.universe.ranking}.{' '}
                {bot.lastScan.symbols.join(', ')}
              </p>
            )}
            <details className="border-t border-border/40 pt-2">
              <summary className="cursor-pointer py-1 text-xs text-muted-foreground">
                Limits, lease & ledger
              </summary>
              <dl className="mt-2 grid grid-cols-2 gap-3 text-xs">
                {[
                  [
                    'Margin / leverage',
                    `${agentMoney(bot.config.marginPerTrade)} / ${bot.config.leverage}× ${bot.config.marginMode}`,
                  ],
                  [
                    'SL / TP',
                    `${bot.config.stopLossPct}% / ${bot.config.takeProfitPct}%`,
                  ],
                  ['Daily loss cap', agentMoney(bot.config.maxDailyLoss)],
                  [
                    'Daily decisions',
                    `${bot.daily.calls} / ${bot.config.maxRunsDaily}`,
                  ],
                  ['Candle timeframe', bot.config.timeframe],
                  ['Decision cadence', `${bot.config.intervalMinutes} min`],
                  ['Provider key expires', agentTime(bot.leaseExpiresAt)],
                  ...(live
                    ? [
                        [
                          'Account daily baseline',
                          agentMoney(bot.live?.daily.startEquity),
                        ],
                      ]
                    : [
                        ['Realized P&L', agentMoney(bot.paper.realizedPnl)],
                        ['Fees paid', agentMoney(bot.paper.feesPaid)],
                        [
                          'Estimated funding paid',
                          agentMoney(bot.paper.fundingPaid),
                        ],
                      ]),
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[10px] text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="mt-0.5 break-words font-mono text-[11px]">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              One position per agent at a time on {bot.config.venue}.{' '}
              {live
                ? 'Snapshots describe the connected account and may include other activity; they are not a separate wallet or per-agent P&L. Pausing leaves accepted native TP/SL orders in place.'
                : 'Paper fills, fees, slippage and snapshot funding are simulated. Exits are checked by polling every 30s; paper results do not establish live returns.'}
            </p>
          </div>
        )}
        {tab === 'activity' &&
          (bot.history.length ? (
            <ol className="divide-y divide-border/40">
              {[...bot.history].reverse().map((event, index) => (
                <li key={`${event.at}-${index}`} className="py-2 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                    <span className="font-medium">
                      {event.action} · {event.status}
                    </span>
                    <time className="text-[10px] text-muted-foreground">
                      {agentTime(event.at)}
                    </time>
                  </div>
                  <p className="mt-1 break-words text-xs leading-relaxed">
                    {event.rationale}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {aiMoney(event.cost)} AI
                    {event.estimatedCost ? ' · reserved estimate' : ''}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">
              No decisions recorded yet.
            </p>
          ))}
        {tab === 'rules' && (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">
              {bot.config.rules}
            </p>
            <dl className="grid grid-cols-2 gap-2 border-t border-border/40 pt-2 text-[11px]">
              {Object.entries(bot.config)
                .filter(
                  ([key]) =>
                    ![
                      'name',
                      'model',
                      'rules',
                      'universe',
                      ...(live
                        ? ['initialEquity', 'feeBps', 'slippageBps']
                        : []),
                    ].includes(key),
                )
                .map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-[10px] text-muted-foreground">
                      {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                    </dt>
                    <dd className="break-words font-mono">{String(value)}</dd>
                  </div>
                ))}
            </dl>
          </div>
        )}
      </div>
    </article>
  )
}
