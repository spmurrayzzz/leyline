import { randomUUID } from 'node:crypto'
import { settingsError } from './pi-config.js'

const operations = new Map()
const lifetimeMs = 10 * 60 * 1000
const retentionMs = 60 * 1000
const providerShutdown = new AbortController()
let providerQueue = Promise.resolve()

export function waitForSettings(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || settingsError('Settings operation cancelled', 503))
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

export async function withProviderSettingsLock(run, signal) {
  signal = AbortSignal.any([providerShutdown.signal, signal].filter(Boolean))
  const previous = providerQueue
  let unlock
  const current = new Promise((resolve) => { unlock = resolve })
  providerQueue = previous.then(() => current)
  try {
    try {
      await waitForSettings(previous, signal)
    } catch (error) {
      if (error.name === 'TimeoutError') throw settingsError('Provider settings are busy. Finish or cancel sign-in, then try again.', 409)
      throw error
    }
    signal.throwIfAborted()
    return await run(signal)
  } finally {
    unlock()
  }
}

function publicUrl(value) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch {
    return ''
  }
}

function snapshot(operation) {
  return {
    id: operation.id,
    state: operation.state,
    prompt: operation.pending?.dto || null,
    events: operation.events,
    result: operation.result,
    error: operation.error,
  }
}

function getOperation(id) {
  const operation = operations.get(id)
  if (!operation) throw settingsError('This settings operation expired. Start it again.', 404)
  return operation
}

export function getSettingsOperation(id) {
  return snapshot(getOperation(id))
}

export function answerSettingsOperation(id, promptId, value) {
  const operation = getOperation(id)
  const pending = operation.pending
  if (operation.state !== 'running' || !pending || pending.dto.id !== promptId) {
    throw settingsError('This prompt is no longer active.', 409)
  }
  if (typeof value !== 'string' || value.length > 32768) throw settingsError('Invalid response')
  if (pending.dto.type === 'select' && !pending.dto.options.some((option) => option.id === value)) {
    throw settingsError('Select an available option')
  }
  if (value && pending.dto.type !== 'select') operation.redactions.add(value)
  pending.finish(value)
  return snapshot(operation)
}

export function cancelSettingsOperation(id) {
  const operation = getOperation(id)
  if (operation.state === 'running') {
    operation.state = 'cancelling'
    operation.controller.abort()
    operation.events = []
  }
  return snapshot(operation)
}

export function hasActiveSettingsOperations() {
  return [...operations.values()].some((item) => ['running', 'cancelling'].includes(item.state))
}

export function startSettingsOperation(key, run) {
  const active = [...operations.values()].filter((item) => ['running', 'cancelling'].includes(item.state))
  if (active.some((item) => item.key === key)) throw settingsError('An operation for this provider or server is already in progress.', 409)
  if (active.length >= 8) throw settingsError('Too many settings operations are in progress.', 429)
  const operation = {
    id: randomUUID(), key, state: 'running', controller: new AbortController(),
    events: [], pending: null, result: null, error: '', redactions: new Set(),
  }
  operations.set(operation.id, operation)
  const clean = (value) => {
    let text = String(value || '').slice(0, 8000)
    for (const secret of operation.redactions) text = text.split(secret).join('[redacted]')
    return text.replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, '$1?[redacted]')
  }
  const notify = (event) => {
    if (operation.state !== 'running') return
    let entry
    if (event.type === 'auth_url') {
      const url = publicUrl(event.url)
      if (url) entry = { type: 'auth_url', url, instructions: clean(event.instructions) }
    } else if (event.type === 'device_code') {
      const verificationUri = publicUrl(event.verificationUri)
      if (verificationUri) entry = { type: 'device_code', verificationUri, userCode: String(event.userCode || ''), expiresInSeconds: event.expiresInSeconds }
    } else {
      entry = { type: 'info', message: clean(event.message), level: event.level || 'info' }
      if (event.links) entry.links = event.links.map((link) => ({ url: publicUrl(link.url), label: clean(link.label) })).filter((link) => link.url)
    }
    if (!entry) return
    if (entry.type === 'info' && operation.events.at(-1)?.message === entry.message) return
    operation.events = [...operation.events, entry].slice(-20)
  }
  const prompt = (request) => {
    const signal = AbortSignal.any([operation.controller.signal, request.signal].filter(Boolean))
    if (signal.aborted) return Promise.reject(new DOMException('Operation cancelled', 'AbortError'))
    if (operation.pending) return Promise.reject(settingsError('Another authentication prompt is still active.'))
    if (!['text', 'secret', 'select', 'manual_code'].includes(request.type)) return Promise.reject(settingsError('Unsupported authentication prompt'))
    return new Promise((resolve, reject) => {
      const dto = {
        id: randomUUID(), type: request.type, message: clean(request.message),
        placeholder: clean(request.placeholder),
        ...(request.type === 'select' ? { options: (request.options || []).map((option) => ({ id: String(option.id), label: clean(option.label), description: clean(option.description) })) } : {}),
      }
      const finish = (value, error) => {
        if (operation.pending?.dto.id !== dto.id) return
        operation.pending = null
        signal.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolve(value)
      }
      const abort = () => finish(undefined, new DOMException('Operation cancelled', 'AbortError'))
      operation.pending = { dto, finish }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }
  const timeout = setTimeout(() => {
    if (operations.has(operation.id)) cancelSettingsOperation(operation.id)
  }, lifetimeMs)
  operation.timeout = timeout
  timeout.unref?.()
  operation.promise = Promise.resolve().then(() => run({ signal: operation.controller.signal, notify, prompt, redact: clean })).then((result) => {
    if (operation.controller.signal.aborted) operation.state = 'cancelled'
    else {
      operation.result = result || null
      operation.state = 'completed'
    }
  }).catch((error) => {
    operation.state = operation.controller.signal.aborted ? 'cancelled' : 'error'
    if (operation.state === 'error') operation.error = clean(error.message || 'Settings operation failed')
  }).finally(() => {
    clearTimeout(timeout)
    operation.controller.abort()
    operation.events = operation.events.filter((event) => event.type === 'info').map(({ links, ...event }) => event)
    operation.redactions.clear()
    const cleanup = setTimeout(() => operations.delete(operation.id), retentionMs)
    cleanup.unref?.()
  })
  return snapshot(operation)
}

export async function shutdownSettingsOperations() {
  providerShutdown.abort(settingsError('Runtime is shutting down', 503))
  for (const operation of operations.values()) {
    clearTimeout(operation.timeout)
    operation.controller.abort()
  }
  let timeout
  try {
    await Promise.race([
      Promise.allSettled([...operations.values()].map((operation) => operation.promise)),
      new Promise((resolve) => { timeout = setTimeout(resolve, 3000) }),
    ])
  } finally {
    clearTimeout(timeout)
    operations.clear()
  }
}
