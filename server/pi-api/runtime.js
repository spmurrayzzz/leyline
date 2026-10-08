import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
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
import { createPromptQueue } from './prompt-queue.js'
import {
  bindRuntimeHandle as bindRuntimeHandleExtensions,
  cleanupExtensionConfirmations,
  emptyExtensionUiState,
} from './extension-ui.js'
import { readDirectory } from './fs-browser.js'
import { readGitReview, readGitReviewDiff } from './git-review.js'
import { openGitReviewEventStream } from './git-review-watch.js'
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
  findPersistedSessionRecord,
  listPersistedProjects,
  listPersistedSessions,
  listSessionsForProject,
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
  clearVisionOverride,
  copySessionVisionOverrides,
  installVisionDelegationContext,
  listVisionConfig,
  registerVisionDelegation,
  resolveVisionConfig,
  setVisionOverride,
} from './vision.js'
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createMcpExtension,
  createToolSearchExtension,
  getAgentDir,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import {
  RESEARCH_CUSTOM_TYPE,
  RESEARCH_VERSION,
  researchStateFromEntries,
} from '../../lib/research-state.js'
import { auditResearchReportCitations } from '../../lib/research-citations.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUNDLED_OUTPUT_BUDGET_EXTENSION = resolve(
  __dirname,
  '..',
  '..',
  '.pi',
  'extensions',
  'output-budget',
  'index.js',
)
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
const BUNDLED_RESEARCH_EXTENSION = resolve(
  __dirname,
  '..',
  '..',
  '.pi',
  'extensions',
  'research',
  'index.ts',
)
const BUNDLED_VISION_EXTENSION = resolve(
  __dirname,
  '..',
  '..',
  '.pi',
  'extensions',
  'vision-agent',
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
let runtimeShuttingDown = false
let runtimeShutdownPromise
const runtimeHandles = new Map()
const hiddenRuntimeHandles = new Set()
const runtimeHandlePromises = new Map()
const pendingRuntimeCreations = new Set()

function trackRuntimeCreation(operation) {
  return (...args) => {
    if (runtimeShuttingDown) return Promise.reject(new Error('Runtime is shutting down'))
    const promise = Promise.resolve().then(() => {
      if (runtimeShuttingDown) throw new Error('Runtime is shutting down')
      return operation(...args)
    })
    pendingRuntimeCreations.add(promise)
    const settled = () => pendingRuntimeCreations.delete(promise)
    promise.then(settled, settled)
    return promise
  }
}


const events = createEventHub({
  getRuntimeHandles: () => runtimeHandles.values(),
  activeSessionDto,
  getActiveSessionId: () => activeSessionId,
})


process.env.PI_CODING_AGENT ??= 'true'

const ONE_AT_A_TIME = 'one-at-a-time'
const SUBAGENT_DELEGATION_TOOL = 'subagent'
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

function extensionNames(extension) {
  const names = new Set()
  const add = (value) => {
    const name = value?.replace(/\.[^.]+$/, '')
    if (name) names.add(name)
  }
  const normalized = extension.resolvedPath.replaceAll('\\', '/')
  const marker = '/extensions/'
  const markerIndex = normalized.lastIndexOf(marker)
  if (markerIndex !== -1) {
    add(normalized.slice(markerIndex + marker.length).split('/')[0])
  }

  const file = basename(extension.resolvedPath)
  add(/^index\.[^.]+$/.test(file)
    ? basename(dirname(extension.resolvedPath))
    : file)

  const baseDir = extension.sourceInfo?.baseDir
  if (extension.sourceInfo?.origin === 'package' && baseDir) {
    try {
      const manifest = JSON.parse(readFileSync(join(baseDir, 'package.json'), 'utf8'))
      add(typeof manifest.name === 'string'
        ? manifest.name.split('/').at(-1)
        : '')
    } catch {}
  }

  return names
}

function preferBundledExtensions(result) {
  const specifications = [
    { path: BUNDLED_OUTPUT_BUDGET_EXTENSION, name: 'output-budget' },
    { path: BUNDLED_GOAL_EXTENSION, name: 'goal', command: 'goal' },
    { path: BUNDLED_MEMORY_EXTENSION, name: 'memory', command: 'memory' },
    { path: BUNDLED_SUBAGENT_EXTENSION, name: 'subagent', tool: 'subagent' },
    { path: BUNDLED_RESEARCH_EXTENSION, name: 'research' },
    { path: BUNDLED_VISION_EXTENSION, name: 'vision-agent', tool: 'vision_agent' },
  ]
  const bundled = new Set()
  const activeSpecifications = specifications.filter((specification) => {
    const extension = result.extensions.find((item) => {
      return item.resolvedPath === specification.path
    })
    if (!extension) return false
    bundled.add(extension)
    return true
  })
  if (bundled.size === 0) return result

  return {
    ...result,
    extensions: result.extensions.filter((extension) => {
      if (bundled.has(extension)) return true
      const names = extensionNames(extension)
      return !activeSpecifications.some((specification) => {
        return names.has(specification.name)
          || (specification.command
            && extension.commands?.has(specification.command))
          || (specification.tool && extension.tools?.has(specification.tool))
      })
    }),
  }
}

function isolateRuntimeExtensions(result) {
  return {
    ...result,
    extensions: result.extensions.filter((extension) => {
      return extension.resolvedPath === BUNDLED_OUTPUT_BUDGET_EXTENSION
    }),
  }
}

function childSessionMarker(manager) {
  return [...manager.getEntries()].reverse().find((entry) => {
    return entry.type === 'custom'
      && entry.customType === SUBAGENT_SESSION_CUSTOM_TYPE
  })?.data
}

async function createRuntimeResult(
  { cwd, agentDir, sessionManager, sessionStartEvent },
  { model, thinkingLevel } = {},
) {
  if (runtimeShuttingDown) throw new Error('Runtime is shutting down')
  let child = childSessionMarker(sessionManager)
  if (sessionStartEvent?.reason === 'fork' && sessionStartEvent.previousSessionFile) {
    child = childSessionMarker(SessionManager.open(sessionStartEvent.previousSessionFile))
      || child
    if (child) sessionManager.appendCustomEntry(SUBAGENT_SESSION_CUSTOM_TYPE, child)
  }
  const systemPrompt = child?.isolatedSystemPrompt?.trim() || ''
  const tools = systemPrompt ? [] : child?.toolPolicy?.tools
  const excludeTools = [...new Set([
    'codemode',
    ...(child?.toolPolicy?.excludeTools || []),
    ...(child ? [SUBAGENT_DELEGATION_TOOL] : []),
  ])]
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    resourceLoaderOptions: {
      extensionFactories: systemPrompt ? [] : [
        {
          name: 'tool-search',
          factory: (pi) => {
            createToolSearchExtension()(pi)
            pi.on('session_start', () => {
              if (pi.getSettings().defaultTools?.includes('-tool_search')) return
              pi.setActiveTools([...pi.getActiveTools(), 'tool_search'])
            })
          },
          builtin: true,
          replaceable: true,
        },
        { name: 'mcp', factory: createMcpExtension(), builtin: true, replaceable: true },
      ],
      additionalExtensionPaths: [
        BUNDLED_OUTPUT_BUDGET_EXTENSION,
        BUNDLED_GOAL_EXTENSION,
        BUNDLED_MEMORY_EXTENSION,
        BUNDLED_SUBAGENT_EXTENSION,
        BUNDLED_RESEARCH_EXTENSION,
        BUNDLED_VISION_EXTENSION,
      ],
      extensionsOverride: systemPrompt
        ? isolateRuntimeExtensions
        : preferBundledExtensions,
      ...(systemPrompt
        ? {
            noContextFiles: true,
            noSkills: true,
            systemPromptOverride: () => systemPrompt,
            appendSystemPromptOverride: () => [],
          }
        : { appendSystemPromptOverride: appendLeylineSystemPrompt }),
    },
  })
  if (!systemPrompt) {
    const extensions = services.resourceLoader.getExtensions()
    extensions.extensions = preferBundledExtensions(extensions).extensions
  }
  if (child?.allowImages) {
    services.settingsManager.applyOverrides({ images: { blockImages: false } })
  }
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
      tools,
      excludeTools,
    })),
    services,
    diagnostics: services.diagnostics,
  }
  forceOneAtATime(runtime.session)
  installVisionDelegationContext(runtime.session)
  return runtime
}

