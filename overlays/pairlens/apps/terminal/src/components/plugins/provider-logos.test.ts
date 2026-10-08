import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'bun:test'
import { venuePosterSrc } from '../accounts/venue-art'
import { quantTradeManifest } from '../../lib/plugins/quanttrade-connectors'
import { nanogptInferenceManifest } from '../../../../../packages/plugins/src/nanogpt-inference'
import { pluginIconSrc } from './plugin-brand'

test('both spot and perpetual venue badges route to bundled official logos', () => {
  for (const venue of ['hyperliquid', 'lighter'] as const) {
    for (const type of ['perpetual', 'spot'] as const) {
      const manifest = quantTradeManifest(venue, type)
      const market = type === 'spot' ? `${venue}-spot` : venue
      const icon = venuePosterSrc(market)
      expect(icon).toMatch(/^\/posters\//)
      expect(manifest.icon).toBe(icon)
      expect(manifest.metadata?.['logoUrl']).toBe(icon)
      expect(pluginIconSrc(manifest.id)).toBe(icon)
      expect(
        existsSync(new URL(`../../../public${icon}`, import.meta.url)),
      ).toBe(true)
    }
  }
})
test('NanoGPT provider picker resolves the official locally bundled mark', () => {
  const icon = pluginIconSrc('nanogpt-inference')
  expect(icon).toBe('/posters/nanogpt-inference.svg')
  expect(nanogptInferenceManifest.icon).toBe(icon)
  expect(existsSync(new URL(`../../../public${icon}`, import.meta.url))).toBe(
    true,
  )
})
test('bundled provider SVGs do not execute code or reference external resources', () => {
  for (const icon of [
    'lighter-market-connector.svg',
    'nanogpt-inference.svg',
  ]) {
    const svg = readFileSync(
      new URL(`../../../public/posters/${icon}`, import.meta.url),
      'utf8',
    )
    expect(svg).not.toMatch(
      /<\s*(?:script|foreignObject)\b|\bon\w+\s*=|<!ENTITY|<!DOCTYPE/i,
    )
    expect(svg).not.toMatch(/(?:href|src)\s*=\s*["'](?!#)/i)
    expect(svg).not.toMatch(/url\(\s*["']?(?!#)/i)
  }
})
