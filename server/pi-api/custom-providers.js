import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { getAgentDir, ModelRuntime, readStoredCredential } from '@earendil-works/pi-coding-agent'
import { lazyStream, normalizeContext } from '@earendil-works/pi-ai'
import { readPiConfig } from './pi-config.js'

export const KEYLESS_AUTH_SOURCE = 'No credentials'
const marker = `leyline-keyless-${randomUUID()}`
const targetKey = Symbol('modelRuntimeTarget')
const wrappers = new WeakMap()
const adapters = new WeakSet()
const registrations = new WeakMap()
const fetchApis = new Set(['openai-completions', 'openai-responses', 'anthropic-messages', 'azure-openai-responses', 'mistral-conversations', 'pi-messages'])
let builtinIds
const emptyCredentials = {
  async list() { return [] },
  async read() { return undefined },
  async modify() { throw new Error('Credential writes are unavailable') },
  async delete() { throw new Error('Credential writes are unavailable') },
}

export function getBuiltinProviderIds() {
  builtinIds ??= ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, credentials: emptyCredentials })
    .then((runtime) => new Set(runtime.getProviders().map((provider) => provider.id)))
  return builtinIds
}

export function isCustomProviderAdapter(runtime, providerId) {
  return adapters.has(runtime.getRegisteredNativeProvider(providerId))
}

export function supportsProviderFetch(api) {
  return fetchApis.has(api) || api === 'openai-codex-responses'
}

function stripMarker(value) {
  return typeof value === 'string' && value.includes(marker)
    ? value.split(',').filter((part) => !part.includes(marker)).join(',').trim() || null
    : value
}

function mergeHeaders(...sources) {
  const headers = {}
  for (const source of sources) {
    for (const [name, value] of Object.entries(source || {})) {
      for (const key of Object.keys(headers)) if (key.toLowerCase() === name.toLowerCase()) delete headers[key]
      headers[name] = value
    }
  }
  return headers
}

function requestOptions(model, options) {
  const headerMarker = Object.values(options.headers || {}).some((value) => typeof value === 'string' && value.includes(marker))
  if (options.apiKey !== marker && !headerMarker) return options
  options = { ...options, apiKey: options.apiKey?.trim() ? options.apiKey : marker }
  const headers = Object.fromEntries(Object.entries(options.headers || {}).map(([name, value]) => [name, stripMarker(value)]))
  if (model.api === 'google-generative-ai') {
    if (!Object.keys(headers).some((name) => name.toLowerCase() === 'x-goog-api-key' && headers[name] != null)) headers['x-goog-api-key'] = ''
    return { ...options, headers }
  }
  if (!fetchApis.has(model.api)) return { ...options, apiKey: undefined, headers }
  const fetch = options.fetch || globalThis.fetch
  return {
    ...options,
    headers,
    fetch(input, init) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
      for (const [name, value] of [...headers]) {
        const clean = stripMarker(value)
        if (clean === null) headers.delete(name)
        else if (clean !== value) headers.set(name, clean)
      }
      return fetch(input, { ...init, headers })
    },
  }
}

export function withOptionalCredentials(provider) {
  const auth = provider.auth.apiKey
  if (!auth || provider.auth.oauth) return provider
  return {
    ...provider,
    auth: {
      ...provider.auth,
      apiKey: {
        ...auth,
        async check(input) {
          input.signal.throwIfAborted()
          return await auth.check?.(input) || { type: 'api_key', source: KEYLESS_AUTH_SOURCE }
        },
        async resolve(input) {
          input.signal.throwIfAborted()
          const result = await auth.resolve(input)
          if (result) return result
          if (input.credential?.key || (input.credential && readStoredCredential(provider.id)?.key)) throw new Error('The configured API key could not be resolved')
          const fallback = await auth.resolve({ ...input, credential: { type: 'api_key', key: marker, env: input.credential?.env } })
          return { ...fallback, source: KEYLESS_AUTH_SOURCE }
        },
      },
    },
  }
}

export function streamResolvedProvider(provider, model, context, options, resolution, method = 'streamSimple') {
  return lazyStream(model, async () => {
    const { transformHeaders, ...rest } = options
    let headers = mergeHeaders(resolution.auth.headers, options.headers)
    if (transformHeaders) headers = await transformHeaders(headers)
    const requestModel = resolution.auth.baseUrl ? { ...model, baseUrl: resolution.auth.baseUrl } : model
    return provider[method](requestModel, normalizeContext(context), requestOptions(requestModel, {
      ...rest,
      apiKey: options.apiKey?.trim() ? options.apiKey : resolution.auth.apiKey ?? (resolution.source === KEYLESS_AUTH_SOURCE ? marker : undefined),
      headers,
      env: { ...resolution.env, ...options.env },
    }))
  })
}