const createRuntime = (options) => createRuntimeResult(options)


async function listProjects() {
  const projects = new Map(
    (await listPersistedProjects()).map((project) => [project.cwd, project]),
  )
  const now = Date.now()
  for (const handle of runtimeHandles.values()) {
    const cwd = handle.runtime.cwd
    if (!cwd) continue
    const current = projects.get(cwd)
    const session = handle.runtime.session
    const active = session.isStreaming || session.isCompacting
    if (current && !active) continue
    projects.set(cwd, {
      cwd,
      name: basename(cwd) || cwd,
      modified: active ? now : current?.modified || now,
    })
  }
  return [...projects.values()].sort((a, b) => {
    return b.modified - a.modified || a.name.localeCompare(b.name)
  })
}

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
  return findPersistedSessionRecord(id)
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

const switchActiveSession = trackRuntimeCreation(async (session) => {
  const handle = await ensureRuntimeForSession(session)
  setActiveHandle(handle)
  return activeSessionDto(handle)
})

const runtimeHandleForId = trackRuntimeCreation(async (id) => {
  const existing = runtimeHandles.get(id)
  if (existing) return existing
  const session = await findSession(id)
  if (!session) return null
  return ensureRuntimeForSession(session)
})

function requireActiveHandle() {
  if (!activeHandle) throw new Error('No active session')
  return activeHandle
}

function requireInitializedSession(handle) {
  if (handle.initializing || handle.bindingExtensions || handle.reloading) {
    throw new Error('Wait for session initialization to finish.')
  }
}

const ensureRuntimeForSession = trackRuntimeCreation(async (session) => {
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
      await disposeRuntime(runtime)
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
    try {
      await bindRuntimeHandle(handle)
      return handle
    } catch (error) {
      await discardRuntimeHandle(handle)
      throw error
    }
  })()
  runtimeHandlePromises.set(key, promise)

  try {
    return await promise
  } finally {
    runtimeHandlePromises.delete(key)
  }
})

function setActiveHandle(handle) {
  activeHandle = handle
  activeRuntime = handle?.runtime
  activeSessionId = handle?.sessionId
}

async function initializeSessionKind(handle, kind) {
  if (kind === undefined) return
  if (!['session', 'research'].includes(kind)) {
    throw new Error('kind must be session or research')
  }
  if (kind === 'session') return

  const manager = handle.runtime.session.sessionManager
  const branch = manager.getBranch()
  if (researchStateFromEntries(branch, handle.sessionId)) return
  if (branch.some((entry) => entry.type === 'message')) {
    throw new Error('Research mode can only start before the first message')
  }

  appendResearchSessionMarker(manager)
  await bindRuntimeHandle(handle)
}

function appendResearchSessionMarker(manager) {
  manager.appendCustomEntry(RESEARCH_CUSTOM_TYPE, {
    version: RESEARCH_VERSION,
    kind: 'session',
    sessionId: manager.getSessionId(),
    createdAt: Date.now(),
  })
}

