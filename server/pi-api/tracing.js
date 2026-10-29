import { join } from 'node:path'
import { createPiTracingExtension } from '@elune/embedded/pi'
import { readBackendSettings, writeBackendSettings } from '../backend-connections.js'
import { leylineDataDir } from './leyline-db.js'

const { createElune } = await import(import.meta.resolve('@elune/embedded').replace(/\.asar\//, '.asar.unpacked/'))
const SETTING = 'tracing.enabled'
export const TRACING_EXTENSION_PATH = '<inline:leyline-elune>'
const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, cost: 0, cacheRead: 0, cacheWrite: 0 })

function addUsage(total, usage) {
  for (const key of Object.keys(total)) {
    const value = usage?.[key] ?? usage?.[key === 'inputTokens' ? 'input' : key === 'outputTokens' ? 'output' : key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) total[key] += value
  }
}

export function createTracing({ broadcastEvent, getChildMarker }) {
  let enabled
  let error
  let configError
  let store
  let removeStoreListener
  let closing = false
  let closePromise
  const captures = new Set()
  const drains = new Map()
  const sessionCaptures = new WeakMap()
  const captureSubscriptions = new WeakMap()
  const captureChildren = new WeakMap()
  const captureInstances = new WeakMap()
  const loggedErrors = new WeakSet()
  const capturedChildren = new Map()

  function log(cause) {
    if (cause && typeof cause === 'object') {
      if (loggedErrors.has(cause)) return
      loggedErrors.add(cause)
    }
    console.error('Leyline tracing failed', cause)
  }

  function config() {
    if (enabled === undefined) {
      try {
        enabled = readBackendSettings([SETTING])[SETTING] !== 'false'
      } catch (cause) {
        enabled = false
        reportConfig(cause)
      }
    }
    const problem = configError || error
    return { enabled, ...(problem ? { error: problem } : {}) }
  }

  function report(cause) {
    if (error) return
    log(cause)
    error = 'Tracing is unavailable. Check the backend log.'
    broadcastEvent('trace_config', { enabled: enabled ?? false, error })
  }

  function reportConfig(cause) {
    if (!configError) log(cause)
    configError = 'Could not read or save trace settings. Check the backend log.'
    broadcastEvent('trace_config', config())
  }

  function publicError(cause) {
    if (cause?.message === 'Trace not found') return { error: 'Trace not found', status: 404 }
    if (['TypeError', 'URIError', 'SyntaxError'].includes(cause?.name)) {
      log(cause)
      return { error: 'Invalid trace request', status: 400 }
    }
    if (closing) return { error: 'Tracing is shutting down', status: 503 }
    if (configError) return { error: configError, status: 503 }
    report(cause)
    return { error, status: 503 }
  }

  function setConfig(input) {
    if (typeof input?.enabled !== 'boolean') throw new TypeError('enabled must be a boolean')
    if (closing) throw new Error('Tracing is shutting down')
    config()
    try {
      writeBackendSettings({ [SETTING]: String(input.enabled) })
      enabled = input.enabled
      configError = undefined
    } catch (cause) {
      reportConfig(cause)
      throw cause
    }
    const result = config()
    broadcastEvent('trace_config', result)
    return result
  }

  function getStore() {
    config()
    if (!store) {
      store = createElune({
        databasePath: join(leylineDataDir(), 'elune', 'elune.db'),
        onError: cause => {
          if (cause?.name !== 'TypeError' && cause?.message !== 'Trace not found') report(cause)
        },
      })
      removeStoreListener = store.subscribe(({ traceId, sessionId, revision }) => {
        broadcastEvent('trace_updated', { traceId, sessionId, revision, activeSessionId: sessionId })
      })
    }
    return store
  }

  function committedChildUsage(state) {
    const usage = { ...state.usage }
    if (state.failed) return { captured: undefined }
    for (const current of state.captures) {
      const snapshot = current.getCapturedUsage()
      if (!snapshot.captured || current.getDurability().error) return { captured: undefined }
      addUsage(usage, snapshot.usage)
    }
    return { captured: true, usage }
  }

  function childUsage(child) {
    const state = capturedChildren.get(child.sessionId)
    if (!state) return { captured: undefined }
    const snapshot = committedChildUsage(state)
    if (snapshot.captured || state.failed) return snapshot
    if (!state.completion) {
      state.completion = (async () => {
        while (!state.failed) {
          await Promise.all([...state.captures].map(current => current.whenCaptured()))
          const result = committedChildUsage(state)
          if (result.captured) return result
        }
        throw new Error('Child tracing did not commit complete usage')
      })().finally(() => { state.completion = undefined })
    }
    return { ...snapshot, completion: state.completion }
  }

  function createBinding() {
    config()
    let session
    let capture
    let childSessionId
    const instances = new Set()

    function bindCapture(current, target) {
      if (!captures.has(current) || drains.has(current) || sessionCaptures.get(target) === current) return
      try {
        const remove = current.bindSession(target)
        captureSubscriptions.set(current, { session: target, remove })
        sessionCaptures.set(target, current)
      } catch (cause) { report(cause) }
    }

    function bindSession(target) {
      session = target
      const current = captures.has(capture) && !drains.has(capture) ? capture : sessionCaptures.get(target)
      if (current) bindCapture(current, target)
    }

    const factory = pi => {
      if (closing) return
      const current = createPiTracingExtension({
        getStore,
        enabled: ctx => {
          const allowed = !closing && enabled
          const manager = ctx?.sessionManager
          const child = getChildMarker(manager)
          if (allowed && child?.sessionId === manager?.getSessionId() && !captureChildren.has(current)) {
            let state = capturedChildren.get(child.sessionId)
            if (!state) {
              state = { sessionId: child.sessionId, usage: emptyUsage(), captures: new Set(), failed: childSessionId === child.sessionId }
              capturedChildren.set(child.sessionId, state)
              if (capturedChildren.size > 4096) capturedChildren.delete(capturedChildren.keys().next().value)
            }
            state.captures.add(current)
            captureChildren.set(current, state)
            childSessionId = child.sessionId
          }
          const state = captureChildren.get(current)
          if (state && state.sessionId !== manager?.getSessionId()) {
            state.failed = true
            return false
          }
          return allowed
        },
        getParent: ctx => {
          const manager = ctx?.sessionManager
          const child = getChildMarker(manager)
          return child?.sessionId === manager?.getSessionId() ? child.tracingParent : undefined
        },
        isChildCaptured: childUsage,
        onError: report,
      })
      capture = current
      captures.add(current)
      instances.add(current)
      captureInstances.set(current, instances)
      current({
        on: (name, handler) => pi.on(name, (event, ctx) => {
          if (name === 'session_shutdown') {
            void drain(current)
            return undefined
          }
          if (name === 'before_agent_start' || name === 'session_before_compact') {
            if (session?.sessionManager === ctx?.sessionManager) bindCapture(current, session)
          }
          const result = handler(event, ctx)
          if (result?.then) void result.catch(report)
          return undefined
        }),
      })
      pi.on('session_start', () => { if (session) bindCapture(current, session) })
    }

    return {
      factory,
      bindSession,
      checkpoint: () => new Set(instances),
      dispose: (previous = new Set()) => Promise.allSettled([...instances].filter(current => !previous.has(current)).map(drain)),
    }
  }

  function observe(session, event) {
    try {
      sessionCaptures.get(session)?.observe(event, { sessionManager: session.sessionManager })
    } catch (cause) { report(cause) }
  }

  function drain(capture) {
    if (drains.has(capture)) return drains.get(capture)
    if (!captures.has(capture)) return Promise.resolve()
    const subscription = captureSubscriptions.get(capture)
    if (subscription) {
      try { subscription.remove() } catch (cause) { report(cause) }
      if (sessionCaptures.get(subscription.session) === capture) sessionCaptures.delete(subscription.session)
      captureSubscriptions.delete(capture)
    }
    const pending = Promise.resolve().then(() => capture.close()).catch(report).finally(() => {
      const child = captureChildren.get(capture)
      if (child) {
        const snapshot = capture.getCapturedUsage()
        if (snapshot.captured && !capture.getDurability().error) addUsage(child.usage, snapshot.usage)
        else child.failed = true
        child.captures.delete(capture)
        captureChildren.delete(capture)
      }
      captureInstances.get(capture)?.delete(capture)
      captureInstances.delete(capture)
      captures.delete(capture)
      drains.delete(capture)
    })
    drains.set(capture, pending)
    return pending
  }

  function closeSession(session) {
    const capture = sessionCaptures.get(session)
    if (!capture) return
    sessionCaptures.delete(session)
    void drain(capture)
  }

  function close() {
    if (closePromise) return closePromise
    closing = true
    closePromise = (async () => {
      try {
        await Promise.allSettled([...captures].map(drain))
        captures.clear()
        if (store) await store.close()
      } catch (cause) { report(cause) }
      finally {
        removeStoreListener?.()
        removeStoreListener = undefined
        store = undefined
        capturedChildren.clear()
      }
    })()
    return closePromise
  }

  return {
    config,
    setConfig,
    publicError,
    createBinding,
    observe,
    closeSession,
    close,
    parentContext: (session, toolCallId) => sessionCaptures.get(session)?.getParentContext(toolCallId) || null,
    async list(options) {
      if (closing) throw new Error('Tracing is shutting down')
      return getStore().list(options)
    },
    async get(id, options = {}) {
      if (closing) throw new Error('Tracing is shutting down')
      return getStore().get(id, { observationLimit: 200, scoreLimit: 200, ...options })
    },
    async setBookmarked(id, bookmarked) {
      if (closing) throw new Error('Tracing is shutting down')
      const current = getStore()
      await current.setBookmarked(id, bookmarked)
      return current.get(id, { observationLimit: 200, scoreLimit: 200 })
    },
  }
}
