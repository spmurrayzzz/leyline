import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'
import pty from 'node-pty'
import { WebSocket, WebSocketServer } from 'ws'
import {
  imageBlocksFor,
  messageBlocksFor,
  projectTranscriptEntries,
  skillSummaries,
} from '../lib/transcript-projection.js'
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const BUNDLED_GOAL_EXTENSION = resolve(
  __dirname,
  '..',
  '.pi',
  'extensions',
  'goal',
  'index.ts',
)

let activeRuntime
let activeSessionId
let unsubscribeActiveSession
let extensionUiState = emptyExtensionUiState()

const sseClients = new Set()
const GOAL_STATE_TYPE = 'goal-state'
const SESSION_DIR_ENV = 'PI_CODING_AGENT_SESSION_DIR'
const HIDDEN_SLASH_COMMANDS = new Set([
  'changelog',
  'clone',
  'copy',
  'export',
  'fork',
  'hotkeys',
  'import',
  'login',
  'logout',
  'model',
  'name',
  'new',
  'quit',
  'reload',
  'resume',
  'scoped-models',
  'session',
  'settings',
  'share',
  'tree',
])

process.env.PI_CODING_AGENT ??= 'true'

const ONE_AT_A_TIME = 'one-at-a-time'
const exportMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
})

function preferBundledGoalExtension(result) {
  const bundled = result.extensions.find((extension) => {
    return extension.resolvedPath === BUNDLED_GOAL_EXTENSION
  })
  if (!bundled?.commands?.has('goal')) return result

  return {
    ...result,
    extensions: result.extensions.filter((extension) => {
      if (extension === bundled) return true
      return !extension.commands?.has('goal')
    }),
  }
}

const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({
    cwd,
    resourceLoaderOptions: {
      additionalExtensionPaths: [BUNDLED_GOAL_EXTENSION],
      extensionsOverride: preferBundledGoalExtension,
    },
  })
  const runtime = {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
    })),
    services,
    diagnostics: services.diagnostics,
  }
  forceOneAtATime(runtime.session)
  return runtime
}

export function piApi() {
  return {
    name: 'pi-api',
    configureServer(server) {
      configurePiWebSocketServer(server.httpServer)
      server.middlewares.use('/api/pi', piApiHandler)
    },
  }
}

export function configurePiWebSocketServer(httpServer) {
  const terminalServer = new WebSocketServer({ noServer: true })

  terminalServer.on('connection', openTerminal)
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== '/api/pi/terminal') return

    terminalServer.handleUpgrade(req, socket, head, (ws) => {
      terminalServer.emit('connection', ws, req)
    })
  })
}

export async function piApiHandler(req, res) {
  const url = new URL(req.url, 'http://localhost')

  try {
    if (url.pathname === '/sessions') {
      if (req.method === 'GET') {
        const sessions = await listSessions()
        return json(res, { sessions: sessions.map(toSessionDto) })
      }

      if (req.method === 'POST') {
        const body = await readJson(req)
        const active = await createNewSession(body.cwd)
        return json(res, {
          active,
          detail: toActiveSessionDetailDto(),
        })
      }

      return json(res, { error: 'Method not allowed' }, 405)
    }

    if (url.pathname === '/active-session') {
      if (req.method !== 'POST') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      const body = await readJson(req)
      const session = await resolveSession(body.id, body.path, body.cwd)
      if (!session) return json(res, { error: 'Session not found' }, 404)

      const active = await switchActiveSession(session)
      return json(res, { active })
    }

    if (url.pathname === '/state') {
      if (req.method !== 'GET') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      const active = await runtimeState(url.searchParams.get('cwd'))
      return json(res, { active })
    }

    if (url.pathname === '/fs') {
      if (req.method !== 'GET') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      return json(res, await readDirectory(url.searchParams.get('path')))
    }

    if (url.pathname === '/prompt') {
      if (req.method !== 'POST') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      const body = await readJson(req)
      await promptActiveSession(
        body.text,
        body.images,
        body.streamingBehavior,
      )
      return json(res, { ok: true, active: activeSessionDto() })
    }

    if (url.pathname === '/bash') {
      if (req.method !== 'POST') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      const body = await readJson(req)
      await bashActiveSession(body.command, body.excludeFromContext)
      return json(res, {
        ok: true,
        active: activeSessionDto(),
        detail: toActiveSessionDetailDto(),
      })
    }

    if (url.pathname === '/compact') {
      if (req.method !== 'POST') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      const body = await readJson(req)
      await compactActiveSession(body.customInstructions)
      return json(res, {
        ok: true,
        active: activeSessionDto(),
        detail: toActiveSessionDetailDto(),
      })
    }

    if (url.pathname === '/edit-prompt') {
      if (req.method !== 'POST') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      const body = await readJson(req)
      await editActivePrompt(body.entryId, body.text, body.images)
      return json(res, { ok: true, active: activeSessionDto() })
    }

    if (url.pathname === '/fork') {
      if (req.method !== 'POST') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      const body = await readJson(req)
      const active = await forkActiveSession(body.entryId)
      return json(res, {
        ok: true,
        active,
        detail: toActiveSessionDetailDto(),
      })
    }

    if (url.pathname === '/reload') {
      if (req.method !== 'POST') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      await reloadActiveSession()
      return json(res, { ok: true, active: activeSessionDto() })
    }

    if (url.pathname === '/model') {
      if (req.method !== 'POST') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      const body = await readJson(req)
      await setActiveModel(body.provider, body.id)
      return json(res, { ok: true, active: activeSessionDto() })
    }

    if (url.pathname === '/thinking') {
      if (req.method !== 'POST') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      const body = await readJson(req)
      setActiveThinkingLevel(body.level)
      return json(res, { ok: true, active: activeSessionDto() })
    }

    if (url.pathname === '/mode') {
      if (req.method !== 'POST') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      await readJson(req)
      setActiveMode()
      return json(res, { ok: true, active: activeSessionDto() })
    }

    if (url.pathname === '/interrupt') {
      if (req.method !== 'POST') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      await interruptActiveSession()
      return json(res, { ok: true, active: activeSessionDto() })
    }

    if (url.pathname === '/events') {
      if (req.method !== 'GET') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      return openEventStream(req, res)
    }

    const exportMatch = url.pathname.match(/^\/sessions\/([^/]+)\/export$/)
    if (exportMatch) {
      if (req.method !== 'GET') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      const detail = await exportSessionDetail(exportMatch[1])
      return html(res, await renderSessionExportHtml(detail), exportFilename(detail))
    }

    const match = url.pathname.match(/^\/sessions\/([^/]+)$/)
    if (match) {
      if (req.method === 'DELETE') {
        const trashed = await trashSession(match[1])
        return json(res, { ok: true, trashed })
      }

      if (req.method !== 'GET') {
        return json(res, { error: 'Method not allowed' }, 405)
      }

      if (isActiveSession(match[1])) {
        return json(res, toActiveSessionDetailDto())
      }

      const path = url.searchParams.get('path')
      if (path) return json(res, toSessionDetailFromPath(match[1], path))

      const session = await findSession(match[1])
      if (!session) return json(res, { error: 'Session not found' }, 404)
      return json(res, toSessionDetailDto(session))
    }

    return json(res, { error: 'Not found' }, 404)
  } catch (error) {
    return json(res, { error: error.message }, 500)
  }
}

