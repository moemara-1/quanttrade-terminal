import { useMemo, useState } from 'react'

/** Reset the visible window on a new query/filter without resetting async arrivals. */
export function usePairResultWindow<T>(key: string, rows: ReadonlyArray<T>) {
  const [window, setWindow] = useState({ key, count: 50 })
  const count = window.key === key ? window.count : 50
  const visible = useMemo(() => rows.slice(0, count), [rows, count])
  return {
    visible,
    remaining: Math.max(0, rows.length - count),
    showMore: () => setWindow({ key, count: count + 50 }),
  }
}
