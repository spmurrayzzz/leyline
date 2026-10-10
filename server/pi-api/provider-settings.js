import { CredentialSynchronizationError, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { isSettingsObject, readPiConfig, settingsError, updatePiConfig } from './pi-config.js'
import { getBuiltinProviderIds, isCustomProviderAdapter, KEYLESS_AUTH_SOURCE, refreshCustomProviders } from './custom-providers.js'
import { testProviderConnection } from './provider-connection-test.js'
import { startSettingsOperation, waitForSettings, withProviderSettingsLock } from './settings-operations.js'

const file = 'models.json'
const providerFields = ['name', 'baseUrl', 'api', 'authHeader', 'apiKey']
const modelFields = ['name', 'contextWindow', 'maxTokens', 'reasoning', 'input', 'cost', 'thinkingLevelMap', 'compat']
const costFields = ['input', 'output', 'cacheRead', 'cacheWrite']
const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const apis = new Set(['openai-completions', 'mistral-conversations', 'openai-responses', 'azure-openai-responses', 'openai-codex-responses', 'anthropic-messages', 'bedrock-converse-stream', 'google-generative-ai', 'google-vertex', 'pi-messages'])
const authLabels = {
  stored: 'Stored credential', runtime: 'Runtime API key', environment: 'Environment or cloud credentials',
  fallback: 'Extension configuration', models_json_key: 'models.json API key', models_json_command: 'models.json command',
}
const emptyCredentials = {
  async list() { return [] },
  async read() { return undefined },
  async modify() { throw settingsError('Credential writes are unavailable') },
  async delete() { throw settingsError('Credential writes are unavailable') },
}

async function baseModels(runtime, providerId, configured) {
  const native = runtime.getRegisteredNativeProvider(providerId)
  if (native && !isCustomProviderAdapter(runtime, providerId)) return native.getAllModels?.() ?? native.getModels()
  if (!configured && !runtime.getRegisteredProviderConfig(providerId)) return runtime.getAllModels(providerId)
  const base = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, credentials: emptyCredentials })
  return base.getAllModels(providerId)
}

function object(value) {
  if (!isSettingsObject(value)) throw settingsError('Expected an object')
}

function fields(value, allowed) {
  object(value)
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw settingsError('Unsupported settings field')
}

function own(value, key) {
  return value && Object.hasOwn(value, key) ? value[key] : undefined
}

function text(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 32768 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw settingsError('Expected nonempty text without control characters')
  }
}

function id(value) {
  text(value)
  if (value.length > 512 || /\s/u.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) {
    throw settingsError('Invalid provider or model ID')
  }
}

function providerId(value) {
  id(value)
  if (value.includes('/')) throw settingsError('Provider IDs cannot contain /')
}

function positive(value) {
  if (!Number.isFinite(value) || value <= 0) throw settingsError('Token limits must be finite positive numbers')
}

function rate(value) {
  if (!Number.isFinite(value) || value < 0) throw settingsError('Costs must be finite nonnegative numbers')
}

function boolean(value) {
  if (typeof value !== 'boolean') throw settingsError('Expected a boolean')
}

