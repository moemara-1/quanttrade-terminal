import { useRef, useState } from 'react'
import type { ArbitrageReviewPlan } from '@/lib/arbitrage-review'
import type { ScannerSnapshot } from '@/lib/scanners'
import {
  confirmArbitrageReview,
  prepareArbitrageReview,
} from '@/lib/arbitrage-review'

export function useArbitrageReview(
  comparison: ScannerSnapshot['comparisons'][number],
) {
  const [margin, setMargin] = useState('')
  const [leverage, setLeverage] = useState(1)
  const [marginMode, setMarginMode] = useState<'cross' | 'isolated'>('cross')
  const [plan, setPlan] = useState<ArbitrageReviewPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const prepare = async () => {
    if (inFlight.current || plan) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      setPlan(
        await prepareArbitrageReview(comparison, margin, leverage, marginMode),
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Paired preparation failed; no orders were submitted',
      )
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const confirm = async () => {
    if (inFlight.current || !plan || plan.status !== 'review') return
    if (plan.expiresAt <= Date.now()) {
      setError(
        'Review expired. Edit the plan and prepare it again; no submission was attempted.',
      )
      return
    }
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      setPlan(await confirmArbitrageReview(plan))
    } catch (cause) {
      setPlan({
        ...plan,
        status: 'unknown',
        message:
          'Confirmation could not be verified. Inspect both exchange accounts and this plan before any new trade. No automatic retry.',
      })
      setError(
        cause instanceof Error
          ? cause.message
          : 'Paired submission outcome is unknown',
      )
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const reset = () => {
    if (!inFlight.current && plan?.status === 'review') {
      setPlan(null)
      setError(null)
    }
  }
  return {
    margin,
    setMargin,
    leverage,
    setLeverage,
    marginMode,
    setMarginMode,
    plan,
    busy,
    error,
    prepare,
    confirm,
    reset,
  }
}
