import { createHash } from 'node:crypto'

const SAFETY_TOKENS = 4096
const MIN_OUTPUT_TOKENS = 1024
const BUDGET_ERROR = /maximum context length of ([\d,]+) tokens\.\s*You requested a total of ([\d,]+) tokens:\s*([\d,]+) tokens from the input messages and ([\d,]+) tokens for the completion/i

export default function outputBudgetExtension(pi) {
  let request
  let recovery
  let retryUsed = false

  function reset() {
    request = undefined
    recovery = undefined
    retryUsed = false
  }

  pi.on('model_select', reset)
  pi.on('message_start', ({ message }) => {
    if (message.role === 'user') reset()
  })

  pi.on('before_provider_request', ({ payload }, ctx) => {
    if (payload?.max_tokens === 1 || payload?.max_completion_tokens === 1) return
    request = undefined
    if (ctx.model?.api !== 'openai-completions'
      || payload?.model !== ctx.model.id
      || !Array.isArray(payload.messages)) return

    const fields = ['max_tokens', 'max_completion_tokens'].filter((field) => {
      return Number.isSafeInteger(payload[field]) && payload[field] > 0
    })
    if (fields.length !== 1) return
    const [field] = fields
    const signature = createHash('sha256').update(JSON.stringify({
      ...payload,
      max_tokens: undefined,
      max_completion_tokens: undefined,
    })).digest('hex')
    if (recovery?.signature !== signature
      || recovery.provider !== ctx.model.provider) recovery = undefined
    const maxTokens = recovery
      ? Math.min(payload[field], recovery.maxTokens)
      : payload[field]
    if (recovery) recovery.pending = false
    request = {
      provider: ctx.model.provider,
      model: payload.model,
      signature,
      maxTokens,
    }
    if (maxTokens !== payload[field]) return { ...payload, [field]: maxTokens }
  })

  pi.on('turn_end', (event, ctx) => {
    const { message } = event
    if (message.role !== 'assistant') return
    if (message.stopReason !== 'error') {
      reset()
      return
    }
    if (retryUsed || !request || ctx.signal?.aborted
      || message.api !== 'openai-completions'
      || message.provider !== request.provider
      || message.model !== request.model
      || ctx.model?.provider !== request.provider
      || ctx.model?.id !== request.model
      || message.content.length || event.toolResults.length) return

    const match = message.errorMessage?.match(BUDGET_ERROR)
    if (!match) return
    const [limit, total, input, output] = match.slice(1).map((value) => {
      return Number(value.replaceAll(',', ''))
    })
    if (![limit, total, input, output].every(Number.isSafeInteger)
      || input < 0 || limit <= 0 || total !== input + output
      || total <= limit || output !== request.maxTokens) return

    const maxTokens = Math.min(ctx.model.maxTokens, limit - input - SAFETY_TOKENS)
    if (!Number.isSafeInteger(maxTokens)
      || maxTokens < MIN_OUTPUT_TOKENS || maxTokens >= output) return
    retryUsed = true
    recovery = { ...request, maxTokens, pending: true }
    return {
      entries: [
        ...event.entries,
        { type: 'context_edit', targetId: event.messageEntryId, replacement: null },
      ],
    }
  })

  pi.on('agent_before_settle', (event, ctx) => {
    if (!recovery?.pending) return
    if (event.outcome !== 'error' || !event.context.canContinue || ctx.signal?.aborted) {
      recovery = undefined
      return
    }
    recovery.pending = false
    return { continue: true }
  })
}