function endpoint(value) {
  text(value)
  let url
  try { url = new URL(value) } catch { throw settingsError('Use an absolute HTTP or HTTPS base URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || value !== value.trim()) {
    throw settingsError('Base URLs cannot contain credentials, queries, or fragments')
  }
}

function safeEndpoint(value) {
  if (value === undefined) return ''
  try { endpoint(value); return value } catch { return '' }
}

function input(value) {
  if (!Array.isArray(value) || !value.length || value.some((item) => !['text', 'image'].includes(item)) || new Set(value).size !== value.length) {
    throw settingsError('Input must contain text and/or image without duplicates')
  }
}

function cost(value, complete = false) {
  object(value)
  for (const key of costFields) {
    if (complete || Object.hasOwn(value, key)) rate(value[key])
  }
}

function thinkingLevelMap(value) {
  object(value)
  for (const [level, entry] of Object.entries(value)) {
    if (!thinkingLevels.includes(level)) throw settingsError('Invalid thinking level')
    if (entry !== null && (typeof entry !== 'string' || !entry.trim() || entry !== entry.trim() || entry.length > 256 || /[\u0000-\u001f\u007f]/u.test(entry))) {
      throw settingsError('Thinking level values must be text without surrounding spaces or control characters')
    }
  }
}

function compat(value) {
  object(value)
  if (Object.hasOwn(value, 'supportsDeveloperRole') && value.supportsDeveloperRole !== null) boolean(value.supportsDeveloperRole)
}

function metadata(value) {
  object(value)
  if (Object.hasOwn(value, 'name')) text(value.name)
  for (const key of ['contextWindow', 'maxTokens']) if (Object.hasOwn(value, key)) positive(value[key])
  if (Object.hasOwn(value, 'reasoning')) boolean(value.reasoning)
  if (Object.hasOwn(value, 'input')) input(value.input)
  if (Object.hasOwn(value, 'cost')) cost(value.cost)
  if (Object.hasOwn(value, 'thinkingLevelMap')) thinkingLevelMap(value.thinkingLevelMap)
  if (Object.hasOwn(value, 'compat')) compat(value.compat)
}

function validateConfig(data) {
  try {
    object(data)
    object(data.providers)
    for (const provider of Object.values(data.providers)) {
      object(provider)
      if (Object.hasOwn(provider, 'models')) {
        if (!Array.isArray(provider.models)) throw settingsError('Invalid models array')
        const ids = new Set()
        for (const model of provider.models) {
          object(model)
          if (typeof model.id !== 'string' || !model.id.length) throw settingsError('Invalid model ID')
          if (ids.has(model.id)) throw settingsError('Duplicate model ID')
          ids.add(model.id)
          if (Object.hasOwn(model, 'cost')) object(model.cost)
        }
      }
      if (Object.hasOwn(provider, 'modelOverrides')) {
        object(provider.modelOverrides)
        for (const override of Object.values(provider.modelOverrides)) {
          object(override)
          if (Object.hasOwn(override, 'cost')) object(override.cost)
        }
      }
    }
  } catch {
    throw settingsError('models.json contains invalid provider or model configuration. Repair it before saving.', 409)
  }
}

function validateProvider(provider, base, extension) {
  if (provider?.oauth && !provider.baseUrl) throw settingsError('OAuth requires a base URL')
  if (provider && !provider.models?.length && !provider.baseUrl && !provider.headers && !provider.compat
    && !Object.keys(provider.modelOverrides || {}).length && !provider.apiKey && !provider.oauth && provider.authHeader === undefined) {
    throw settingsError('Provider configuration has no supported settings')
  }
  provider ||= {}
  const defaults = base.filter((model) => !model.type || model.type === 'chat')
    .map((model) => ({ ...model, baseUrl: provider.oauth === 'radius' ? model.baseUrl : provider.baseUrl ?? model.baseUrl }))
  for (const model of provider.models || []) {
    const api = model.api ?? provider.api
    const fallback = defaults.find((entry) => entry.id === model.id) ?? defaults.find((entry) => entry.api === api)
      ?? defaults.find((entry) => entry.api === 'openai-completions') ?? defaults[0]
    const effective = { id: model.id, api: api ?? fallback?.api, baseUrl: model.baseUrl ?? provider.baseUrl ?? fallback?.baseUrl }
    if (typeof effective.api !== 'string' || !effective.api.length || typeof effective.baseUrl !== 'string' || !effective.baseUrl.length) {
      throw settingsError('Custom models require an API and base URL')
    }
    const index = defaults.findIndex((entry) => entry.id === model.id)
    if (index < 0) defaults.push(effective)
    else defaults[index] = effective
  }
  for (const model of extension?.models || []) {
    const type = model.type || 'chat'
    const candidates = type === 'chat' ? defaults : base.filter((entry) => entry.type === type)
    const fallback = candidates.find((entry) => entry.id === model.id) ?? candidates.find((entry) => entry.api === model.api)
      ?? (type === 'chat' ? candidates.find((entry) => entry.api === 'openai-completions') : undefined) ?? candidates[0]
    if (!(model.api ?? (type === 'chat' ? extension.api : undefined) ?? fallback?.api)
      || !(model.baseUrl ?? extension.baseUrl ?? (fallback && provider.baseUrl) ?? fallback?.baseUrl)) {
      throw settingsError('These changes would remove defaults required by a provider extension')
    }
  }
}

function safeMetadata(value = {}) {
  const result = {}
  if (typeof value.name === 'string') result.name = value.name
  for (const key of ['contextWindow', 'maxTokens']) if (Number.isFinite(value[key]) && value[key] > 0) result[key] = value[key]
  if (typeof value.reasoning === 'boolean') result.reasoning = value.reasoning
  if (Array.isArray(value.input)) result.input = value.input.filter((entry) => ['text', 'image'].includes(entry))
  if (isSettingsObject(value.thinkingLevelMap)) {
    const map = Object.fromEntries(thinkingLevels
      .filter((level) => value.thinkingLevelMap[level] === null || typeof value.thinkingLevelMap[level] === 'string')
      .map((level) => [level, value.thinkingLevelMap[level]]))
    if (Object.keys(map).length) result.thinkingLevelMap = map
  }
  if (isSettingsObject(value.compat) && typeof value.compat.supportsDeveloperRole === 'boolean') {
    result.compat = { supportsDeveloperRole: value.compat.supportsDeveloperRole }
  }
  if (isSettingsObject(value.cost)) {
    result.cost = Object.fromEntries(costFields.filter((key) => Number.isFinite(value.cost[key]) && value.cost[key] >= 0).map((key) => [key, value.cost[key]]))
    if (Array.isArray(value.cost.tiers)) {
      result.cost.tiers = value.cost.tiers.filter((tier) => isSettingsObject(tier) && Number.isFinite(tier.inputTokensAbove) && tier.inputTokensAbove >= 0)
        .map((tier) => ({ inputTokensAbove: tier.inputTokensAbove, ...Object.fromEntries(costFields.filter((key) => Number.isFinite(tier[key]) && tier[key] >= 0).map((key) => [key, tier[key]])) }))
    }
  }
  return result
}

function authMethods(provider) {
  const methods = []
  if (typeof provider?.auth?.oauth?.login === 'function') methods.push({ id: 'oauth', label: provider.auth.oauth.loginLabel || provider.auth.oauth.name || 'OAuth' })
  if (typeof provider?.auth?.apiKey?.login === 'function') methods.push({ id: 'api_key', label: provider.auth.apiKey.name || 'API key' })
  return methods.map(({ id, label }) => ({ id, label: typeof label === 'string' ? label : id }))
}

function combineWarnings(...warnings) {
  return [...new Set(warnings.filter(Boolean))].join(' ') || undefined
}

export function createProviderSettings({ getRuntime, assertProviderRoutes }) {
  async function inventory(runtime, config, warning, signal) {
    const builtins = await getBuiltinProviderIds()
    const extensions = new Set(runtime.getRegisteredProviderIds())
    const providers = new Map(runtime.getProviders().map((provider) => [provider.id, provider]))
    let credentials = []
    try { credentials = await runtime.listCredentials({ signal }) } catch { signal?.throwIfAborted(); warning = combineWarnings(warning, 'Stored credential metadata could not be read.') }
    const stored = new Map(credentials.map((credential) => [credential.providerId, credential.type]))
    let valid = true
    try { validateConfig(config.data) } catch { valid = false; warning = combineWarnings(warning, 'models.json is invalid. Configuration writes are blocked until it is repaired.') }
    if (runtime.getError()) warning = combineWarnings(warning, 'Pi reported a configuration or catalog error. The catalog may be incomplete.')
    const configuredProviders = valid ? config.data.providers : {}
    const ids = new Set([...providers.keys(), ...Object.keys(configuredProviders), ...stored.keys()])
    const rows = await Promise.all([...ids].map(async (providerId) => {
      const provider = providers.get(providerId)
      const config = own(configuredProviders, providerId) || {}
      const customAdapter = isCustomProviderAdapter(runtime, providerId)
      const keyless = customAdapter && (await waitForSettings(runtime.checkAuth(providerId, { signal }), signal))?.source === KEYLESS_AUTH_SOURCE
      const status = runtime.getProviderAuthStatus(providerId)
      const source = status.source === 'runtime' ? 'runtime' : stored.has(providerId) ? 'stored' : status.source !== 'stored' && Object.hasOwn(authLabels, status.source) ? status.source : null
      const custom = new Map((config.models || []).map((model) => [model.id, model]))
      const overrides = config.modelOverrides || {}
      const models = new Map(runtime.getModels(providerId).map((model) => [model.id, model]))
      for (const [modelId, model] of custom) if (!models.has(modelId)) models.set(modelId, model)
      for (const modelId of Object.keys(overrides)) if (!models.has(modelId)) models.set(modelId, { id: modelId })
      return {
        id: providerId,
        name: typeof provider?.name === 'string' && provider.name ? provider.name : typeof config.name === 'string' && config.name ? config.name : providerId,
        kind: extensions.has(providerId) && !customAdapter ? 'extension' : builtins.has(providerId) ? 'builtin' : Object.hasOwn(configuredProviders, providerId) || !provider ? 'custom' : 'extension',
        configured: Boolean(customAdapter || (status.configured && status.source !== 'stored') || stored.has(providerId)),
        authSource: source,
        authLabel: keyless ? config.headers && Object.keys(config.headers).length ? 'Custom headers; no API key set' : 'No API key set' : source === 'stored' ? stored.get(providerId) === 'oauth' ? 'Stored OAuth credential' : 'Stored API key' : authLabels[source] || 'Not configured',
        authMethods: authMethods(provider),
        config: {
          name: typeof config.name === 'string' ? config.name : '', baseUrl: safeEndpoint(config.baseUrl), api: typeof config.api === 'string' ? config.api : '',
          authHeader: typeof config.authHeader === 'boolean' ? config.authHeader : null, apiKeyConfigured: Object.hasOwn(config, 'apiKey'),
          headersConfigured: Boolean(config.headers && Object.keys(config.headers).length), canEdit: valid,
          hasConfiguration: Object.hasOwn(configuredProviders, providerId),
        },
        models: [...models].map(([modelId, model]) => ({
          id: modelId, name: modelId, contextWindow: null, maxTokens: null, reasoning: false, input: [], cost: {},
          ...safeMetadata(model),
          kind: custom.has(modelId) ? 'custom' : Object.hasOwn(overrides, modelId) ? 'override' : 'catalog',
          overrides: safeMetadata(own(overrides, modelId)),
        })).sort((a, b) => a.id.localeCompare(b.id)),
        ...(!provider && Object.hasOwn(configuredProviders, providerId) ? { error: 'This provider is not loaded in the selected runtime.' } : {}),
      }
    }))
    rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    return { revision: config.revision, providers: rows, ...(warning ? { warning } : {}) }
  }

  async function list(target, options = {}) {
    return withProviderSettingsLock(async (signal) => {
      const lease = await getRuntime(target, { ...options, signal })
      try {
        let config
        try { config = await readPiConfig(file) } catch {
          return await inventory(lease.modelRuntime, { revision: null, data: null }, 'models.json could not be read. Configuration writes are blocked.', signal)
        }
        return await inventory(lease.modelRuntime, config, undefined, signal)
      } finally {
        lease.release()
      }
    }, AbortSignal.timeout(15000))
  }

  async function refresh(runtime, providerId, options = {}) {
    try {
      const signal = AbortSignal.any([options.signal, AbortSignal.timeout(15000)].filter(Boolean))
      const result = await refreshCustomProviders(runtime, { allowNetwork: false, providers: [providerId], ...options, signal })
      if (result.aborted || result.errors.size || runtime.getError()) return 'The catalog could not be fully refreshed.'
    } catch { return 'The catalog could not be refreshed.' }
  }

  async function write(target, providerId, revision, makeChanges) {
    return withProviderSettingsLock(async (signal) => {
      const lease = await getRuntime(target, { signal })
      const { modelRuntime } = lease
      try {
        const saved = await updatePiConfig(file, revision, async (data) => {
          signal.throwIfAborted()
          validateConfig(data)
          const patches = await makeChanges(data, modelRuntime)
          const candidate = structuredClone(data)
          for (const patch of patches) {
            let parent = candidate
            for (let index = 0; index < patch.path.length - 1; index++) {
              const key = patch.path[index]
              if (!Object.hasOwn(parent, key)) parent[key] = typeof patch.path[index + 1] === 'number' ? [] : {}
              parent = parent[key]
            }
            const key = patch.path.at(-1)
            if (patch.value === undefined) {
              if (Array.isArray(parent)) parent.splice(key, 1)
              else delete parent[key]
            } else if (Array.isArray(parent) && key === -1) parent.push(patch.value)
            else parent[key] = patch.value
          }
          const provider = own(candidate.providers, providerId)
          if (provider?.modelOverrides) {
            for (const [modelId, override] of Object.entries(provider.modelOverrides)) {
              if (isSettingsObject(override) && !Object.keys(override).length) {
                delete provider.modelOverrides[modelId]
                patches.push({ path: ['providers', providerId, 'modelOverrides', modelId], value: undefined })
              }
            }
          }
          if (provider && Object.entries(provider).every(([key, value]) => ['models', 'modelOverrides'].includes(key) && Object.keys(value).length === 0)) {
            delete candidate.providers[providerId]
            patches.push({ path: ['providers', providerId], value: undefined })
          }
          const previous = own(data.providers, providerId)
          if ((previous?.oauth === 'radius' || providerId === 'radius')
            && previous?.baseUrl !== provider?.baseUrl) {
            throw settingsError('Pi retains cached Radius gateway URLs. Use a new provider ID for a different gateway; the existing base URL cannot be changed or removed.', 409)
          }
          try {
            validateConfig(candidate)
            const defaults = await baseModels(modelRuntime, providerId, Object.hasOwn(data.providers, providerId))
            validateProvider(own(candidate.providers, providerId), defaults, modelRuntime.getRegisteredProviderConfig(providerId))
          } catch {
            throw settingsError('These changes would leave invalid provider or model configuration')
          }
          return patches
        })
        const warning = await refresh(modelRuntime, providerId, { signal })
        return await inventory(modelRuntime, saved, warning, signal)
      } finally {
        lease.release()
      }
    }, AbortSignal.timeout(15000))
  }

  async function saveProvider(target, body) {
    fields(body, ['id', 'revision', 'create', 'values'])
    providerId(body.id)
    if (body.create !== undefined) boolean(body.create)
    fields(body.values, providerFields)
    if (!Object.keys(body.values).length) throw settingsError('No provider changes supplied')
    for (const [key, value] of Object.entries(body.values)) {
      if (key === 'apiKey' && value === null) continue
      if (key === 'authHeader') boolean(value)
      else if (key === 'baseUrl') endpoint(value)
      else text(value)
      if (key === 'apiKey' && value.startsWith('!') && !value.slice(1).trim()) throw settingsError('An API-key command cannot be empty')
    }
    return write(target, body.id, body.revision, async (data, runtime) => {
      const existing = Object.hasOwn(data.providers, body.id)
      const provider = runtime.getProvider(body.id)
      if (body.create && (existing || provider || (await getBuiltinProviderIds()).has(body.id))) throw settingsError('Provider ID already exists', 409)
      if (!body.create && !existing && !provider) throw settingsError('Provider does not exist', 404)
      if (body.values.api !== undefined && !apis.has(body.values.api) && !runtime.getModels(body.id).some((model) => model.api === body.values.api)) {
        throw settingsError('Unsupported provider API')
      }
      if (body.create) {
        if (!body.values.baseUrl || !body.values.api) throw settingsError('A custom provider requires baseUrl and api')
        return [{ path: ['providers', body.id], value: { ...Object.fromEntries(Object.entries(body.values).filter(([, value]) => value !== null)), models: [] } }]
      }
      return Object.entries(body.values).map(([key, value]) => ({ path: ['providers', body.id, key], value: value === null ? undefined : value }))
    })
  }

  async function deleteProvider(target, body) {
    fields(body, ['id', 'revision'])
    providerId(body.id)
    return write(target, body.id, body.revision, (data) => {
      if (!Object.hasOwn(data.providers, body.id)) throw settingsError('Provider has no configuration to remove', 404)
      return [{ path: ['providers', body.id], value: undefined }]
    })
  }

  function modelRequest(body, saving) {
    fields(body, ['providerId', 'modelId', 'revision', 'kind', ...(saving ? ['create', 'values'] : [])])
    providerId(body.providerId)
    id(body.modelId)
    if (!['custom', 'override'].includes(body.kind)) throw settingsError('Select a custom model or an override')
    if (saving) {
      if (body.create !== undefined) boolean(body.create)
      fields(body.values, ['id', ...modelFields])
      if (!body.create && !Object.keys(body.values).length) throw settingsError('No model changes supplied')
      if (Object.hasOwn(body.values, 'id') && body.values.id !== body.modelId) throw settingsError('Model IDs cannot be renamed')
      if (Object.hasOwn(body.values, 'cost')) fields(body.values.cost, costFields)
      if (Object.hasOwn(body.values, 'compat')) fields(body.values.compat, ['supportsDeveloperRole'])
      metadata(body.values)
    }
  }

  async function saveModel(target, body) {
    modelRequest(body, true)
    return write(target, body.providerId, body.revision, (data, runtime) => {
      const config = own(data.providers, body.providerId)
      if (!config && !runtime.getProvider(body.providerId)) throw settingsError('Provider does not exist', 404)
      const index = config?.models?.findIndex((model) => model.id === body.modelId) ?? -1
      const existing = body.kind === 'custom' ? index >= 0 : Object.hasOwn(config?.modelOverrides || {}, body.modelId)
      if (body.create && existing) throw settingsError('Model configuration already exists', 409)
      if (!body.create && !existing) throw settingsError('Model configuration does not exist', 404)
      const catalog = runtime.getModel(body.providerId, body.modelId)
      if (body.kind === 'override' && index >= 0) throw settingsError('Edit this model as a custom definition')
      if (body.kind === 'override' && !existing && !catalog) throw settingsError('Only catalog models can receive a new override')
      if (body.kind === 'custom' && !existing && catalog) throw settingsError('Use an override for an existing catalog model', 409)
      if (body.kind === 'custom' && !existing && (!config?.baseUrl || !config?.api)) {
        throw settingsError('Set the provider baseUrl and api before adding a custom model')
      }
      const values = Object.fromEntries(Object.entries(body.values).filter(([key]) => key !== 'id'))
      if (body.kind === 'override' && !existing) {
        if (values.compat?.supportsDeveloperRole === null) delete values.compat
        if (values.thinkingLevelMap && !Object.keys(values.thinkingLevelMap).length) delete values.thinkingLevelMap
      }
      if (!Object.keys(values).length && body.kind === 'override') throw settingsError('No override changes supplied')
      if (body.kind === 'custom' && !existing) {
        if (values.cost) cost(values.cost, true)
        if (values.thinkingLevelMap && !Object.keys(values.thinkingLevelMap).length) delete values.thinkingLevelMap
        if (values.compat && (values.compat.supportsDeveloperRole === null || !Object.keys(values.compat).length)) delete values.compat
        return [{ path: ['providers', body.providerId, 'models', -1], value: { id: body.modelId, ...values } }]
      }
      if (body.kind === 'custom' && values.cost) {
        const original = config.models[index].cost
        for (const key of costFields) {
          if (!Object.hasOwn(values.cost, key) && !Object.hasOwn(original || {}, key)) {
            const amount = catalog?.cost?.[key] ?? 0
            if (!Number.isFinite(amount)) throw settingsError('Effective model costs are unavailable')
            values.cost = { ...values.cost, [key]: amount }
          }
        }
      }
      const holder = body.kind === 'custom' ? config.models[index] : config?.modelOverrides?.[body.modelId]
      const path = ['providers', body.providerId, ...(body.kind === 'custom' ? ['models', index] : ['modelOverrides', body.modelId])]
      return Object.entries(values).flatMap(([key, value]) => {
        if (key === 'cost') return Object.entries(value).map(([rate, amount]) => ({ path: [...path, 'cost', rate], value: amount }))
        if (key === 'thinkingLevelMap') return [{ path: [...path, 'thinkingLevelMap'], value: Object.keys(value).length ? value : undefined }]
        if (key === 'compat') {
          const existingCompat = isSettingsObject(holder?.compat) ? holder.compat : {}
          if (value.supportsDeveloperRole === null) {
            const remaining = Object.keys(existingCompat).filter((entry) => entry !== 'supportsDeveloperRole')
            return [{ path: remaining.length ? [...path, 'compat', 'supportsDeveloperRole'] : [...path, 'compat'], value: undefined }]
          }
          return [{ path: [...path, 'compat', 'supportsDeveloperRole'], value: value.supportsDeveloperRole }]
        }
        return [{ path: [...path, key], value }]
      })
    })
  }

  async function deleteModel(target, body) {
    modelRequest(body, false)
    return write(target, body.providerId, body.revision, (data) => {
      const config = own(data.providers, body.providerId)
      if (body.kind === 'override') {
        if (!Object.hasOwn(config?.modelOverrides || {}, body.modelId)) throw settingsError('Model override does not exist', 404)
        return [{ path: ['providers', body.providerId, 'modelOverrides', body.modelId], value: undefined }]
      }
      const index = config?.models?.findIndex((model) => model.id === body.modelId) ?? -1
      if (index < 0) throw settingsError('Custom model does not exist', 404)
      return [{ path: ['providers', body.providerId, 'models', index], value: undefined }]
    })
  }

  async function action(target, body) {
    fields(body, ['providerId', 'action', 'authType', 'modelId', 'draft'])
    providerId(body.providerId)
    if (!['login', 'logout', 'refresh', 'test'].includes(body.action)) throw settingsError('Unsupported provider action')
    if (body.authType !== undefined && !['api_key', 'oauth'].includes(body.authType)) throw settingsError('Unsupported authentication method')
    if (body.action === 'test') {
      id(body.modelId)
      if (body.draft !== undefined) {
        fields(body.draft, ['type', 'create', 'revision', 'values', 'kind'])
        if (!['provider', 'model'].includes(body.draft.type)) throw settingsError('Invalid connection-test draft')
        boolean(body.draft.create)
        if (body.draft.type === 'provider') {
          fields(body.draft.values, providerFields)
          for (const [key, value] of Object.entries(body.draft.values)) {
            if (key === 'apiKey' && value === null) continue
            if (key === 'authHeader') boolean(value)
            else if (key === 'baseUrl') endpoint(value)
            else text(value)
          }
        } else {
          fields(body.draft.values, modelFields)
          if (!['custom', 'override'].includes(body.draft.kind)) throw settingsError('Invalid model draft kind')
          metadata(body.draft.values)
          if (Object.hasOwn(body.draft.values, 'cost')) fields(body.draft.values.cost, costFields)
          if (Object.hasOwn(body.draft.values, 'compat')) fields(body.draft.values.compat, ['supportsDeveloperRole'])
        }
      }
    } else if (body.modelId !== undefined || body.draft !== undefined) throw settingsError('Model drafts are only supported for a connection test')
    return startSettingsOperation(`provider:${body.providerId}`, (operation) => withProviderSettingsLock(async (signal) => {
      const lease = await getRuntime(target, { refresh: body.action === 'refresh', signal })
      const { modelRuntime, settingsManager } = lease
      try {
        const provider = modelRuntime.getProvider(body.providerId)
        if (!provider && !(body.action === 'test' && body.draft?.type === 'provider' && body.draft.create)) {
          if (body.action !== 'logout') throw settingsError('Provider does not exist', 404)
          let credentials
          try { credentials = await modelRuntime.listCredentials({ signal }) } catch { throw settingsError('Stored credential metadata could not be read', 503) }
          if (!credentials.some((credential) => credential.providerId === body.providerId)) throw settingsError('Provider does not exist', 404)
        }
        if (body.action === 'login') {
          if (!authMethods(provider).some((method) => method.id === body.authType)) throw settingsError('Authentication method is not available')
          assertProviderRoutes(body.providerId, modelRuntime)
        }
        if (body.action === 'test') {
          let configuration
          if (body.draft) {
            const current = await readPiConfig(file)
            if (body.draft.revision !== current.revision) throw settingsError('The configuration changed. Refresh settings before testing the draft.', 409)
            validateConfig(current.data)
            configuration = current.data
            if (body.draft.type === 'provider' && body.draft.values.api !== undefined
              && !apis.has(body.draft.values.api) && !modelRuntime.getModels(body.providerId).some((model) => model.api === body.draft.values.api)) throw settingsError('Unsupported provider API')
            if (body.draft.type === 'provider' && body.draft.create && (provider || Object.hasOwn(configuration.providers, body.providerId))) throw settingsError('Provider ID already exists', 409)
          }
          return await testProviderConnection({ source: modelRuntime, body, operation, configuration, assertProviderRoutes })
        }
        return await runAction(body, operation, signal, modelRuntime, settingsManager)
      } finally {
        lease.release()
      }
    }, operation.signal))
  }

  async function runAction(body, operation, signal, modelRuntime, settingsManager) {
    let warning
    if (body.action !== 'refresh') {
      try {
        if (body.action === 'login') {
          await modelRuntime.login(body.providerId, body.authType, {
            signal, prompt: operation.prompt, notify: operation.notify,
          }, { getDeviceId: () => settingsManager.getOrCreateDeviceId() })
        } else await modelRuntime.logout(body.providerId, { signal })
      } catch (error) {
        if (error instanceof CredentialSynchronizationError) {
          warning = 'The credential change was saved, but Pi could not synchronize its local catalog.'
        } else {
          signal.throwIfAborted()
          throw settingsError(operation.redact('Authentication failed. The credential change could not be confirmed.'))
        }
      }
    }
    try {
      await settingsManager.flush()
      if (settingsManager.drainErrors().length) warning = combineWarnings(warning, 'Pi could not save its installation settings.')
    } catch {
      warning = combineWarnings(warning, 'Pi could not save its installation settings.')
    }
    warning = combineWarnings(warning, await refresh(modelRuntime, body.providerId, {
      allowNetwork: body.action !== 'logout', force: body.action === 'refresh', signal,
    }))
    if (warning) operation.notify({ type: 'info', message: warning, level: 'warning' })
    return {
      providerId: body.providerId, action: body.action,
      ...(body.action !== 'refresh' ? { credentialChanged: true } : {}),
      ...(warning ? { warning } : {}),
    }
  }

  async function catalog(target, query, refreshCatalog) {
    if (typeof query !== 'string' || query.length > 256) throw settingsError('Invalid catalog search')
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return { models: [] }
    return withProviderSettingsLock(async (signal) => {
      const lease = await getRuntime(target, { refresh: refreshCatalog, signal })
      const { modelRuntime } = lease
      let warning
      try {
        if (refreshCatalog) {
          const refreshWarning = 'The catalog could not be fully refreshed. Results come from the cached catalog.'
          try {
            const result = await modelRuntime.refresh({ allowNetwork: true, force: true, signal })
            if (result.aborted || result.errors.size || modelRuntime.getError()) warning = refreshWarning
          } catch {
            warning = refreshWarning
          }
        }
        const matches = modelRuntime.getAllModels()
          .filter((model) => (model.type || 'chat') === 'chat')
          .filter((model) => words.every((word) => `${model.id} ${model.name} ${model.provider}`.toLowerCase().includes(word)))
          .sort((a, b) => a.id.localeCompare(b.id) || String(a.provider).localeCompare(String(b.provider)))
          .slice(0, 20)
          .map((model) => ({
            providerId: model.provider,
            id: model.id,
            name: model.name,
            api: model.api,
            reasoning: model.reasoning,
            input: model.input,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
            ...(isSettingsObject(model.compat) ? { compat: model.compat } : {}),
          }))
        return { models: matches, ...(warning ? { warning } : {}) }
      } finally {
        lease.release()
      }
    }, AbortSignal.timeout(15000))
  }

  return { list, saveProvider, deleteProvider, saveModel, deleteModel, action, catalog }
}
