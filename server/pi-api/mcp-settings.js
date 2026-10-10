import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { killMcpProcess } from './mcp-settings-transports.js'
import { isSettingsObject, readPiConfig, settingsError, updatePiConfig } from './pi-config.js'
import { startSettingsOperation } from './settings-operations.js'

const exposures = new Set(['codemode', 'codemode-deferred', 'deferred', 'direct', 'hidden'])
const editableExposures = new Set(['deferred', 'direct', 'hidden'])
const oauthFields = new Set(['clientId', 'clientSecret', 'scope', 'callbackPort', 'callbackUrl'])
const valueFields = new Set(['url', 'command', 'args', 'cwd', 'enabled', 'exposure', 'timeout', 'headers', 'env', 'removeHeaders', 'removeEnv', 'oauth'])

function validateName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(name)) {
    throw settingsError('Server names must contain only letters, digits, underscores, and hyphens.')
  }
}

function parseUrl(value) {
  try {
    return typeof value === 'string' ? new URL(value) : undefined
  } catch {
    return undefined
  }
}

function safeUrl(value) {
  const url = parseUrl(value)
  if (!url || !['http:', 'https:'].includes(url.protocol)) return '[redacted URL]'
  url.username = ''
  url.password = ''
  if (url.search) url.search = '?[redacted]'
  if (url.hash) url.hash = '#[redacted]'
  return url.href
}

function redactUrls(value) {
  return String(value ?? '').replace(/https?:\/\/[^\s<>"']+/gi, safeUrl)
}

function redactConfig(config) {
  const secrets = new Set()
  const add = (value) => {
    if (typeof value !== 'string' || !value) return
    secrets.add(value)
    if (value.startsWith('!') && value.length > 1) secrets.add(value.slice(1))
    if (process.env[value]) secrets.add(process.env[value])
    for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
      if (process.env[match[1]]) secrets.add(process.env[match[1]])
    }
    const bearer = value.match(/^(?:Bearer|Basic)\s+(.+)$/i)
    if (bearer) secrets.add(bearer[1])
  }
  for (const field of ['headers', 'env']) {
    if (isSettingsObject(config?.[field])) Object.values(config[field]).forEach(add)
  }
  add(config?.oauth?.clientSecret)
  if (Array.isArray(config?.args)) config.args.forEach(add)
  for (const value of [config?.url, config?.oauth?.callbackUrl]) {
    const url = parseUrl(value)
    if (!url) continue
    for (const secret of [url.username, url.password, ...url.searchParams.values(), url.hash.slice(1)]) {
      add(secret)
      try { add(decodeURIComponent(secret)) } catch {}
    }
  }
  const ordered = [...secrets].sort((a, b) => b.length - a.length)
  return (value) => {
    let text = String(value ?? '')
    for (const secret of ordered) text = text.split(secret).join('[redacted]')
    return redactUrls(text)
      .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [redacted]')
      .replace(/\b((?:access_token|refresh_token|client_secret|api_key|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
  }
}

function transportOf(config) {
  return typeof config?.url === 'string' && config.type !== 'stdio' ? 'http' : 'stdio'
}

function validateConfig(name, config, preserveExposures = false) {
  validateName(name)
  if (!isSettingsObject(config)) throw settingsError('The server entry must be an object. Repair it or remove it explicitly.', 409)
  const { exposure, enabled, timeout, toolExposure } = config
  if (exposure !== undefined && (typeof exposure !== 'string' || (!preserveExposures && !exposures.has(exposure)))) {
    throw settingsError('The server has an unsupported exposure.')
  }
  if (toolExposure !== undefined && (!isSettingsObject(toolExposure)
    || Object.values(toolExposure).some((value) => typeof value !== 'string' || (!preserveExposures && !exposures.has(value))))) {
    throw settingsError('toolExposure must map tool names to supported exposures.')
  }
  if (enabled !== undefined && typeof enabled !== 'boolean') throw settingsError('enabled must be a boolean.')
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) throw settingsError('timeout must be a positive number of seconds.')
  if (config.type !== undefined && !['stdio', 'http', 'streamable-http'].includes(config.type)) {
    throw settingsError('Unsupported transport type. Use stdio or streamable HTTP.')
  }
  const transport = transportOf(config)
  if (transport === 'stdio' && Object.hasOwn(config, 'url')) throw settingsError('The stdio entry contains a conflicting URL field. Save an explicit transport to repair it.')
  if (transport === 'http') {
    const url = parseUrl(config.url)
    if (!url || !['http:', 'https:'].includes(url.protocol)) throw settingsError('url must be an HTTP or HTTPS URL.')
  } else if (typeof config.command !== 'string' || !config.command.trim()
    || (config.type !== undefined && config.type !== 'stdio')) {
    throw settingsError('The server needs a command for stdio or a URL for HTTP.')
  }
  if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== 'string'))) {
    throw settingsError('args must be an array of strings.')
  }
  if (config.cwd !== undefined && typeof config.cwd !== 'string') throw settingsError('cwd must be a string.')
  for (const field of ['headers', 'env']) {
    if (config[field] !== undefined && (!isSettingsObject(config[field]) || Object.values(config[field]).some((value) => typeof value !== 'string'))) {
      throw settingsError(`${field} must map names to strings.`)
    }
  }
  if (config.oauth === undefined) return
  if (!isSettingsObject(config.oauth)) throw settingsError('oauth must be an object.')
  const oauth = config.oauth
  for (const field of ['clientId', 'clientSecret', 'scope', 'callbackUrl']) {
    if (oauth[field] !== undefined && typeof oauth[field] !== 'string') throw settingsError(`oauth.${field} must be a string.`)
  }
  if (oauth.callbackPort !== undefined && (!Number.isInteger(oauth.callbackPort) || oauth.callbackPort < 1 || oauth.callbackPort > 65535)) {
    throw settingsError('oauth.callbackPort must be a port number from 1 to 65535.')
  }
  if (oauth.callbackUrl !== undefined) {
    const url = parseUrl(oauth.callbackUrl)
    if (!url || url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.search || url.hash || url.username || url.password) {
      throw settingsError('oauth.callbackUrl must be an HTTP loopback URL without credentials, query, or fragment.')
    }
    if (url.port && oauth.callbackPort !== undefined && Number(url.port) !== oauth.callbackPort) {
      throw settingsError('oauth.callbackUrl and oauth.callbackPort must use the same port.')
    }
  }
}

