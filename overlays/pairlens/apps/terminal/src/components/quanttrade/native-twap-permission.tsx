import { useEffect, useRef, useState } from 'react'
import type { NativeTwapPolicyStatus } from '@/lib/copilot/native-twap-policy'
import {
  changeNativeTwapPolicy,
  readNativeTwapPolicy,
} from '@/lib/copilot/native-twap-policy'

export function NativeTwapPermission() {
  const [status, setStatus] = useState<NativeTwapPolicyStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const active = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    active.current = controller
    void readNativeTwapPolicy(fetch, controller.signal)
      .then((current) => {
        if (!controller.signal.aborted) setStatus(current)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setMessage(
            error instanceof Error ? error.message : 'Permission unavailable.',
          )
      })
    return () => controller.abort()
  }, [])
  const refresh = async () => {
    const controller = active.current
    if (!controller || controller.signal.aborted) return
    setBusy(true)
    setMessage('')
    try {
      const current = await readNativeTwapPolicy(fetch, controller.signal)
      if (!controller.signal.aborted) setStatus(current)
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error ? error.message : 'Permission unavailable.',
        )
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const change = async () => {
    if (!status || !active.current) return
    const controller = active.current
    setBusy(true)
    setMessage('')
    try {
      const result = await changeNativeTwapPolicy(
        status,
        !status.nativeTwapRiskAllowed,
        fetch,
        controller.signal,
      )
      const current = await readNativeTwapPolicy(fetch, controller.signal)
      if (controller.signal.aborted) return
      if (
        current.accountName !== result.accountName ||
        current.connectionRevisions.hyperliquid !== result.connectionRevision
      )
        throw new Error(
          'Account changed. Reopen these controls to review permission.',
        )
      setStatus(current)
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus(null)
        setMessage(
          error instanceof Error
            ? error.message
            : 'Permission change unconfirmed.',
        )
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  return (
    <fieldset className="space-y-2 rounded border border-border p-2">
      <legend>Native Hyperliquid TWAP permission</legend>
      <p className="text-muted-foreground">
        Native TWAP uses fixed 3% slice slippage and has no absolute future
        price or quote cap. This permission applies to the connected account;
        standard order risk limits stay unchanged. Each TWAP still requires
        trade confirmation.
      </p>
      <button
        className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted"
        disabled={!status || busy}
        onClick={() => void change()}
      >
        {busy
          ? 'Updating permission…'
          : status?.nativeTwapRiskAllowed
            ? 'Disable native TWAP 3%'
            : 'Allow native TWAP 3%'}
      </button>
      <button
        className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted"
        disabled={busy}
        onClick={() => void refresh()}
      >
        Refresh permission
      </button>
      {message && <p role="status">{message}</p>}
    </fieldset>
  )
}
