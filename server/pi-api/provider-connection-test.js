import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { isCustomProviderAdapter, streamResolvedProvider, supportsProviderFetch, withOptionalCredentials, wrapModelRuntime } from './custom-providers.js'
import { settingsError } from './pi-config.js'
import { waitForSettings } from './settings-operations.js'

const emptyCredentials = {
  async list() { return [] },
  async read() { return undefined },
  async modify() { throw new Error('Credential writes are unavailable') },
  async delete() { throw new Error('Credential writes are unavailable') },
}

function mergeMetadata(base, values) {
  return { ...base, ...values, ...(values.cost ? { cost: { ...base?.cost, ...values.cost } } : {}) }
}

function draftModel(source, body, configuration) {
  const provider = structuredClone(configuration.providers?.[body.providerId] || {})
  const draft = body.draft
  if (draft.type === 'provider') {
    for (const [key, value] of Object.entries(draft.values)) {
      if (value === null) delete provider[key]
      else provider[key] = value
    }
  } else if (draft.kind === 'override') {
    provider.modelOverrides ||= {}
    provider.modelOverrides[body.modelId] = mergeMetadata(provider.modelOverrides[body.modelId], draft.values)
  } else {
    const definitions = provider.models ||= []
    const index = definitions.findIndex((model) => model.id === body.modelId)
    const model = mergeMetadata(index < 0 ? { id: body.modelId } : definitions[index], draft.values)
    if (index < 0) definitions.push(model)
    else definitions[index] = model
  }
  const base = source.getModel(body.providerId, body.modelId)
  const definition = provider.models?.find((model) => model.id === body.modelId) || {}
  const overrides = provider.modelOverrides?.[body.modelId] || {}
  const model = mergeMetadata(mergeMetadata({
    id: body.modelId, name: body.modelId, provider: body.providerId,
    contextWindow: 32768, maxTokens: 16, input: ['text'], reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...base,
  }, definition), overrides)
  model.api = base?.api === 'pi-virtual' ? base.api : definition.api ?? provider.api ?? base?.api
  model.baseUrl = base?.api === 'pi-virtual' ? base.baseUrl : definition.baseUrl ?? provider.baseUrl ?? base?.baseUrl
  model.headers = { ...base?.headers, ...overrides.headers, ...definition.headers }
  model.compat = { ...provider.compat, ...base?.compat, ...definition.compat, ...overrides.compat }
  if (!model.api || (!model.baseUrl && model.api !== 'pi-virtual')) throw settingsError('Enter a base URL and API format before testing.')
  return { provider, model }
}

function checkTestSupport(model, resolution) {
  const subscription = model.api === 'openai-responses' && model.provider === 'openai'
    && (resolution?.auth.baseUrl || model.baseUrl) === 'https://api.openai.com/v1'
    && resolution?.auth.apiKey && !resolution.auth.apiKey.startsWith('sk-')
  const uncapped = model.api === 'openai-responses' && model.compat?.supportsMaxOutputTokens === false
  if (model.api === 'openai-codex-responses' || subscription || uncapped) throw settingsError('Connection tests are unavailable for this API because pi cannot enforce the test output limit.')
  if (model.api === 'bedrock-converse-stream') throw settingsError('Connection tests are unavailable for this API because pi cannot disable automatic retries.')
}

async function prepareDraft(source, body, configuration, signal) {
  const { provider, model } = draftModel(source, body, configuration)
  checkTestSupport(model)
  const native = source.getRegisteredNativeProvider(body.providerId)
  const extension = native && !isCustomProviderAdapter(source, body.providerId)
  const legacy = source.getRegisteredProviderConfig(body.providerId)
  const oauth = source.isUsingOAuth(body.providerId)
  const original = source.getModel(body.providerId, body.modelId)
  if (oauth && body.draft.type === 'provider' && ['baseUrl', 'api'].some((key) => Object.hasOwn(body.draft.values, key)
    && body.draft.values[key] !== configuration.providers?.[body.providerId]?.[key])) {
    throw settingsError('This provider controls its endpoint through OAuth. Draft endpoint changes cannot be tested with its stored OAuth credential.')
  }
  const template = wrapModelRuntime(await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, credentials: emptyCredentials, signal }))
  const values = Object.fromEntries(['name', 'baseUrl', 'api', 'apiKey', 'authHeader'].filter((key) => provider[key] !== undefined).map((key) => [key, provider[key]]))
  if (legacy) {
    for (const key of ['name', 'baseUrl', 'apiKey', 'api', 'authHeader', 'oauth', 'streamSimple']) {
      if (legacy[key] !== undefined) values[key] = legacy[key]
    }
  }
  values.headers = { ...provider.headers, ...legacy?.headers, ...model.headers }
  model.headers = undefined
  values.models = [model]
  template.registerProvider(body.providerId, values)
  const configured = withOptionalCredentials(template.getProvider(body.providerId))
  template.registerNativeProvider(configured)
  const runtime = wrapModelRuntime(await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, signal }))
  const baseline = extension ? native : provider.oauth ? source.getProvider(body.providerId) : configured
  runtime.registerNativeProvider({ ...baseline, refreshModels: undefined, getModels: () => [model], getAllModels: () => [model] })
  const replacement = body.draft.type === 'provider' && Object.hasOwn(body.draft.values, 'apiKey') && body.draft.values.apiKey !== null
  const stored = (await source.listCredentials({ signal })).some((entry) => entry.providerId === body.providerId)
  if (replacement || (extension && provider.apiKey !== undefined && !stored && source.getProviderAuthStatus(body.providerId).source !== 'runtime')) {
    const auth = await template.getAuth(model, { signal })
    if (!auth?.auth.apiKey) throw settingsError('The draft API key could not be resolved.')
    await runtime.setRuntimeApiKey(body.providerId, auth.auth.apiKey, { signal })
  }
  const resolution = !replacement && source.getProviderAuthStatus(body.providerId).source === 'runtime' && original
    ? await source.getAuth(original, { signal })
    : await runtime.getAuth(model, { signal })
  if (!resolution) throw settingsError('The provider could not resolve its authentication.')
  if (extension || provider.oauth) {
    const headers = await template.getAuth(model, { apiKey: resolution.auth.apiKey, env: resolution.env, signal })
    resolution.auth.headers = { ...resolution.auth.headers, ...headers?.auth.headers }
  }
  return { model, provider: extension && original?.api === model.api || provider.oauth ? baseline : configured, resolution }
}