async function readDirectory(path) {
  const current = normalizeFsPath(path)
  const info = await stat(current)
  if (!info.isDirectory()) throw new Error('Path is not a folder')

  const entries = await readdir(current, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: join(current, entry.name),
      hidden: entry.name.startsWith('.'),
    }))
    .sort((a, b) => {
      if (a.hidden !== b.hidden) return a.hidden ? 1 : -1
      return a.name.localeCompare(b.name)
    })

  return {
    path: current,
    parent: dirname(current) === current ? '' : dirname(current),
    home: homedir(),
    directories,
  }
}

function normalizeFsPath(path) {
  const value = path?.trim() || homedir()
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return join(homedir(), value.slice(2))
  return isAbsolute(value) ? resolve(value) : resolve(process.cwd(), value)
}

async function listSessions() {
  const sessionDir = configuredSessionDir(process.cwd())
  const sessions = sessionDir
    ? await listSessionsFromConfiguredDir(sessionDir)
    : await SessionManager.listAll()

  if (!activeRuntime) return sessions
  if (sessions.some((session) => session.id === activeSessionId)) {
    return sessions
  }
  return [activeSessionInfo(), ...sessions]
}

async function findSession(id) {
  if (isActiveSession(id)) return activeSessionInfo()
  const sessions = await listSessions()
  return sessions.find((session) => session.id === id)
}

async function resolveSession(id, path, cwd) {
  if (isActiveSession(id)) return activeSessionInfo()
  if (path) return { id, path, cwd: cwd || '' }
  return findSession(id)
}

function configuredSessionDir(cwd) {
  const envSessionDir = process.env[SESSION_DIR_ENV]
  if (envSessionDir) return expandTildePath(envSessionDir)
  return SettingsManager.create(cwd, getAgentDir()).getSessionDir()
}

function expandTildePath(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return homedir() + value.slice(1)
  return value
}

async function listSessionsFromConfiguredDir(sessionDir) {
  const files = await sessionFiles(sessionDir)
  const sessions = await Promise.all(files.map(buildSessionInfo))
  return sessions
    .filter(Boolean)
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
}

async function sessionFiles(sessionDir) {
  try {
    const entries = await readdir(sessionDir, { withFileTypes: true })
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => join(sessionDir, entry.name))
    const dirs = entries.filter((entry) => entry.isDirectory())
    const nested = await Promise.all(
      dirs.map((entry) => sessionFiles(join(sessionDir, entry.name))),
    )
    return [...files, ...nested.flat()]
  } catch {
    return []
  }
}

async function buildSessionInfo(filePath) {
  try {
    const [content, stats] = await Promise.all([
      readFile(filePath, 'utf8'),
      stat(filePath),
    ])
    const entries = parseSessionEntries(content)
    const header = entries[0]

    if (header?.type !== 'session' || typeof header.id !== 'string') {
      return null
    }

    let messageCount = 0
    let firstMessage = ''
    let name
    const allMessages = []
    const goal = goalStateFromEntries(entries)

    for (const entry of entries) {
      if (entry.type === 'session_info') {
        name = entry.name?.trim() || undefined
      }
      if (entry.type !== 'message') continue
      messageCount++

      const message = entry.message
      if (!message || !('content' in message)) continue
      if (message.role !== 'user' && message.role !== 'assistant') continue

      const text = messageText(message.content)
      if (!text) continue
      allMessages.push(text)
      if (!firstMessage && message.role === 'user') firstMessage = text
    }

    return {
      path: filePath,
      id: header.id,
      cwd: typeof header.cwd === 'string' ? header.cwd : '',
      name,
      parentSessionPath: header.parentSession,
      created: new Date(header.timestamp),
      modified: sessionModifiedDate(entries, header, stats.mtime),
      messageCount,
      firstMessage: firstMessage || goal?.objective || '(no messages)',
      allMessagesText: allMessages.join(' '),
    }
  } catch {
    return null
  }
}

function parseSessionEntries(content) {
  const entries = []
  for (const line of content.trim().split('\n')) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line))
    } catch {}
  }
  return entries
}

function messageText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join(' ')
}

function sessionModifiedDate(entries, header, statsMtime) {
  let lastActivityTime
  for (const entry of entries) {
    if (entry.type !== 'message') continue

    const message = entry.message
    if (!message || !('content' in message)) continue
    if (message.role !== 'user' && message.role !== 'assistant') continue

    if (typeof message.timestamp === 'number') {
      lastActivityTime = Math.max(lastActivityTime ?? 0, message.timestamp)
      continue
    }

    if (typeof entry.timestamp === 'string') {
      const time = new Date(entry.timestamp).getTime()
      if (!Number.isNaN(time)) lastActivityTime = Math.max(
        lastActivityTime ?? 0,
        time,
      )
    }
  }

  if (typeof lastActivityTime === 'number' && lastActivityTime > 0) {
    return new Date(lastActivityTime)
  }

  const headerTime = new Date(header.timestamp).getTime()
  return Number.isNaN(headerTime) ? statsMtime : new Date(headerTime)
}

function isActiveSession(id) {
  return activeRuntime && id === activeSessionId
}

async function switchActiveSession(session) {
  if (isActiveSession(session.id)) return activeSessionDto()

  if (!activeRuntime) {
    activeRuntime = await createAgentSessionRuntime(createRuntime, {
      cwd: session.cwd,
      agentDir: getAgentDir(),
      sessionManager: SessionManager.open(session.path),
    })
  } else if (activeRuntime.session.sessionFile !== session.path) {
    await activeRuntime.switchSession(session.path)
  }

  forceOneAtATime(activeRuntime.session)
  activeSessionId = activeRuntime.session.sessionManager.getSessionId()
  if (session.id && activeSessionId !== session.id) {
    throw new Error('Session path does not match session id')
  }
  await bindActiveSession()

  return activeSessionDto()
}

async function promptActiveSession(text, images = [], streamingBehavior) {
  if (!activeRuntime) throw new Error('No active session')
  forceOneAtATime(activeRuntime.session)
  const promptText = typeof text === 'string' ? text : ''
  const promptImages = validateImages(images)
  if (!promptText.trim() && promptImages.length === 0) {
    throw new Error('text or image is required')
  }
  if (streamingBehavior
    && !['steer', 'followUp'].includes(streamingBehavior)) {
    throw new Error('invalid streaming behavior')
  }

  let preflightSucceeded = false
  await new Promise((resolve, reject) => {
    activeRuntime.session
      .prompt(promptText, {
        images: promptImages,
        streamingBehavior,
        source: 'api',
        preflightResult: (didSucceed) => {
          if (!didSucceed) return
          preflightSucceeded = true
          resolve()
        },
      })
      .catch((error) => {
        if (!preflightSucceeded) reject(error)
      })
  })
}

async function bashActiveSession(command, excludeFromContext = false) {
  if (!activeRuntime) throw new Error('No active session')
  const bashCommand = typeof command === 'string' ? command.trim() : ''
  if (!bashCommand) throw new Error('shell command is required')
  if (activeRuntime.session.isBashRunning) {
    throw new Error('A shell command is already running')
  }

  const eventResult = await activeRuntime.session.extensionRunner.emitUserBash({
    type: 'user_bash',
    command: bashCommand,
    excludeFromContext: excludeFromContext === true,
    cwd: activeRuntime.session.sessionManager.getCwd(),
  })

  if (eventResult?.result) {
    activeRuntime.session.recordBashResult(bashCommand, eventResult.result, {
      excludeFromContext: excludeFromContext === true,
    })
    return eventResult.result
  }

  return activeRuntime.session.executeBash(bashCommand, undefined, {
    excludeFromContext: excludeFromContext === true,
    operations: eventResult?.operations,
  })
}