async function promptSession(
  handle,
  text,
  images = [],
  streamingBehavior,
  signal,
  kind,
  handoffId,
  onAccepted,
) {
  requireInitializedSession(handle)
  const session = handle.runtime.session
  const controller = new AbortController()
  const abortPrompt = () => controller.abort()
  if (signal?.aborted) abortPrompt()
  else signal?.addEventListener?.('abort', abortPrompt, { once: true })
  handle.pendingPromptControllers ||= new Set()
  handle.pendingPromptControllers.add(controller)

  try {
    if (controller.signal.aborted) throw new Error('Prompt cancelled')
    forceOneAtATime(session)
    const promptText = typeof text === 'string' ? text : ''
    const promptImages = validateImages(images)
    const promptHandoffId = typeof handoffId === 'string'
      && handoffId.length <= 100
      ? handoffId
      : undefined
    if (!promptText.trim() && promptImages.length === 0) {
      throw new Error('text or image is required')
    }
    if (streamingBehavior
      && !['steer', 'followUp'].includes(streamingBehavior)) {
      throw new Error('invalid streaming behavior')
    }
    await initializeSessionKind(handle, kind)
    if (controller.signal.aborted) throw new Error('Prompt cancelled')
    const queue = ensurePromptQueue(handle)
    const pending = queue.snapshot()
    if (!onAccepted && !isExtensionCommand(session, promptText)
      && (pending.held || (streamingBehavior !== 'steer'
        && (streamingBehavior === 'followUp' || !session.isIdle || pending.items.length)))) {
      queue.add({ text: promptText, images: promptImages, kind, handoffId: promptHandoffId })
      return 'queued'
    }

    const model = session.state?.model || session.model
    const modelSupportsImages = Boolean(model?.input?.includes('image'))
    const shouldDelegate = promptImages.length
      && !modelSupportsImages
      && !isExtensionCommand(session, promptText)
    const delegation = shouldDelegate
      ? await prepareVisionDelegation(
        handle,
        promptImages,
        controller.signal,
      )
      : null
    if (controller.signal.aborted) throw new Error('Prompt cancelled')

    if (!delegation) {
      const disposition = await runSessionPrompt(
        handle,
        promptText,
        promptImages,
        streamingBehavior,
        promptHandoffId,
        controller.signal,
        undefined,
        onAccepted,
      )
      if (controller.signal.aborted && disposition === 'started') {
        await session.abort()
        throw new Error('Prompt cancelled')
      }
      return disposition
    }

    const registration = registerVisionDelegation(
      session,
      promptImages,
      delegation,
      promptText,
    )
    try {
      const disposition = await runSessionPrompt(
        handle,
        promptText,
        promptImages,
        streamingBehavior,
        promptHandoffId,
        controller.signal,
        registration,
        onAccepted,
      )
      if (controller.signal.aborted && disposition === 'started') {
        registration.cancel()
        await session.abort()
        throw new Error('Prompt cancelled')
      }
      if (disposition === 'handled') registration.cancel()
      return disposition
    } catch (error) {
      registration.cancel()
      if (controller.signal.aborted) throw new Error('Prompt cancelled')
      throw error
    }
  } finally {
    signal?.removeEventListener?.('abort', abortPrompt)
    handle.pendingPromptControllers.delete(controller)
    handle.promptQueue?.schedule()
  }
}

function ensurePromptQueue(handle) {
  handle.promptQueue ||= createPromptQueue({
    isIdle: () => handle.runtime.session.isIdle
      && !handle.pendingPromptControllers?.size
      && !handle.bindingExtensions
      && !handle.reloading
      && !handle.interruptPromise
      && !handle.initializing
      && !handle.disposalPromise
      && !runtimeShuttingDown,
    submit: (item, streamingBehavior, signal, onAccepted) => promptSession(
      handle,
      item.text,
      item.images,
      streamingBehavior,
      signal,
      item.kind,
      item.handoffId,
      onAccepted,
    ),
    onChange: () => events.broadcastActiveSession(handle),
  })
  return handle.promptQueue
}

async function updatePromptQueue(handle, request) {
  requireInitializedSession(handle)
  if (request.action === 'resume' && handle.interruptPromise) {
    throw new Error('Wait for the current run to stop before resuming.')
  }
  await ensurePromptQueue(handle).update(request)
}

async function runSessionPrompt(
  handle,
  text,
  promptImages,
  streamingBehavior,
  handoffId,
  signal,
  visionRegistration,
  onAccepted,
) {
  const release = await lockPromptSubmission(handle)
  const session = handle.runtime.session
  let handoff
  try {
    if (signal?.aborted) throw new Error('Prompt cancelled')
    let disposition
    await new Promise((resolve, reject) => {
      const promptPromise = session.prompt(text, {
        images: promptImages.length ? promptImages : undefined,
        streamingBehavior,
        source: 'api',
        preflightResult: (result) => {
          if (result === 'started' && signal?.aborted) throw new Error('Prompt cancelled')
          disposition = result
          if (result === 'started') {
            visionRegistration?.start()
            handoff = createPromptHandoff(handle, handoffId)
          }
          onAccepted?.(result)
          resolve()
        },
      })
      Promise.resolve(promptPromise).then(
        () => settlePromptHandoff(handle, handoff),
        (error) => {
          settlePromptHandoff(handle, handoff)
          if (!disposition) reject(error)
        },
      )
    })
    if (handoff) await handoff.settled
    if (disposition === 'started' && !session.isStreaming) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    return disposition
  } finally {
    settlePromptHandoff(handle, handoff)
    release()
  }
}

async function lockPromptSubmission(handle) {
  const previous = handle.promptSubmissionLock
  let unlock
  const current = new Promise((resolve) => { unlock = resolve })
  handle.promptSubmissionLock = current
  if (previous) await previous
  return () => {
    if (handle.promptSubmissionLock === current) {
      handle.promptSubmissionLock = undefined
    }
    unlock()
  }
}

function createPromptHandoff(handle, id) {
  let resolve
  const settled = new Promise((settle) => { resolve = settle })
  const handoff = { id, settled, resolve }
  settlePromptHandoff(handle, handle.pendingPromptHandoff)
  handle.pendingPromptHandoff = handoff
  return handoff
}

