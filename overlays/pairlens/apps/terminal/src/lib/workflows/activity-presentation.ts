import type { ActivityRow } from './live-activity'

export type ActivityView = 'current' | 'history'

export function visibleActivityRows(
  rows: Array<ActivityRow>,
  view: ActivityView,
  search: string,
  venue: string,
): Array<ActivityRow> {
  const term = search.trim().toLowerCase()
  return rows.filter(
    (row) =>
      (view === 'history' ||
        (!row.scopeMismatch &&
          !['completed', 'cancelled', 'filled', 'closed', 'stopped'].includes(
            row.status,
          ))) &&
      (venue === 'all' || row.venue === venue) &&
      (!term ||
        [row.symbol, row.name, row.venue, row.accountName, row.id].some(
          (value) => value.toLowerCase().includes(term),
        )),
  )
}

export function groupActivityMarkets(
  rows: Array<ActivityRow>,
): Array<{ key: string; row: ActivityRow; rows: Array<ActivityRow> }> {
  const groups = new Map<
    string,
    { key: string; row: ActivityRow; rows: Array<ActivityRow> }
  >()
  for (const row of rows) {
    const key = JSON.stringify([
      row.venue,
      row.symbol,
      row.marketType,
      row.accountName,
      row.mode,
    ])
    const group = groups.get(key)
    if (group) group.rows.push(row)
    else groups.set(key, { key, row, rows: [row] })
  }
  return [...groups.values()].sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  )
}

export function positiveActivityValue(value?: string): string | undefined {
  return value && Number.isFinite(Number(value)) && Number(value) > 0
    ? value
    : undefined
}

export type ActivityFilter = 'all' | 'pending' | 'attention' | 'finished'

export function matchesActivityFilter(
  status: string,
  filter: ActivityFilter,
  error?: string,
): boolean {
  if (filter === 'all') return true
  if (filter === 'attention')
    return (
      Boolean(error) ||
      ['paused', 'failed', 'unverified', 'rejected'].includes(status)
    )
  if (filter === 'finished')
    return ['completed', 'cancelled', 'filled', 'closed'].includes(status)
  return [
    'active',
    'pending',
    'waiting',
    'waiting-fill',
    'submitting',
    'submitted',
    'open',
    'running',
    'scheduled',
  ].includes(status)
}

export function activityStatusTone(status: string): string {
  if (['paused', 'failed', 'unverified', 'rejected'].includes(status))
    return 'text-amber-400'
  if (['completed', 'filled'].includes(status)) return 'text-primary'
  return 'text-muted-foreground'
}