async function compactActiveSession(customInstructions) {
  if (!activeRuntime) throw new Error('No active session')
  if (activeRuntime.session.isStreaming) {
    throw new Error('Wait for the current response to finish before compacting.')
  }
  if (activeRuntime.session.isCompacting) {
    throw new Error('Compaction is already running.')
  }

  const entries = activeRuntime.session.sessionManager.getEntries()
  const messageCount = entries.filter((entry) => entry.type === 'message').length
  if (messageCount < 2) throw new Error('Nothing to compact (no messages yet)')

  const instructions = typeof customInstructions === 'string'
    ? customInstructions.trim()
    : ''
  await activeRuntime.session.compact(instructions || undefined)
}

function validateImages(images) {
  if (!images) return []
  if (!Array.isArray(images)) throw new Error('images must be an array')

  return images.map((image) => {
    if (image?.type !== 'image') throw new Error('invalid image')
    if (typeof image.data !== 'string') throw new Error('invalid image data')
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(image.mimeType || '')) {
      throw new Error('unsupported image type')
    }
    return {
      type: 'image',
      data: image.data,
      mimeType: image.mimeType,
    }
  })
}

async function interruptActiveSession() {
  if (!activeRuntime) throw new Error('No active session')
  await activeRuntime.session.abort()
}

async function editActivePrompt(entryId, text, images = []) {
  if (!activeRuntime) throw new Error('No active session')
  if (!entryId) throw new Error('entryId is required')
  if (activeRuntime.session.isStreaming) {
    throw new Error('Wait for the current response to finish before editing.')
  }
  if (activeRuntime.session.isCompacting) {
    throw new Error('Wait for compaction to finish before editing.')
  }

  const entry = activeRuntime.session.sessionManager.getEntry(entryId)
  if (entry?.type !== 'message' || entry.message?.role !== 'user') {
    throw new Error('Only user messages can be edited')
  }

  const result = await activeRuntime.session.navigateTree(entryId)
  if (result.cancelled) throw new Error('Edit cancelled')
  await promptActiveSession(text, images)
}

async function forkActiveSession(entryId) {
  if (!activeRuntime) throw new Error('No active session')
  if (!entryId) throw new Error('entryId is required')
  if (activeRuntime.session.isStreaming) {
    throw new Error('Wait for the current response to finish before forking.')
  }
  if (activeRuntime.session.isCompacting) {
    throw new Error('Wait for compaction to finish before forking.')
  }

  const result = await activeRuntime.fork(entryId, { position: 'at' })
  if (result.cancelled) throw new Error('Fork cancelled')
  forceOneAtATime(activeRuntime.session)
  activeSessionId = activeRuntime.session.sessionManager.getSessionId()
  await bindActiveSession()
  return activeSessionDto()
}

async function trashSession(id) {
  const session = await findSession(id)
  if (!session) throw new Error('Session not found')
  if (isActiveSession(id)) {
    if (activeRuntime.session.isStreaming) {
      throw new Error('Wait for the current response to finish before deleting.')
    }
    if (activeRuntime.session.isCompacting) {
      throw new Error('Wait for compaction to finish before deleting.')
    }
  }

  if (isActiveSession(id) && !existsSync(session.path)) {
    discardActiveSession()
    return { path: null }
  }

  const trashPath = trashSessionPath(session)
  await mkdir(dirname(trashPath), { recursive: true })
  try {
    await rename(session.path, trashPath)
  } catch (error) {
    if (!isActiveSession(id) || error?.code !== 'ENOENT') throw error
    discardActiveSession()
    return { path: null }
  }

  if (isActiveSession(id)) discardActiveSession()

  return { path: trashPath }
}

function discardActiveSession() {
  unsubscribeActiveSession?.()
  unsubscribeActiveSession = undefined
  activeRuntime.session.dispose()
  activeRuntime = undefined
  activeSessionId = undefined
}

function trashSessionPath(session) {
  const sessionDir = configuredSessionDir(session.cwd) || dirname(session.path)
  const rel = relative(sessionDir, session.path)
  const safeRel = rel && !rel.startsWith('..') && rel !== session.path
    ? rel
    : basename(session.path)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(dirname(sessionDir), 'leyline-trash', stamp, safeRel)
}

async function reloadActiveSession() {
  if (!activeRuntime) throw new Error('No active session')
  if (activeRuntime.session.isStreaming) {
    throw new Error('Wait for the current response to finish before reloading.')
  }
  if (activeRuntime.session.isCompacting) {
    throw new Error('Wait for compaction to finish before reloading.')
  }

  await activeRuntime.session.reload()
  forceOneAtATime(activeRuntime.session)
  await bindActiveSession()
}

async function setActiveModel(provider, id) {
  if (!activeRuntime) throw new Error('No active session')
  if (!provider || !id) throw new Error('provider and id are required')

  const model = activeRuntime.services.modelRegistry.find(provider, id)
  if (!model) throw new Error('Model not found')
  await activeRuntime.session.setModel(model)
}

function setActiveThinkingLevel(level) {
  if (!activeRuntime) throw new Error('No active session')
  if (!level) throw new Error('level is required')

  const levels = activeRuntime.session.getAvailableThinkingLevels()
  if (!levels.includes(level)) throw new Error('Thinking level not available')
  activeRuntime.session.setThinkingLevel(level)
}

function setActiveMode() {
  if (!activeRuntime) throw new Error('No active session')
  forceOneAtATime(activeRuntime.session)
}

function forceOneAtATime(session) {
  session.setSteeringMode(ONE_AT_A_TIME)
  session.setFollowUpMode(ONE_AT_A_TIME)
}

async function createNewSession(cwd) {
  if (!cwd) throw new Error('cwd is required')

  if (activeRuntime && activeRuntime.cwd === cwd) {
    const result = await activeRuntime.newSession()
    if (result.cancelled) throw new Error('New session cancelled')
  } else {
    unsubscribeActiveSession?.()
    activeRuntime?.session.dispose()
    activeRuntime = await createAgentSessionRuntime(createRuntime, {
      cwd,
      agentDir: getAgentDir(),
      sessionManager: SessionManager.create(cwd, configuredSessionDir(cwd)),
    })
  }

  forceOneAtATime(activeRuntime.session)
  activeSessionId = activeRuntime.session.sessionManager.getSessionId()
  await bindActiveSession()
  return activeSessionDto()
}

function activeSessionDto() {
  return {
    id: activeSessionId,
    path: activeRuntime.session.sessionFile,
    cwd: activeRuntime.cwd,
    diagnostics: activeRuntime.diagnostics,
    state: activeSessionStateDto(),
  }
}

function activeSessionStateDto() {
  return sessionStateDto(activeRuntime.session, activeRuntime.services)
}

function sessionStateDto(session, services) {
  return {
    model: modelDto(session.model),
    availableModels: services.modelRegistry.getAvailable().map(modelDto),
    thinkingLevel: session.thinkingLevel,
    availableThinkingLevels: session.getAvailableThinkingLevels(),
    steeringMode: session.steeringMode,
    followUpMode: session.followUpMode,
    activeToolCount: session.getActiveToolNames().length,
    contextUsage: session.getContextUsage?.(),
    slashCommands: slashCommandDtos(session),
    queuedMessages: {
      steering: [...session.getSteeringMessages()],
      followUp: [...session.getFollowUpMessages()],
    },
    extensionUi: extensionUiState,
    goal: goalStateFromSession(session),
  }
}