function settlePromptHandoff(handle, handoff) {
  if (!handoff) return
  if (handle.pendingPromptHandoff === handoff) {
    handle.pendingPromptHandoff = undefined
  }
  handoff.resolve()
}

function isExtensionCommand(session, text) {
  if (!text.startsWith('/')) return false
  const spaceIndex = text.indexOf(' ')
  const name = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex)
  return Boolean(session.extensionRunner.getCommand(name))
}

async function prepareVisionDelegation(handle, images, signal) {
  if (signal?.aborted) throw new Error('Prompt cancelled')
  const session = handle.runtime.session
  const cwd = session.sessionManager.getCwd()
  const sessionPath = session.sessionManager.getSessionFile() || null
  const resolved = resolveVisionConfig({ cwd, sessionPath })
  if (!resolved.model) {
    throw new Error(
      `${formatModelLabel(session.state?.model || session.model)} does not support images and no vision model is configured. Set a default vision model in Leyline Settings → Vision.`,
    )
  }

  const modelRuntime = handle.runtime.services?.modelRuntime
  const visionModel = modelRuntime
    ? resolveSubagentModel(modelRuntime, resolved.model)
    : null
  if (modelRuntime && !visionModel) {
    throw new Error(`Unknown vision model: ${resolved.model}`)
  }
  if (visionModel && !visionModel.input?.includes('image')) {
    throw new Error(
      `The vision model ${formatSubagentModel(resolved.model)} does not support images. Choose a vision model in Leyline Settings → Vision.`,
    )
  }

  const blocks = [
    `[Attached ${images.length === 1 ? 'image' : 'images'} you cannot receive directly; the active model does not support image content.]`,
    'Inspect before answering:',
  ]
  const filePaths = await Promise.all(images.map((image) => {
    return writeVisionImage(session, image)
  }))
  filePaths.forEach((filePath, index) => {
    const label = images.length > 1 ? `${index + 1}. ` : ''
    blocks.push(
      `${label}Saved to: ${filePath}\n` +
      `Give the vision_agent tool path=${filePath} (cwd not needed; the path is absolute).`,
    )
  })
  blocks.push('')
  const settledBlocks = [
    `[Attached ${images.length === 1 ? 'image' : 'images'} that the active model cannot receive directly. You already inspected the attached image; no further vision agent call is needed.]`,
  ]
  filePaths.forEach((filePath, index) => {
    const label = images.length > 1 ? `${index + 1}. ` : ''
    settledBlocks.push(`${label}Saved to: ${filePath}`)
  })
  settledBlocks.push('')
  return {
    paths: filePaths,
    settledText: settledBlocks.join('\n'),
    text: blocks.join('\n'),
  }
}

function imageFileExtension(mimeType) {
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
  }
  return map[mimeType] || '.png'
}

function visionImageBaseDir() {
  const root = process.env.LEYLINE_MEMORY_DIR
    || join(homedir(), '.local', 'share', 'leyline')
  return join(root, 'attachments')
}

async function writeVisionImage(session, image) {
  const sessionId = session.sessionManager.getSessionId()
  const subdir = sessionId || 'pending'
  const dir = join(visionImageBaseDir(), subdir)
  await mkdir(dir, { recursive: true })
  const hash = createHash('sha256').update(image.data || '').digest('hex').slice(0, 16)
  const filePath = join(dir, `${hash}${imageFileExtension(image.mimeType)}`)
  if (!existsSync(filePath)) {
    await writeFile(filePath, Buffer.from(image.data, 'base64'), { flag: 'wx' })
  }
  return filePath
}

function formatModelLabel(model) {
  if (!model) return 'The current model'
  if (typeof model === 'object') return `${model.provider}/${model.id}`
  return String(model)
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
  if (handle.interruptPromise) return handle.interruptPromise
  ensurePromptQueue(handle).hold()
  handle.subagentController?.abort()
  cleanupExtensionConfirmations(handle, { invalidate: false })
  for (const controller of handle.pendingPromptControllers || []) {
    controller.abort()
  }
  handle.interruptPromise = handle.runtime.session.abort()
  try {
    await handle.interruptPromise
  } finally {
    handle.interruptPromise = undefined
  }
}

async function editSessionPrompt(
  handle,
  entryId,
  text,
  images = [],
  signal,
  handoffId,
) {
  requireInitializedSession(handle)
  const session = handle.runtime.session
  if (!entryId) throw new Error('entryId is required')
  if (session.isStreaming) {
    throw new Error('Wait for the current response to finish before editing.')
  }
  if (session.isCompacting) {
    throw new Error('Wait for compaction to finish before editing.')
  }

  if (handle.pendingPromptControllers?.size) {
    throw new Error('Wait for the pending message to finish sending before editing.')
  }
  const entry = session.sessionManager.getEntry(entryId)
  if (entry?.type !== 'message' || entry.message?.role !== 'user') {
    throw new Error('Only user messages can be edited')
  }

  if (handle.promptQueue?.snapshot().items.length) handle.promptQueue.hold()
  const oldLeafId = session.sessionManager.getLeafId()
  try {
    if (oldLeafId === entryId) moveSessionLeaf(session, entry.parentId || null)
    else {
      const result = await session.navigateTree(entryId)
      if (result.cancelled) throw new Error('Edit cancelled')
    }
    await bindRuntimeHandle(handle)

    try {
      await promptSession(
        handle,
        text,
        images,
        undefined,
        signal,
        undefined,
        handoffId,
        () => {},
      )
    } catch (error) {
      moveSessionLeaf(session, oldLeafId)
      await bindRuntimeHandle(handle)
      throw error
    }
  } finally {
    handle.promptQueue?.schedule()
  }
}

