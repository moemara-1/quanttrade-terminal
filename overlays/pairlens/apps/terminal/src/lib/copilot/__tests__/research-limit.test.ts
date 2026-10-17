import { expect, test } from 'bun:test'
import { buildProviderTools } from '../provider-tools'
import type { CopilotToolDeps } from '../tool-deps'

test('venue research accepts bounded decimal-digit limits from model tools', async () => {
  const tool = buildProviderTools({} as CopilotToolDeps).get_exchange_research
  const schema = tool.inputSchema as {
    parse: (value: unknown) => { limit: number }
  }
  expect(
    schema.parse({ venue: 'hyperliquid', action: 'market-stats', limit: '100' })
      .limit,
  ).toBe(100)
  for (const limit of ['', true, '1.5', '101', '0', '1e2'])
    expect(() =>
      schema.parse({ venue: 'hyperliquid', action: 'market-stats', limit }),
    ).toThrow()
})
