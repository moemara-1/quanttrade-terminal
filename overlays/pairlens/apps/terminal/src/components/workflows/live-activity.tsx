import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { cn } from '@pairlens/ui'
import { Button } from '@pairlens/ui/components/ui/button'
import type {
  ActivityRow,
  ActivitySection,
} from '@/lib/workflows/live-activity'
import type { ActivityFilter } from '@/lib/workflows/activity-presentation'
import { PAGE_COLUMN, PAGE_GROUND } from '@/components/chrome/page-chrome'
import { useLiveActivity } from '@/lib/workflows/live-activity'
import {
  activityStatusTone,
  matchesActivityFilter,
} from '@/lib/workflows/activity-presentation'

function ActivityItem({ row }: { row: ActivityRow }) {
  return (
    <article className="min-w-0 rounded-lg bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 break-words text-sm font-medium">{row.name}</h3>
        <span className={`text-xs ${activityStatusTone(row.status)}`}>
          {row.status}
        </span>
      </div>
      <p className="mt-1 break-words text-xs text-muted-foreground">
        {row.chartSymbol ? (
          <Link
            to="/$cls/$market/$id"
            params={{
              cls: row.marketType === 'perpetual' ? 'perp' : 'spot',
              market:
                row.marketType === 'spot' ? `${row.venue}-spot` : row.venue,
              id: row.chartSymbol,
            }}
            className="text-foreground underline decoration-muted-foreground/40 underline-offset-2"
          >
            {row.symbol}
          </Link>
        ) : (
          row.symbol
        )}{' '}
        · {row.venue} · {row.marketType} · {row.accountName} ·{' '}
        <span className={row.mode === 'live' ? 'text-amber-400' : ''}>
          {row.mode}
        </span>
      </p>
      {row.scopeMismatch && (
        <p className="mt-2 text-xs text-amber-400">
          Historical account or connection. This is not the currently connected
          account.
        </p>
      )}
      {(row.side || row.size || row.price || row.triggerPrice) && (
        <p className="mt-2 text-xs">
          {row.side} {row.size}
          {row.price ? ` · price ${row.price}` : ''}
          {row.triggerPrice ? ` · trigger ${row.triggerPrice}` : ''}
          {row.reduceOnly ? ' · reduce only' : ''}
        </p>
      )}
      {row.error && (
        <p className="mt-2 break-words text-xs text-amber-400">{row.error}</p>
      )}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer py-1 text-muted-foreground">
          IDs and{' '}
          {row.steps.length
            ? `${row.steps.length} step outcomes`
            : 'order details'}
        </summary>
        <p className="mt-2 break-all font-mono text-[11px]">{row.id}</p>
        {row.startedAt && (
          <p className="mt-1 text-muted-foreground">
            Started {new Date(row.startedAt).toLocaleString()}
          </p>
        )}
        {row.steps.length > 0 && (
          <>
            <p className="mt-2 text-muted-foreground">
              A recorded submission is not proof of a fill. Protective orders
              may remain open until triggered.
            </p>
            <ol className="mt-2 space-y-2">
              {row.steps.map((step, index) => (
                <li
                  key={`${step.id}-${index}`}
                  className="rounded bg-background/50 p-2"
                >
                  <p>
                    {step.id} ·{' '}
                    <span className={activityStatusTone(step.status)}>
                      {step.status === 'executed'
                        ? 'executed (recorded outcome)'
                        : step.status === 'submitted'
                          ? 'submitted; fill not verified'
                          : step.status}
                    </span>
                  </p>
                  {step.orderId && (
                    <p className="mt-1 break-all font-mono text-[11px]">
                      Exchange order {step.orderId}
                    </p>
                  )}
                  {step.error && (
                    <p className="mt-1 break-words text-amber-400">
                      {step.error}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </details>
    </article>
  )
}

function Section({
  title,
  description,
  section,
  filter,
}: {
  title: string
  description: string
  section: ActivitySection
  filter: ActivityFilter
}) {
  const rows = section.items.filter((row) =>
    matchesActivityFilter(row.status, filter, row.error),
  )
  return (
    <section aria-label={title} className={cn(PAGE_COLUMN, 'h-auto shrink-0')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">
          {title}{' '}
          <span className="text-muted-foreground">{section.items.length}</span>
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {section.loading
            ? 'Refreshing…'
            : section.updatedAt
              ? `Read ${new Date(section.updatedAt).toLocaleTimeString()}`
              : 'Not yet verified'}
          {section.stale ? ' · stale' : ''}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      {section.error && (
        <p role="alert" className="mt-3 text-xs text-amber-400">
          {section.error}{' '}
          {section.items.length
            ? 'Previously read results remain below.'
            : 'The current contents could not be verified.'}
        </p>
      )}
      {section.warnings.map((warning, index) => (
        <p key={index} className="mt-2 text-xs text-amber-400">
          {warning}
        </p>
      ))}
      <div className="mt-3 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <ActivityItem
            key={`${row.kind}-${row.venue}-${row.marketType}-${row.id}`}
            row={row}
          />
        ))}
      </div>
      {!rows.length && !section.loading && !section.error && (
        <p className="py-5 text-sm text-muted-foreground">
          {section.items.length
            ? 'No results match this filter.'
            : section.warnings.length
              ? 'No orders or runs were returned in the verified scope. See the coverage warnings above.'
              : 'No orders or runs returned by this read.'}
        </p>
      )}
      {!rows.length && section.loading && (
        <p role="status" className="py-5 text-sm text-muted-foreground">
          Reading activity…
        </p>
      )}
    </section>
  )
}

export function LiveActivity() {
  const activity = useLiveActivity()
  const [filter, setFilter] = useState<ActivityFilter>('all')
  return (
    <div
      className={cn(PAGE_GROUND, 'flex-col overflow-x-hidden overflow-y-auto')}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-1 py-2">
        <div>
          <p className="text-sm font-medium">Server runs & exchange orders</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Fresh reads from QuantTrade and connected exchanges. Saved workflow
            definitions do not place orders.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void activity.refresh()}
          disabled={activity.isRefreshing}
        >
          <RefreshCw
            className={`mr-2 size-3.5 ${activity.isRefreshing ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>
      <div
        role="group"
        aria-label="Activity status filter"
        className="flex shrink-0 flex-wrap gap-1 px-1"
      >
        {(['all', 'pending', 'attention', 'finished'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? 'secondary' : 'ghost'}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {
              {
                all: 'All',
                pending: 'Pending / active',
                attention: 'Needs attention',
                finished: 'Finished',
              }[value]
            }
          </Button>
        ))}
      </div>
      <Section
        title="Exchange orders"
        description="Orders currently returned by the exchange, including native orders. They are separate from scheduled workflow runs."
        section={activity.orders}
        filter={filter}
      />
      <Section
        title="Workflow runs"
        description="Confirmed plans stored on the QuantTrade server, including paused plans and step outcomes."
        section={activity.workflows}
        filter={filter}
      />
      <Section
        title="Managed Chase runs"
        description="Limit orders managed by QuantTrade's Chase service. This service state is separate from the exchange order book."
        section={activity.chase}
        filter={filter}
      />
      <Section
        title="Native TWAP receipts"
        description="Native Hyperliquid TWAP submissions accepted through QuantTrade. These receipts do not establish whether the exchange schedule is still running or filled."
        section={activity.nativeTwap}
        filter={filter}
      />
    </div>
  )
}