function slashCommandDtos(session) {
  const commands = [
    {
      name: 'compact',
      description: 'Manually compact context, optional custom instructions',
      source: 'command',
    },
    ...session.extensionRunner.getRegisteredCommands().map((command) => ({
      name: command.invocationName,
      description: command.description,
      source: 'extension',
    })),
    ...session.promptTemplates.map((template) => ({
      name: template.name,
      description: template.description,
      source: 'prompt',
    })),
    ...session.resourceLoader.getSkills().skills.map((skill) => ({
      name: `skill:${skill.name}`,
      description: skill.description,
      source: 'skill',
    })),
  ]

  return commands
    .filter((command) => {
      return command.name && !HIDDEN_SLASH_COMMANDS.has(command.name)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function runtimeState(cwd) {
  const targetCwd = cwd || activeRuntime?.cwd || process.cwd()
  if (activeRuntime?.cwd === targetCwd) return activeSessionDto()

  const result = await createRuntime({
    cwd: targetCwd,
    agentDir: getAgentDir(),
    sessionManager: SessionManager.create(
      targetCwd,
      configuredSessionDir(targetCwd),
    ),
  })

  try {
    return {
      id: '',
      path: result.session.sessionFile,
      cwd: targetCwd,
      diagnostics: result.diagnostics,
      state: sessionStateDto(result.session, result.services),
    }
  } finally {
    result.session.dispose()
  }
}

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']

function modelDto(model) {
  if (!model) return undefined
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    supportsImages: model.input?.includes('image') === true,
    availableThinkingLevels: modelThinkingLevels(model),
  }
}

function modelThinkingLevels(model) {
  if (!model.reasoning) return ['off']
  return THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level]
    if (mapped === null) return false
    if (level === 'xhigh') return mapped !== undefined
    return true
  })
}

function openTerminal(ws) {
  if (!activeRuntime?.cwd) {
    ws.send(JSON.stringify({ type: 'error', message: 'No active session' }))
    ws.close()
    return
  }

  const cwd = activeRuntime.cwd
  const shell = terminalShell()
  const env = terminalEnv()
  let term

  if (!isDirectory(cwd)) {
    ws.send(JSON.stringify({ type: 'error', message: `Invalid cwd: ${cwd}` }))
    ws.close()
    return
  }

  try {
    ensureNodePtyHelperExecutable()
    term = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: 100,
      rows: 24,
      cwd,
      env,
    })
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `Failed to start PTY: ${error.message}`,
    }))
    ws.close()
    return
  }

  let exited = false

  ws.send(JSON.stringify({
    type: 'ready',
    cwd,
    shell,
    pty: true,
  }))

  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data }))
    }
  })

  term.onExit(({ exitCode }) => {
    exited = true
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', exitCode }))
      ws.close()
    }
  })

  ws.on('message', (message) => {
    let payload
    try {
      payload = JSON.parse(message.toString())
    } catch {
      return
    }

    if (payload.type === 'input') term.write(payload.data || '')
    if (payload.type === 'resize') {
      term.resize(payload.cols || 100, payload.rows || 24)
    }
  })

  ws.on('close', () => {
    if (!exited) term.kill()
  })
}

function ensureNodePtyHelperExecutable() {
  if (process.platform !== 'darwin') return

  const nodePtyDir = dirname(require.resolve('node-pty/package.json'))
  const helper = join(
    nodePtyDir,
    'prebuilds',
    `darwin-${process.arch}`,
    'spawn-helper',
  ).replace('app.asar', 'app.asar.unpacked')

  if (!existsSync(helper)) return
  const mode = statSync(helper).mode
  if (mode & 0o111) return
  chmodSync(helper, mode | 0o755)
}

function terminalShell() {
  const candidates = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh']
  return candidates.find((shell) => shell && existsSync(shell)) || '/bin/sh'
}

function terminalEnv() {
  const env = Object.fromEntries(
    Object.entries(process.env)
      .filter((entry) => entry[1] !== undefined)
      .map(([key, value]) => [key, String(value)]),
  )
  delete env.npm_config_prefix
  delete env.NPM_CONFIG_PREFIX
  env.SHELL = terminalShell()
  return env
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

async function bindActiveSession() {
  unsubscribeActiveSession?.()
  extensionUiState = emptyExtensionUiState()
  await activeRuntime.session.bindExtensions({
    uiContext: createExtensionUiContext(),
    onError: (error) => {
      broadcastEvent('extension_error', error)
    },
  })
  syncGoalStateFromSession()
  unsubscribeActiveSession = activeRuntime.session.subscribe((event) => {
    syncGoalStateFromSession()
    broadcastEvent('runtime_event', {
      activeSessionId,
      event,
    })
    if (event.type === 'queue_update' || isGoalStateEvent(event)) {
      broadcastActiveSession()
    }
  })
  broadcastActiveSession()
}

function emptyExtensionUiState() {
  return {
    statuses: {},
    widgets: {},
    notifications: [],
  }
}

function createExtensionUiContext() {
  return {
    select: async () => undefined,
    confirm: async () => true,
    input: async () => undefined,
    notify(message, type = 'info') {
      const notification = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        message,
        type,
        timestamp: new Date().toISOString(),
      }
      extensionUiState = {
        ...extensionUiState,
        notifications: [
          ...extensionUiState.notifications.slice(-19),
          notification,
        ],
      }
      broadcastExtensionUi()
    },
    onTerminalInput: () => () => {},
    setStatus(key, text) {
      const statuses = { ...extensionUiState.statuses }
      if (text === undefined) delete statuses[key]
      else statuses[key] = text
      extensionUiState = { ...extensionUiState, statuses }
      broadcastExtensionUi()
    },
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget(key, content, options = {}) {
      const widgets = { ...extensionUiState.widgets }
      if (content === undefined) delete widgets[key]
      else if (Array.isArray(content)) {
        widgets[key] = {
          lines: content.filter((line) => typeof line === 'string'),
          placement: options.placement || 'aboveEditor',
        }
      }
      extensionUiState = { ...extensionUiState, widgets }
      broadcastExtensionUi()
    },
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: async () => undefined,
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => '',
    editor: async () => undefined,
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    theme: {},
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'Theme switching unavailable' }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  }
}

function broadcastExtensionUi() {
  broadcastEvent('extension_ui', {
    activeSessionId,
    state: extensionUiState,
    goal: activeRuntime ? goalStateFromSession(activeRuntime.session) : null,
  })
  if (activeRuntime) broadcastActiveSession()
}

function syncGoalStateFromSession() {
  const goal = activeRuntime
    ? goalStateFromSession(activeRuntime.session)
    : null
  if (!goal) return
  const status = goal.status === 'budget_limited'
    ? 'limited by budget'
    : goal.status === 'continuation_limited'
      ? 'limited by continuations'
      : goal.status
  extensionUiState = {
    ...extensionUiState,
    statuses: {
      ...extensionUiState.statuses,
      goal: `goal: ${status}`,
    },
  }
}

function isGoalStateEvent(event) {
  return event?.type === 'message_end'
    && event.message?.role === 'custom'
    && event.message?.customType === GOAL_STATE_TYPE
}

function goalStateFromSession(session) {
  const entries = session?.sessionManager?.getEntries?.() || []
  return goalStateFromEntries(entries)
}

function goalStateFromEntries(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.type !== 'custom') continue
    if (entry.customType !== GOAL_STATE_TYPE) continue
    return normalizeGoalState(entry.data)
  }
  return null
}

