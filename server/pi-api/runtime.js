import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  exportFilename,
  exportShareMeta,
  renderSessionExportHtml,
} from './export-renderer.js'
import { createEventHub } from './events.js'
import {
  bindRuntimeHandle as bindRuntimeHandleExtensions,
  emptyExtensionUiState,
} from './extension-ui.js'
import { readDirectory } from './fs-browser.js'
import {
  runtimeSessionDto,
  sessionInfo,
  sessionStateDto,
  toActiveSessionDetailDto as handleSessionDetailDto,
  toSessionDetailDto,
  toSessionDetailFromPath,
  toSessionDto,
} from './dtos.js'
import { html, json, readJson } from './http.js'
import {
  createMemory,
  deleteMemories,
  listVisibleMemories,
  setMemoryStatus,
  updateMemory,
} from './memories.js'
import { setRolloutFeedback } from './rollout-feedback.js'
import {
  configuredSessionDir,
  listPersistedSessions,
  SUBAGENT_SESSION_CUSTOM_TYPE,
} from './sessions.js'
import {
  copySessionSubagentOverrides,
  deleteSubagentModelOverride,
  listSubagentConfigs,
  resolveSubagentConfig,
  setSubagentModelOverride,
} from './subagents.js'
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from '@earendil-works/pi-coding-agent'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUNDLED_GOAL_EXTENSION = resolve(
  __dirname,
  '..',
  '..',
  '.pi',
  'extensions',
  'goal',
  'index.ts',
)
const BUNDLED_MEMORY_EXTENSION = resolve(
  __dirname,
  '..',
  '..',
  '.pi',
  'extensions',
  'memory',
  'index.ts',
)
const BUNDLED_SUBAGENT_EXTENSION = resolve(
  __dirname,
  '..',
  '..',
  '.pi',
  'extensions',
  'subagent',
  'index.ts',
)
const BUNDLED_LEYLINE_SYSTEM_PROMPT = resolve(
  __dirname,
  '..',
  '..',
  '.pi',
  'LEYLINE_SYSTEM.md',
)

let activeHandle
let activeRuntime
let activeSessionId
const runtimeHandles = new Map()
const runtimeHandlePromises = new Map()


const events = createEventHub({
  getRuntimeHandles: () => runtimeHandles.values(),
  activeSessionDto,
  getActiveSessionId: () => activeSessionId,
})


process.env.PI_CODING_AGENT ??= 'true'

const ONE_AT_A_TIME = 'one-at-a-time'
const SUBAGENT_THINKING_LEVELS = new Set([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

function appendLeylineSystemPrompt(base) {
  if (!existsSync(BUNDLED_LEYLINE_SYSTEM_PROMPT)) return base
  const prompt = readFileSync(BUNDLED_LEYLINE_SYSTEM_PROMPT, 'utf8').trim()
  if (!prompt || base.includes(prompt)) return base
  return [...base, prompt]
}

function preferBundledExtensions(result) {
  const bundledCommands = new Map([
    [BUNDLED_GOAL_EXTENSION, 'goal'],
    [BUNDLED_MEMORY_EXTENSION, 'memory'],
  ])
  const bundled = result.extensions.filter((extension) => {
    const command = bundledCommands.get(extension.resolvedPath)
    return command && extension.commands?.has(command)
  })
  if (bundled.length === 0) return result

  const commands = new Set(bundled.map((extension) => {
    return bundledCommands.get(extension.resolvedPath)
  }))
  return {
    ...result,
    extensions: result.extensions.filter((extension) => {
      if (bundled.includes(extension)) return true
      for (const command of commands) {
        if (extension.commands?.has(command)) return false
      }
      return true
    }),
  }
}

async function createRuntimeResult(
  { cwd, sessionManager, sessionStartEvent },
  { model, thinkingLevel } = {},
) {
  const services = await createAgentSessionServices({
    cwd,
    resourceLoaderOptions: {
      additionalExtensionPaths: [
        BUNDLED_GOAL_EXTENSION,
        BUNDLED_MEMORY_EXTENSION,
        BUNDLED_SUBAGENT_EXTENSION,
      ],
      extensionsOverride: preferBundledExtensions,
      appendSystemPromptOverride: appendLeylineSystemPrompt,
    },
  })
  const selectedModel = resolveSubagentModel(services.modelRuntime, model)
  if (modelRequested(model) && !selectedModel) {
    throw new Error(`Unknown subagent model: ${formatSubagentModel(model)}`)
  }
  if (selectedModel && !services.modelRuntime.hasConfiguredAuth(selectedModel.provider)) {
    throw new Error(`No API key for ${selectedModel.provider}/${selectedModel.id}`)
  }
  const runtime = {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      model: selectedModel,
      thinkingLevel,
    })),
    services,
    diagnostics: services.diagnostics,
  }
  forceOneAtATime(runtime.session)
  return runtime
}

