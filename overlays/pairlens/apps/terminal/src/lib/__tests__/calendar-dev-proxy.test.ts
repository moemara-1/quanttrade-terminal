import { readFileSync } from 'node:fs'
import { expect, it } from 'bun:test'

it('routes only public calendar paths to the local QuantTrade bridge', () => {
  const config = readFileSync(
    new URL('../../../vite.config.ts', import.meta.url),
    'utf8',
  )
  const proxy = config.match(
    /'([^']*earnings-calendar[^']*)':\s*\{\s*target: 'http:\/\/127\.0\.0\.1:4318'/,
  )?.[1]
  expect(proxy).toBeDefined()
  if (!proxy) throw new Error('Calendar dev proxy is missing')
  const route = new RegExp(proxy)
  for (const path of [
    '/api/earnings-calendar?days=7',
    '/api/ipo-calendar',
    '/api/economic-calendar?days=14',
  ])
    expect(route.test(path)).toBe(true)
  for (const path of [
    '/api/auth',
    '/api/user/config',
    '/api/company-overview',
    '/api/earnings-calendar-extra',
  ])
    expect(route.test(path)).toBe(false)
})
