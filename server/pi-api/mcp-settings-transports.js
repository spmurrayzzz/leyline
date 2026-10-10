import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getShellConfig } from '@earendil-works/pi-coding-agent'

const require = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'))
const { StdioTransport, StreamableHttpTransport } = await import(pathToFileURL(require.resolve('@earendil-works/pi-mcp', {
  conditions: new Set(['node', 'import']),
})).href)

export function killMcpProcess(pid) {
  if (process.platform === 'win32') {
    spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true,
    }).on('error', () => {})
  } else {
    try { process.kill(-pid, 'SIGKILL') } catch {}
  }
}

function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || (process.platform === 'win32' && value.startsWith('~\\'))) return join(homedir(), value.slice(2))
  return value
}

export function createMcpSettingsTransports(signal, track) {
  const transports = new Set()
  const pendingCommands = new Set()
  const secrets = new Set()
  const controller = new AbortController()
  const activeSignal = AbortSignal.any([signal, controller.signal])
  const remember = (value) => {
    if (typeof value !== 'string' || !value) return value
    secrets.add(value)
    const token = value.match(/^(?:Bearer|Basic)\s+(.+)$/i)?.[1]
    if (token) secrets.add(token)
    return value
  }
  const execute = async (command) => {
    const pending = new Promise((resolveValue, reject) => {
      activeSignal.throwIfAborted()
      let shellConfig
      try {
        shellConfig = getShellConfig()
      } catch (error) {
        if (process.platform !== 'win32') throw error
        shellConfig = {
          shell: process.env.ComSpec || join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'),
          args: [], commandTransport: 'shell',
        }
      }
      const { shell, args, commandTransport } = shellConfig
      const stdin = commandTransport === 'stdin'
      const useShell = commandTransport === 'shell'
      const child = spawn(useShell ? command : shell, stdin || useShell ? args : [...args, command], {
        shell: useShell ? shell : false,
        detached: process.platform !== 'win32', windowsHide: true, stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'ignore'],
      })
      const pid = child.pid
      if (pid) track(pid, true)
      let output = ''
      let bytes = 0
      let failed = false
      const stop = () => {
        failed = true
        if (pid) killMcpProcess(pid)
      }
      const timer = setTimeout(stop, 10000)
      activeSignal.addEventListener('abort', stop, { once: true })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 1024 * 1024) stop()
        else output += chunk
      })
      child.on('error', () => { failed = true })
      child.on('close', (code) => {
        clearTimeout(timer)
        activeSignal.removeEventListener('abort', stop)
        if (pid) {
          killMcpProcess(pid)
          track(pid, false)
        }
        if (failed || code !== 0 || !output.trim()) reject(new Error('Could not resolve MCP configuration.'))
        else resolveValue(output.trim())
      })
      child.stdin?.on('error', () => {})
      if (stdin) child.stdin.end(command)
      if (activeSignal.aborted) stop()
    })
    pendingCommands.add(pending)
    try {
      return await pending
    } finally {
      pendingCommands.delete(pending)
    }
  }
  const resolveValue = async (value) => {
    activeSignal.throwIfAborted()
    if (value.startsWith('!')) return remember(await execute(value.slice(1)))
    return remember(value.replace(/\$(\$|!|\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*)/g, (match, part) => {
      if (part === '$' || part === '!') return part
      const name = part.startsWith('{') ? part.slice(1, -1) : part
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return match
      if (!process.env[name]) throw new Error('Could not resolve MCP configuration.')
      return remember(process.env[name])
    }))
  }
  const createTransport = (entry, cwd, authProvider) => {
    activeSignal.throwIfAborted()
    let native
    let closing
    let shutdownSignal
    let closed = false
    let pid
    const listeners = { onMessage: new Set(), onError: new Set(), onClose: new Set() }
    const emit = (kind, value) => {
      for (const listener of listeners[kind]) listener(value)
    }
    const adapter = {
      async start() {
        try {
          const config = entry.config
          const values = {}
          for (const [key, value] of Object.entries(('url' in config ? config.headers : config.env) || {})) {
            values[key] = await resolveValue(value)
          }
          activeSignal.throwIfAborted()
          if (closed) throw new Error('MCP connection closed.')
          native = 'url' in config
            ? new StreamableHttpTransport({
              url: config.url, headers: values,
              authProvider: authProvider && {
                async token() {
                  const authSignal = closed ? shutdownSignal : activeSignal
                  authSignal.throwIfAborted()
                  const token = remember(await authProvider.token())
                  if (token) remember(`Bearer ${token}`)
                  return token
                },
                ...(authProvider.onUnauthorized ? {
                  onUnauthorized: (context) => {
                    activeSignal.throwIfAborted()
                    return authProvider.onUnauthorized(context)
                  },
                } : {}),
              },
              fetch: (input, init = {}) => {
                remember(new Headers(init.headers).get('authorization'))
                return fetch(input, {
                  ...init,
                  signal: AbortSignal.any([
                    closed && init.method === 'DELETE' ? shutdownSignal : activeSignal,
                    init.signal, AbortSignal.timeout(60000),
                  ].filter(Boolean)),
                })
              },
            })
            : new StdioTransport({
              command: expandHome(config.command), args: config.args?.map(expandHome),
              cwd: resolve(cwd, expandHome(config.cwd ?? '.')), env: values, stderr: 'pipe', closeTimeoutMs: 500,
            })
          native.onMessage((message) => emit('onMessage', message))
          native.onError((error) => emit('onError', error))
          native.onClose(() => { void adapter.close() })
          const starting = native.start()
          pid = native instanceof StdioTransport ? native.pid : undefined
          if (pid) track(pid, true)
          await starting
          activeSignal.throwIfAborted()
        } catch (error) {
          await adapter.close()
          throw error
        }
      },
      async send(message) {
        activeSignal.throwIfAborted()
        if (closed || !native) throw new Error('MCP connection closed.')
        return native.send(message)
      },
      setProtocolVersion(version) { native?.setProtocolVersion?.(version) },
      close() {
        if (closing) return closing
        closed = true
        shutdownSignal = AbortSignal.any([signal, AbortSignal.timeout(3000)])
        closing = Promise.resolve().then(async () => {
          emit('onClose')
          try { await native?.close() } finally {
            if (pid) {
              killMcpProcess(pid)
              track(pid, false)
            }
            transports.delete(adapter)
            for (const set of Object.values(listeners)) set.clear()
          }
        })
        return closing
      },
    }
    for (const kind of Object.keys(listeners)) {
      adapter[kind] = (listener) => {
        listeners[kind].add(listener)
        return () => listeners[kind].delete(listener)
      }
    }
    transports.add(adapter)
    return adapter
  }
  return {
    createTransport, resolveValue, secrets,
    async close() {
      controller.abort()
      await Promise.allSettled([...pendingCommands, ...[...transports].map((transport) => transport.close())])
    },
  }
}
