export const ULTRAFAST_COMMAND = 'leyline-ultrafast'
export const ULTRAFAST_STATUS_KEY = 'leyline-ultrafast'

export function supportsUltrafast(model) {
  return ['gpt-6-astra', 'gpt-6.1-sol'].includes(model?.id)
    && ((model.provider === 'openai' && model.api === 'openai-responses')
      || (model.provider === 'openai-codex' && model.api === 'openai-codex-responses'))
}

export function supportsUltrafastWithAuth(model, subscription) {
  return supportsUltrafast(model) && !(model.provider === 'openai' && subscription)
}