function reportedStatus(message) {
  try {
    const status = JSON.parse(message)?.error?.code
    return Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined
  } catch { return undefined }
}

export async function testProviderConnection({ source, body, operation, configuration, assertProviderRoutes }) {
  const signal = AbortSignal.any([operation.signal, AbortSignal.timeout(30000)])
  const started = Date.now()
  let httpStatus
  let providerStatus
  try {
    const context = { messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }] }
    let model = body.draft ? draftModel(source, body, configuration).model : source.getModel(body.providerId, body.modelId)
    if (!model) throw settingsError('Save a valid model definition before testing the connection.', 404)
    const virtual = model.api === 'pi-virtual'
    if (virtual) {
      if (body.draft?.type === 'provider') throw settingsError('Choose a physical model to test draft connection settings.')
      for (const provider of source.getProviders()) {
        if (source.isUsingOAuth(provider.id)) assertProviderRoutes(provider.id, source, 'Connection test')
      }
      const route = await waitForSettings(source.resolveModel(model, context.messages, { reason: 'direct', thinkingLevel: 'off', signal }), signal)
      model = route.model
    }
    checkTestSupport(model)
    if (source.isUsingOAuth(model.provider)) assertProviderRoutes(model.provider, source, 'Connection test')
    const draft = body.draft && !virtual ? await waitForSettings(prepareDraft(source, body, configuration, signal), signal) : null
    const resolution = draft?.resolution || await waitForSettings(wrapModelRuntime(source).getAuth(model, { signal }), signal)
    if (!resolution) throw settingsError('The provider could not resolve its authentication.')
    checkTestSupport(model, resolution)
    const options = {
      signal, maxTokens: 16, maxRetries: 0, cacheRetention: 'none', transport: 'sse', timeoutMs: 30000,
      onResponse: ({ status }) => { httpStatus = status },
      ...(supportsProviderFetch(model.api) ? {
        fetch: async (input, init) => {
          const response = await globalThis.fetch(input, init)
          httpStatus = response.status
          return response
        },
      } : {}),
    }
    const response = await waitForSettings(streamResolvedProvider(draft?.provider || source.getProvider(model.provider), draft?.model || model, context, options, resolution).result(), signal)
    signal.throwIfAborted()
    if (['error', 'aborted'].includes(response.stopReason)) {
      providerStatus = reportedStatus(response.errorMessage)
      throw new Error('Connection test failed')
    }
    return { providerId: body.providerId, modelId: body.modelId, action: 'test', durationMs: Date.now() - started, ...(httpStatus ? { httpStatus } : {}) }
  } catch (error) {
    operation.signal.throwIfAborted()
    if (signal.aborted) throw settingsError('Connection test timed out after 30 seconds.', 408)
    if (error.statusCode) throw error
    const status = httpStatus >= 400 ? httpStatus : providerStatus
    if (status) {
      const detail = status === 401 ? ' Authentication is required or the credentials were rejected.' : status === 403 ? ' Access was denied.' : ''
      throw settingsError(`${httpStatus >= 400 ? 'Connection test failed: HTTP' : 'The provider reported error'} ${status}.${detail}`)
    }
    throw settingsError(httpStatus
      ? `The endpoint returned HTTP ${httpStatus}, but the model could not complete the test. Check the model ID and API format.`
      : 'The provider could not complete the connection test. Check the endpoint, model ID, API format, and credentials.')
  }
}