function serverMap(data) {
  if (data.mcpServers !== undefined && !isSettingsObject(data.mcpServers)) {
    throw settingsError('mcpServers must be an object. Repair it before saving.', 409)
  }
  return data.mcpServers || {}
}

function settingsDto({ data, revision }) {
  let entries
  try {
    entries = Object.entries(serverMap(data))
  } catch (error) {
    return { revision, servers: [], warning: error.message }
  }
  const servers = entries.map(([name, value]) => {
    const config = isSettingsObject(value) ? value : {}
    const clean = redactConfig(config)
    let error
    try { validateConfig(name, value) } catch (failure) { error = failure.message }
    const oauth = {}
    if (isSettingsObject(config.oauth)) {
      for (const field of ['clientId', 'scope', 'callbackUrl']) {
        if (typeof config.oauth[field] === 'string') oauth[field] = clean(config.oauth[field])
      }
      if (Number.isInteger(config.oauth.callbackPort)) oauth.callbackPort = config.oauth.callbackPort
      oauth.clientSecretConfigured = Object.hasOwn(config.oauth, 'clientSecret')
    }
    const dto = {
      name: redactUrls(name), transport: transportOf(config), enabled: config.enabled !== false,
      exposure: typeof config.exposure === 'string' ? redactUrls(config.exposure) : 'codemode',
      oauth,
      headers: isSettingsObject(config.headers) ? Object.keys(config.headers).map((name) => ({ name: redactUrls(name), configured: true })) : [],
      env: isSettingsObject(config.env) ? Object.keys(config.env).map((name) => ({ name: redactUrls(name), configured: true })) : [],
    }
    for (const field of ['url', 'command', 'cwd']) {
      if (typeof config[field] === 'string') dto[field] = field === 'url' ? safeUrl(config[field]) : clean(config[field])
    }
    if (Array.isArray(config.args)) {
      dto.argsConfigured = true
      dto.argsCount = config.args.length
    }
    if (Number.isFinite(config.timeout)) dto.timeout = config.timeout
    if (error) dto.error = error
    return dto
  })
  const warnings = []
  if (servers.some((server) => server.error)) warnings.push('Some server entries are invalid. Their configuration has been kept.')
  if (data.autoEnableCodemode !== undefined && typeof data.autoEnableCodemode !== 'boolean') warnings.push('autoEnableCodemode must be a boolean.')
  return { revision, servers, ...(warnings.length ? { warning: warnings.join(' ') } : {}) }
}