function moveSessionLeaf(session, leafId) {
  if (leafId) session.sessionManager.branch(leafId)
  else session.sessionManager.resetLeaf()
  updateSessionContext(session)
}

async function resetSessionToEntry(handle, entryId) {
  requireInitializedSession(handle)
  const session = handle.runtime.session
  if (!entryId) throw new Error('entryId is required')
  if (session.isStreaming) {
    throw new Error('Wait for the current response to finish before resetting.')
  }
  if (session.isCompacting) {
    throw new Error('Wait for compaction to finish before resetting.')
  }

  if (handle.pendingPromptControllers?.size) {
    throw new Error('Wait for the pending message to finish sending before resetting.')
  }
  if (handle.promptQueue?.snapshot().items.length) handle.promptQueue.hold()
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
  restoreTrailingResearchReport(manager)
  updateSessionContext(session)
  await bindRuntimeHandle(handle)
  return activeSessionDto(handle)
}

function updateSessionContext(session) {
  session.refreshContext()
}

const forkSession = trackRuntimeCreation(async (handle, entryId) => {
  requireInitializedSession(handle)
  const session = handle.runtime.session
  if (!entryId) throw new Error('entryId is required')
  if (!session.sessionManager.getEntry(entryId)) throw new Error('Entry not found')
  if (session.isCompacting) {
    throw new Error('Wait for compaction to finish before forking.')
  }

  const result = await session.extensionRunner.emit({
    type: 'session_before_fork',
    entryId,
    position: 'at',
  })
  if (result?.cancel) throw new Error('Fork cancelled')
  if (runtimeShuttingDown || handle.disposalPromise) {
    throw new Error('Runtime is shutting down')
  }
  if (handle.runtime.session !== session) throw new Error('Session changed before forking')

  const previousSessionFile = session.sessionManager.getSessionFile()
  if (!previousSessionFile || !existsSync(previousSessionFile)) {
    throw new Error('Wait for this session to finish saving before forking.')
  }
  const manager = SessionManager.open(
    previousSessionFile,
    session.sessionManager.getSessionDir(),
  )
  manager.createBranchedSession(entryId)
  rebaseResearchSession(manager)
  copySessionSubagentOverrides({
    cwd: manager.getCwd(),
    fromSessionPath: previousSessionFile,
    toSessionPath: manager.getSessionFile(),
  })
  copySessionVisionOverrides({
    cwd: manager.getCwd(),
    fromSessionPath: previousSessionFile,
    toSessionPath: manager.getSessionFile(),
  })
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: manager.getCwd(),
    agentDir: getAgentDir(),
    sessionManager: manager,
    sessionStartEvent: { type: 'session_start', reason: 'fork', previousSessionFile },
  })
  const fork = {
    runtime,
    sessionId: manager.getSessionId(),
    unsubscribe: undefined,
    extensionUiState: emptyExtensionUiState(),
  }
  runtimeHandles.set(fork.sessionId, fork)
  try {
    await bindRuntimeHandle(fork)
    setActiveHandle(fork)
    return fork
  } catch (error) {
    await discardRuntimeHandle(fork)
    throw error
  }
})

function restoreTrailingResearchReport(manager) {
  const research = researchStateFromEntries(
    manager.getBranch(),
    manager.getSessionId(),
  )
  if (!research || research.phase !== 'report' || research.reportEntryId) return
  const reportEntry = researchReportEntry(
    manager.getBranch(),
    research.reportRequestedAt,
  )
  if (reportEntry?.type !== 'message') return
  const reportText = extractMessageText(reportEntry.message.content)
  const citationAudit = auditResearchReportCitations(
    reportText,
    research.sources,
    manager.getCwd(),
  )
  const usableSources = research.sources.filter((source) => {
    return source.status !== 'excluded'
  })
  const data = !citationAudit.invalid
    && (!usableSources.length || citationAudit.ids.length)
    ? {
        kind: 'report',
        reportEntryId: reportEntry.id,
        title: research.reportTitle,
        citedSourceIds: citationAudit.ids,
      }
    : {
        kind: 'error',
        message: 'The restored report citations did not match the source ledger.',
        invalidLinks: citationAudit.invalidLinks,
        invalidCount: citationAudit.invalid,
      }
  manager.appendCustomEntry(RESEARCH_CUSTOM_TYPE, {
    version: RESEARCH_VERSION,
    sessionId: manager.getSessionId(),
    updatedAt: Date.now(),
    ...data,
  })
}

function rebaseResearchSession(manager) {
  const branch = manager.getBranch()
  const marker = [...branch].reverse().find((entry) => {
    return entry.type === 'custom'
      && entry.customType === RESEARCH_CUSTOM_TYPE
      && entry.data?.kind === 'session'
  })
  if (!marker?.data?.sessionId) return
  const research = researchStateFromEntries(branch, marker.data.sessionId)
  if (!research) return

  const sessionId = manager.getSessionId()
  const append = (data) => manager.appendCustomEntry(RESEARCH_CUSTOM_TYPE, {
    version: RESEARCH_VERSION,
    sessionId,
    updatedAt: Date.now(),
    ...data,
  })
  append({ kind: 'session', createdAt: Date.now() })
  if (research.objective) append({ kind: 'objective', objective: research.objective })
  if (research.threads.length) {
    append({
      kind: 'plan',
      strategy: research.strategy,
      threads: research.threads,
    })
  }
  for (const source of research.sources) append({ kind: 'source', source })
  append({
    kind: 'phase',
    phase: research.phase,
    note: research.note,
    title: research.reportTitle,
    citedSourceIds: research.citedSourceIds,
  })
  const reportEntry = manager.getEntry(research.reportEntryId)
    || researchReportEntry(branch, research.reportRequestedAt)
  if (reportEntry?.type === 'message') {
    const reportText = extractMessageText(reportEntry.message.content)
    const citationAudit = auditResearchReportCitations(
      reportText,
      research.sources,
      manager.getCwd(),
    )
    const usableSources = research.sources.filter((source) => {
      return source.status !== 'excluded'
    })
    if (!citationAudit.invalid
      && (!usableSources.length || citationAudit.ids.length)) {
      append({
        kind: 'report',
        reportEntryId: reportEntry.id,
        title: research.reportTitle,
        citedSourceIds: citationAudit.ids,
      })
    } else {
      append({
        kind: 'error',
        message: 'Forked report citations did not match the source ledger.',
        invalidLinks: citationAudit.invalidLinks,
        invalidCount: citationAudit.invalid,
      })
    }
  } else if (research.status === 'error') {
    append({ kind: 'error', message: research.error })
  }
}