const createRuntime = (options) => createRuntimeResult(options)


async function listSessions() {
  const sessions = await listPersistedSessions()
  const missing = [...runtimeHandles.values()]
    .map((handle) => sessionInfo(handle))
    .filter((session) => !sessions.some((item) => item.id === session.id))
  return [...missing, ...sessions]
}

async function findSession(id) {
  const handle = runtimeHandles.get(id)
  if (handle) return sessionInfo(handle)
  const sessions = await listSessions()
  return sessions.find((session) => session.id === id)
}

async function resolveSession(id, path, cwd) {
  const handle = runtimeHandles.get(id)
  if (handle) return sessionInfo(handle)
  if (path) return { id, path, cwd: cwd || '' }
  return findSession(id)
}

function isActiveSession(id) {
  return activeHandle && id === activeSessionId
}

async function switchActiveSession(session) {
  const handle = await ensureRuntimeForSession(session)
  setActiveHandle(handle)
  return activeSessionDto(handle)
}

async function runtimeHandleForId(id) {
  const existing = runtimeHandles.get(id)
  if (existing) return existing
  const session = await findSession(id)
  if (!session) return null
  return ensureRuntimeForSession(session)
}

function requireActiveHandle() {
  if (!activeHandle) throw new Error('No active session')
  return activeHandle
}

async function ensureRuntimeForSession(session) {
  const key = session.id || session.path
  const existing = runtimeHandles.get(session.id)
  if (existing) return existing
  const pending = runtimeHandlePromises.get(key)
  if (pending) return pending

  const promise = (async () => {
    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: session.cwd,
      agentDir: getAgentDir(),
      sessionManager: SessionManager.open(session.path),
    })
    const sessionId = runtime.session.sessionManager.getSessionId()
    if (session.id && sessionId !== session.id) {
      runtime.session.dispose()
      throw new Error('Session path does not match session id')
    }

    const handle = {
      runtime,
      sessionId,
      unsubscribe: undefined,
      extensionUiState: emptyExtensionUiState(),
    }
    runtimeHandles.set(sessionId, handle)
    forceOneAtATime(runtime.session)
    await bindRuntimeHandle(handle)
    return handle
  })()
  runtimeHandlePromises.set(key, promise)

  try {
    return await promise
  } finally {
    runtimeHandlePromises.delete(key)
  }
}

function setActiveHandle(handle) {
  activeHandle = handle
  activeRuntime = handle?.runtime
  activeSessionId = handle?.sessionId
}

