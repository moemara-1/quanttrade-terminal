import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@pairlens/ui/components/ui/button'
import { Badge } from '@pairlens/ui/components/ui/badge'
import { ArenaEquity } from './arena-equity'
import { ArenaForm } from './arena-form'
import type { ArenaBot, ArenaConfig, ArenaModel } from '@/lib/llm-arena'
import {
  arenaAction,
  arenaList,
  arenaModels,
  arenaProviderKey,
  arenaSave,
  arenaStart,
} from '@/lib/llm-arena'

const money = (value: number) =>
  value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
const aiMoney = (value: number) =>
  value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })
const price = (value: number) =>
  value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 1 ? 8 : 4,
  })
const time = (value: number | null) =>
  value === null ? '—' : new Date(value).toLocaleString()
const statusLabel = (value: ArenaBot['status']) => value.replaceAll('-', ' ')
function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /^(Arena |Sign in to QuantTrade|Connect and enable NanoGPT|Unlock or reconnect NanoGPT)/.test(
    message,
  )
    ? message
    : 'Arena connection interrupted. Refresh status before repeating an action.'
}

export function ArenaPanel() {
  const [bots, setBots] = useState<Array<ArenaBot>>([])
  const [models, setModels] = useState<Array<ArenaModel>>([])
  const [modelsAt, setModelsAt] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [readAt, setReadAt] = useState<number | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [form, setForm] = useState<{ bot: ArenaBot | null } | null>(null)
  const pending = useRef(false)
  const version = useRef(0)
  const actionController = useRef<AbortController | null>(null)
  const manualRead = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const refresh = useCallback(async (signal: AbortSignal, catalog = false) => {
    if (pending.current) return
    const current = ++version.current
    try {
      const result = await arenaList(signal)
      if (signal.aborted || !alive.current || current !== version.current)
        return
      setBots(result.bots)
      setReadAt(Date.now())
      setLoaded(true)
      setError(null)
      if (catalog) {
        const listing = await arenaModels(signal)
        if (signal.aborted || !alive.current || current !== version.current)
          return
        setModels(listing.models)
        setModelsAt(listing.updatedAt)
      }
    } catch (failure) {
      if (!signal.aborted && alive.current && current === version.current) {
        setError(safeError(failure))
        setLoaded(true)
      }
    }
  }, [])
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    void refresh(controller.signal, true)
    const timer = setInterval(() => {
      void refresh(controller.signal)
    }, 15_000)
    return () => {
      alive.current = false
      version.current++
      controller.abort()
      actionController.current?.abort()
      manualRead.current?.abort()
      clearInterval(timer)
    }
  }, [refresh])
  const mutate = async (
    operation: (signal: AbortSignal) => Promise<ArenaBot>,
  ) => {
    if (pending.current) return false
    pending.current = true
    version.current++
    setBusy(true)
    setError(null)
    const controller = new AbortController()
    actionController.current = controller
    try {
      const result = await operation(controller.signal)
      if (!alive.current || controller.signal.aborted) return false
      setBots((previous) => [
        ...previous.filter((bot) => bot.id !== result.id),
        result,
      ])
      setSelectedId(result.id)
      setReadAt(Date.now())
      return true
    } catch (failure) {
      if (alive.current && !controller.signal.aborted)
        setError(safeError(failure))
      return false
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
      actionController.current = null
    }
  }
  const save = async (config: ArenaConfig, id?: string) => {
    const saved = await mutate((signal) => arenaSave(config, id, signal))
    if (saved) setForm(null)
    return saved
  }
  const visible = bots
    .filter((bot) => showArchived || !bot.archived)
    .sort(
      (a, b) =>
        b.paper.equity / b.config.initialEquity -
        a.paper.equity / a.config.initialEquity,
    )
  const selected =
    visible.find((bot) => bot.id === selectedId) ?? visible[0] ?? null
  const readOnly = busy || Boolean(form)
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-hidden px-2.5 pb-2.5"
      aria-label="LLM Arena paper portfolios"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-card px-3 py-2.5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-medium">LLM Arena</h1>
            <Badge variant="secondary">Paper only</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Compare model decisions in separate server-run paper portfolios.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={readOnly}
            onClick={() => {
              manualRead.current?.abort()
              const controller = new AbortController()
              manualRead.current = controller
              void refresh(controller.signal, true)
            }}
          >
            <RefreshCw className="mr-1 size-3" />
            Refresh
          </Button>
          <Button
            size="sm"
            disabled={readOnly}
            onClick={() => setForm({ bot: null })}
          >
            <Plus className="mr-1 size-3" />
            New paper bot
          </Button>
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto lg:flex-row lg:overflow-hidden">
        <aside
          className="min-w-0 shrink-0 rounded-[14px] bg-card p-3 lg:w-64 lg:overflow-y-auto"
          aria-label="Paper bot rankings"
        >
          <div className="mb-2 flex items-center justify-between text-xs">
            <h2 className="font-medium">Ranking · return %</h2>
            <span className="text-muted-foreground">{visible.length} bots</span>
          </div>
          <label className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showArchived}
              disabled={busy}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Show archived
          </label>
          {!loaded ? (
            <p className="text-xs text-muted-foreground">
              Loading paper portfolios…
            </p>
          ) : visible.length === 0 ? (
            <p className="py-3 text-xs text-muted-foreground">
              Create a paused paper bot to start comparing models.
            </p>
          ) : (
            <div className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
              {visible.map((bot, index) => (
                <button
                  key={bot.id}
                  type="button"
                  aria-pressed={selected?.id === bot.id}
                  disabled={readOnly}
                  onClick={() => setSelectedId(bot.id)}
                  className={`min-w-44 rounded-lg px-2 py-2 text-left text-xs transition-colors lg:min-w-0 ${selected?.id === bot.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted/40'}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">
                      {index + 1}. {bot.config.name}
                    </span>
                    <span className="font-mono tabular-nums">
                      {(
                        (bot.paper.equity / bot.config.initialEquity - 1) *
                        100
                      ).toFixed(2)}
                      %
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                    {bot.config.model}
                  </span>
                  <span className="mt-1 block text-[10px] capitalize text-muted-foreground">
                    {statusLabel(bot.status)} · {bot.config.venue}
                    {bot.archived ? ' · archived' : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
            Read {time(readAt)}. Refreshes every 15 seconds. Rankings use
            recorded paper equity, not an equal-risk backtest.
          </p>
        </aside>
        {selected ? (
          <ArenaDetail
            key={selected.id}
            bot={selected}
            busy={readOnly}
            onEdit={() => setForm({ bot: selected })}
            onAction={(action) => {
              if (action === 'start')
                void mutate((signal) =>
                  arenaStart(selected.id, arenaProviderKey(), signal),
                )
              else
                void mutate((signal) =>
                  arenaAction(
                    selected.id,
                    action,
                    action === 'archive' ? !selected.archived : undefined,
                    signal,
                  ),
                )
            }}
          />
        ) : (
          <div className="flex min-h-64 min-w-0 flex-1 flex-col items-center justify-center rounded-[14px] bg-card p-6 text-center">
            <h2 className="text-sm font-medium">
              A separate scoreboard for every model
            </h2>
            <p className="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Choose a model, market, rules and daily limits. Save first, then
              explicitly start. No live orders are placed.
            </p>
          </div>
        )}
      </div>
      <footer className="shrink-0 px-1 text-[10px] leading-relaxed text-muted-foreground">
        Model catalog {time(modelsAt)}. Autonomous live wallets are a separate
        future integration; live execution is unavailable in this Arena.
      </footer>
      {form && (
        <ArenaForm
          key={form.bot?.id ?? 'new'}
          bot={form.bot}
          models={models}
          busy={busy}
          onClose={() => setForm(null)}
          onSave={save}
        />
      )}
    </section>
  )
}

function ArenaDetail({
  bot,
  busy,
  onEdit,
  onAction,
}: {
  bot: ArenaBot
  busy: boolean
  onEdit: () => void
  onAction: (
    action: 'start' | 'pause' | 'evaluate' | 'close-position' | 'archive',
  ) => void
}) {
  const [tab, setTab] = useState<'overview' | 'history' | 'rules'>('overview')
  const running = bot.status === 'running'
  const position = bot.paper.position
  const editable = !running && !bot.archived
  const pnl = bot.paper.equity - bot.config.initialEquity
  return (
    <article className="flex min-h-0 min-w-0 flex-none flex-col rounded-[14px] bg-card lg:flex-1 lg:overflow-hidden">
      <header className="shrink-0 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium">{bot.config.name}</h2>
            <p className="mt-1 break-all text-xs text-muted-foreground">
              {bot.config.model} · {bot.config.venue} · {bot.config.symbol}
            </p>
          </div>
          <Badge variant="secondary" className="capitalize">
            {statusLabel(bot.status)}
          </Badge>
        </div>
        {bot.reason && (
          <p role="status" className="mt-2 text-xs text-amber-500">
            {bot.reason}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {running ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => onAction('pause')}
            >
              Pause decisions
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || bot.archived}
              onClick={() => onAction('start')}
            >
              Start paper bot
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !running}
            onClick={() => onAction('evaluate')}
          >
            Evaluate now
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !editable}
            onClick={onEdit}
          >
            Edit rules & limits
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !position || bot.archived}
            onClick={() => onAction('close-position')}
          >
            Close paper position
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || running || Boolean(position)}
            onClick={() => onAction('archive')}
          >
            {bot.archived ? 'Restore' : 'Archive'}
          </Button>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          Start sends your connected NanoGPT key to QuantTrade server memory for
          up to 24 hours. Pause clears it; protective paper checks continue.
          Evaluate uses your AI budget, with a 60-second cooldown.
        </p>
      </header>
      <nav
        className="flex shrink-0 gap-1 border-y border-border/40 px-3 py-1"
        aria-label="Paper bot details"
      >
        {(['overview', 'history', 'rules'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
            className={`rounded px-3 py-1.5 text-xs capitalize ${tab === value ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
          >
            {value}
          </button>
        ))}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 space-y-4 p-3 lg:overflow-y-auto">
        {tab === 'overview' && (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              {[
                ['Paper equity', money(bot.paper.equity)],
                ['Total P&L', money(pnl)],
                ['Realized P&L', money(bot.paper.realizedPnl)],
                ['Max drawdown', `${bot.paper.maxDrawdownPct.toFixed(2)}%`],
                [
                  'Daily AI spend',
                  `${aiMoney(bot.daily.aiSpent)} / ${money(bot.config.maxAiSpendDaily)}`,
                ],
                [
                  'Daily decisions',
                  `${bot.daily.calls} / ${bot.config.maxRunsDaily}`,
                ],
                [
                  'Daily P&L / loss cap',
                  `${money(bot.paper.equity - bot.daily.startEquity)} / ${money(bot.config.maxDailyLoss)}`,
                ],
                [
                  'Paper trades / wins',
                  `${bot.paper.closedTrades} / ${bot.paper.winningTrades}`,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words font-mono text-xs tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <ArenaEquity points={bot.equityCurve} />
            <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Next model decision</dt>
                <dd>{time(bot.nextWakeAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Key lease expires</dt>
                <dd>{time(bot.leaseExpiresAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Paper cash</dt>
                <dd>{money(bot.paper.cash)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Paper fees paid</dt>
                <dd>{money(bot.paper.feesPaid)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  Estimated funding paid
                </dt>
                <dd>{money(bot.paper.fundingPaid)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  Daily budget date · server
                </dt>
                <dd>{bot.daily.date}</dd>
              </div>
            </dl>
            <section className="rounded-lg bg-muted/30 p-3">
              <h3 className="text-xs font-medium">Paper position</h3>
              {position ? (
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  {[
                    ['Direction', position.side],
                    ['Size', String(position.size)],
                    ['Entry', price(position.entryPrice)],
                    ['Margin', money(position.margin)],
                    ['Leverage', `${position.leverage}×`],
                    [
                      'Stop / target',
                      `${price(position.stopPrice)} / ${price(position.takeProfitPrice)}`,
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[10px] text-muted-foreground">
                        {label}
                      </dt>
                      <dd className="break-words font-mono">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Flat. No paper position is open.
                </p>
              )}
            </section>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Funding accrues hourly from venue snapshots as an estimate. Stop
              and target checks poll the server every 30 seconds, rather than
              resting at an exchange. Fees and slippage use configured
              assumptions. Paper fills do not model every queue, liquidity or
              liquidation event.
            </p>
          </>
        )}
        {tab === 'history' && (
          <section>
            <h3 className="mb-2 text-xs font-medium">
              Recorded decisions & paper events
            </h3>
            {bot.history.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No recorded decisions yet.
              </p>
            ) : (
              <ol className="space-y-3">
                {[...bot.history].reverse().map((event, index) => (
                  <li
                    key={`${event.at}-${index}`}
                    className="rounded-lg bg-muted/30 p-3 text-xs"
                  >
                    <div className="flex flex-wrap justify-between gap-1">
                      <span className="font-medium">
                        {event.action} · {event.status}
                      </span>
                      <time className="text-[10px] text-muted-foreground">
                        {time(event.at)}
                      </time>
                    </div>
                    <p className="mt-2 break-words leading-relaxed">
                      {event.rationale}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      AI cost {aiMoney(event.cost)}
                      {event.estimatedCost ? ' · conservative estimate' : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
        {tab === 'rules' && (
          <section className="space-y-3 text-xs">
            <h3 className="font-medium">Fixed rules & assumptions</h3>
            <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 leading-relaxed">
              {bot.config.rules}
            </p>
            <dl className="grid grid-cols-2 gap-3">
              {Object.entries(bot.config)
                .filter(
                  ([key]) =>
                    !['name', 'model', 'venue', 'symbol', 'rules'].includes(
                      key,
                    ),
                )
                .map(([key, value]) => (
                  <div key={key}>
                    <dt className="break-words text-[10px] text-muted-foreground">
                      {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                    </dt>
                    <dd className="mt-1 font-mono">{String(value)}</dd>
                  </div>
                ))}
            </dl>
          </section>
        )}
      </div>
    </article>
  )
}