export function wrapModelRuntime(runtime) {
  if (runtime[targetKey]) return runtime
  if (wrappers.has(runtime)) return wrappers.get(runtime)
  const stream = (method, model, context, options = {}) => lazyStream(model, async () => {
    const transcript = normalizeContext(context)
    if (method === 'streamSimple' && model.api === 'pi-virtual') {
      const route = await runtime.resolveModel(model, transcript.messages, { reason: 'direct', thinkingLevel: options.reasoning || 'off', signal: options.signal })
      const { apiKey, headers, env, ...rest } = options
      return stream(method, route.model, transcript, {
        ...rest,
        ...(route.model.provider === model.provider ? { apiKey, headers, env } : {}),
        maxTokens: options.maxTokens && route.model.maxTokens > 0 ? Math.min(options.maxTokens, route.model.maxTokens) : options.maxTokens,
        reasoning: route.thinkingLevel === 'off' ? undefined : route.thinkingLevel,
      })
    }
    const provider = runtime.getProvider(model.provider)
    if (!provider) throw new Error(`Unknown provider: ${model.provider}`)
    const resolution = await runtime.getAuth(model, { apiKey: options.apiKey, env: options.env, signal: options.signal })
    if (!resolution) throw new Error(`Provider is not configured: ${model.provider}`)
    return streamResolvedProvider(provider, model, transcript, options, resolution, method)
  })
  const proxy = new Proxy(runtime, {
    get(target, key) {
      if (key === targetKey) return target
      if (key === 'stream' || key === 'streamSimple') return (model, context, options) => stream(key, model, context, options)
      if (key === 'complete' || key === 'completeSimple') return (model, context, options) => stream(key === 'complete' ? 'stream' : 'streamSimple', model, context, options).result()
      if (key === 'getAuth') return async (...args) => {
        const result = await target.getAuth(...args)
        if (result?.auth.apiKey !== marker) return result
        return { ...result, auth: { ...result.auth, apiKey: undefined, headers: Object.fromEntries(Object.entries(result.auth.headers || {}).map(([name, value]) => [name, stripMarker(value)])) } }
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  wrappers.set(runtime, proxy)
  return proxy
}

async function catalogProvider(id, signal) {
  const runtime = await ModelRuntime.create({ modelsPath: join(getAgentDir(), 'models.json'), refreshOnCreate: false, credentials: emptyCredentials, signal })
  signal?.throwIfAborted()
  return runtime.getProvider(id)
}

function customProvider(state) {
  const adapter = {
    id: state.provider.id,
    name: state.provider.id,
    auth: {
      apiKey: {
        name: 'API key',
        login: state.provider.auth.apiKey?.login,
        async check({ credential, signal }) {
          signal.throwIfAborted()
          return { type: 'api_key', source: credential?.key ? 'stored credential' : KEYLESS_AUTH_SOURCE }
        },
        async resolve({ credential, signal }) {
          signal.throwIfAborted()
          if (credential && credential.key === undefined && readStoredCredential(adapter.id)?.key) throw new Error('The configured API key could not be resolved')
          return { auth: { apiKey: credential?.key || marker }, env: credential?.env, source: credential?.key ? 'stored credential' : KEYLESS_AUTH_SOURCE }
        },
      },
    },
    getModels: () => state.provider?.getModels() || [],
    getAllModels: () => state.provider?.getAllModels?.() || state.provider?.getModels() || [],
    async refreshModels(context) {
      const provider = await catalogProvider(adapter.id, context.signal)
      await context.publish({ update: () => { state.provider = provider } })
    },
    stream: (model, context, options) => state.provider.stream(model, context, requestOptions(model, options)),
    streamSimple: (model, context, options) => state.provider.streamSimple(model, context, requestOptions(model, options)),
  }
  adapters.add(adapter)
  return adapter
}

export async function refreshCustomProviders(runtime, options = { allowNetwork: false }) {
  const target = runtime[targetKey] || runtime
  let config
  try { config = await readPiConfig('models.json') } catch { return runtime.refresh(options) }
  options.signal?.throwIfAborted()
  const providers = config.data.providers
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return runtime.refresh(options)
  const builtins = await getBuiltinProviderIds()
  const previous = registrations.get(target) || new Map()
  registrations.set(target, previous)
  for (const [id, state] of previous) {
    if (runtime.getRegisteredNativeProvider(id) !== state.adapter) previous.delete(id)
    else if (!Object.hasOwn(providers, id) || providers[id]?.oauth) {
      runtime.unregisterProvider(id)
      previous.delete(id)
    }
  }
  for (const id of Object.keys(providers)) {
    if (builtins.has(id) || runtime.getRegisteredProviderIds().includes(id)) continue
    const provider = await catalogProvider(id, options.signal)
    if (!provider || provider.auth.oauth) continue
    const state = { provider }
    runtime.registerNativeProvider(customProvider(state))
    state.adapter = runtime.getRegisteredNativeProvider(id)
    adapters.add(state.adapter)
    previous.set(id, state)
  }
  return runtime.refresh(options)
}
