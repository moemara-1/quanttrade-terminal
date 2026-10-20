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
  ArenaBot,
  ArenaConfig,
  ArenaMarket,
  ArenaModel,
} from '@/lib/llm-arena'
import {
  arenaConfigSchema,
  arenaDefaults,
  arenaMarkets,
  configuredArenaModel,
} from '@/lib/llm-arena'

const fieldClass =
  'h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs'
type NumericKey = {
  [K in keyof ArenaConfig]: ArenaConfig[K] extends number ? K : never
}[keyof ArenaConfig]
const numericFields: Array<{
  key: NumericKey
  label: string
  min: number
  max?: number
  step?: string
}> = [
  {
    key: 'intervalMinutes',
    label: 'Decision interval · minutes',
    min: 15,
    max: 1440,
    step: '1',
  },
  { key: 'initialEquity', label: 'Paper capital · USDC', min: 1 },
  { key: 'marginPerTrade', label: 'Paper margin per trade · USDC', min: 0.01 },
  { key: 'leverage', label: 'Leverage · ×', min: 1, max: 100, step: '1' },
  { key: 'maxDailyLoss', label: 'Daily paper loss cap · USDC', min: 0.01 },
  {
    key: 'maxAiSpendDaily',
    label: 'Daily AI spend cap · USD',
    min: 0.001,
    max: 1000,
  },
  {
    key: 'maxRunsDaily',
    label: 'Max decisions per day',
    min: 1,
    max: 96,
    step: '1',
  },
  { key: 'stopLossPct', label: 'Stop loss · %', min: 0.01, max: 50 },
  { key: 'takeProfitPct', label: 'Take profit · %', min: 0.01, max: 500 },
  {
    key: 'minConfidence',
    label: 'Minimum model confidence · 0–1',
    min: 0,
    max: 1,
  },
  { key: 'minVolume24h', label: 'Minimum 24h volume · USD', min: 0 },
  {
    key: 'maxAbsFundingBps',
    label: 'Maximum absolute funding · bps',
    min: 0,
    max: 10000,
  },
  { key: 'feeBps', label: 'Paper fee per fill · bps', min: 0, max: 100 },
  {
    key: 'slippageBps',
    label: 'Paper slippage per fill · bps',
    min: 0,
    max: 100,
  },
]

