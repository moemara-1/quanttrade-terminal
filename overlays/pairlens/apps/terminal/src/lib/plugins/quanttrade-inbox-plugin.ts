import { lazy } from 'react'
import type {
  PluginInstance,
  PluginManifest,
} from '@pairlens/plugin-system/types'

export const quanttradeInboxManifest: PluginManifest = {
  id: 'quanttrade-agent-inbox',
  name: 'QuantTrade Agent Inbox',
  icon: '/quanttrade-mark.svg?v=quanttrade-1',
  version: '0.1.0',
  author: 'QuantTrade',
  description: 'Review agent trade proposals before Hummingbot execution.',
  metadata: { family: 'cex-futures' },
  capabilities: [],
  config: {},
  contributes: {
    panels: [
      {
        id: 'agent-inbox',
        label: 'Agent Inbox',
        icon: 'Inbox',
        description:
          'Approve or reject Hyperliquid and Lighter trade proposals.',
        preview: 'table',
        category: 'trading',
        minHeight: 200,
        singleton: true,
      },
    ],
  },
}

export function createQuanttradeInboxPlugin(
  manifest: PluginManifest,
): PluginInstance {
  return {
    manifest,
    status: 'installed',
    config: {},
    async execute() {
      throw new Error(
        'Agent Inbox provides a review panel, not execution tools.',
      )
    },
    getContributedComponents: () => ({
      'agent-inbox': lazy(
        () => import('../../components/quanttrade/agent-inbox-pane'),
      ),
    }),
  }
}