async function promptSession(handle, text, images = [], streamingBehavior) {
  forceOneAtATime(handle.runtime.session)
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
    handle.runtime.session
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

async function bashSession(handle, command, excludeFromContext = false) {
  const session = handle.runtime.session
  const bashCommand = typeof command === 'string' ? command.trim() : ''
  if (!bashCommand) throw new Error('shell command is required')
  if (session.isBashRunning) {
    throw new Error('A shell command is already running')
  }

  const eventResult = await session.extensionRunner.emitUserBash({
    type: 'user_bash',
    command: bashCommand,
    excludeFromContext: excludeFromContext === true,
    cwd: session.sessionManager.getCwd(),
  })

  if (eventResult?.result) {
    session.recordBashResult(bashCommand, eventResult.result, {
      excludeFromContext: excludeFromContext === true,
    })
    return eventResult.result
  }

  return session.executeBash(bashCommand, undefined, {
    excludeFromContext: excludeFromContext === true,
    operations: eventResult?.operations,
  })
}

async function compactSession(handle, customInstructions) {
  const session = handle.runtime.session
  if (session.isStreaming) {
    throw new Error('Wait for the current response to finish before compacting.')
  }
  if (session.isCompacting) {
    throw new Error('Compaction is already running.')
  }

  const entries = session.sessionManager.getEntries()
  const messageCount = entries.filter((entry) => entry.type === 'message').length
  if (messageCount < 2) throw new Error('Nothing to compact (no messages yet)')

  const instructions = typeof customInstructions === 'string'
    ? customInstructions.trim()
    : ''
  await session.compact(instructions || undefined)
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

async function interruptSession(handle) {
  await handle.runtime.session.abort()
}

async function editSessionPrompt(handle, entryId, text, images = []) {
  const session = handle.runtime.session
  if (!entryId) throw new Error('entryId is required')
  if (session.isStreaming) {
    throw new Error('Wait for the current response to finish before editing.')
  }
  if (session.isCompacting) {
    throw new Error('Wait for compaction to finish before editing.')
  }

  const entry = session.sessionManager.getEntry(entryId)
  if (entry?.type !== 'message' || entry.message?.role !== 'user') {
    throw new Error('Only user messages can be edited')
  }

  const oldLeafId = session.sessionManager.getLeafId()
  if (oldLeafId === entryId) moveSessionLeaf(session, entry.parentId || null)
  else {
    const result = await session.navigateTree(entryId)
    if (result.cancelled) throw new Error('Edit cancelled')
  }

  try {
    await promptSession(handle, text, images)
  } catch (error) {
    moveSessionLeaf(session, oldLeafId)
    throw error
  }
}

function moveSessionLeaf(session, leafId) {
  if (leafId) session.sessionManager.branch(leafId)
  else session.sessionManager.resetLeaf()
  updateSessionContext(session)
}

async function resetSessionToEntry(handle, entryId) {
  const session = handle.runtime.session
  if (!entryId) throw new Error('entryId is required')
  if (session.isStreaming) {
    throw new Error('Wait for the current response to finish before resetting.')
  }
  if (session.isCompacting) {
    throw new Error('Wait for compaction to finish before resetting.')
  }

  const manager = session.sessionManager
  const entry = manager.getEntry(entryId)
  if (!entry) throw new Error('Entry not found')

  const activeBranch = manager.getBranch()
  if (!activeBranch.some((item) => item.id === entryId)) {
    throw new Error('Entry is not on the active thread')
  }

  const header = manager.getHeader()
  manager.fileEntries = [header, ...manager.getBranch(entryId)]
  manager._buildIndex()
  manager._rewriteFile()
  updateSessionContext(session)
  return activeSessionDto(handle)
}

function updateSessionContext(session) {
  const sessionContext = session.sessionManager.buildSessionContext()
  session.agent.state.messages = sessionContext.messages
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

  const previousId = activeHandle.sessionId
  const previousSessionPath = activeRuntime.session.sessionManager.getSessionFile()
  const result = await activeRuntime.fork(entryId, { position: 'at' })
  if (result.cancelled) throw new Error('Fork cancelled')
  forceOneAtATime(activeRuntime.session)
  runtimeHandles.delete(previousId)
  activeHandle.sessionId = activeRuntime.session.sessionManager.getSessionId()
  runtimeHandles.set(activeHandle.sessionId, activeHandle)
  setActiveHandle(activeHandle)
  copySessionSubagentOverrides({
    cwd: activeRuntime.session.sessionManager.getCwd(),
    fromSessionPath: previousSessionPath,
    toSessionPath: activeRuntime.session.sessionManager.getSessionFile(),
  })
  await bindActiveSession()
  return activeSessionDto()
}

async function renameSession(id, name) {
  const nextName = normalizeSessionName(name)
  const handle = runtimeHandles.get(id)
  if (handle) {
    handle.runtime.session.setSessionName(nextName)
    return toActiveSessionDetailDto(handle)
  }

  const session = await findSession(id)
  if (!session) throw new Error('Session not found')

  const manager = SessionManager.open(session.path)
  if (manager.getSessionId() !== id) {
    throw new Error('Session path does not match session id')
  }
  manager.appendSessionInfo(nextName)
  return toSessionDetailDto({ ...session, name: manager.getSessionName() })
}

function normalizeSessionName(name) {
  if (typeof name !== 'string') return ''
  return name.replace(/\s+/g, ' ').trim()
}

async function trashSession(id) {
  const session = await findSession(id)
  if (!session) throw new Error('Session not found')
  const handle = runtimeHandles.get(id)
  if (handle) {
    if (handle.runtime.session.isStreaming) {
      throw new Error('Wait for the current response to finish before deleting.')
    }
    if (handle.runtime.session.isCompacting) {
      throw new Error('Wait for compaction to finish before deleting.')
    }
  }

  if (handle && !existsSync(session.path)) {
    discardRuntimeHandle(handle)
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

  if (handle) discardRuntimeHandle(handle)

  return { path: trashPath }
}

function discardActiveSession() {
  if (!activeHandle) return
  discardRuntimeHandle(activeHandle)
}

function discardRuntimeHandle(handle) {
  handle.unsubscribe?.()
  handle.runtime.session.dispose()
  runtimeHandles.delete(handle.sessionId)
  if (activeHandle === handle) setActiveHandle(undefined)
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

async function reloadSession(handle) {
  const session = handle.runtime.session
  if (session.isStreaming) {
    throw new Error('Wait for the current response to finish before reloading.')
  }
  if (session.isCompacting) {
    throw new Error('Wait for compaction to finish before reloading.')
  }

  const previousSessionFile = session.sessionFile
  const previousLeafId = session.sessionManager.getLeafId()
  const sessionManager = SessionManager.open(previousSessionFile)
  if (previousLeafId) sessionManager.branch(previousLeafId)

  const result = await createRuntime({
    cwd: sessionManager.getCwd(),
    agentDir: handle.runtime.services.agentDir,
    sessionManager,
    sessionStartEvent: {
      type: 'session_start',
      reason: 'reload',
      previousSessionFile,
    },
  })

  let applied = false
  try {
    await handle.runtime.teardownCurrent('reload', previousSessionFile)
    handle.unsubscribe?.()
    const previousId = handle.sessionId
    handle.runtime.apply(result)
    applied = true
    handle.sessionId = handle.runtime.session.sessionManager.getSessionId()
    handle.extensionUiState = emptyExtensionUiState()
    if (previousId !== handle.sessionId) runtimeHandles.delete(previousId)
    runtimeHandles.set(handle.sessionId, handle)
    forceOneAtATime(handle.runtime.session)
    if (activeHandle === handle) setActiveHandle(handle)
    await bindRuntimeHandle(handle)
  } catch (error) {
    if (!applied) result.session.dispose()
    throw error
  }
}

async function setSessionModel(handle, provider, id) {
  if (!provider || !id) throw new Error('provider and id are required')

  const model = handle.runtime.session.modelRuntime.getModel(provider, id)
  if (!model) throw new Error('Model not found')
  await handle.runtime.session.setModel(model)
}

function setSessionThinkingLevel(handle, level) {
  if (!level) throw new Error('level is required')

  const levels = handle.runtime.session.getAvailableThinkingLevels()
  if (!levels.includes(level)) throw new Error('Thinking level not available')
  handle.runtime.session.setThinkingLevel(level)
}

function setSessionMode(handle) {
  forceOneAtATime(handle.runtime.session)
}

function forceOneAtATime(session) {
  session.setSteeringMode(ONE_AT_A_TIME)
  session.setFollowUpMode(ONE_AT_A_TIME)
}

async function createNewSession(cwd) {
  if (!cwd) throw new Error('cwd is required')
  await mkdir(cwd, { recursive: true })

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir: getAgentDir(),
    sessionManager: SessionManager.create(cwd, configuredSessionDir(cwd)),
  })
  const handle = {
    runtime,
    sessionId: runtime.session.sessionManager.getSessionId(),
    unsubscribe: undefined,
    extensionUiState: emptyExtensionUiState(),
  }
  runtimeHandles.set(handle.sessionId, handle)
  forceOneAtATime(runtime.session)
  await bindRuntimeHandle(handle)
  setActiveHandle(handle)
  return activeSessionDto(handle)
}

function activeSessionDto(handle = activeHandle) {
  return runtimeSessionDto(handle)
}

function toActiveSessionDetailDto(handle = activeHandle) {
  return handleSessionDetailDto(handle)
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
      state: sessionStateDto(result.session),
    }
  } finally {
    result.session.dispose()
  }
}

