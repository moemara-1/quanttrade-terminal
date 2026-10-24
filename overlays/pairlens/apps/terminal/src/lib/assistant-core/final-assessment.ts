import { streamText } from 'ai'
import { boundAssistantModelHistory } from './model-history'
import type { LanguageModel, ModelMessage } from 'ai'

export async function synthesizeFinalAssessment(
  model: LanguageModel,
  history: Array<ModelMessage>,
  abortSignal?: AbortSignal,
): Promise<string> {
  const result = streamText({
    model,
    messages: boundAssistantModelHistory(history),
    maxOutputTokens: 4096,
    maxRetries: 0,
    abortSignal: abortSignal
      ? AbortSignal.any([abortSignal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000),
  })
  return result.text
}