function researchReportEntry(branch, requestedAt) {
  const minimum = Number(requestedAt || 0)
  return [...branch].reverse().find((entry) => {
    if (entry.type !== 'message' || entry.message?.role !== 'assistant') {
      return false
    }
    if (entry.message.stopReason !== 'stop') return false
    const timestamp = new Date(entry.timestamp).getTime()
    return timestamp >= minimum && extractMessageText(entry.message.content).trim()
  })
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

async function removeVisionAttachments(sessionId) {
  if (!sessionId) return
  try {
    await rm(join(visionImageBaseDir(), sessionId), { recursive: true, force: true })
  } catch {
    // Best effort: an orphaned attachment folder must not block deletion.
  }
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
    await discardRuntimeHandle(handle)
    return { path: null }
  }

  const trashPath = trashSessionPath(session)
  await mkdir(dirname(trashPath), { recursive: true })
  try {
    await rename(session.path, trashPath)
  } catch (error) {
    if (!isActiveSession(id) || error?.code !== 'ENOENT') throw error
    await discardActiveSession()
    return { path: null }
  }

  if (handle) await discardRuntimeHandle(handle)
  await removeVisionAttachments(session.id)

  return { path: trashPath }
}

async function trashProject(cwd) {
  if (!cwd) throw new Error('Project cwd is required')

  const persisted = await listSessionsForProject(cwd)
  const runtimeOnly = [...runtimeHandles.values()]
    .map(sessionInfo)
    .filter((session) => session.cwd === cwd
      && !persisted.some((item) => item.id === session.id))
  const sessions = [...runtimeOnly, ...persisted]
  if (!sessions.length) return { count: 0, path: '' }

  for (const session of sessions) {
    const handle = runtimeHandles.get(session.id)
    if (!handle) continue
    if (handle.runtime.session.isStreaming) {
      throw new Error('Wait for the current response to finish before deleting.')
    }
    if (handle.runtime.session.isCompacting) {
      throw new Error('Wait for compaction to finish before deleting.')
    }
  }

  const stamp = trashStamp()
  const moved = []
  for (const session of sessions) {
    const handle = runtimeHandles.get(session.id)
    if (handle && !existsSync(session.path)) {
      await discardRuntimeHandle(handle)
      continue
    }
    if (!handle && !existsSync(session.path)) continue

    const trashPath = trashSessionPath(session, stamp)
    await mkdir(dirname(trashPath), { recursive: true })
    try {
      await rename(session.path, trashPath)
      moved.push(trashPath)
    } catch (error) {
      if (!isActiveSession(session.id) || error?.code !== 'ENOENT') throw error
      await discardActiveSession()
    }

    if (handle) await discardRuntimeHandle(handle)
    await removeVisionAttachments(session.id)
  }

  return { count: moved.length, path: moved[0] || '' }
}

async function discardActiveSession() {
  if (!activeHandle) return
  await discardRuntimeHandle(activeHandle)
}

async function disposeRuntime(runtime) {
  try {
    await runtime.session.abort()
  } finally {
    await runtime.dispose()
  }
}

function discardRuntimeHandle(handle) {
  if (handle.disposalPromise) return handle.disposalPromise
  handle.promptQueue?.dispose()
  cleanupExtensionConfirmations(handle)
  for (const controller of handle.pendingPromptControllers || []) {
    controller.abort()
  }
  settlePromptHandoff(handle, handle.pendingPromptHandoff)
  handle.unsubscribe?.()
  handle.disposalPromise = (async () => {
    try {
      await disposeRuntime(handle.runtime)
    } finally {
      hiddenRuntimeHandles.delete(handle)
      if (runtimeHandles.get(handle.sessionId) === handle) {
        removeRuntimeHandle(handle.sessionId)
      }
      if (activeHandle === handle) setActiveHandle(undefined)
    }
  })()
  return handle.disposalPromise
}

function shutdownRuntime() {
  if (runtimeShutdownPromise) return runtimeShutdownPromise
  runtimeShuttingDown = true
  runtimeShutdownPromise = Promise.resolve().then(async () => {
    const interruptions = [
      ...runtimeHandles.values(),
      ...hiddenRuntimeHandles,
    ].map((handle) => {
      cleanupExtensionConfirmations(handle)
      return interruptSession(handle)
    })
    await Promise.allSettled([...interruptions, ...pendingRuntimeCreations])
    const results = await Promise.allSettled([
      ...runtimeHandles.values(),
      ...hiddenRuntimeHandles,
    ].map(discardRuntimeHandle))
    const errors = results.filter((result) => result.status === 'rejected')
    if (errors.length) {
      throw new AggregateError(errors.map((result) => result.reason), 'Runtime shutdown failed')
    }
  }).finally(() => {
    runtimeShuttingDown = false
    runtimeShutdownPromise = undefined
  })
  return runtimeShutdownPromise
}

function removeRuntimeHandle(id) {
  if (!runtimeHandles.delete(id)) return
  events.broadcastRuntimeRemoved(id)
}