async function bindActiveSession() {
  if (!activeHandle) throw new Error('No active session')
  await bindRuntimeHandle(activeHandle)
}

async function bindRuntimeHandle(handle) {
  await bindRuntimeHandleExtensions(handle, events)
}

function openEventStream(req, res) {
  return events.openEventStream(req, res)
}

function broadcastActiveSession(handle = activeHandle) {
  events.broadcastActiveSession(handle)
}

function broadcastEvent(type, data) {
  events.broadcastEvent(type, data)
}

async function sessionDetail(id, path) {
  const handle = runtimeHandles.get(id)
  if (handle) return toActiveSessionDetailDto(handle)
  if (path) return toSessionDetailFromPath(id, path)

  const session = await findSession(id)
  if (!session) return null
  return toSessionDetailDto(session)
}

async function exportSessionDetail(id) {
  const detail = await sessionDetail(id)
  if (!detail) throw new Error('Session not found')
  return detail
}

async function runSubagent({ task, cwd, parentSessionPath, model, thinkingLevel, tools, systemPrompt, signal }) {
  if (!cwd) throw new Error('cwd is required')
  if (!task) throw new Error('task is required')
  if (signal?.aborted) throw new Error('Subagent cancelled')
  const requestedThinkingLevel = normalizeSubagentThinkingLevel(thinkingLevel)

  const sessionManager = SessionManager.create(cwd, configuredSessionDir(cwd))
  const childPath = sessionManager.newSession({
    parentSession: parentSessionPath || undefined,
  })
  if (!childPath) {
    throw new Error('Failed to create subagent session')
  }

  const childId = sessionManager.getSessionId()
  sessionManager.appendCustomEntry(SUBAGENT_SESSION_CUSTOM_TYPE, {
    sessionId: childId,
    parentSessionPath: parentSessionPath || null,
  })

  let session
  let abortSubagent
  try {
    const createSubagentRuntime = (options) => createRuntimeResult(options, {
      model,
      thinkingLevel: requestedThinkingLevel,
    })
    const runtime = await createAgentSessionRuntime(createSubagentRuntime, {
      cwd,
      agentDir: getAgentDir(),
      sessionManager,
    })
    session = runtime.session
    if (signal?.aborted) throw new Error('Subagent cancelled')
    abortSubagent = () => session?.abort?.()
    signal?.addEventListener?.('abort', abortSubagent, { once: true })

    if (tools?.length) {
      if (typeof session.setActiveToolsByName !== 'function') {
        throw new Error('Subagent runtime does not support tool allowlists')
      }

      session.setActiveToolsByName(tools)

      const activeTools = new Set(session.getActiveToolNames?.() || [])
      const missingTools = tools.filter((tool) => !activeTools.has(tool))
      if (missingTools.length) {
        throw new Error(`Unknown subagent tools: ${missingTools.join(', ')}`)
      }
    }

    const taskWithPrompt = systemPrompt && systemPrompt.trim()
      ? `${systemPrompt.trim()}\n\nTask: ${task}`
      : task
    let preflightSucceeded = false
    await new Promise((resolve, reject) => {
      session
        .prompt(taskWithPrompt, { source: 'api' })
        .then(() => {
          preflightSucceeded = true
          resolve()
        })
        .catch((error) => {
          if (!preflightSucceeded) reject(error)
        })
    })

    const entries = sessionManager.getBranch()
    const messages = []
    let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, turns: 0 }
    let responseModel
    let stopReason

    for (const entry of entries) {
      if (entry.type !== 'message') continue
      const msg = entry.message
      if (!msg || !('content' in msg)) continue

      const text = extractMessageText(msg.content)
      if (msg.role === 'assistant') {
        usage.turns++
        if (text) messages.push({ role: 'assistant', content: text })
        if (msg.usage) {
          const u = msg.usage
          const msgInput = u.inputTokens ?? u.promptTokens ?? u.input ?? 0
          const msgOutput = u.outputTokens ?? u.completionTokens ?? u.output ?? 0
          usage.inputTokens = msgInput
          usage.outputTokens = msgOutput
          usage.totalTokens = u.totalTokens ?? (msgInput + msgOutput)
          usage.cost = u.cost?.total ?? 0
        }
        if (msg.model) responseModel = msg.model
        if (msg.stopReason) stopReason = msg.stopReason
        if (msg.errorMessage) messages.push({ role: 'error', content: msg.errorMessage })
      } else if (msg.role === 'toolResult' || msg.role === 'tool') {
        if (text) messages.push({ role: msg.role, content: text })
      }
    }

    signal?.removeEventListener?.('abort', abortSubagent)
    const effectiveThinkingLevel = session.thinkingLevel
    session.dispose()

    return {
      childSession: { path: childPath, id: childId, cwd },
      messages,
      usage,
      model: responseModel,
      thinkingLevel: effectiveThinkingLevel,
      stopReason,
    }
  } catch (error) {
    signal?.removeEventListener?.('abort', abortSubagent)
    try { session?.dispose() } catch {}
    if (signal?.aborted) throw new Error('Subagent cancelled')
    throw error
  }
}

