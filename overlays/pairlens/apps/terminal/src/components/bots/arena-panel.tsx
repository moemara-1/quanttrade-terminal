import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, RefreshCw } from 'lucide-react'
import { Button } from '@pairlens/ui/components/ui/button'
import { ArenaForm } from './arena-form'
import { ArenaAgentDetail, agentUniverse } from './arena-agent-detail'
import { ArenaCloseReview, ArenaLiveArm } from './arena-live-arm'
import type {
  ArenaAccount,
  ArenaBot,
  ArenaCapabilities,
  ArenaConfig,
  ArenaModel,
} from '@/lib/llm-arena'
import type { AgentAction } from './arena-agent-detail'
import {
  arenaAction,
  arenaDefaults,
  arenaList,
  arenaModels,
  arenaProviderKey,
  arenaSave,
  arenaStart,
  configuredArenaModel,
} from '@/lib/llm-arena'
import {
  getTradingAgentDraft,
  subscribeTradingAgentDraft,
  takeTradingAgentDraft,
} from '@/lib/trading-agent-draft'
import { askAssistant } from '@/stores/assistant-store'

export function ArenaPanel() {
  const [bots, setBots] = useState<Array<ArenaBot>>([]),
    [models, setModels] = useState<Array<ArenaModel>>([]),
    [accounts, setAccounts] = useState<Array<ArenaAccount>>([])
  const [capabilities, setCapabilities] = useState<ArenaCapabilities>({
    paper: true,
    live: false,
    liveClose: false,
  })
  const [mode, setMode] = useState<'paper' | 'live'>('paper'),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [showArchived, setShowArchived] = useState(false),
    [intent, setIntent] = useState('')
  const [form, setForm] = useState<{
      bot: ArenaBot | null
      initial?: Partial<ArenaConfig>
      requestId?: string
    } | null>(null),
    [armId, setArmId] = useState<string | null>(null),
    [closeId, setCloseId] = useState<string | null>(null)
  const alive = useRef(true),
    pending = useRef(false),
    revision = useRef(0),
    actionController = useRef<AbortController | null>(null)
  const refresh = useCallback(async (signal: AbortSignal, catalog = false) => {
    if (pending.current) return
    const version = ++revision.current
    try {
      const result = await arenaList(signal)
      if (signal.aborted || !alive.current || version !== revision.current)
        return
      setBots(result.bots)
      setAccounts(result.accounts)
      setCapabilities(result.capabilities)
      setLoaded(true)
      setError(null)
      if (catalog) {
        const resultModels = await arenaModels(signal)
        if (!signal.aborted && alive.current) setModels(resultModels.models)
      }
    } catch (reason) {
      if (!signal.aborted && alive.current && version === revision.current) {
        setLoaded(true)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Arena status could not be read.',
        )
      }
    }
  }, [])
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    void refresh(controller.signal, true)
    const timer = setInterval(() => void refresh(controller.signal), 15000)
    return () => {
      alive.current = false
      controller.abort()
      actionController.current?.abort()
      clearInterval(timer)
    }
  }, [refresh])
  const mutate = async (
    operation: (signal: AbortSignal) => Promise<ArenaBot>,
  ) => {
    if (pending.current) return false
    pending.current = true
    revision.current++
    setBusy(true)
    setError(null)
    const controller = new AbortController()
    actionController.current = controller
    try {
      const bot = await operation(controller.signal)
      if (!alive.current || controller.signal.aborted) return false
      setBots((previous) => [
        bot,
        ...previous.filter((row) => row.id !== bot.id),
      ])
      setSelectedId(bot.id)
      setMode(bot.config.mode)
      return true
    } catch (reason) {
      if (alive.current && !controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Action failed. Refresh status before repeating it.',
        )
      return false
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  useEffect(() => {
    const receive = () => {
      if (!loaded || busy || form || armId || closeId) return
      const draft = getTradingAgentDraft()
      if (!draft) return
      const existing = draft.agentId
        ? bots.find((bot) => bot.id === draft.agentId)
        : undefined
      if (draft.agentId && !existing) {
        takeTradingAgentDraft()
        setError('The requested agent was not found. Refresh before editing.')
        return
      }
      if (existing?.status === 'running') {
        setError('Pause the agent before reviewing its draft changes.')
        return
      }
      takeTradingAgentDraft()
      setMode(draft.config.mode ?? existing?.config.mode ?? 'paper')
      setForm({
        bot: existing ?? null,
        initial: draft.config,
        requestId: draft.requestId,
      })
    }
    receive()
    return subscribeTradingAgentDraft(receive)
  }, [loaded, busy, form, armId, closeId, bots])
  const rows = bots
    .filter(
      (bot) => bot.config.mode === mode && (showArchived || !bot.archived),
    )
    .sort((a, b) =>
      mode === 'paper'
        ? b.paper.equity / b.config.initialEquity -
          a.paper.equity / a.config.initialEquity
        : b.updatedAt - a.updatedAt,
    )
  const selected = rows.find((bot) => bot.id === selectedId) ?? rows[0],
    arm = bots.find((bot) => bot.id === armId),
    closing = bots.find((bot) => bot.id === closeId)
  const account = arm
    ? accounts.find(
        (row) =>
          row.venue === arm.config.venue &&
          row.accountName === arm.config.accountName,
      )
    : undefined
  const act = (action: AgentAction) => {
    if (!selected || busy) return
    if (action === 'start') {
      if (selected.config.mode === 'live') {
        setError(null)
        setArmId(selected.id)
      } else
        void mutate((signal) =>
          arenaStart(selected.id, arenaProviderKey(), signal),
        )
      return
    }
    if (action === 'close-position' && selected.config.mode === 'live') {
      setError(null)
      setCloseId(selected.id)
      return
    }
    void mutate((signal) =>
      arenaAction(
        selected.id,
        action,
        action === 'archive' ? !selected.archived : undefined,
        signal,
      ),
    )
  }
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-y-auto md:overflow-hidden"
      aria-label="LM Arena"
    >
      <header className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <h1 className="text-sm font-semibold">LM Arena</h1>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Refresh Arena"
          disabled={busy}
          onClick={() => {
            const controller = new AbortController()
            void refresh(controller.signal, true)
          }}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </header>
      <form
        className="shrink-0 space-y-1.5 rounded-lg border border-border/50 p-2.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!intent.trim()) return
          askAssistant(
            'Use prepare_trading_agent to propose an UNSAVED editable agent draft. Do not save, start, arm or place trades. Suggest a name and explicit editable risk caps; use a multi-market scope unless I request one coin. My request: ' +
              intent.trim() + `\nSelected mode: ${mode}. Selected model: ${configuredArenaModel()}. Keep both editable in the draft.`,
          )
          setIntent('')
        }}
      >
        <label htmlFor="arena-description" className="text-xs font-medium">
          Describe your agent
        </label>
        <textarea
          id="arena-description"
          className="min-h-14 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          maxLength={2000}
          placeholder="Scalp liquid Lighter markets using 5m candles, with clear loss and spending limits…"
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-xs"
            disabled={busy}
            onClick={() => {
              setError(null)
              setForm({ bot: null, initial: { ...arenaDefaults(configuredArenaModel()), mode } })
            }}
          >
            Configure manually
          </Button>
          <Button type="submit" size="sm" className="h-8 text-xs" disabled={!intent.trim()}>
            Prepare draft
          </Button>
        </div>
      </form>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex gap-1">
          {(['paper', 'live'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={mode === value ? 'secondary' : 'ghost'}
              className="h-8 px-3 text-xs capitalize"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {value} ·{' '}
              {
                bots.filter((bot) => bot.config.mode === value && !bot.archived)
                  .length
              }
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Archived
        </label>
      </div>
      {error && !form && !arm && !closing && (
        <p role="alert" className="shrink-0 text-xs text-destructive">
          {error}
        </p>
      )}
      {mode === 'live' && !capabilities.live && (
        <p className="shrink-0 text-xs text-muted-foreground">
          Live agents are unavailable on this server. Saved agents remain
          visible.
        </p>
      )}
      <div className="flex min-h-112 flex-1 flex-col gap-2 md:min-h-0 md:flex-row">
        <nav
          aria-label="Agents"
          className="flex max-h-28 shrink-0 gap-1 overflow-auto md:max-h-none md:w-52 md:flex-col"
        >
          {rows.map((bot) => (
            <button
              key={bot.id}
              className={`min-w-40 rounded-md border px-2.5 py-2 text-left md:min-w-0 ${selected?.id === bot.id ? 'border-primary/40 bg-primary/5' : 'border-transparent bg-muted/20'}`}
              onClick={() => setSelectedId(bot.id)}
            >
              <span className="block truncate text-xs font-medium">
                {bot.config.name}
              </span>
              <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                {bot.config.venue} · {agentUniverse(bot)}
              </span>
              <span className="mt-1 block text-[10px] capitalize text-muted-foreground">
                {bot.status.replaceAll('-', ' ')}
              </span>
            </button>
          ))}
        </nav>
        {selected ? (
          <ArenaAgentDetail
            key={selected.id}
            bot={selected}
            busy={busy}
            liveAvailable={capabilities.live}
            liveClose={capabilities.liveClose}
            onEdit={() => {
              setError(null)
              setForm({ bot: selected })
            }}
            onAction={act}
          />
        ) : (
          <div className="flex min-h-28 flex-1 items-center justify-center rounded-lg bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            {!loaded
              ? 'Loading agents…'
              : `No ${mode} agents. Describe a strategy above, then review its draft.`}
          </div>
        )}
      </div>
      <p className="shrink-0 text-[10px] text-muted-foreground">
        One venue and one open position per agent. Save paused, then start
        separately. Status refreshes every 15s.
      </p>
      {form && (
        <ArenaForm
          key={form.requestId ?? form.bot?.id ?? 'new'}
          {...form}
          models={models}
          accounts={accounts}
          capabilities={capabilities}
          busy={busy}
          saveError={error}
          onClose={() => setForm(null)}
          onSave={async (config, id) => {
            const saved = await mutate((signal) =>
              arenaSave(config, id, signal),
            )
            if (saved) setForm(null)
            return saved
          }}
        />
      )}
      {arm && (
        <ArenaLiveArm
          key={arm.id + ':' + account?.connectionRevision}
          bot={arm}
          account={capabilities.live ? account : undefined}
          busy={busy}
          error={error}
          onClose={() => setArmId(null)}
          onConfirm={() => {
            if (!account || !capabilities.live) return
            void mutate((signal) =>
              arenaStart(arm.id, arenaProviderKey(), signal, {
                accountName: account.accountName,
                connectionRevision: account.connectionRevision,
                acknowledgeAutonomousLive: true,
              }),
            ).then((saved) => {
              if (saved) setArmId(null)
            })
          }}
        />
      )}
      {closing && (
        <ArenaCloseReview
          bot={closing}
          busy={busy}
          error={error}
          onClose={() => setCloseId(null)}
          onConfirm={() => {
            if (!capabilities.liveClose) return
            void mutate((signal) =>
              arenaAction(closing.id, 'close-position', undefined, signal),
            ).then((saved) => {
              if (saved) setCloseId(null)
            })
          }}
        />
      )}
    </section>
  )
}
