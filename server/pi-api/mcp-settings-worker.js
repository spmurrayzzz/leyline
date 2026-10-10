import { parentPort, workerData } from 'node:worker_threads'
import { join } from 'node:path'
import {
  createAgentSession, createMcpExtension, DefaultResourceLoader,
  ModelRuntime, SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { createMcpSettingsTransports } from './mcp-settings-transports.js'

const { entry, action, temporary } = workerData
const controller = new AbortController()
const { signal } = controller
const send = (message) => parentPort.postMessage(message)
const transports = createMcpSettingsTransports(signal, (pid, active) => send({ type: 'process', pid, active }))
const prompts = new Map()
let nextPrompt = 0
let session
let closing
const close = () => {
  closing ||= (async () => {
    for (const finish of prompts.values()) finish(undefined)
    await transports.close()
    try {
      await session?.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
    } finally {
      session?.dispose()
      send({ type: 'closed' })
    }
  })()
  return closing
}
parentPort.on('message', (message) => {
  if (message.type === 'abort') {
    controller.abort()
    void close().catch(() => send({ type: 'closed' }))
  }
  if (message.type === 'answer') prompts.get(message.id)?.(message.value)
})

async function run() {
  const config = { ...entry.config, enabled: true }
  if (action !== 'logout' && 'url' in config && config.oauth?.clientSecret !== undefined
    && !Object.keys(config.headers || {}).some((name) => name.toLowerCase() === 'authorization')) {
    config.oauth = { ...config.oauth }
    try {
      const secret = await transports.resolveValue(config.oauth.clientSecret)
      config.oauth.clientSecret = secret.replace(/\$/g, () => '$$').replace(/^!/, '$!')
    } catch {
      Object.defineProperty(config.oauth, 'clientSecret', {
        get() { throw new Error('Could not resolve MCP configuration.') },
      })
    }
  }
  signal.throwIfAborted()
  const extensionName = 'leyline-mcp-settings'
  const extensionPath = `<inline:${extensionName}>`
  const notices = []
  let statusRequested = false
  let failure = false
  const notify = (message, level = 'info') => {
    if (signal.aborted) return
    send({ type: 'event', event: { type: 'info', message, level } })
  }
  const nativeNotify = (message, level) => {
    if (level === 'error') {
      failure = true
      notify('MCP management failed. Check the server configuration and try again.', 'error')
      return
    }
    const first = String(message).split('\n', 1)[0]
    const prefix = `${entry.name}: `
    if (statusRequested && first.startsWith(prefix)) {
      const status = first.slice(prefix.length).match(/^(connected, \d+ tools|needs sign-in, run \/mcp login [A-Za-z0-9_-]+|failed|disconnected, reconnects on next call|connecting|starting|closed|disabled) \((codemode|codemode-deferred|deferred|direct|hidden)\)$/)?.[1]
      if (status) {
        const state = status.startsWith('needs sign-in') ? 'needs sign-in' : status
        const text = `Temporary connection: ${state}.`
        notices.push(text)
        notify(text)
      }
    } else if (message === `Signed out of MCP server "${entry.name}".`) {
      notices.push('Signed out.')
      notify('Signed out.')
    } else if (message === `No stored credentials for MCP server "${entry.name}".`) {
      notices.push('No stored credentials.')
      notify('No stored credentials.')
    } else if (message === 'Sign-in cancelled.') {
      failure = true
      notify('Sign-in cancelled.')
    }
  }
  const settingsManager = SettingsManager.inMemory({
    defaultTools: [], compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off',
  }, { projectTrusted: false })
  const resourceLoader = new DefaultResourceLoader({
    cwd: temporary, agentDir: temporary, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPrompt: '', appendSystemPrompt: [],
    extensionFactories: [{
      name: extensionName,
      factory: createMcpExtension({
        loadConfig: () => ({ servers: [{ ...entry, config }], errors: [], autoEnableCodemode: false }),
        createTransport: (...args) => {
          if (action === 'logout') throw new Error('No connection is needed to sign out.')
          return transports.createTransport(...args)
        },
        logPath: join(temporary, 'mcp.log'),
        openUrl: (url) => {
          signal.throwIfAborted()
          send({ type: 'event', event: { type: 'auth_url', url } })
        },
        updateConfig: () => { throw new Error('Management probes cannot change saved configuration.') },
      }),
    }],
  })
  await resourceLoader.reload()
  const loaded = resourceLoader.getExtensions()
  if (loaded.errors.length || loaded.extensions.length !== 1 || loaded.extensions[0].path !== extensionPath) throw new Error('MCP extension unavailable.')
  const modelRuntime = await ModelRuntime.create({
    authPath: join(temporary, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false,
  })
  const model = modelRuntime.getModels()[0]
  if (!model) throw new Error('Static model unavailable.')
  signal.throwIfAborted()
  ;({ session } = await createAgentSession({
    cwd: process.cwd(), agentDir: temporary, resourceLoader, settingsManager, modelRuntime, model,
    thinkingLevel: 'off', noTools: 'all', excludeTools: ['codemode'],
    sessionManager: SessionManager.inMemory(process.cwd()),
  }))
  signal.throwIfAborted()
  const runner = session.extensionRunner
  const command = runner.getCommand('mcp')
  if (!command || command.sourceInfo.path !== extensionPath
    || command.handler !== loaded.extensions[0].commands.get('mcp')?.handler) throw new Error('MCP command unavailable.')
  await session.bindExtensions({
    mode: 'rpc',
    onError: () => { failure = true },
    uiContext: {
      ...runner.getUIContext(), notify: nativeNotify,
      input: async (_message, _placeholder, options = {}) => {
        const promptSignal = AbortSignal.any([signal, options.signal].filter(Boolean))
        if (promptSignal.aborted) return undefined
        const id = ++nextPrompt
        return new Promise((resolve) => {
          const finish = (value) => {
            prompts.delete(id)
            promptSignal.removeEventListener('abort', abort)
            send({ type: 'cancel_prompt', id })
            resolve(value)
          }
          const abort = () => finish(undefined)
          prompts.set(id, finish)
          promptSignal.addEventListener('abort', abort, { once: true })
          send({ type: 'prompt', id })
        })
      },
    },
  })
  signal.throwIfAborted()
  if (action === 'logout') notify('This operation removes stored credentials without opening a connection.')
  else {
    notify('This operation opens a temporary connection and closes it afterward. It does not report conversation connections.')
    if (entry.config.enabled === false) notify('This operation connects the disabled server temporarily. Its saved enabled setting is unchanged.')
  }
  if (action === 'login') notify('Cancellation stops this operation. Credentials already saved by native OAuth are not rolled back.')
  await command.handler('', runner.createCommandContext())
  signal.throwIfAborted()
  if (failure) throw new Error('MCP runtime failed.')
  if (action !== 'check') {
    await command.handler(`${action} ${entry.name}`, runner.createCommandContext())
    signal.throwIfAborted()
    if (failure) throw new Error('MCP action failed.')
  }
  statusRequested = true
  await command.handler('', runner.createCommandContext())
  signal.throwIfAborted()
  if (failure || !notices.length) throw new Error('MCP status unavailable.')
  const secrets = [...transports.secrets].sort((a, b) => b.length - a.length)
  const clean = (value) => {
    let text = String(value ?? '')
    for (const secret of secrets) text = text.split(secret).join('[redacted]')
    return text
  }
  return {
    report: notices.join('\n'),
    tools: runner.getAllRegisteredTools().filter((tool) => tool.sourceInfo.path === extensionPath).map(({ definition }) => ({
      name: clean(definition.name), description: clean(definition.description), exposure: definition.exposure ?? 'direct',
    })),
  }
}

try {
  send({ type: 'result', result: await run() })
} catch {
  controller.abort()
  send({ type: 'failure' })
} finally {
  await close().catch(() => send({ type: 'closed' }))
}