function normalizeSubagentThinkingLevel(thinkingLevel) {
  if (thinkingLevel === undefined || thinkingLevel === null) return undefined
  if (SUBAGENT_THINKING_LEVELS.has(thinkingLevel)) return thinkingLevel
  throw new Error(`Invalid subagent thinking level: ${String(thinkingLevel)}`)
}

function resolveSubagentModel(modelRuntime, model) {
  if (!model || model === 'inherit') return undefined
  if (typeof model === 'object' && model.provider && model.id) {
    return modelRuntime.getModel(model.provider, model.id)
  }
  if (typeof model !== 'string') return undefined

  const providerSeparator = model.indexOf('/')
  if (providerSeparator > 0) {
    return modelRuntime.getModel(
      model.slice(0, providerSeparator),
      model.slice(providerSeparator + 1),
    )
  }

  return modelRuntime.getAvailableSnapshot().find((item) => item.id === model)
}

function modelRequested(model) {
  return Boolean(model && model !== 'inherit')
}

function formatSubagentModel(model) {
  if (typeof model === 'object' && model) return `${model.provider || '?'} / ${model.id || '?'}`
  return String(model)
}

function extractMessageText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b?.type === 'text' || b?.type === 'toolResult')
    .map((b) => b.type === 'toolResult' ? b.content || b.output || '' : b.text)
    .join('\n')
}

export function createPiRuntimeApi() {
  return {
  activeRuntimeCwd: () => activeRuntime?.cwd,
  activeSessionDto,
  bashSession,
  compactSession,
  createMemory,
  createNewSession,
  deleteMemories,
  editSessionPrompt,
  exportFilename,
  exportSessionDetail,
  exportShareMeta,
  forkActiveSession,
  html,
  interruptSession,
  json,
  listSessions,
  listSubagentConfigs,
  listVisibleMemories,
  openEventStream,
  promptSession,
  readDirectory,
  readJson,
  reloadSession,
  renameSession,
  renderSessionExportHtml,
  requireActiveHandle,
  resetSessionToEntry,
  resolveSession,
  resolveSubagentConfig,
  runtimeHandleForId,
  runtimeState,
  setMemoryStatus,
  setSubagentModelOverride,
  deleteSubagentModelOverride,
  setSessionMode,
  setSessionModel,
  setRolloutFeedback,
  setSessionThinkingLevel,
  sessionDetail,
  switchActiveSession,
  toActiveSessionDetailDto,
  toSessionDto,
  trashSession,
  updateMemory,
  runSubagent,
  }
}
