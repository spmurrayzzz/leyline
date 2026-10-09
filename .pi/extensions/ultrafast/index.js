import { calculateCost, cleanupSessionResources } from '@earendil-works/pi-ai'
import {
  supportsUltrafastWithAuth,
  ULTRAFAST_COMMAND,
  ULTRAFAST_STATUS_KEY,
} from '../../../lib/ultrafast.js'

export default function (pi) {
  let enabled = false
  let enabledModel
  let compacting = false
  let resetPending = false
  let request
  const responses = new Map()

  function available(ctx, model) {
    return Boolean(model) && supportsUltrafastWithAuth(
      model,
      ctx.modelRegistry.isUsingOAuth(model),
    )
  }

  function publish(ctx) {
    ctx.ui.setStatus(ULTRAFAST_STATUS_KEY, enabled ? 'on' : 'off')
  }

  function disable(ctx) {
    const cleanup = enabled || enabledModel
    enabled = false
    enabledModel = undefined
    resetPending = false
    request = undefined
    responses.clear()
    publish(ctx)
    if (cleanup) cleanupSessionResources(ctx.sessionManager.getSessionId())
  }

  function reset(_event, ctx) {
    if (enabled && ctx.signal) {
      resetPending = true
      return
    }
    disable(ctx)
  }

  pi.on('session_start', (_event, ctx) => {
    enabled = false
    enabledModel = undefined
    compacting = false
    resetPending = false
    request = undefined
    responses.clear()
    publish(ctx)
  })
  pi.on('model_select', reset)
  pi.on('session_before_compact', () => { compacting = true })
  pi.on('session_compact', () => { compacting = false })
  pi.on('session_compact_failed', () => { compacting = false })
  pi.on('session_tree', reset)
  pi.on('turn_start', (_event, ctx) => {
    if (resetPending) disable(ctx)
  })
  pi.on('turn_end', (_event, ctx) => {
    if (resetPending) disable(ctx)
  })
  pi.on('agent_settled', (_event, ctx) => {
    if (resetPending) disable(ctx)
  })
  pi.on('session_shutdown', () => {
    enabled = false
    enabledModel = undefined
    compacting = false
    resetPending = false
    request = undefined
    responses.clear()
  })

  pi.registerCommand(ULTRAFAST_COMMAND, {
    description: 'Set Ultrafast from the Leyline composer',
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) return
      if (!['on', 'off'].includes(args)
        || (args === 'on' && !available(ctx, ctx.model))) return
      if (args === 'off') {
        disable(ctx)
        return
      }
      if (!enabled) cleanupSessionResources(ctx.sessionManager.getSessionId())
      enabled = true
      enabledModel = ctx.model
      resetPending = false
      publish(ctx)
    },
  })

  pi.on('cache_warming_decision', () => {
    if (enabled) return { action: 'stop' }
  })

  pi.on('before_provider_headers', ({ headers }, ctx) => {
    if (resetPending) {
      disable(ctx)
      return
    }
    if (!enabled || !enabledModel || compacting || !ctx.signal) return
    if (enabledModel.provider === 'openai-codex') {
      headers['x-codex-routing-hint'] = `model=${enabledModel.id};tier=ultrafast`
    } else if (enabledModel.id === 'gpt-6-astra') {
      headers['OpenAI-Service-Tier'] = 'ultrafast'
    }
  })

  pi.on('before_provider_request', ({ payload }, ctx) => {
    request = undefined
    const model = enabled ? enabledModel : ctx.model
    if (compacting || !ctx.signal || !available(ctx, model)
      || payload?.model !== model.id) return
    request = { model, tier: enabled ? 'ultrafast' : payload.service_tier }
    if (enabled) return { ...payload, service_tier: 'ultrafast' }
  })

  pi.on('provider_stream_event', ({ provider, model, data }) => {
    if (!request || request.model.provider !== provider || request.model.id !== model
      || !['response.completed', 'response.done', 'response.incomplete'].includes(data?.type)
      || !data.response?.id) return
    const tier = data.response.service_tier
    const ultrafast = tier === 'ultrafast'
      || (provider === 'openai-codex' && request.tier === 'ultrafast'
        && (!tier || tier === 'default'))
    if (!ultrafast) return
    responses.set(data.response.id, request.model)
    if (responses.size > 16) responses.delete(responses.keys().next().value)
  })

  pi.on('message_end', ({ message }) => {
    if (message.role !== 'assistant') return
    const model = responses.get(message.responseId)
    responses.delete(message.responseId)
    if (!model || message.provider !== model.provider || message.model !== model.id
      || !message.usage) return
    const usage = { ...message.usage, cost: { ...message.usage.cost } }
    calculateCost(model, usage)
    for (const key of Object.keys(usage.cost)) usage.cost[key] *= 6
    return { message: { ...message, usage } }
  })
}