export function ArenaForm({
  bot,
  models,
  busy,
  onClose,
  onSave,
}: {
  bot: ArenaBot | null
  models: Array<ArenaModel>
  busy: boolean
  onClose: () => void
  onSave: (config: ArenaConfig, id?: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState<ArenaConfig>(
    () => bot?.config ?? arenaDefaults(configuredArenaModel()),
  )
  const [error, setError] = useState<string | null>(null)
  const [markets, setMarkets] = useState<Array<ArenaMarket>>([])
  const [marketError, setMarketError] = useState(false)
  const [loadingMarkets, setLoadingMarkets] = useState(true)
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
  }, [draft.venue])
  const change = <TKey extends keyof ArenaConfig>(
    key: TKey,
    value: ArenaConfig[TKey],
  ) => setDraft((previous) => ({ ...previous, [key]: value }))
  const selectedModel = models.find((model) => model.id === draft.model)
  const selectedMarket = markets.find(
    (market) => market.symbol === draft.symbol,
  )
  const lockedMarket = Boolean(bot?.paper.position)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>
            {bot ? 'Edit paper bot' : 'Create paper bot'}
          </DialogTitle>
          <DialogDescription>
            Editable paper suggestions. Saving leaves the bot paused. Every bot
            has its own simulated capital. This first version supports
            USDC-quoted perpetuals only; it does not read or use your exchange
            balance.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy) return
            const parsed = arenaConfigSchema.safeParse(draft)
            if (!parsed.success) {
              setError(
                `Check ${parsed.error.issues[0]?.path.join(' ') || 'the settings'}: ${parsed.error.issues[0]?.message || 'invalid value'}`,
              )
              return
            }
            if (!selectedModel) {
              setError(
                'Choose an available priced model. Refresh the catalog if needed.',
              )
              return
            }
            setError(null)
            if (!selectedMarket) {
              setError(
                'Choose an exact market from the selected venue catalog.',
              )
              return
            }
            if (
              selectedMarket.maxLeverage === null ||
              draft.leverage > selectedMarket.maxLeverage
            ) {
              setError(
                'Set leverage within the selected market’s verified venue limit.',
              )
              return
            }
            if (!(await onSave(parsed.data, bot?.id)))
              setError(
                'The bot was not saved. Refresh Arena status and check the current limits before retrying.',
              )
          }}
        >
          <fieldset
            disabled={busy}
            className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <label className="space-y-1 text-xs">
              Name
              <Input
                required
                maxLength={80}
                value={draft.name}
                onChange={(event) => change('name', event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs">
              NanoGPT model
              <select
                required
                className={fieldClass}
                value={draft.model}
                onChange={(event) => change('model', event.target.value)}
              >
                <option value="">Select a priced model</option>
                {draft.model && !selectedModel && (
                  <option value={draft.model} disabled>
                    {draft.model} · not in priced catalog
                  </option>
                )}
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} · {model.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              Venue
              <select
                className={fieldClass}
                value={draft.venue}
                disabled={lockedMarket}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    symbol: '',
                    venue:
                      event.target.value === 'lighter'
                        ? 'lighter'
                        : 'hyperliquid',
                  }))
                }
              >
                <option value="lighter">Lighter</option>
                <option value="hyperliquid">Hyperliquid</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              Exact venue symbol
              <select
                required
                className={fieldClass}
                value={draft.symbol}
                disabled={lockedMarket || loadingMarkets}
                onChange={(event) => change('symbol', event.target.value)}
              >
                <option value="">
                  {loadingMarkets
                    ? 'Loading venue markets…'
                    : 'Select an exact perpetual market'}
                </option>
                {draft.symbol &&
                  !markets.some((market) => market.symbol === draft.symbol) && (
                    <option value={draft.symbol} disabled>
                      {draft.symbol} · catalog unavailable
                    </option>
                  )}
                {markets.map((market) => (
                  <option key={market.symbol} value={market.symbol}>
                    {market.symbol}
                    {market.maxLeverage === null
                      ? ''
                      : ` · max ${market.maxLeverage}×`}
                  </option>
                ))}
              </select>
            </label>
            {numericFields.map((field) => (
              <label key={field.key} className="space-y-1 text-xs">
                {field.label}
                <Input
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
                  value={
                    Number.isFinite(draft[field.key]) ? draft[field.key] : ''
                  }
                  onChange={(event) =>
                    change(
                      field.key,
                      event.target.value === ''
                        ? NaN
                        : Number(event.target.value),
                    )
                  }
                />
              </label>
            ))}
            <label className="space-y-1 text-xs">
              Allowed direction
              <select
                className={fieldClass}
                value={draft.allowedSide}
                onChange={(event) =>
                  change(
                    'allowedSide',
                    event.target.value === 'long'
                      ? 'long'
                      : event.target.value === 'short'
                        ? 'short'
                        : 'both',
                  )
                }
              >
                <option value="both">Long and short</option>
                <option value="long">Long only</option>
                <option value="short">Short only</option>
              </select>
            </label>
            <label className="space-y-1 text-xs sm:col-span-2">
              Decision rules
              <textarea
                required
                maxLength={2000}
                className="min-h-24 w-full resize-y rounded-md border border-input bg-background p-2 text-xs"
                value={draft.rules}
                onChange={(event) => change('rules', event.target.value)}
              />
            </label>
          </fieldset>
          {lockedMarket && (
            <p className="text-xs text-muted-foreground">
              Close the paper position before changing its venue or symbol. The
              initial bankroll is fixed after creation.
            </p>
          )}
          {marketError && (
            <p role="alert" className="text-xs text-destructive">
              The venue catalog did not load. Close and reopen this form to
              refresh; no substitute symbols are used.
            </p>
          )}
          {selectedModel && (
            <p className="text-xs text-muted-foreground">
              Catalog pricing per million tokens: $
              {selectedModel.inputPerMillion.toFixed(3)} input / $
              {selectedModel.outputPerMillion.toFixed(3)} output. Conservative
              reservation per decision: $
              {(
                (selectedModel.contextLength * selectedModel.inputPerMillion +
                  1200 * selectedModel.outputPerMillion) /
                1e6
              ).toFixed(4)}{' '}
              (full context plus 1,200 output tokens). No decision runs when
              this exceeds the remaining daily AI budget.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Paper USDC is valued at $1 for this simulation. Fees, slippage and
            funding are paper assumptions. Snapshot funding is an estimate;
            paper performance does not establish executable live returns.
          </p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || models.length === 0}>
              {busy ? 'Saving…' : 'Save paused bot'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