function normalizeGoalState(data) {
  const goal = data?.goal
  if (!goal || typeof goal.objective !== 'string') return null
  return {
    objective: goal.objective,
    status: typeof goal.status === 'string' ? goal.status : '',
    tokenBudget: typeof goal.tokenBudget === 'number' ? goal.tokenBudget : null,
    continuationLimit: Number(goal.continuationLimit || 0),
    continuationsUsed: Number(goal.continuationsUsed || 0),
    tokensUsed: Number(goal.tokensUsed || 0),
    timeUsedSeconds: currentGoalSeconds(goal),
    createdAt: Number(goal.createdAt || 0),
    updatedAt: Number(goal.updatedAt || 0),
  }
}

function currentGoalSeconds(goal) {
  const base = Number(goal.timeUsedSeconds || 0)
  if (goal.status !== 'active') return base
  if (typeof goal.activeSince !== 'number') return base
  return base + Math.max(0, Math.floor((Date.now() - goal.activeSince) / 1000))
}

function openEventStream(req, res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.write(': connected\n\n')

  sseClients.add(res)

  if (activeRuntime) {
    sendEvent(res, 'active_session', activeSessionDto())
  }

  req.on('close', () => {
    sseClients.delete(res)
  })
}

function broadcastActiveSession() {
  broadcastEvent('active_session', activeSessionDto())
}

function broadcastEvent(type, data) {
  for (const client of sseClients) sendEvent(client, type, data)
}

function sendEvent(res, type, data) {
  res.write(`event: ${type}\n`)
  res.write(`data: ${stringifyEvent(data)}\n\n`)
}

function stringifyEvent(data) {
  try {
    return JSON.stringify(data)
  } catch (error) {
    return JSON.stringify({
      activeSessionId,
      event: {
        type: 'unserializable',
        error: error.message,
      },
    })
  }
}

function toSessionDetailDto(session) {
  return toSessionDetailFromManager(SessionManager.open(session.path), session)
}

function toSessionDetailFromPath(id, path) {
  const manager = SessionManager.open(path)
  if (manager.getSessionId() !== id) {
    throw new Error('Session path does not match session id')
  }
  return toSessionDetailFromManager(manager, { id, path })
}

function toActiveSessionDetailDto() {
  return toSessionDetailFromManager(
    activeRuntime.session.sessionManager,
    activeSessionInfo(),
    activeRuntime.session.getContextUsage?.(),
  )
}

function toSessionDetailFromManager(manager, session, contextUsage) {
  const header = manager.getHeader()
  const entries = manager.getBranch()
  let messageCount = 0
  let firstMessage = ''
  let name = session.name
  const goal = goalStateFromEntries(entries)

  for (const entry of entries) {
    if (entry.type === 'session_info') {
      name = entry.name?.trim() || undefined
    }
    if (entry.type !== 'message') continue
    messageCount++

    const message = entry.message
    if (firstMessage || message?.role !== 'user') continue
    firstMessage = messageText(message.content || message.output || '')
  }

  const info = {
    ...session,
    id: manager.getSessionId(),
    path: manager.getSessionFile(),
    cwd: header.cwd || session.cwd,
    name,
    firstMessage: firstMessage || goal?.objective || '(no messages)',
    created: session.created || new Date(header.timestamp),
    modified: session.modified
      || sessionModifiedDate(entries, header, new Date()),
    messageCount: session.messageCount ?? messageCount,
  }

  return {
    session: {
      ...toSessionDto(info),
      cwd: info.cwd,
      sessionFile: info.path,
      messageCount: info.messageCount,
      modified: info.modified,
      created: info.created,
      contextUsage,
    },
    entries: projectTranscriptEntries(entries),
  }
}

function activeSessionInfo() {
  const manager = activeRuntime.session.sessionManager
  const header = manager.getHeader()
  const entries = manager.getBranch()
  const created = new Date(header.timestamp)
  let messageCount = 0
  let firstMessage = ''
  const goal = goalStateFromEntries(entries)

  for (const entry of entries) {
    if (entry.type !== 'message') continue
    messageCount++

    const message = entry.message
    if (firstMessage || message?.role !== 'user') continue
    firstMessage = messageText(message.content || message.output || '')
  }

  return {
    id: manager.getSessionId(),
    path: manager.getSessionFile(),
    cwd: header.cwd || activeRuntime.cwd,
    name: undefined,
    firstMessage: firstMessage || goal?.objective || '(no messages)',
    created,
    modified: sessionModifiedDate(entries, header, created),
    messageCount,
  }
}

function toSessionDto(session) {
  return {
    id: session.id,
    path: session.path,
    cwd: session.cwd,
    name: session.name,
    firstMessage: truncate(session.firstMessage || '', 140),
    timestamp: session.created || timestampFromPath(session.path),
  }
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

function timestampFromPath(path) {
  const match = path?.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_/)
  if (!match) return undefined
  return match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z')
}

async function exportSessionDetail(id) {
  if (isActiveSession(id)) return toActiveSessionDetailDto()

  const session = await findSession(id)
  if (!session) throw new Error('Session not found')
  return toSessionDetailDto(session)
}

function exportFilename(detail) {
  const session = detail.session
  const title = session.name || session.firstMessage || session.id
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'session'
  return `leyline-${slug}.html`
}

