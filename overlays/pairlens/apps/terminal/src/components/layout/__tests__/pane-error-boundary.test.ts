import { expect, test } from 'bun:test'
import { PaneErrorBoundary } from '../pane-error-boundary'
import { paneRecoveryKey } from '@/lib/chart-pane-navigation'

const props = (resetKey: string) => ({
  paneType: 'chart',
  resetKey,
  children: null,
})

test('a new chart identity releases a latched error, but the same failed identity does not retry forever', () => {
  const failed = { hasError: true, resetKey: 'lighter:PUFFER-USDT:15m' }
  expect(
    PaneErrorBoundary.getDerivedStateFromProps(props(failed.resetKey), failed),
  ).toBeNull()
  const recovered = PaneErrorBoundary.getDerivedStateFromProps(
    props('lighter:DASH-USDC-USDC:1h'),
    failed,
  )
  expect(recovered).toEqual({
    hasError: false,
    resetKey: 'lighter:DASH-USDC-USDC:1h',
  })
  const failedAgain = {
    ...recovered,
    ...PaneErrorBoundary.getDerivedStateFromError(),
  }
  expect(
    PaneErrorBoundary.getDerivedStateFromProps(
      props('lighter:DASH-USDC-USDC:1h'),
      failedAgain,
    ),
  ).toBeNull()
})

test('venue, spot/perpetual identity, timeframe and pane replacement each permit recovery', () => {
  const target = {
    paneType: 'chart',
    paneId: 'one',
    pair: { market: 'lighter', pairKey: 'ETH-USDC-USDC' },
    timeframe: '15m',
  }
  const failed = { hasError: true, resetKey: paneRecoveryKey(target) }
  expect(
    PaneErrorBoundary.getDerivedStateFromProps(
      props(paneRecoveryKey({ ...target, pair: { ...target.pair } })),
      failed,
    ),
  ).toBeNull()
  for (const resetKey of [
    paneRecoveryKey({
      ...target,
      pair: { ...target.pair, market: 'hyperliquid' },
    }),
    paneRecoveryKey({
      ...target,
      pair: { market: 'lighter-spot', pairKey: 'ETH-USDC' },
    }),
    paneRecoveryKey({ ...target, timeframe: '1h' }),
    paneRecoveryKey({ ...target, paneId: 'two' }),
  ])
    expect(
      PaneErrorBoundary.getDerivedStateFromProps(props(resetKey), failed)
        ?.hasError,
    ).toBe(false)
})
