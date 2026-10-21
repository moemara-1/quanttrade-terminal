import { useEffect, useState } from 'react'
import { Button } from '@pairlens/ui/components/ui/button'
import { Input } from '@pairlens/ui/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@pairlens/ui/components/ui/dialog'
import type {
  ArenaAccount,
  ArenaBot,
  ArenaCapabilities,
  ArenaConfig,
  ArenaMarket,
  ArenaModel,
  ArenaReviewDraft,
} from '@/lib/llm-arena'
import {
  arenaConfigSchema,
  arenaDefaults,
  arenaMarkets,
  arenaReviewDraft,
  configuredArenaModel,
} from '@/lib/llm-arena'

const fieldClass =
  'h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs'
type NumericKey = {
  [K in keyof ArenaConfig]-?: ArenaConfig[K] extends number ? K : never
}[keyof ArenaConfig]
type NumericField = {
  key: NumericKey
  label: string
  min: number
  max?: number
  step?: string
  advanced?: boolean
  paperOnly?: boolean
}
const fields: Array<NumericField> = [
  {
    key: 'initialEquity',
    label: 'Paper capital · USDC',
    min: 1,
    paperOnly: true,
  },
  {
    key: 'intervalMinutes',
    label: 'Decision interval · min',
    min: 1,
    max: 1440,
    step: '1',
  },
  { key: 'marginPerTrade', label: 'Margin per entry · USDC', min: 0.01 },
  { key: 'leverage', label: 'Leverage · ×', min: 1, max: 100, step: '1' },
  { key: 'maxDailyLoss', label: 'Daily loss cap · USDC', min: 0.01 },
  {
    key: 'maxDailyNotional',
    label: 'Daily order budget · USDC',
    min: 0.01,
  },
  {
    key: 'maxAiSpendDaily',
    label: 'Daily AI budget · USD',
    min: 0.001,
    max: 1000,
  },
  { key: 'stopLossPct', label: 'Stop loss · %', min: 0.01, max: 50 },
  { key: 'takeProfitPct', label: 'Take profit · %', min: 0.01, max: 500 },
  {
    key: 'maxRunsDaily',
    label: 'Maximum decisions per day',
    min: 1,
    max: 96,
    step: '1',
    advanced: true,
  },
  {
    key: 'minConfidence',
    label: 'Minimum confidence · 0–1',
    min: 0,
    max: 1,
    advanced: true,
  },
  {
    key: 'minVolume24h',
    label: 'Minimum 24h volume · USD',
    min: 0,
    advanced: true,
  },
  {
    key: 'maxAbsFundingBps',
    label: 'Maximum absolute funding · bps',
    min: 0,
    max: 10000,
    advanced: true,
  },
  {
    key: 'feeBps',
    label: 'Simulated fill fee · bps',
    min: 0,
    max: 100,
    advanced: true,
    paperOnly: true,
  },
  {
    key: 'slippageBps',
    label: 'Simulated slippage · bps',
    min: 0,
    max: 100,
    advanced: true,
    paperOnly: true,
  },
]
export function ArenaForm({
  bot,
  initial,
  models,
  accounts,
  capabilities,
  busy,
  saveError,
  onClose,
  onSave,
}: {
  bot: ArenaBot | null
  initial?: Partial<ArenaConfig>
  models: Array<ArenaModel>
  accounts: Array<ArenaAccount>
  capabilities: ArenaCapabilities
  busy: boolean
  saveError?: string | null
  onClose: () => void
  onSave: (config: ArenaConfig, id?: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState<ArenaReviewDraft>(() =>
    initial
      ? arenaReviewDraft(initial, configuredArenaModel(), bot?.config)
      : (bot?.config ?? arenaDefaults(configuredArenaModel())),
  )
  const [error, setError] = useState<string | null>(null)
  const [markets, setMarkets] = useState<Array<ArenaMarket>>([])
  const [marketError, setMarketError] = useState(false)
  const [loadingMarkets, setLoadingMarkets] = useState(true)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoadingMarkets(true)
    setMarketError(false)
    void arenaMarkets(draft.venue, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setMarkets(rows)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setMarkets([])
          setMarketError(true)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMarkets(false)
      })
    return () => controller.abort()
  }, [draft.venue, catalogAttempt])
  const change = <TKey extends keyof ArenaReviewDraft>(
    key: TKey,
    value: ArenaReviewDraft[TKey],
  ) => setDraft((previous) => ({ ...previous, [key]: value }))
  const live = draft.mode === 'live'
  const selectedModel = models.find((model) => model.id === draft.model)
  const selectedMarket = markets.find(
    (market) => market.symbol === draft.symbol,
  )
  const availableAccounts = accounts.filter(
    (account) => account.venue === draft.venue,
  )
  const boundAccount = availableAccounts.find(
    (account) => account.accountName === draft.accountName,
  )
  const lockedMarket = Boolean(
    bot?.paper.position ||
    bot?.live?.position ||
    (bot?.live?.receipt && bot.live.receipt.status !== 'flat'),
  )
  const visibleFields = fields.filter((field) => !live || !field.paperOnly)
  const advancedMissing = visibleFields.some(
    (field) => field.advanced && !Number.isFinite(draft[field.key]),
  )
  const renderNumber = (field: NumericField) => (
    <label
      key={field.key}
      className="space-y-1 text-[11px] text-muted-foreground"
    >
      {field.label}
      <Input
        className="h-9 text-xs text-foreground"
        type="number"
        required
        min={field.min}
        max={
          field.key === 'leverage'
            ? (selectedMarket?.maxLeverage ?? field.max)
            : field.max
        }
        step={field.step ?? 'any'}
        disabled={Boolean(bot && field.key === 'initialEquity')}
        value={Number.isFinite(draft[field.key]) ? draft[field.key] : ''}
        onChange={(event) =>
          change(
            field.key,
            event.target.value === '' ? NaN : Number(event.target.value),
          )
        }
      />
    </label>
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[90dvh] flex-col gap-3 overflow-hidden p-4 sm:max-w-xl"
        showCloseButton={!busy}
      >
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>
            {initial
              ? 'Review agent draft'
              : bot
                ? 'Edit agent'
                : 'New trading agent'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {initial
              ? 'Proposed settings — review every limit before saving.'
              : 'Editable settings. Saving never starts the agent.'}{' '}
            {live
              ? 'Real funds require a separate account review and live arming.'
              : 'Paper uses simulated USDC; exchange balances are untouched.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy) return
            const parsed = arenaConfigSchema.safeParse({
              ...draft,
              name:
                draft.name.trim() ||
                `${draft.venue} ${draft.universe.kind === 'single' ? draft.symbol : draft.universe.kind} agent`,
            })
            if (!parsed.success) {
              setError(
                `Check ${parsed.error.issues[0]?.path.join(' ') || 'the settings'}: ${parsed.error.issues[0]?.message || 'invalid value'}`,
              )
              return
            }
            if (!selectedModel) {
              setError('Choose an available model with verified pricing.')
              return
            }
            if (
              draft.universe.kind === 'single' &&
              (!selectedMarket ||
                selectedMarket.maxLeverage === null ||
                draft.leverage > selectedMarket.maxLeverage)
            ) {
              setError(
                'Choose a verified market and leverage within its limit.',
              )
              return
            }
            if (
              (selectedMarket?.onlyIsolated ||
                selectedMarket?.marginModes?.every(
                  (mode) => mode !== 'cross',
                )) &&
              draft.marginMode === 'cross'
            ) {
              setError('This market supports isolated margin only.')
              return
            }
            if (live && (!capabilities.live || !boundAccount)) {
              setError(
                'Connect and verify the selected live account before saving.',
              )
              return
            }
            if (
              draft.universe.kind === 'watchlist' &&
              draft.universe.symbols?.some(
                (symbol) => !markets.some((market) => market.symbol === symbol),
              )
            ) {
              setError('Select only verified markets from this venue.')
              return
            }
            setError(null)
            if (!(await onSave(parsed.data, bot?.id)))
              setError(
                'The agent was not saved. Check the server status before retrying.',
              )
          }}
        >
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            <fieldset disabled={busy} className="min-w-0 space-y-3">
              <div
                className="flex items-center gap-1 rounded-lg bg-muted/40 p-1"
                aria-label="Agent mode"
              >
                {(['paper', 'live'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={draft.mode === mode}
                    disabled={
                      lockedMarket || (mode === 'live' && !capabilities.live)
                    }
                    onClick={() => change('mode', mode)}
                    className={`min-h-9 flex-1 rounded-md px-3 text-xs font-medium capitalize ${draft.mode === mode ? (mode === 'live' ? 'bg-amber-500/15 text-amber-500' : 'bg-background text-foreground') : 'text-muted-foreground disabled:opacity-40'}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              {!capabilities.live && (
                <p className="text-[11px] text-muted-foreground">
                  Live agents are unavailable on this server.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                <label className="col-span-2 space-y-1 text-[11px] text-muted-foreground">
                  Agent name · optional
                  <Input
                    className="h-9 text-xs text-foreground"
                    placeholder="Generated from your strategy if blank"
                    maxLength={80}
                    value={draft.name}
                    onChange={(event) => change('name', event.target.value)}
                  />
                </label>
                <label className="col-span-2 space-y-1 text-[11px] text-muted-foreground">
                  Model
                  <select
                    required
                    className={fieldClass}
                    value={draft.model}
                    onChange={(event) => change('model', event.target.value)}
                  >
                    <option value="">Select a priced model</option>
                    {draft.model && !selectedModel && (
                      <option disabled value={draft.model}>
                        {draft.model} · unavailable
                      </option>
                    )}
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} · {model.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  Venue
                  <select
                    className={fieldClass}
                    value={draft.venue}
                    disabled={lockedMarket}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        venue:
                          event.target.value === 'lighter'
                            ? 'lighter'
                            : 'hyperliquid',
                        symbol: '',
                        universe: {
                          ...previous.universe,
                          symbols: undefined,
                          kind: 'liquid',
                        },
                        accountName: undefined,
                      }))
                    }
                  >
                    <option value="lighter">Lighter</option>
                    <option value="hyperliquid">Hyperliquid</option>
                  </select>
                </label>
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  Market scope
                  <select
                    className={fieldClass}
                    value={draft.universe.kind}
                    disabled={lockedMarket}
                    onChange={(event) =>
                      change('universe', {
                        ...draft.universe,
                        kind:
                          event.target.value === 'single'
                            ? 'single'
                            : event.target.value === 'watchlist'
                              ? 'watchlist'
                              : 'liquid',
                        symbols:
                          event.target.value === 'watchlist' ? [] : undefined,
                      })
                    }
                  >
                    <option value="liquid">Eligible USDC perpetuals</option>
                    <option value="watchlist">Watchlist</option>
                    <option value="single">Single market</option>
                  </select>
                </label>
                {draft.universe.kind === 'single' && (
                  <label className="col-span-2 space-y-1 text-[11px] text-muted-foreground">
                    Market
                    <select
                      required
                      className={fieldClass}
                      value={draft.symbol}
                      disabled={lockedMarket || loadingMarkets}
                      onChange={(event) => change('symbol', event.target.value)}
                    >
                      <option value="">Select market</option>
                      {markets.map((market) => (
                        <option key={market.symbol} value={market.symbol}>
                          {market.symbol} · {market.maxLeverage ?? '?'}× max
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {draft.universe.kind === 'watchlist' && (
                  <label className="col-span-2 space-y-1 text-[11px] text-muted-foreground">
                    Watchlist · select 1–40 native markets
                    <select
                      multiple
                      required
                      size={5}
                      className="w-full rounded-md border border-input bg-background p-2 text-xs"
                      value={draft.universe.symbols ?? []}
                      disabled={lockedMarket || loadingMarkets}
                      onChange={(event) =>
                        change('universe', {
                          ...draft.universe,
                          symbols: Array.from(
                            event.target.selectedOptions,
                            (option) => option.value,
                          ),
                        })
                      }
                    >
                      {markets.map((market) => (
                        <option key={market.symbol} value={market.symbol}>
                          {market.symbol}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {draft.universe.kind !== 'single' && (
                  <>
                    <label className="space-y-1 text-[11px] text-muted-foreground">
                      Shortlist ranking
                      <select
                        className={fieldClass}
                        value={draft.universe.ranking}
                        disabled={lockedMarket}
                        onChange={(event) =>
                          change('universe', {
                            ...draft.universe,
                            ranking:
                              event.target.value === 'gainers'
                                ? 'gainers'
                                : event.target.value === 'losers'
                                  ? 'losers'
                                  : event.target.value === 'movement'
                                    ? 'movement'
                                    : 'volume',
                          })
                        }
                      >
                        <option value="volume">Highest volume</option>
                        <option value="gainers">Biggest gainers</option>
                        <option value="losers">Biggest losers</option>
                        <option value="movement">Largest absolute move</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-[11px] text-muted-foreground">
                      Candidates per decision
                      <Input
                        type="number"
                        className="h-9 text-xs"
                        min={1}
                        max={8}
                        step={1}
                        required
                        disabled={lockedMarket}
                        value={draft.universe.maxCandidates}
                        onChange={(event) =>
                          change('universe', {
                            ...draft.universe,
                            maxCandidates: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </>
                )}
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  Candle timeframe
                  <select
                    className={fieldClass}
                    value={draft.timeframe}
                    onChange={(event) =>
                      change(
                        'timeframe',
                        event.target.value === '1m'
                          ? '1m'
                          : event.target.value === '5m'
                            ? '5m'
                            : event.target.value === '15m'
                              ? '15m'
                              : event.target.value === '4h'
                                ? '4h'
                                : '1h',
                      )
                    }
                  >
                    {['1m', '5m', '15m', '1h', '4h'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                {live && (
                  <label className="col-span-2 space-y-1 text-[11px] text-muted-foreground">
                    Verified live account
                    <select
                      required
                      className={fieldClass}
                      value={draft.accountName ?? ''}
                      disabled={lockedMarket}
                      onChange={(event) =>
                        change('accountName', event.target.value || undefined)
                      }
                    >
                      <option value="">Choose the account explicitly</option>
                      {availableAccounts.map((account) => (
                        <option
                          key={account.accountName}
                          value={account.accountName}
                        >
                          {account.accountName} · {account.venue} · live
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {visibleFields
                  .filter((field) => !field.advanced)
                  .map(renderNumber)}
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  Margin mode
                  <select
                    required
                    className={fieldClass}
                    value={draft.marginMode}
                    onChange={(event) =>
                      change(
                        'marginMode',
                        event.target.value === 'cross'
                          ? 'cross'
                          : event.target.value === 'isolated'
                            ? 'isolated'
                            : '',
                      )
                    }
                  >
                    <option value="">Select</option>
                    <option value="isolated">Isolated</option>
                    <option
                      value="cross"
                      disabled={selectedMarket?.onlyIsolated}
                    >
                      Cross
                    </option>
                  </select>
                </label>
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  Direction
                  <select
                    required
                    className={fieldClass}
                    value={draft.allowedSide}
                    onChange={(event) =>
                      change(
                        'allowedSide',
                        event.target.value === 'long'
                          ? 'long'
                          : event.target.value === 'short'
                            ? 'short'
                            : event.target.value === 'both'
                              ? 'both'
                              : '',
                      )
                    }
                  >
                    <option value="">Select</option>
                    <option value="both">Long and short</option>
                    <option value="long">Long only</option>
                    <option value="short">Short only</option>
                  </select>
                </label>
              </div>
              <label className="block space-y-1 text-[11px] text-muted-foreground">
                Strategy instructions
                <textarea
                  required
                  maxLength={2000}
                  className="min-h-20 w-full resize-y rounded-md border border-input bg-background p-2 text-xs leading-relaxed text-foreground"
                  value={draft.rules}
                  onChange={(event) => change('rules', event.target.value)}
                />
              </label>
              <details
                open={advancedMissing || undefined}
                className="border-t border-border/40 pt-2"
              >
                <summary className="cursor-pointer py-1 text-xs font-medium">
                  Advanced limits{!live ? ' & simulation costs' : ''}
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-2.5">
                  {visibleFields
                    .filter((field) => field.advanced)
                    .map(renderNumber)}
                </div>
              </details>
              {marketError && (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-2 text-xs text-destructive"
                >
                  <span>Market catalog did not load.</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setCatalogAttempt((previous) => previous + 1)
                    }
                  >
                    Retry catalog
                  </Button>
                </div>
              )}
              {selectedModel && (
                <details className="border-t border-border/40 pt-2">
                  <summary className="cursor-pointer py-1 text-xs text-muted-foreground">
                    AI pricing & cost reservation
                  </summary>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    ${selectedModel.inputPerMillion.toFixed(3)} input / $
                    {selectedModel.outputPerMillion.toFixed(3)} output per
                    million tokens. Maximum reservation: $
                    {(
                      (selectedModel.contextLength *
                        selectedModel.inputPerMillion +
                        1200 * selectedModel.outputPerMillion) /
                      1e6
                    ).toFixed(4)}{' '}
                    per decision. Requests stop when the remaining daily budget
                    cannot cover this amount.
                  </p>
                </details>
              )}
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                One open position at a time. Shortlist ranking uses verified
                venue data, with at most eight candidates per decision. Daily
                order budget counts entries, protective orders and closes; it is
                not margin. Decision frequency remains subject to daily AI and
                96-call limits.
              </p>
              {live && draft.venue === 'hyperliquid' && (
                <p className="text-[10px] text-muted-foreground">
                  Liquid scope uses core markets. Builder markets need a
                  separate agent/watchlist within one DEX collateral scope.
                </p>
              )}
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {live
                  ? 'This uses the connected desk account, not a newly provisioned dedicated wallet. Saving does not authorize trading. Live arming reviews the current account revision and limits separately.'
                  : 'USDC-quoted perpetuals; paper USDC is valued at $1. Fees, slippage, funding and poll-based exits are simulation assumptions.'}
              </p>
            </fieldset>
          </div>
          {(saveError || error) && (
            <p role="alert" className="shrink-0 text-xs text-destructive">
              {saveError || error}
            </p>
          )}
          <div className="flex shrink-0 justify-end gap-2 border-t border-border/40 pt-3">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || models.length === 0 || loadingMarkets}
            >
              {busy ? 'Saving…' : 'Save paused agent'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
