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