async function renderSessionExportHtml(detail) {
  const session = detail.session
  const title = session.name || session.firstMessage || 'Untitled session'
  const entries = detail.entries
    .filter(isExportRenderableEntry)
    .map(toExportEntry)
  const body = entries.map(renderExportEntry).join('\n')
  const exportData = Buffer.from(JSON.stringify({ entries })).toString('base64')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>${exportCss()}</style>
</head>
<body>
<main class="export-shell">
<header class="export-header">
<div class="export-meta-row">
${exportLogoSvg()}
<dl>
<div><dt>Project</dt><dd>${escapeHtml(projectLabel(session.cwd))}</dd></div>
<div><dt>Path</dt><dd>${escapeHtml(session.cwd || '')}</dd></div>
<div><dt>Messages</dt><dd>${escapeHtml(String(session.messageCount || 0))}</dd></div>
<div><dt>Modified</dt><dd>${escapeHtml(formatExportDate(session.modified))}</dd></div>
</dl>
</div>
<h1>${escapeHtml(title)}</h1>
</header>
<section class="transcript">
${body || '<div class="empty-workbench">No transcript entries found.</div>'}
</section>
</main>
<script id="export-data" type="application/json">${exportData}</script>
<script>${highlightJsSource()}</script>
<script type="module">${exportJs()}</script>
</body>
</html>`
}

function exportLogoSvg() {
  return `<svg class="export-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" aria-hidden="true">
  <g transform="translate(12 12) scale(0.8125)">
    <rect width="128" height="128" rx="28" fill="#111019"/>
    <path d="M63 72c12 3 22 11 31 24" fill="none" stroke="#60a5fa" stroke-width="9" stroke-linecap="round"/>
    <path d="M33 96c17-8 27-22 30-42 3-16 15-24 35-24" fill="none" stroke="#a78bfa" stroke-width="9" stroke-linecap="round"/>
    <g fill="#f4f0ff">
      <circle cx="33" cy="96" r="9"/>
      <circle cx="98" cy="30" r="9"/>
      <circle cx="94" cy="96" r="9"/>
    </g>
  </g>
</svg>`
}

function isExportRenderableEntry(entry) {
  if (entry.type === 'event') return false
  if (entry.type !== 'message') return true
  if (entry.role !== 'assistant') return true
  return Boolean(entry.blocks?.length || entry.text?.trim())
}

function toExportEntry(entry) {
  if (entry.type !== 'tool') return entry
  if (!entry.preview) return entry

  const next = { ...entry, text: '' }
  if (entry.preview.kind === 'file') {
    const content = clippedExportContent(entry.preview.content || '')
    next.preview = {
      ...entry.preview,
      content,
      fallbackText: content,
    }
  }
  return next
}

function renderExportEntry(entry, index) {
  if (entry.type === 'tool') return renderExportTool(entry, index)
  return renderExportMessage(entry)
}

function renderExportTool(entry, index) {
  return `<details class="tool-card transcript-tool${entry.isError ? ' error-card' : ''}">
<summary class="tool-card-header">
<span class="chevron tool-chevron">›</span>
<span>${escapeHtml(entry.label)}</span>
${entry.code ? `<code>${escapeHtml(entry.code)}</code>` : ''}
${entry.contextLabel ? renderToolContext(entry) : ''}
<em>${entry.isError ? 'error' : 'completed'}</em>
</summary>
<div class="tool-expanded-body" data-tool-index="${index}">
<div class="tool-lazy-placeholder">Open to render preview</div>
</div>
</details>`
}

function renderToolContext(entry) {
  const excluded = entry.excludeFromContext ? ' is-excluded' : ''
  return `<span class="tool-context-pill${excluded}">${escapeHtml(entry.contextLabel)}</span>`
}

function exportCodeLanguage(entry) {
  return entry.preview?.language || ''
}

function toolPreviewText(entry) {
  const preview = entry.preview
  if (!preview) return entry.text || ''
  if (preview.kind === 'file') {
    return clippedExportContent(preview.fallbackText || entry.text || '')
  }
  return preview.fallbackText || entry.text || ''
}

function clippedExportContent(content) {
  const lines = content.split('\n')
  if (lines.length <= 400) return content
  return [
    ...lines.slice(0, 400),
    '',
    `… clipped ${lines.length - 400} more lines.`,
  ].join('\n')
}

function renderedExportToolJson(text) {
  const trimmed = (text || '').trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return ''

  try {
    return highlightExportJson(JSON.stringify(JSON.parse(trimmed), null, 2))
  } catch {
    return ''
  }
}

function jsonTokenClass(token) {
  if (token.endsWith(':')) return 'json-key'
  if (token.startsWith('"')) return 'json-string'
  if (token === 'true' || token === 'false') return 'json-boolean'
  if (token === 'null') return 'json-null'
  return 'json-number'
}

function highlightExportJson(json) {
  const token = /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"\s*:?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g
  let html = ''
  let offset = 0
  for (const match of json.matchAll(token)) {
    html += escapeHtml(json.slice(offset, match.index))
    html += `<span class="${jsonTokenClass(match[0])}">`
    html += escapeHtml(match[0])
    html += '</span>'
    offset = match.index + match[0].length
  }
  return html + escapeHtml(json.slice(offset))
}

function renderExportMessage(entry) {
  const classes = [
    'message compact-message transcript-message',
    entry.role === 'user' ? 'user-message' : '',
    entry.role === 'assistant' ? 'assistant-message' : '',
    entry.type === 'summary' ? 'summary-message' : '',
  ].filter(Boolean).join(' ')

  return `<article class="${classes}">
<div class="message-meta message-meta-row"><span>${escapeHtml(entry.label)}</span></div>
${renderMessageBody(entry)}
${renderMessageImages(entry)}
</article>`
}

function renderMessageBody(entry) {
  if (entry.role === 'assistant' && entry.blocks?.length) {
    return messageBlocksFor(entry).map(renderMessageBlock).join('\n')
  }

  const skills = skillSummaries(entry)
  if (skills.length) return renderSkillSummaries(entry, skills)

  return `<div class="entry-text markdown-body">${renderMarkdown(entry.text)}</div>`
}

function renderMessageBlock(block) {
  if (block.type === 'thinking') {
    return `<div class="thinking-block is-expanded">
<button class="thinking-trigger" type="button">
<span class="chevron">›</span>
<span class="thinking-label">Thinking</span>
</button>
<div class="thinking-expand-wrapper is-expanded">
<div class="thinking-expand-inner">
<pre>${escapeHtml(block.text || '')}</pre>
</div>
</div>
</div>`
  }

  return `<div class="entry-text markdown-body assistant-text-block">
${renderMarkdown(block.text || '')}
</div>`
}

function renderSkillSummaries(entry, skills) {
  const rows = skills.map((skill) => {
    return `<div class="skill-summary"><span>[skill]</span><strong>${escapeHtml(skill.name)}</strong><em>expand</em></div>`
  }).join('')

  return `<div class="skill-summary-list"><details><summary>${rows}</summary>
<div class="skill-expanded entry-text markdown-body">
${renderMarkdown(entry.text || '')}
</div>
</details></div>`
}

function renderMessageImages(entry) {
  const images = imageBlocksFor(entry)
  if (!images.length) return ''
  const tags = images.map((image, index) => {
    const src = `data:${image.mimeType};base64,${image.data}`
    return `<img src="${src}" alt="Attached image ${index + 1}">`
  }).join('')
  return `<div class="message-images">${tags}</div>`
}

function renderMarkdown(text) {
  return exportMarkdown.render(text || '')
}


function projectLabel(cwd) {
  if (!cwd) return 'Unknown project'
  return basename(cwd)
}

function formatExportDate(value) {
  if (!value) return 'unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function highlightJsSource() {
  const mainPath = fileURLToPath(import.meta.resolve(
    '@earendil-works/pi-coding-agent',
  ))
  return readFileSync(
    join(dirname(mainPath), 'core/export-html/vendor/highlight.min.js'),
    'utf8',
  )
}

function exportJs() {
  return `import {
  DIFFS_TAG_NAME,
  File,
  FileDiff,
  parsePatchFiles,
} from 'https://esm.sh/@pierre/diffs@1.2.0-beta.6'

const encoded = document.getElementById('export-data').textContent
const data = JSON.parse(new TextDecoder().decode(
  Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)),
))
const pierreOptions = {
  theme: 'pierre-dark',
  themeType: 'dark',
  overflow: 'wrap',
  tokenizeMaxLineLength: 20000,
  unsafeCSS: \`
    [data-diffs] {
      --diffs-font-family: ui-monospace, SFMono-Regular, Menlo, Monaco,
        Consolas, "Liberation Mono", "Courier New", monospace;
      --diffs-font-size: 12px;
      --diffs-line-height: 18px;
    }
  \`,
}
const pierreDiffOptions = {
  ...pierreOptions,
  diffStyle: 'unified',
  hunkSeparators: 'metadata',
}

if (window.hljs) hljs.highlightAll()

document.querySelectorAll('details').forEach((item) => {
  item.addEventListener('toggle', () => {
    const icon = item.querySelector('.tool-chevron')
    if (icon) icon.textContent = item.open ? '⌄' : '›'
    item.classList.toggle('is-expanded', item.open)
    if (item.open) renderTool(item.querySelector('[data-tool-index]'))
  })
})

function renderTool(container) {
  if (!container || container.dataset.rendered) return
  const entry = data.entries[Number(container.dataset.toolIndex)]
  container.dataset.rendered = 'true'
  container.innerHTML = ''

  if (entry.preview?.kind === 'image') {
    const img = document.createElement('img')
    img.src = \`data:\${entry.preview.mimeType};base64,\${entry.preview.data}\`
    img.alt = 'Read image preview'
    const wrap = document.createElement('div')
    wrap.className = 'tool-image-preview'
    wrap.appendChild(img)
    container.appendChild(wrap)
    return
  }

  if (entry.preview && renderPierre(container, entry.preview)) return
  renderPlainTool(container, entry)
}

function renderPierre(container, preview) {
  try {
    const target = document.createElement(DIFFS_TAG_NAME)
    target.className = 'pierre-diffs-container'
    container.appendChild(target)

    if (preview.kind === 'file') {
      new File(pierreOptions).render({
        fileContainer: target,
        file: {
          name: preview.path || 'tool-output.txt',
          contents: preview.content || '',
        },
      })
      return true
    }

    if (preview.kind === 'diff') {
      new FileDiff(pierreDiffOptions).render({
        fileContainer: target,
        oldFile: {
          name: preview.path || 'before.txt',
          contents: preview.oldText || '',
        },
        newFile: {
          name: preview.path || 'after.txt',
          contents: preview.newText || '',
        },
      })
      return true
    }

    if (preview.kind === 'patch') {
      const parsed = parsePatchFiles(preview.patch || '')
      const fileDiff = parsed.flatMap((patch) => patch.files || [])[0]
      if (!fileDiff) throw new Error('No diff found')
      new FileDiff(pierreDiffOptions).render({ fileContainer: target, fileDiff })
      return true
    }
  } catch {}

  container.innerHTML = ''
  return false
}

function renderPlainTool(container, entry) {
  const text = toolPreviewText(entry)
  const pre = document.createElement('pre')
  pre.className = 'tool-output'
  const code = document.createElement('code')
  const language = exportCodeLanguage(entry)
  if (language) code.className = \`language-\${language}\`
  code.textContent = text
  pre.appendChild(code)
  container.appendChild(pre)
  if (window.hljs) hljs.highlightElement(code)
}

function toolPreviewText(entry) {
  const preview = entry.preview
  if (!preview) return entry.text || ''
  return preview.fallbackText || entry.text || ''
}

function exportCodeLanguage(entry) {
  return entry.preview?.language || ''
}`
}

