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
import {
  bindRuntimeHandle as bindRuntimeHandleExtensions,
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
  return { ...result, extensions: [] }
}

async function createRuntimeResult(
  { cwd, sessionManager, sessionStartEvent },
  { model, thinkingLevel, allowImages = false, isolatedSystemPrompt } = {},
) {
  const systemPrompt = typeof isolatedSystemPrompt === 'string'
    ? isolatedSystemPrompt.trim()
    : ''
  const services = await createAgentSessionServices({
    cwd,
    resourceLoaderOptions: {
      additionalExtensionPaths: [
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
  if (allowImages) {
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
) {
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
    if (!promptText.trim() && promptImages.length === 0) {
      throw new Error('text or image is required')
    }
    if (streamingBehavior
      && !['steer', 'followUp'].includes(streamingBehavior)) {
      throw new Error('invalid streaming behavior')
    }
    await initializeSessionKind(handle, kind)

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
      try {
        await runSessionPrompt(session, promptText, promptImages, streamingBehavior)
      } catch (error) {
        if (controller.signal.aborted) throw new Error('Prompt cancelled')
        throw error
      }
      if (controller.signal.aborted) {
        await session.abort()
        throw new Error('Prompt cancelled')
      }
      return
    }

    const registration = registerVisionDelegation(
      session,
      promptImages,
      delegation,
      promptText,
    )
    try {
      const accepted = await runSessionPrompt(
        session,
        promptText,
        promptImages,
        streamingBehavior,
      )
      if (controller.signal.aborted) {
        registration.cancel()
        await session.abort()
        throw new Error('Prompt cancelled')
      }
      if (!accepted) registration.cancel()
    } catch (error) {
      registration.cancel()
      if (controller.signal.aborted) throw new Error('Prompt cancelled')
      throw error
    }
  } finally {
    signal?.removeEventListener?.('abort', abortPrompt)
    handle.pendingPromptControllers.delete(controller)
  }
}

async function runSessionPrompt(session, text, promptImages, streamingBehavior) {
  const wasStreaming = session.isStreaming
  const queueBefore = queuedMessageCount(session, streamingBehavior)
  let preflightSucceeded = false
  let queued = false
  await new Promise((resolve, reject) => {
    session
      .prompt(text, {
        images: promptImages.length ? promptImages : undefined,
        streamingBehavior,
        source: 'api',
        preflightResult: (didSucceed) => {
          if (!didSucceed) return
          preflightSucceeded = true
          queued = wasStreaming
            && queuedMessageCount(session, streamingBehavior) > queueBefore
          resolve()
        },
      })
      .catch((error) => {
        if (!preflightSucceeded) reject(error)
      })
  })
  if (!wasStreaming && !session.isStreaming) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  return queued || session.isStreaming
}

function queuedMessageCount(session, streamingBehavior) {
  if (streamingBehavior === 'followUp') {
    return session.getFollowUpMessages().length
  }
  return session.getSteeringMessages().length
}

function isExtensionCommand(session, text) {
  if (!text.startsWith('/')) return false
  const name = text.slice(1).split(/\s/, 1)[0]
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
  for (const controller of handle.pendingPromptControllers || []) {
    controller.abort()
  }
  await handle.runtime.session.abort()
}

async function editSessionPrompt(handle, entryId, text, images = [], signal) {
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
  await bindRuntimeHandle(handle)

  try {
    await promptSession(handle, text, images, undefined, signal)
  } catch (error) {
    moveSessionLeaf(session, oldLeafId)
    await bindRuntimeHandle(handle)
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
  restoreTrailingResearchReport(manager)
  updateSessionContext(session)
  await bindRuntimeHandle(handle)
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
  rebaseResearchSession(activeRuntime.session.sessionManager)
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
  copySessionVisionOverrides({
    cwd: activeRuntime.session.sessionManager.getCwd(),
    fromSessionPath: previousSessionPath,
    toSessionPath: activeRuntime.session.sessionManager.getSessionFile(),
  })
  await bindActiveSession()
  return activeSessionDto()
}

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
  const citationAudit = auditResearchReportCitations(reportText, research.sources)
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
      discardRuntimeHandle(handle)
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
      discardActiveSession()
    }

    if (handle) discardRuntimeHandle(handle)
    await removeVisionAttachments(session.id)
  }

  return { count: moved.length, path: moved[0] || '' }
}

function discardActiveSession() {
  if (!activeHandle) return
  discardRuntimeHandle(activeHandle)
}

function discardRuntimeHandle(handle) {
  for (const controller of handle.pendingPromptControllers || []) {
    controller.abort()
  }
  handle.unsubscribe?.()
  handle.runtime.session.dispose()
  runtimeHandles.delete(handle.sessionId)
  if (activeHandle === handle) setActiveHandle(undefined)
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
    for (const controller of handle.pendingPromptControllers || []) {
      controller.abort()
    }
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

async function createNewSession(cwd, kind = 'session') {
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

async function runSubagent({ task, cwd, parentSessionPath, model, thinkingLevel, tools, systemPrompt, isolatedSystemPrompt, images, allowImages = false, signal }) {
  if (!cwd) throw new Error('cwd is required')
  if (!task) throw new Error('task is required')
  if (tools !== undefined && !Array.isArray(tools)) {
    throw new Error('tools must be an array')
  }
  if (signal?.aborted) throw new Error('Subagent cancelled')
  const requestedThinkingLevel = normalizeSubagentThinkingLevel(thinkingLevel)
  const promptImages = validateImages(images)

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
      allowImages,
      isolatedSystemPrompt,
    })
    const runtime = await createAgentSessionRuntime(createSubagentRuntime, {
      cwd,
      agentDir: getAgentDir(),
      sessionManager,
    })
    session = runtime.session
    if (signal?.aborted) throw new Error('Subagent cancelled')
    if (promptImages.length && !session.model?.input?.includes('image')) {
      throw new Error(
        `The configured model ${formatSubagentModel(model)} does not support images. Use a vision-capable model.`,
      )
    }
    abortSubagent = () => session?.abort?.()
    signal?.addEventListener?.('abort', abortSubagent, { once: true })

    if (tools !== undefined) {
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
        .prompt(taskWithPrompt, {
          images: promptImages.length ? promptImages : undefined,
          source: 'api',
        })
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
  forkActiveSession,
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
  sessionDetail,
  switchActiveSession,
  toActiveSessionDetailDto,
  toSessionDto,
  trashProject,
  trashSession,
  updateMemory,
  runSubagent,
  runVision,
  }
}