function trashSessionPath(session, stamp = trashStamp()) {
  const sessionDir = configuredSessionDir(session.cwd) || dirname(session.path)
  const rel = relative(sessionDir, session.path)
  const safeRel = rel && !rel.startsWith('..') && rel !== session.path
    ? rel
    : basename(session.path)
  return join(dirname(sessionDir), 'leyline-trash', stamp, safeRel)
}

function trashStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

const reloadSession = trackRuntimeCreation(async (handle) => {
  requireInitializedSession(handle)
  const session = handle.runtime.session
  if (session.isStreaming) {
    throw new Error('Wait for the current response to finish before reloading.')
  }
  if (session.isCompacting) {
    throw new Error('Wait for compaction to finish before reloading.')
  }

  if (handle.pendingPromptControllers?.size) {
    throw new Error('Wait for the pending message to finish sending before reloading.')
  }
  if (handle.promptQueue?.snapshot().items.length) handle.promptQueue.hold()
  const previousSessionFile = session.sessionFile
  const previousLeafId = session.sessionManager.getLeafId()
  const sessionManager = previousSessionFile && existsSync(previousSessionFile)
    ? SessionManager.open(previousSessionFile)
    : session.sessionManager
  if (previousLeafId) sessionManager.branch(previousLeafId)
  else sessionManager.resetLeaf()

  handle.reloading = true
  let replacement
  let applied = false
  try {
    replacement = await createAgentSessionRuntime(createRuntime, {
      cwd: sessionManager.getCwd(),
      agentDir: handle.runtime.services.agentDir,
      sessionManager,
      sessionStartEvent: {
        type: 'session_start',
        reason: 'reload',
        previousSessionFile,
      },
    })
    if (runtimeShuttingDown || handle.disposalPromise) throw new Error('Runtime is shutting down')
    cleanupExtensionConfirmations(handle)
    for (const controller of handle.pendingPromptControllers || []) {
      controller.abort()
    }
    settlePromptHandoff(handle, handle.pendingPromptHandoff)
    await disposeRuntime(handle.runtime)
    if (runtimeShuttingDown || handle.disposalPromise) throw new Error('Runtime is shutting down')
    handle.unsubscribe?.()
    handle.runtime = replacement
    applied = true
    handle.extensionUiState = emptyExtensionUiState()
    if (activeHandle === handle) setActiveHandle(handle)
    await bindRuntimeHandle(handle)
  } catch (error) {
    if (replacement) {
      try {
        await discardRuntimeHandle(handle)
      } finally {
        if (!applied) await disposeRuntime(replacement)
      }
    }
    throw error
  } finally {
    handle.reloading = false
  }
})

async function setSessionModel(handle, provider, id) {
  if (!provider || !id) throw new Error('provider and id are required')

  const model = handle.runtime.session.modelRuntime.getModel(provider, id)
  if (!model) throw new Error('Model not found')
  await handle.runtime.session.setModel(model, { persist: true })
}

function setSessionThinkingLevel(handle, level) {
  if (!level) throw new Error('level is required')

  const levels = handle.runtime.session.getAvailableThinkingLevels()
  if (!levels.includes(level)) throw new Error('Thinking level not available')
  handle.runtime.session.setThinkingLevel(level, { persist: true })
}

function setSessionMode(handle) {
  forceOneAtATime(handle.runtime.session)
}

function forceOneAtATime(session) {
  session.setSteeringMode(ONE_AT_A_TIME)
  session.setFollowUpMode(ONE_AT_A_TIME)
}

const createNewSession = trackRuntimeCreation(async (cwd, kind = 'session') => {
  if (!cwd) throw new Error('cwd is required')
  if (!['session', 'research'].includes(kind)) {
    throw new Error('kind must be session or research')
  }
  await mkdir(cwd, { recursive: true })

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir: getAgentDir(),
    sessionManager: SessionManager.create(cwd, configuredSessionDir(cwd)),
  })
  const sessionId = runtime.session.sessionManager.getSessionId()
  if (kind === 'research') {
    appendResearchSessionMarker(runtime.session.sessionManager)
  }
  const handle = {
    runtime,
    sessionId,
    unsubscribe: undefined,
    extensionUiState: emptyExtensionUiState(),
  }
  runtimeHandles.set(handle.sessionId, handle)
  forceOneAtATime(runtime.session)
  try {
    await bindRuntimeHandle(handle)
    setActiveHandle(handle)
    return activeSessionDto(handle)
  } catch (error) {
    await discardRuntimeHandle(handle)
    throw error
  }
})

function activeSessionDto(handle = activeHandle) {
  return runtimeSessionDto(handle)
}

function toActiveSessionDetailDto(handle = activeHandle) {
  return handleSessionDetailDto(handle)
}