function exportCss() {
  return `:root {
  color: #e8e9ef;
  color-scheme: dark;
  background: #0d0e11;
  --bg: #0d0e11;
  --panel-soft: #1a1b21;
  --border: #30313a;
  --border-soft: #252730;
  --text: #e8e9ef;
  --muted: #7f8390;
  --muted-strong: #a7aab5;
  --accent: #7c5cff;
  --accent-border: rgb(124 92 255 / 34%);
  --syntax-comment: #6b7280;
  --syntax-keyword: #c084fc;
  --syntax-number: #f7c986;
  --syntax-string: #86efac;
  --syntax-function: #93c5fd;
  --syntax-type: #67e8f9;
  --syntax-variable: #fca5a5;
  --syntax-operator: #d8dbe3;
  --syntax-punctuation: #9ca3af;
  --motion-quick: 100ms;
  --motion-fast: 180ms;
  --motion-base: 220ms;
  --motion-slow: 300ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-emphasized: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-decelerate: cubic-bezier(0, 0, 0.2, 1);
  --ease-accelerate: cubic-bezier(0.4, 0, 1, 1);
  --content-max: 1080px;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system,
    BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
button, input, textarea { color: inherit; font: inherit; }
.export-shell { min-height: 100vh; padding: 32px 22px 64px; }
.export-header {
  width: min(var(--content-max), 100%);
  margin: 0 auto 28px;
  border: 1px solid var(--border-soft);
  border-radius: 16px;
  background: #14151a;
  padding: 18px 20px;
}
.export-meta-row {
  display: flex;
  align-items: center;
  gap: 16px;
}
.export-logo {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 7%),
    0 10px 26px rgb(0 0 0 / 24%);
}
.export-header h1 {
  margin: 18px 0 0;
  font-size: 20px;
  line-height: 1.25;
}
.export-header dl {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(100px, 0.9fr) minmax(220px, 1.8fr)
    minmax(90px, 0.7fr) minmax(150px, 1fr);
  gap: 12px;
  margin: 0;
}
.export-header dt {
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.export-header dd {
  overflow-wrap: anywhere;
  margin: 4px 0 0;
  color: #d9dbe3;
  font-size: 13px;
}
.transcript { display: grid; gap: 0; }
.message {
  width: min(var(--content-max), 100%);
  margin-right: auto;
  margin-left: auto;
  color: #e2e3ea;
  font-size: 14px;
  line-height: 1.45;
}
.message p { margin: 0 0 12px; }
.message-meta {
  margin-bottom: 6px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.02em;
}
.message-meta-row { display: flex; align-items: center; gap: 7px; }
.compact-message { margin-top: 14px; }
.transcript-message {
  border-radius: 10px;
  padding: 2px 0;
  transition:
    background-color var(--motion-base) var(--ease-standard),
    border-color var(--motion-base) var(--ease-standard),
    opacity var(--motion-base) var(--ease-standard),
    transform var(--motion-base) var(--ease-standard);
}
.assistant-message { padding-left: 16px; color: #d8dbe3; }
.assistant-message .message-meta { color: var(--muted); }
.thinking-block {
  margin: 0 0 8px;
  border: 1px solid #2b2d36;
  border-radius: 9px;
  background: #15161b;
  transition:
    border-color var(--motion-base) var(--ease-standard),
    background-color var(--motion-base) var(--ease-standard);
}
.thinking-block.is-expanded {
  border-color: #353740;
  background: #181a20;
}
.thinking-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 11px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-align: left;
  cursor: pointer;
  border: none;
  background: transparent;
}
.thinking-trigger:hover { color: #c9c9c9; }
.thinking-trigger .thinking-label {
  color: var(--muted);
}
.thinking-trigger .chevron {
  display: inline-block;
  font-size: 14px;
  line-height: 1;
  transition:
    transform var(--motion-base) var(--ease-emphasized),
    color var(--motion-base) var(--ease-standard);
}
.thinking-block.is-expanded .thinking-trigger .chevron {
  transform: rotate(90deg);
}
.thinking-expand-wrapper {
  display: grid;
  grid-template-rows: 1fr;
}
.thinking-expand-inner {
  overflow: auto;
  max-height: 180px;
  min-height: 0;
}
.thinking-expand-inner pre {
  margin: 0;
  padding: 0 11px 9px;
  color: #a3a3a3;
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.45;
}
.assistant-text-block + .thinking-block,
.thinking-block + .assistant-text-block { margin-top: 8px; }
.user-message {
  margin-top: 22px;
  border: 1px solid var(--accent-border);
  border-left: 2px solid var(--accent);
  border-radius: 12px;
  background: rgb(124 92 255 / 9%);
  padding: 10px 12px;
}
.user-message .message-meta { color: #bfb5ff; }
.message-images {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}
.message-images img {
  max-width: min(360px, 100%);
  max-height: 320px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 10px;
  object-fit: contain;
}
.summary-message {
  border-left: 2px solid #4f5360;
  padding-left: 12px;
  color: #aeb2bd;
}
.entry-text { margin-bottom: 0 !important; }
.markdown-body p,
.markdown-body ul,
.markdown-body ol,
.markdown-body pre,
.markdown-body blockquote { margin: 0 0 10px; }
.markdown-body > :last-child { margin-bottom: 0; }
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 {
  margin: 14px 0 8px;
  color: var(--text);
  font-size: 15px;
  line-height: 1.25;
}
.markdown-body h1:first-child,
.markdown-body h2:first-child,
.markdown-body h3:first-child,
.markdown-body h4:first-child { margin-top: 0; }
.markdown-body ul,
.markdown-body ol { padding-left: 20px; }
.markdown-body li { margin: 3px 0; }
.markdown-body code {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-soft);
  padding: 1px 5px;
  color: #e5e5e5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.92em;
}
.markdown-body pre {
  overflow: auto;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  background: #131419;
  padding: 10px 12px;
}
.markdown-body pre code {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
}
.markdown-body blockquote {
  border-left: 2px solid #4f5360;
  padding-left: 10px;
  color: #adb1bc;
}
.markdown-body a { color: #bfb5ff; text-decoration: none; }
.tool-card {
  width: min(var(--content-max), 100%);
  margin: 8px auto 0;
  border: 1px solid #292b34;
  border-radius: 12px;
  background: #131419;
  padding: 8px 10px;
  color: #bdbdbd;
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color var(--motion-base) var(--ease-standard),
    background-color var(--motion-base) var(--ease-standard),
    opacity var(--motion-base) var(--ease-standard),
    transform var(--motion-base) var(--ease-standard);
}
.tool-card summary { list-style: none; cursor: pointer; }
.tool-card summary::-webkit-details-marker { display: none; }
.tool-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #777;
  font-size: 12px;
  font-weight: 700;
}
.tool-card-header > span:first-child {
  transition: color var(--motion-base) var(--ease-standard);
}
.tool-card-header .chevron,
.tool-card-header .tool-chevron {
  display: inline-block;
  transition:
    transform var(--motion-base) var(--ease-emphasized),
    color var(--motion-base) var(--ease-standard);
}
.tool-card[open] .chevron,
.tool-card[open] .tool-chevron {
  transform: rotate(90deg);
}
.transcript-tool.is-expanded {
  border-color: #33353f;
  background: #171820;
}
.transcript-tool.is-expanded:hover {
  border-color: #3b3d49;
  background: #1a1c25;
}
.transcript-tool:hover {
  border-color: var(--border);
  background: #181a21;
  transform: translateY(-0.5px);
  transition-duration: var(--motion-quick);
  transition-timing-function: var(--ease-accelerate);
}
.tool-card-header em {
  margin-left: auto;
  color: #82d69a;
  font-style: normal;
  font-size: 11px;
  text-transform: uppercase;
}
.error-card .tool-card-header em { color: #fca5a5; }
.tool-card-header code {
  overflow: hidden;
  min-width: 0;
  border: 1px solid var(--border-soft);
  border-radius: 7px;
  background: #17181e;
  padding: 2px 6px;
  color: #aaa;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-context-pill {
  border: 1px solid rgb(130 214 154 / 24%);
  border-radius: 999px;
  padding: 1px 7px;
  color: #82d69a;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  transition:
    border-color var(--motion-base) var(--ease-decelerate),
    color var(--motion-base) var(--ease-decelerate),
    opacity var(--motion-base) var(--ease-decelerate);
}
.tool-context-pill.is-excluded { border-color: var(--border); color: var(--muted); }
.tool-expanded-body {
  margin-top: 9px;
  border-top: 1px solid var(--border-soft);
  padding-top: 9px;
  transition: border-top-color var(--motion-base) var(--ease-decelerate);
}
.tool-output {
  overflow: auto;
  max-height: 420px;
  margin: 0;
  background: #0f1014;
  padding: 14px 16px;
  color: #b8b8b8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
}
.tool-output code {
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  white-space: pre-wrap;
}
.tool-image-preview img {
  max-width: 100%;
  max-height: 520px;
  border-radius: 10px;
  object-fit: contain;
}
.json-output .json-key { color: #bfb5ff; }
.json-output .json-string { color: #b8e6c1; }
.json-output .json-number { color: #f7c986; }
.json-output .json-boolean { color: #8fbfff; }
.json-output .json-null { color: #fca5a5; }
.hljs { background: transparent; color: #d8dbe3; }
.hljs-comment,
.hljs-quote { color: var(--syntax-comment); }
.hljs-keyword,
.hljs-selector-tag { color: var(--syntax-keyword); }
.hljs-number,
.hljs-literal { color: var(--syntax-number); }
.hljs-string,
.hljs-doctag { color: var(--syntax-string); }
.hljs-function,
.hljs-title,
.hljs-title.function_,
.hljs-section,
.hljs-name { color: var(--syntax-function); }
.hljs-type,
.hljs-class,
.hljs-title.class_,
.hljs-built_in { color: var(--syntax-type); }
.hljs-attr,
.hljs-variable,
.hljs-variable.language_,
.hljs-params,
.hljs-property { color: var(--syntax-variable); }
.hljs-meta,
.hljs-meta .hljs-keyword,
.hljs-meta .hljs-string { color: var(--syntax-keyword); }
.hljs-operator { color: var(--syntax-operator); }
.hljs-punctuation { color: var(--syntax-punctuation); }
.hljs-subst { color: #d8dbe3; }
.hljs-regexp { color: var(--syntax-string); }
.hljs-symbol,
.hljs-bullet { color: var(--syntax-keyword); }
.hljs-addition { color: var(--syntax-string); }
.hljs-deletion { color: var(--syntax-variable); }
.skill-summary-list { display: grid; gap: 8px; }
.skill-summary-list summary { list-style: none; cursor: pointer; }
.skill-summary-list summary::-webkit-details-marker { display: none; }
.skill-summary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  border: 1px solid rgb(124 92 255 / 22%);
  border-radius: 9px;
  background: rgb(124 92 255 / 10%);
  padding: 7px 9px;
  color: #d9d5e8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color var(--motion-base) var(--ease-decelerate),
    background-color var(--motion-base) var(--ease-decelerate),
    transform var(--motion-base) var(--ease-decelerate);
}
.skill-summary:hover {
  border-color: rgb(124 92 255 / 40%);
  background: rgb(124 92 255 / 14%);
  transform: translateY(-0.5px);
  transition-duration: var(--motion-quick);
  transition-timing-function: var(--ease-accelerate);
}
.skill-summary span { color: #9d7dff; font-weight: 800; }
.skill-summary strong { color: #e4e2ec; font-weight: 700; }
.skill-summary em { color: var(--muted); font-style: normal; }
.skill-expanded {
  max-height: 520px;
  overflow: auto;
  margin-top: 8px;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  background: #111217;
  padding: 10px 12px;
  transition:
    border-color var(--motion-base) var(--ease-decelerate),
    opacity var(--motion-base) var(--ease-decelerate);
}
.empty-workbench {
  width: min(var(--content-max), 100%);
  margin: 0 auto;
  color: var(--muted);
}
@media (max-width: 760px) {
  .export-shell { padding: 16px 12px 42px; }
  .export-meta-row { align-items: flex-start; flex-wrap: wrap; }
  .export-header dl {
    flex-basis: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .assistant-message { padding-left: 4px; }
  .user-message { padding: 9px 10px; }
  .tool-card-header { gap: 7px; }
}
@media (prefers-reduced-motion: reduce) {
  .transcript-message,
  .tool-card,
  .skill-summary,
  .thinking-block,
  .thinking-trigger .chevron,
  .tool-chevron,
  .tool-expanded-body,
  .tool-context-pill,
  .skill-expanded {
    transition-duration: 1ms;
  }
  .tool-card:hover {
    transform: none;
  }
  .skill-summary:hover {
    transform: none;
  }
  .tool-card[open] .chevron,
  .tool-card[open] .tool-chevron {
    transform: rotate(90deg);
  }
}`
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => {
      if (!data) return resolve({})

      try {
        resolve(JSON.parse(data))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function json(res, data, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

function html(res, content, filename) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename.replace(/"/g, '')}"`,
  )
  res.end(content)
}