function applyValues(previous, values, create) {
  if (!isSettingsObject(values) || Object.keys(values).some((field) => !valueFields.has(field))) {
    throw settingsError('Invalid server settings fields.')
  }
  if (Object.hasOwn(values, 'url') && Object.hasOwn(values, 'command')) throw settingsError('Supply either url or command, not both.')
  const next = { ...previous }
  if (create && values.exposure === undefined) next.exposure = 'deferred'
  const target = Object.hasOwn(values, 'url') ? 'http' : Object.hasOwn(values, 'command') ? 'stdio' : undefined
  if (target) {
    const incompatible = target === 'http' ? ['command', 'args', 'cwd', 'env'] : ['url', 'headers', 'oauth']
    if (incompatible.some((field) => Object.hasOwn(values, field))) throw settingsError('Settings contain fields for the other transport.')
    for (const field of incompatible) delete next[field]
    if (previous.type !== undefined && (target === 'stdio' ? previous.type !== 'stdio' : !['http', 'streamable-http'].includes(previous.type))) next.type = target
  }
  for (const field of ['url', 'command', 'args', 'cwd', 'enabled', 'exposure', 'timeout']) {
    if (!Object.hasOwn(values, field)) continue
    const value = values[field]
    if (value === undefined) throw settingsError('Omit unchanged fields instead of supplying undefined.')
    if (field === 'exposure' && !editableExposures.has(value) && (create || value !== previous.exposure)) {
      throw settingsError('New exposure selections must be deferred, direct, or hidden.')
    }
    if (field === 'url' && (typeof value !== 'string' || value.includes('[redacted]') || value.includes('%5Bredacted%5D'))) {
      throw settingsError('Supply the complete new URL, or omit url to keep the stored value.')
    }
    if (value === null && ['args', 'cwd', 'timeout'].includes(field)) delete next[field]
    else next[field] = value
  }
  if (transportOf(next) === 'http' && ['args', 'cwd'].some((field) => Object.hasOwn(values, field))) {
    throw settingsError('args and cwd apply only to stdio servers.')
  }
  for (const [field, removal] of [['headers', 'removeHeaders'], ['env', 'removeEnv']]) {
    if (!Object.hasOwn(values, field) && !Object.hasOwn(values, removal)) continue
    if ((field === 'headers' && transportOf(next) !== 'http') || (field === 'env' && transportOf(next) !== 'stdio')) {
      throw settingsError(`${field} does not apply to this transport.`)
    }
    if (next[field] !== undefined && !isSettingsObject(next[field])) throw settingsError(`Repair the existing ${field} object before editing it.`, 409)
    const additions = Object.hasOwn(values, field) ? values[field] : {}
    const removals = Object.hasOwn(values, removal) ? values[removal] : []
    if (!isSettingsObject(additions) || Object.values(additions).some((value) => typeof value !== 'string')
      || !Array.isArray(removals) || removals.some((name) => typeof name !== 'string')) {
      throw settingsError(`Supply ${field} as string values and ${removal} as an array of names.`)
    }
    if (removals.some((name) => Object.hasOwn(additions, name))) throw settingsError(`Cannot set and remove the same ${field} entry.`)
    const merged = { ...next[field], ...additions }
    for (const name of removals) delete merged[name]
    next[field] = merged
  }
  if (Object.hasOwn(values, 'oauth')) {
    if (transportOf(next) !== 'http' || !isSettingsObject(values.oauth)
      || Object.keys(values.oauth).some((field) => !oauthFields.has(field))) throw settingsError('Invalid OAuth settings.')
    if (next.oauth !== undefined && !isSettingsObject(next.oauth)) throw settingsError('Repair the existing oauth object before editing it.', 409)
    next.oauth = { ...next.oauth }
    for (const [field, value] of Object.entries(values.oauth)) {
      if (value === null) delete next.oauth[field]
      else if (value === undefined) throw settingsError('Omit unchanged OAuth fields instead of supplying undefined.')
      else next.oauth[field] = value
    }
  }
  return next
}

