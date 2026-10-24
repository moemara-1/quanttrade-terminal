// Copyright (c) 2026 Juan Ignacio Molina Estrada
// SPDX-License-Identifier: FSL-1.1-Apache-2.0
import { loadOpenAiCompatible } from '../lib/ai-sdk-lazy'
import { streamOpenAiCompatible } from '../lib/inference-sse'
import { executeNanogptTool, nanogptWebSearch } from './tools'
import { fetchNanogptWithRecovery } from './network-recovery'
import { fetchNanogptOnServer } from './server-fetch'
import type { InferenceMessage } from '@pairlens/shared/plugin-types'
import type {
  PluginExecuteParams,
  PluginInstance,
  PluginManifest,
} from '@pairlens/plugin-system/types'

// NanoGPT BYOK provider: direct browser requests and the host-run agentic loop.
// Model access and tool support depend on the selected NanoGPT model.

const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1'
const DEFAULT_MODEL = 'minimax/minimax-m2.7'

export const nanogptInferenceManifest: PluginManifest = {
  id: 'nanogpt-inference',
  name: 'NanoGPT',
  icon: '/posters/nanogpt-inference.svg',
  version: '0.1.0',
  author: 'Pairlens',
  description:
    'AI inference via NanoGPT: use your API key and choose a model from its catalog',
  homepage: 'https://nano-gpt.com',
  metadata: { family: 'ai-byok' },
  capabilities: [
    {
      id: 'ai:web-search',
      singleton: false,
      markets: ['*'],
      priority: 10,
      streaming: false,
    },
    {
      id: 'ai:inference',
      singleton: false,
      markets: ['*'],
      priority: 10,
      streaming: false,
    },
  ],
  config: {
    apiKey: {
      type: 'secret',
      label: 'NanoGPT API Key',
      required: true,
    },
    model: {
      type: 'string',
      label: 'Model ID from the NanoGPT model catalog',
      required: false,
      default: DEFAULT_MODEL,
    },
    serverBacked: {
      type: 'boolean',
      label:
        'Keep assistant responses on the QuantTrade server (sends your NanoGPT key and chat there; key is not saved)',
      required: false,
      default: false,
    },
  },
}

type InferenceResult = {
  content: string
  model: string
  usage: {
    promptTokens: number
    completionTokens: number
  }
}

export function createNanogptInferencePlugin(
  manifest: PluginManifest,
): PluginInstance {
  let config: Record<string, unknown> = {}

  function configuredModel(): string {
    const model = String(config['model'] ?? '').trim()
    return model || DEFAULT_MODEL
  }

  async function execute(params: PluginExecuteParams): Promise<unknown> {
    const { capability, params: p } = params

    if (capability === 'ai:web-search')
      return nanogptWebSearch(p, String(config['apiKey'] ?? ''))
    if (capability === 'ai:inference' && p['action'] !== undefined)
      return executeNanogptTool(p, String(config['apiKey'] ?? ''))
    if (capability !== 'ai:inference') {
      throw new Error(
        `nanogpt-inference: unsupported capability '${capability}'`,
      )
    }

    const model = configuredModel()
    const messages = p['messages'] as Array<InferenceMessage>
    const temperature =
      p['temperature'] !== undefined ? Number(p['temperature']) : 0.7
    const maxTokens =
      p['maxTokens'] !== undefined ? Number(p['maxTokens']) : 1024

    try {
      const response = await fetch(`${NANOGPT_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${String(config['apiKey'] ?? '')}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      })

      if (!response.ok) {
        return {
          content: `NanoGPT API error ${response.status}: check your key, balance and model access`,
          model,
          usage: { promptTokens: 0, completionTokens: 0 },
        } satisfies InferenceResult
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>
        model: string
        usage?: { prompt_tokens: number; completion_tokens: number }
      }

      return {
        content: data.choices[0]?.message.content ?? '',
        model: data.model,
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
        },
      } satisfies InferenceResult
    } catch (err) {
      return {
        content: `nanogpt-inference error: ${err instanceof Error ? err.message : String(err)}`,
        model,
        usage: { promptTokens: 0, completionTokens: 0 },
      } satisfies InferenceResult
    }
  }

  function subscribe(
    params: PluginExecuteParams,
    callback: (data: unknown) => void,
  ): () => void {
    if (params.capability !== 'ai:inference') {
      throw new Error(
        `nanogpt-inference: unsupported capability '${params.capability}'`,
      )
    }
    const p = params.params
    return streamOpenAiCompatible({
      url: `${NANOGPT_BASE_URL}/chat/completions`,
      apiKey: String(config['apiKey'] ?? ''),
      model: configuredModel(),
      messages: p['messages'] as Array<InferenceMessage>,
      temperature:
        p['temperature'] !== undefined ? Number(p['temperature']) : undefined,
      maxTokens:
        p['maxTokens'] !== undefined ? Number(p['maxTokens']) : undefined,
      onEvent: (event) =>
        callback(
          event.type === 'error'
            ? {
                ...event,
                message:
                  'NanoGPT request failed. Check your key, balance and model access.',
              }
            : event,
        ),
    })
  }

  // AI SDK model for the host-run agentic loop (copilot tools + research).
  // The user-selected model serves both purposes.
  async function getLanguageModel(): Promise<unknown> {
    const createOpenAICompatible = await loadOpenAiCompatible()
    const modelFetch =
      config['serverBacked'] === true
        ? fetchNanogptOnServer
        : fetchNanogptWithRecovery
    return createOpenAICompatible({
      name: 'nanogpt',
      baseURL: NANOGPT_BASE_URL,
      apiKey: String(config['apiKey'] ?? ''),
      fetch: Object.assign(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          // DeepSeek thinking requires this field on every assistant turn
          // when tools are present. The generic SDK omits empty reasoning,
          // including text-only history produced before a provider switch.
          // Preserve supplied reasoning exactly; an absent value stays empty.
          if (typeof init?.body === 'string') {
            const body: Record<string, unknown> = JSON.parse(init.body)
            if (
              /^deepseek\//i.test(String(body.model)) &&
              /:thinking(?:$|:)/i.test(String(body.model)) &&
              Array.isArray(body.tools) &&
              body.tools.length > 0 &&
              Array.isArray(body.messages)
            ) {
              body.messages = body.messages.map((message: unknown) => {
                if (typeof message !== 'object' || message === null)
                  return message
                const record = message as Record<string, unknown>
                if (record.role !== 'assistant') return record
                return {
                  ...record,
                  reasoning_content:
                    typeof record.reasoning_content === 'string'
                      ? record.reasoning_content
                      : typeof record.reasoning === 'string'
                        ? record.reasoning
                        : '',
                }
              })
              return modelFetch(url, {
                ...init,
                body: JSON.stringify(body),
              })
            }
          }
          return modelFetch(url, init)
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    }).chatModel(configuredModel())
  }

  async function initialize(cfg: Record<string, unknown>): Promise<void> {
    // Without a key every request fails — refuse to activate so a keyless
    // install never wins ai:inference resolution or grants the copilot gate
    if (String(cfg['apiKey'] ?? '').trim() === '') {
      throw new Error('NanoGPT API key required: add it in the plugin settings')
    }
    config = { ...cfg, apiKey: String(cfg['apiKey']).trim() }
  }

  return {
    manifest,
    status: 'installed',
    config,
    execute,
    subscribe,
    getLanguageModel,
    initialize,
  }
}
