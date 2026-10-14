import { useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { Link, useNavigate } from '@tanstack/react-router'
import { cn } from '@pairlens/ui'
import { Button } from '@pairlens/ui/components/ui/button'
import { Input } from '@pairlens/ui/components/ui/input'
import type {
  ActivityIdentity,
  ActivityRow,
  ActivitySection,
} from '@/lib/workflows/live-activity'
import type { ActivityView } from '@/lib/workflows/activity-presentation'
import type { ActivityApproval } from '@/lib/workflows/activity-management'
import { PAGE_COLUMN, PAGE_GROUND } from '@/components/chrome/page-chrome'
import { useLiveActivity } from '@/lib/workflows/live-activity'
import {
  activityStatusTone,
  groupActivityMarkets,
  positiveActivityValue,
  visibleActivityRows,
} from '@/lib/workflows/activity-presentation'
import {
  copyActivityWorkflowDraft,
  prepareActivityOrderAction,
  prepareActivityRunAction,
} from '@/lib/workflows/activity-management'

function MarketLink({ row }: { row: ActivityRow }) {
  return row.chartSymbol ? (
    <Link
      to="/$cls/$market/$id"
      params={{
        cls: row.marketType === 'perpetual' ? 'perp' : 'spot',
        market: row.marketType === 'spot' ? `${row.venue}-spot` : row.venue,
        id: row.chartSymbol,
      }}
      className="font-medium hover:text-primary hover:underline underline-offset-4"
    >
      {row.symbol}
    </Link>
  ) : (
    <span className="font-medium">{row.symbol}</span>
  )
}
function OrderValues({ row }: { row: ActivityRow }) {
  const price = positiveActivityValue(row.price),
    trigger = positiveActivityValue(row.triggerPrice)
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums">
      <span className={row.side === 'buy' ? 'text-primary' : 'text-foreground'}>
        {row.side} {row.size}
      </span>
      {price && (
        <span>
          <span className="text-muted-foreground">Price </span>
          {price}
        </span>
      )}
      {trigger && (
        <span>
          <span className="text-muted-foreground">Trigger </span>
          {trigger}
        </span>
      )}
      {row.reduceOnly && (
        <span className="text-muted-foreground">Reduce only</span>
      )}
    </span>
  )
}
function RowDetails({ row }: { row: ActivityRow }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer py-2 text-muted-foreground hover:text-foreground">
        Details{row.steps.length ? ` · ${row.steps.length} steps` : ''}
        {row.error ? ' · issue' : ''}
      </summary>
      <div className="space-y-3 pb-2">
        <p className="break-all text-muted-foreground">ID {row.id}</p>
        {row.scopeMismatch && (
          <p className="text-amber-400">
            Historical account or connection. Live actions are unavailable.
          </p>
        )}
        {row.startedAt && (
          <p className="text-muted-foreground">
            Started {new Date(row.startedAt).toLocaleString()}
          </p>
        )}
        {row.error && <p className="break-words text-amber-400">{row.error}</p>}
        {row.steps.length > 0 && (
          <>
            <p className="max-w-prose text-muted-foreground">
              Recorded submissions do not prove fills. Protective orders may
              stay open until triggered.
            </p>
            <ol className="space-y-2">
              {row.steps.map((step, index) => (
                <li
                  key={`${step.id}-${index}`}
                  className="flex flex-wrap gap-x-3 gap-y-1"
                >
                  <span className="text-muted-foreground">{step.id}</span>
                  <span className={activityStatusTone(step.status)}>
                    {step.status === 'executed'
                      ? 'Executed (recorded)'
                      : step.status === 'submitted'
                        ? 'Submitted; fill unverified'
                        : step.status}
                  </span>
                  {step.orderId && (
                    <span className="basis-full break-all text-muted-foreground">
                      Exchange order {step.orderId}
                    </span>
                  )}
                  {step.error && (
                    <span className="basis-full break-words text-amber-400">
                      {step.error}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </details>
  )
}
type ItemProps = {
  row: ActivityRow
  section: ActivitySection
  identity: ActivityIdentity | null
  refresh: () => Promise<void>
}
function ActivityActions({ row, section, identity, refresh }: ItemProps) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState('')
  const [price, setPrice] = useState('')
  const [approval, setApproval] = useState<ActivityApproval | null>(null)
  const [action, setAction] = useState<
    'amend' | 'cancel' | 'pause' | 'stop' | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const current =
    !row.scopeMismatch && !section.stale && !section.error && Boolean(identity)
  const canOrder = current && row.kind === 'order' && row.status === 'open'
  const canRun =
    current &&
    row.kind === 'workflow' &&
    ['active', 'paused'].includes(row.status)
  const canEdit =
    canOrder &&
    row.name.toLowerCase() === 'limit' &&
    (row.venue !== 'lighter' || Boolean(row.totalSize))
  function review(next: 'amend' | 'cancel' | 'pause' | 'stop') {
    try {
      const prepared =
        next === 'amend' || next === 'cancel'
          ? prepareActivityOrderAction(
              row,
              section,
              identity,
              next,
              next === 'amend' ? { amount, price } : undefined,
            )
          : prepareActivityRunAction(row, section, identity, next)
      setApproval(prepared)
      setAction(next)
      setError(null)
      setEditing(false)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'This action could not be reviewed.',
      )
    }
  }
  async function confirm() {
    if (!approval || busy) return
    setBusy(true)
    try {
      await approval.approve()
      setError(approval.error)
      if (approval.status === 'accepted') await refresh()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Refresh could not be completed. Check the latest exchange state.',
      )
    } finally {
      setBusy(false)
    }
  }
  function copyDraft() {
    try {
      const id = copyActivityWorkflowDraft(row)
      void navigate({
        to: '/workflows',
        search: { workflow: id, view: 'builder' },
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The draft could not be copied.',
      )
    }
  }
  if (!canOrder && !canRun && !row.graph && !error && row.kind !== 'workflow')
    return row.kind === 'order' ? (
      <p className="mt-2 text-xs text-muted-foreground">
        Refresh activity before managing this order.
      </p>
    ) : null
  return (
    <div className="mt-2 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {canOrder && !approval && (
          <>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAmount(
                    row.venue === 'lighter'
                      ? (row.totalSize ?? '')
                      : (row.size ?? ''),
                  )
                  setPrice(row.price ?? '')
                  setEditing(true)
                  setError(null)
                }}
              >
                Edit limit
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => review('cancel')}>
              Cancel order
            </Button>
            {!canEdit && (
              <span className="text-muted-foreground">
                {row.name.toLowerCase() === 'limit'
                  ? 'Total quantity unavailable; refresh before editing.'
                  : 'Native TWAP / conditional edits are not available here.'}
              </span>
            )}
          </>
        )}
        {canRun && !approval && (
          <>
            {row.status === 'active' && (
              <Button size="sm" variant="ghost" onClick={() => review('pause')}>
                Pause
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => review('stop')}>
              Stop schedule
            </Button>
          </>
        )}
        {row.graph && (
          <Button size="sm" variant="ghost" onClick={copyDraft}>
            Edit a copy
          </Button>
        )}
      </div>
      {row.kind === 'workflow' && !row.graph && (
        <p className="text-muted-foreground">
          This scheduled-order plan has no editable graph. Prepare a new plan to
          change its orders.
        </p>
      )}
      {!current && row.kind === 'workflow' && (
        <p className="text-muted-foreground">
          Refresh to manage a current schedule. Historical runs cannot be
          replayed.
        </p>
      )}
      {editing && !approval && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg bg-muted/30 p-3">
          <label className="min-w-32 flex-1 space-y-1">
            <span>
              {row.venue === 'lighter'
                ? 'Total quantity · includes fills'
                : 'Quantity'}
            </span>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className="min-w-32 flex-1 space-y-1">
            <span>Limit price</span>
            <Input
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
          <Button size="sm" onClick={() => review('amend')}>
            Review edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Close
          </Button>
        </div>
      )}
      {approval && (
        <div className="space-y-2 rounded-lg bg-muted/40 p-3">
          <p className="font-medium">
            {action === 'amend'
              ? 'Review limit edit'
              : action === 'cancel'
                ? 'Review order cancellation'
                : action === 'pause'
                  ? 'Pause future scheduled steps'
                  : 'Stop future scheduled steps'}
          </p>
          <p>
            {row.symbol} · {row.venue} · {row.accountName} · {row.mode}
          </p>
          {action === 'amend' && (
            <p>
              {row.venue === 'lighter' ? 'Total quantity' : 'Quantity'} {amount}{' '}
              · price {price}
            </p>
          )}
          {action === 'cancel' && (
            <p className="break-all text-muted-foreground">Order {row.id}</p>
          )}
          {action === 'cancel' && row.reduceOnly && (
            <p className="text-amber-400">
              This is a reduce-only exit. Cancelling it may leave your position
              unprotected.
            </p>
          )}
          {(action === 'pause' || action === 'stop') && (
            <p className="text-amber-400">
              Already submitted exchange orders and positions remain. An
              in-flight order may still complete.
            </p>
          )}
          {approval.status === 'accepted' ? (
            <div className="flex flex-wrap items-center gap-2">
              <p role="status" className="text-primary">
                Change accepted. Check the latest state.
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setApproval(null)
                  setAction(null)
                }}
              >
                Done
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || approval.status !== 'idle'}
                onClick={() => void confirm()}
              >
                {busy ? 'Submitting…' : 'Confirm'}
              </Button>
              {approval.status === 'idle' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setApproval(null)
                    setAction(null)
                  }}
                >
                  Back
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="max-w-prose break-words text-amber-400">
          {error}
        </p>
      )}
    </div>
  )
}
function ActivityItem(props: ItemProps) {
  const { row } = props
  if (row.kind === 'order') {
    return (
      <article className="min-w-0 py-1">
        <details>
          <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 py-2 text-xs">
            <span className="min-w-24 font-medium">{row.name}</span>
            <OrderValues row={row} />
            <span className={cn('ml-auto', activityStatusTone(row.status))}>
              {row.status}
            </span>
            <span className="text-muted-foreground hover:text-foreground">
              Manage order ▾
            </span>
          </summary>
          <div className="pb-2 pt-1">
            <ActivityActions {...props} />
            <p className="mt-3 break-all text-[11px] text-muted-foreground">
              Order ID {row.id}
            </p>
            {row.error && (
              <p className="mt-2 text-xs text-amber-400">{row.error}</p>
            )}
          </div>
        </details>
      </article>
    )
  }
  return (
    <article className="min-w-0 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="break-words text-sm font-medium">{row.name}</h3>
          <span
            className={cn(
              'rounded px-2 py-0.5 text-[11px] bg-muted/40',
              activityStatusTone(row.status),
            )}
          >
            {row.status}
          </span>
          {row.scopeMismatch && (
            <span className="text-[11px] text-muted-foreground">
              Historical connection
            </span>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        <MarketLink row={row} /> · {row.venue} · {row.accountName} · {row.mode}
      </p>
      <div className="mt-2">
        <OrderValues row={row} />
      </div>
      <ActivityActions {...props} />
      <RowDetails row={row} />
    </article>
  )
}
function Section({
  title,
  description,
  section,
  view,
  search,
  venue,
  identity,
  refresh,
  groupOrders = false,
  compactEmpty = false,
}: {
  title: string
  description: string
  section: ActivitySection
  view: ActivityView
  search: string
  venue: string
  identity: ActivityIdentity | null
  refresh: () => Promise<void>
  groupOrders?: boolean
  compactEmpty?: boolean
}) {
  const rows = visibleActivityRows(section.items, view, search, venue),
    hidden = section.items.length - rows.length
  if (
    compactEmpty &&
    !section.items.length &&
    !section.error &&
    !section.loading &&
    !section.stale &&
    section.updatedAt
  ) {
    return (
      <section
        aria-label={title}
        className={cn(PAGE_COLUMN, 'h-auto shrink-0')}
      >
        <details>
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 py-1 text-xs">
            <span className="font-medium">
              {title}{' '}
              <span className="ml-1 text-muted-foreground">0 returned</span>
            </span>
            <span className="text-muted-foreground">
              Updated {new Date(section.updatedAt).toLocaleTimeString()} ·
              coverage ▾
            </span>
          </summary>
          <p className="mt-2 max-w-prose text-xs text-muted-foreground">
            {description}
          </p>
          {section.warnings.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {section.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            No results returned in this read scope.
          </p>
        </details>
      </section>
    )
  }
  return (
    <section aria-label={title} className={cn(PAGE_COLUMN, 'h-auto shrink-0')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">
          {title}{' '}
          <span className="ml-1 text-muted-foreground">{rows.length}</span>
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {section.loading
            ? 'Refreshing…'
            : section.updatedAt
              ? `Updated ${new Date(section.updatedAt).toLocaleTimeString()}`
              : 'Not yet verified'}
          {section.stale ? ' · stale' : ''}
        </span>
      </div>
      <p className="mt-1 max-w-prose text-xs text-muted-foreground">
        {description}
      </p>
      {section.error && (
        <p role="alert" className="mt-3 text-xs text-amber-400">
          {section.error}{' '}
          {section.items.length
            ? 'Previous results remain visible.'
            : 'Current contents could not be verified.'}
        </p>
      )}
      {section.warnings.length > 0 && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer py-1">
            Read coverage · {section.warnings.length} notes
          </summary>
          <ul className="mt-2 space-y-1">
            {section.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      {groupOrders ? (
        <div className="mt-3 space-y-4">
          {groupActivityMarkets(rows).map((group) => (
            <div key={group.key}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted/30 px-3 py-2 text-xs">
                <MarketLink row={group.row} />
                <span className="text-muted-foreground">
                  {group.row.venue} · {group.row.accountName} ·{' '}
                  {group.row.marketType}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {group.rows.length} orders · {group.row.mode}
                </span>
              </div>
              <div className="divide-y divide-border/40 px-3">
                {group.rows.map((row) => (
                  <ActivityItem
                    key={row.id}
                    row={row}
                    section={section}
                    identity={identity}
                    refresh={refresh}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 divide-y divide-border/40">
          {rows.map((row) => (
            <ActivityItem
              key={`${row.kind}-${row.venue}-${row.id}`}
              row={row}
              section={section}
              identity={identity}
              refresh={refresh}
            />
          ))}
        </div>
      )}
      {!rows.length && !section.error && (
        <p role="status" className="py-4 text-xs text-muted-foreground">
          {section.loading
            ? 'Reading activity…'
            : hidden
              ? `${hidden} records hidden by this view. Use History or clear filters.`
              : section.warnings.length
                ? 'No results in the verified scope. Check read coverage.'
                : 'No current orders or runs.'}
        </p>
      )}
    </section>
  )
}
export function LiveActivity() {
  const activity = useLiveActivity(),
    [view, setView] = useState<ActivityView>('current'),
    [search, setSearch] = useState(''),
    [venue, setVenue] = useState('all')
  const shared = {
    view,
    search,
    venue,
    identity: activity.identity,
    refresh: activity.refresh,
  }
  return (
    <div
      className={cn(PAGE_GROUND, 'flex-col overflow-x-hidden overflow-y-auto')}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-1 py-2">
        <div>
          <p className="text-sm font-medium">Orders & plans</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Manage exchange orders and server schedules. Edit a plan as a new
            draft.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void activity.refresh()}
          disabled={activity.isRefreshing}
        >
          <RefreshCw
            className={cn(
              'mr-2 size-3.5',
              activity.isRefreshing && 'animate-spin',
            )}
          />
          Refresh
        </Button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-1 pb-1">
        <div
          role="group"
          aria-label="Activity view"
          className="flex rounded-lg bg-muted/30 p-1"
        >
          {(['current', 'history'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={view === value ? 'secondary' : 'ghost'}
              aria-pressed={view === value}
              onClick={() => setView(value)}
            >
              {value === 'current' ? 'Current' : 'History / all'}
            </Button>
          ))}
        </div>
        <div className="relative min-w-40 flex-1 sm:max-w-80">
          <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input
            aria-label="Search activity"
            placeholder="Search market, plan or account"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-8"
          />
        </div>
        <select
          aria-label="Filter exchange"
          value={venue}
          onChange={(event) => setVenue(event.target.value)}
          className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
        >
          <option value="all">All exchanges</option>
          <option value="lighter">Lighter</option>
          <option value="hyperliquid">Hyperliquid</option>
        </select>
      </div>
      <Section
        title="Exchange orders"
        description="Live orders grouped by market. Stopping a plan does not cancel these orders."
        section={activity.orders}
        groupOrders
        {...shared}
      />
      <Section
        title="Workflow runs"
        description="Current schedules and paused plans. Historical or finished runs are in History."
        section={activity.workflows}
        {...shared}
      />
      <Section
        title="Managed Chase runs"
        description="Limits managed by QuantTrade, separate from the exchange order book."
        section={activity.chase}
        compactEmpty
        {...shared}
      />
      <Section
        title="Native TWAP receipts"
        description="Hyperliquid acknowledgments, not verified running schedules or fills."
        section={activity.nativeTwap}
        compactEmpty
        {...shared}
      />
    </div>
  )
}