async function runAction(entry, action, op) {
  const temporary = await mkdtemp(join(tmpdir(), 'leyline-mcp-settings-'))
  const processes = new Set()
  const prompts = new Map()
  let worker
  let deadline
  let cleanupTimer
  let stop
  try {
    op.signal.throwIfAborted()
    worker = new Worker(new URL('./mcp-settings-worker.js', import.meta.url), {
      workerData: { entry, action, temporary }, stdout: true, stderr: true,
      execArgv: [],
    })
    worker.stdout.resume()
    worker.stderr.resume()
    const result = await new Promise((resolve, reject) => {
      let result
      let failed = false
      let stopping = false
      let cancelling = false
      const terminate = () => {
        for (const pid of processes) killMcpProcess(pid)
        void worker.terminate().catch(() => {})
      }
      stop = () => {
        if (cancelling) return
        cancelling = true
        stopping = true
        clearTimeout(cleanupTimer)
        for (const prompt of prompts.values()) prompt.abort()
        worker.postMessage({ type: 'abort' })
        cleanupTimer = setTimeout(terminate, 3000)
      }
      op.signal.addEventListener('abort', stop, { once: true })
      deadline = setTimeout(() => { failed = true; stop() }, action === 'login' ? 10 * 60 * 1000 : 120000)
      worker.on('message', (message) => {
        if (message.type === 'process') {
          if (message.active) processes.add(message.pid)
          else processes.delete(message.pid)
        } else if (message.type === 'closed') {
          terminate()
        } else if (message.type === 'cancel_prompt') {
          prompts.get(message.id)?.abort()
          prompts.delete(message.id)
        } else if (!stopping && !op.signal.aborted) {
          if (message.type === 'event') op.notify(message.event)
          else if (message.type === 'prompt') {
            const controller = new AbortController()
            prompts.set(message.id, controller)
            void op.prompt({
              type: 'manual_code', message: 'Complete sign-in in your browser, then paste the full redirect URL.',
              placeholder: 'http://127.0.0.1:.../callback?code=...', signal: controller.signal,
            }).then((value) => worker.postMessage({ type: 'answer', id: message.id, value }))
              .catch(() => worker.postMessage({ type: 'answer', id: message.id }))
          } else if (message.type === 'result') {
            result = message.result
            stopping = true
            clearTimeout(deadline)
            cleanupTimer = setTimeout(terminate, 4000)
          } else if (message.type === 'failure') {
            failed = true
            stop()
          }
        }
      })
      worker.on('error', () => { failed = true; stop() })
      worker.on('exit', () => {
        if (failed || !result) reject(settingsError('MCP management failed. Check the server configuration and try again.', 500))
        else resolve(result)
      })
      if (op.signal.aborted) stop()
    })
    const redact = redactConfig(entry.config)
    return {
      report: result.report,
      tools: result.tools.map((tool) => ({
        name: op.redact(redact(tool.name)), description: op.redact(redact(tool.description)), exposure: tool.exposure,
      })),
    }
  } catch {
    throw settingsError('MCP management failed. Check the server configuration and try again.', 500)
  } finally {
    clearTimeout(deadline)
    clearTimeout(cleanupTimer)
    if (stop) op.signal.removeEventListener('abort', stop)
    for (const prompt of prompts.values()) prompt.abort()
    for (const pid of processes) killMcpProcess(pid)
    await worker?.terminate()
    await rm(temporary, { recursive: true, force: true })
  }
}

export function createMcpSettings() {
  return {
    async list() {
      return settingsDto(await readPiConfig('mcp.json'))
    },
    async save(body) {
      if (!isSettingsObject(body)) throw settingsError('Invalid server settings request.')
      validateName(body.name)
      if (body.create !== undefined && typeof body.create !== 'boolean') throw settingsError('create must be a boolean.')
      const saved = await updatePiConfig('mcp.json', body.revision, (data) => {
        const servers = serverMap(data)
        const exists = Object.hasOwn(servers, body.name)
        if (body.create && exists) throw settingsError('This server already exists. Refresh settings before editing it.', 409)
        if (!body.create && !exists) throw settingsError('This server no longer exists. Refresh settings before saving.', 409)
        const previous = exists ? servers[body.name] : {}
        if (!isSettingsObject(previous)) throw settingsError('The server entry is invalid. Repair it or remove it explicitly.', 409)
        const next = applyValues(previous, body.values, !exists)
        validateConfig(body.name, next, exists)
        return [{ path: ['mcpServers', body.name], value: next }]
      })
      return settingsDto(saved)
    },
    async remove(body) {
      if (!isSettingsObject(body) || typeof body.name !== 'string' || !body.name) throw settingsError('Supply the server name to remove.')
      const saved = await updatePiConfig('mcp.json', body.revision, (data) => {
        if (!Object.hasOwn(serverMap(data), body.name)) throw settingsError('This server no longer exists.', 409)
        return [{ path: ['mcpServers', body.name], value: undefined }]
      })
      return settingsDto(saved)
    },
    async action(body) {
      if (!isSettingsObject(body) || !['check', 'login', 'logout'].includes(body.action)) throw settingsError('Unsupported MCP action.')
      validateName(body.name)
      const { data, path } = await readPiConfig('mcp.json')
      const servers = serverMap(data)
      if (!Object.hasOwn(servers, body.name)) throw settingsError('This server no longer exists.', 404)
      const config = servers[body.name]
      validateConfig(body.name, config)
      if (body.action !== 'check' && (transportOf(config) !== 'http'
        || Object.keys(config.headers || {}).some((name) => name.toLowerCase() === 'authorization'))) {
        throw settingsError('Native OAuth requires an HTTP server without an Authorization header.')
      }
      const key = transportOf(config) === 'http'
        ? `mcp:url:${createHash('sha256').update(String(new URL(config.url))).digest('hex')}`
        : `mcp:${path}:${body.name}`
      return startSettingsOperation(key, (op) => runAction({ name: body.name, config, source: path, scope: 'global' }, body.action, op))
    },
  }
}
