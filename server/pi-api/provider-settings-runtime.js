import { join, resolve } from 'node:path'
import {
  AgentSessionRuntime,
  createAgentSessionFromServices,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { settingsError } from './pi-config.js'
import { waitForSettings } from './settings-operations.js'

const deadlineMs = 15000

export async function createResourceSession(services, sessionManager = SessionManager.inMemory(services.cwd)) {
  return (await createAgentSessionFromServices({
    services, sessionManager, tools: [], excludeTools: ['codemode'],
    model: services.modelRuntime.getModels()[0], thinkingLevel: 'off',
  })).session
}

function boundedSignal(lifetime, signal) {
  return AbortSignal.any([lifetime, signal, AbortSignal.timeout(deadlineMs)].filter(Boolean))
}

function boundedProvider(provider, lifetime) {
  const apiKey = provider.auth.apiKey && { ...provider.auth.apiKey }
  for (const name of ['check', 'resolve']) {
    if (!apiKey?.[name]) continue
    apiKey[name] = (input) => {
      const signal = boundedSignal(lifetime, input.signal)
      signal.throwIfAborted()
      return waitForSettings(provider.auth.apiKey[name]({ ...input, signal }), signal)
    }
  }
  const auth = { ...provider.auth, ...(apiKey ? { apiKey } : {}) }
  return new Proxy(provider, {
    get(target, key) {
      if (key === 'auth') return auth
      if (key === 'refreshModels' && target.refreshModels) return boundedRefresh(target.refreshModels.bind(target), lifetime)
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function boundedRefresh(refresh, lifetime) {
  return (context) => {
    const signal = boundedSignal(lifetime, context.signal)
    signal.throwIfAborted()
    return waitForSettings(refresh({
      ...context,
      signal,
      publish: (publication) => signal.aborted ? Promise.resolve(false) : context.publish(publication),
    }), signal)
  }
}

function settingsModelRuntime(runtime, lifetime) {
  return new Proxy(runtime, {
    get(target, key) {
      if (key === 'refresh') return (options = {}) => {
        const signal = boundedSignal(lifetime, options.signal)
        signal.throwIfAborted()
        return waitForSettings(target.refresh({ ...options, signal }), signal)
      }
      if (key === 'listCredentials') return (options = {}) => {
        const signal = boundedSignal(lifetime, options.signal)
        signal.throwIfAborted()
        return waitForSettings(target.listCredentials({ ...options, signal }), signal)
      }
      if (key === 'getAvailable') return (providerId, options = {}) => {
        const signal = boundedSignal(lifetime, options.signal)
        signal.throwIfAborted()
        return waitForSettings(target.getAvailable(providerId, { ...options, signal }), signal)
      }
      if (key === 'registerNativeProvider') return (provider) => {
        lifetime.throwIfAborted()
        target.registerNativeProvider(boundedProvider(provider, lifetime))
      }
      if (key === 'registerProvider') return (providerId, config) => {
        lifetime.throwIfAborted()
        target.registerProvider(providerId, config.refreshModels
          ? { ...config, refreshModels: boundedRefresh(config.refreshModels.bind(config), lifetime) }
          : config)
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export function createProviderSettingsRuntimes({ isClosing }) {
  const contexts = new Map()
  const retiring = new Set()

  async function disposeRuntime(runtime) {
    try {
      await waitForSettings(runtime.dispose(), AbortSignal.timeout(3000))
    } catch {
      runtime.session.dispose()
    }
  }

  function retire(context) {
    context.retired = true
    if (contexts.get(context.cwd) === context) contexts.delete(context.cwd)
    if (context.users || context.disposal) return context.disposal
    context.controller.abort()
    const disposal = context.creation.then(({ runtime }) => disposeRuntime(runtime)).catch(() => {})
    context.disposal = disposal
    retiring.add(disposal)
    void disposal.finally(() => retiring.delete(disposal))
    return disposal
  }

  function create(cwd, previousServices, forceReload) {
    const context = { cwd, users: 0, controller: new AbortController(), retired: false }
    const signal = context.controller.signal
    context.creation = (async () => {
      const agentDir = getAgentDir()
      const settingsManager = previousServices?.settingsManager || SettingsManager.create(cwd, agentDir)
      const resourceLoader = previousServices?.resourceLoader || new DefaultResourceLoader({
        cwd, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      })
      const factory = async ({ sessionManager }) => {
        const modelRuntime = settingsModelRuntime(await ModelRuntime.create({
          authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), refreshOnCreate: false, signal,
        }), signal)
        signal.throwIfAborted()
        const services = { cwd, agentDir, modelRuntime, settingsManager, resourceLoader, diagnostics: [] }
        const previousExtensions = resourceLoader.getExtensions()
        let session
        try {
          await resourceLoader.reload()
          session = await createResourceSession(services, sessionManager)
          signal.throwIfAborted()
          const refreshed = await modelRuntime.refresh({ allowNetwork: false, signal })
          if (refreshed.aborted) throw settingsError('Provider settings refresh timed out', 503)
          signal.throwIfAborted()
          return { session, services, diagnostics: services.diagnostics }
        } catch (error) {
          if (!session && resourceLoader.getExtensions() !== previousExtensions) session = await createResourceSession(services, sessionManager)
          if (session) await disposeRuntime(new AgentSessionRuntime(session, services, factory))
          throw error
        }
      }
      const load = async () => {
        const result = await factory({ sessionManager: SessionManager.inMemory(cwd) })
        return new AgentSessionRuntime(result.session, result.services, factory, result.diagnostics)
      }
      let runtime = await load()
      if (forceReload && !previousServices) {
        await disposeRuntime(runtime)
        signal.throwIfAborted()
        runtime = await load()
      }
      return { runtime }
    })()
    context.ready = waitForSettings(context.creation, boundedSignal(signal)).catch(() => {
      retire(context)
      throw settingsError('Could not load provider settings within 15 seconds. Check project extensions and try Refresh.', 503)
    })
    return context
  }

  function invalidate(cwd) {
    for (const context of contexts.values()) {
      if (!cwd || context.cwd === resolve(cwd)) context.invalidated = true
    }
  }

  async function getRuntime(target = {}, options = {}) {
    if (isClosing()) throw settingsError('Runtime is shutting down', 503)
    const cwd = resolve(target.cwd || process.cwd())
    let context = contexts.get(cwd)
    let previousServices
    if (context && (options.refresh || context.invalidated)) {
      if (context.users) throw settingsError('Provider settings are in use. Finish the current operation and try Refresh.', 409)
      previousServices = (await waitForSettings(context.ready, boundedSignal(context.controller.signal, options.signal))).runtime.services
      await waitForSettings(retire(context), boundedSignal(undefined, options.signal))
      context = undefined
    }
    if (!context) {
      for (const entry of contexts.values()) {
        if (contexts.size + retiring.size < 4) break
        if (!entry.users) await waitForSettings(retire(entry), boundedSignal(undefined, options.signal))
      }
      if (contexts.size + retiring.size >= 4) throw settingsError('Provider settings are busy or an extension has not stopped. Finish current operations or restart the backend.', 503)
      context = create(cwd, previousServices, options.refresh)
    }
    contexts.delete(cwd)
    contexts.set(cwd, context)
    context.users++
    let released = false
    const release = () => {
      if (released) return
      released = true
      context.users--
      if (context.retired || isClosing()) retire(context)
    }
    try {
      const { runtime } = await waitForSettings(context.ready, boundedSignal(context.controller.signal, options.signal))
      if (isClosing() || context.retired) throw settingsError('Provider settings changed. Refresh and try again.', 409)
      const result = await runtime.session.modelRuntime.refresh({ allowNetwork: false, signal: options.signal })
      if (result.aborted || runtime.session.modelRuntime.getError()?.includes('Availability refresh:')) {
        throw settingsError('Provider authentication status could not be refreshed. Check project extensions and try again.', 503)
      }
      return { modelRuntime: runtime.session.modelRuntime, settingsManager: runtime.session.settingsManager, release }
    } catch (error) {
      retire(context)
      release()
      throw error
    }
  }

  async function dispose() {
    for (const context of contexts.values()) {
      context.controller.abort()
      retire(context)
    }
    await waitForSettings(Promise.allSettled([...retiring]), AbortSignal.timeout(3000)).catch(() => {})
  }

  return { getRuntime, invalidate, dispose }
}