const runtimeState = trackRuntimeCreation(async (cwd) => {
  const targetCwd = cwd || activeRuntime?.cwd || process.cwd()
  if (activeRuntime?.cwd === targetCwd) return activeSessionDto()

  const result = await createAgentSessionRuntime(createRuntime, {
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
    await disposeRuntime(result)
  }
})

async function bindRuntimeHandle(handle) {
  if (runtimeShuttingDown) throw new Error('Runtime is shutting down')
  if (handle.bindingExtensions) throw new Error('Wait for session initialization to finish.')
  handle.bindingExtensions = true
  ensurePromptQueue(handle)
  try {
    await bindRuntimeHandleExtensions(handle, events)
    if (runtimeShuttingDown) throw new Error('Runtime is shutting down')
  } finally {
    handle.bindingExtensions = false
  }
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

const runSubagent = trackRuntimeCreation(async ({ task, cwd, parentSessionPath, model, thinkingLevel, tools, excludeTools, systemPrompt, isolatedSystemPrompt, images, allowImages = false, signal, onStart }) => {
  if (!cwd) throw new Error('cwd is required')
  if (!task) throw new Error('task is required')
  if (tools !== undefined && !Array.isArray(tools)) {
    throw new Error('tools must be an array')
  }
  if (excludeTools !== undefined && !Array.isArray(excludeTools)) {
    throw new Error('excludeTools must be an array')
  }
  if (tools !== undefined && excludeTools !== undefined) {
    throw new Error('tools and excludeTools cannot be used together')
  }
  if (signal?.aborted) throw new Error('Subagent cancelled')
  if (tools?.includes(SUBAGENT_DELEGATION_TOOL)) {
    throw new Error('Nested subagent delegation is disabled')
  }
  const controller = new AbortController()
  signal = AbortSignal.any([signal, controller.signal].filter(Boolean))
  const requestedThinkingLevel = normalizeSubagentThinkingLevel(thinkingLevel)
  const promptImages = validateImages(images)
  const isolatedPrompt = typeof isolatedSystemPrompt === 'string'
    ? isolatedSystemPrompt.trim()
    : ''

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
    toolPolicy: {
      ...(tools !== undefined ? { tools } : {}),
      excludeTools: [...new Set([...(excludeTools || []), SUBAGENT_DELEGATION_TOOL])],
    },
    ...(isolatedPrompt ? { isolatedSystemPrompt: isolatedPrompt } : {}),
    ...(allowImages ? { allowImages: true } : {}),
  })

  let session
  let handle
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
    handle = {
      runtime,
      sessionId: childId,
      unsubscribe: undefined,
      extensionUiState: emptyExtensionUiState(),
      initializing: true,
      subagentSignal: signal,
      subagentController: controller,
    }
    if (runtimeShuttingDown) throw new Error('Runtime is shutting down')
    if (signal?.aborted) throw new Error('Subagent cancelled')
    if (promptImages.length && !session.model?.input?.includes('image')) {
      throw new Error(
        `The configured model ${formatSubagentModel(model)} does not support images. Use a vision-capable model.`,
      )
    }
    abortSubagent = () => { interruptSession(handle).catch(() => {}) }
    signal?.addEventListener?.('abort', abortSubagent, { once: true })

    if (onStart) {
      runtimeHandles.set(childId, handle)
      onStart({ path: childPath, id: childId, cwd })
      if (signal?.aborted) throw new Error('Subagent cancelled')
      await bindRuntimeHandle(handle)
    } else {
      hiddenRuntimeHandles.add(handle)
      await session.bindExtensions({})
    }
    if (runtimeShuttingDown) throw new Error('Runtime is shutting down')
    if (signal?.aborted) throw new Error('Subagent cancelled')

    const taskWithPrompt = systemPrompt && systemPrompt.trim()
      ? `${systemPrompt.trim()}\n\nTask: ${task}`
      : task
    let preflightSucceeded = false
    await new Promise((resolve, reject) => {
      session
        .prompt(taskWithPrompt, {
          images: promptImages.length ? promptImages : undefined,
          source: 'api',
          preflightResult: () => {
            if (signal.aborted) throw new Error('Subagent cancelled')
            handle.initializing = false
          }
        })
        .then(() => {
          preflightSucceeded = true
          resolve()
        })
        .catch((error) => {
          if (!preflightSucceeded) reject(error)
        })
    })

    if (signal.aborted) throw new Error('Subagent cancelled')
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

    const effectiveThinkingLevel = session.thinkingLevel

    const result = {
      childSession: { path: childPath, id: childId, cwd },
      messages,
      usage,
      model: responseModel,
      thinkingLevel: effectiveThinkingLevel,
      stopReason,
    }
    return result
  } catch (error) {
    if (signal?.aborted) throw new Error('Subagent cancelled')
    throw error
  } finally {
    signal?.removeEventListener?.('abort', abortSubagent)
    if (handle) {
      handle.initializing = false
      handle.subagentSignal = undefined
      handle.subagentController = undefined
      if (runtimeShuttingDown || activeHandle !== handle) await discardRuntimeHandle(handle)
    }
  }
})

const VISION_AGENT_PROMPT =
  'You are the vision subagent for a parent coding agent that cannot receive ' +
  'images directly. Study the attached image and report what it shows in prose. ' +
  'Include any visible text (UI labels, error messages, terminal output, ' +
  'diagrams), notable layout, colors, and relationships between parts. ' +
  'If the user asked a specific question, answer it directly first, then give ' +
  'the surrounding detail the parent needs.'

async function runVision({ question, cwd, parentSessionPath, model, thinking, image, signal }) {
  if (!image) throw new Error('image is required')
  return runSubagent({
    task: question || 'Describe this image in detail.',
    cwd,
    parentSessionPath,
    model,
    thinkingLevel: thinking,
    tools: [],
    isolatedSystemPrompt: VISION_AGENT_PROMPT,
    images: [image],
    allowImages: true,
    signal,
  })
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
  forkSession,
  html,
  interruptSession,
  json,
  listProjects,
  listSessions,
  listSubagentConfigs,
  listVisibleMemories,
  listVisionConfig,
  openEventStream,
  openGitReviewEventStream,
  promptSession,
  readDirectory,
  readGitReview,
  readGitReviewDiff,
  readJson,
  reloadSession,
  renameSession,
  renderSessionExportHtml,
  requireActiveHandle,
  resetSessionToEntry,
  resolveSession,
  resolveSubagentConfig,
  resolveVisionConfig,
  runtimeHandleForId,
  runtimeState,
  setMemoryStatus,
  setSubagentModelOverride,
  deleteSubagentModelOverride,
  setVisionOverride,
  clearVisionOverride,
  setSessionMode,
  setSessionModel,
  setRolloutFeedback,
  setSessionThinkingLevel,
  shutdownRuntime,
  sessionDetail,
  switchActiveSession,
  toActiveSessionDetailDto,
  toSessionDto,
  trashProject,
  trashSession,
  updateMemory,
  updatePromptQueue,
  runSubagent,
  runVision,
  }
}
