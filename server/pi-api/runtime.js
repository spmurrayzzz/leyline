import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import { RUNTIME_SHUTDOWN_TIMEOUT_MS } from '../shutdown-deadlines.js'
import {
  exportFilename,
  exportShareMeta,
  renderSessionExportHtml,
} from './export-renderer.js'
import { createEventHub } from './events.js'
import { createTracing, TRACING_EXTENSION_PATH } from './tracing.js'
import { createPromptQueue } from './prompt-queue.js'
import { createIdleRuntimeCleanup } from './idle-runtimes.js'
import { createSessionTitleGenerator } from './session-titles.js'
import { shutdownSettingsOperations, waitForSettings, withProviderSettingsLock } from './settings-operations.js'
import { settingsError } from './pi-config.js'
import { refreshCustomProviders, wrapModelRuntime } from './custom-providers.js'
import { createProviderSettingsRuntimes, createResourceSession } from './provider-settings-runtime.js'
import {
  bindRuntimeHandle as bindRuntimeHandleExtensions,
  cleanupExtensionConfirmations,
  emptyExtensionUiState,
  trackRuntimeActivity,
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
  toSessionDetailFromManager,
  toSessionDto,
} from './dtos.js'
import { html, json, readJson } from './http.js'
import { leylineDataDir } from './leyline-db.js'
import {
  createMemory,
  deleteMemories,
  listVisibleMemories,
  setMemoryStatus,
  updateMemory,
} from './memories.js'
import { setRolloutFeedback } from './rollout-feedback.js'
import {
  closeSessionSummaryWorkers,
  configuredSessionDir,
  findPersistedSessionRecord,
  listPersistedProjects,
  listPersistedSessions,
  listSessionsForProject,
  SUBAGENT_SESSION_CUSTOM_TYPE,
} from './sessions.js'
import {
  copySessionSubagentOverrides,
  deleteSessionSubagentBatchOverride,
  deleteSubagentModelOverride,
  listSubagentConfigs,
  resolveSubagentConfig,
  setSubagentBatchSize,
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
  AgentSessionRuntime,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createEventBus,
  createMcpExtension,
  createToolSearchExtension,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import {
  RESEARCH_CUSTOM_TYPE,
  RESEARCH_VERSION,
  compactResearchState,
  researchStateFromEntries,
} from '../../lib/research-state.js'
import { auditResearchReportCitations } from '../../lib/research-citations.js'
import { projectModelChanges } from '../../lib/transcript-projection.js'
import {
  SERVICE_TIER_COMMAND,
  SERVICE_TIERS,
  serviceTierFromStatuses,
  supportedServiceTiers,
  ULTRAFAST_COMMAND,
} from '../../lib/ultrafast.js'

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
const BUNDLED_ULTRAFAST_EXTENSION = resolve(
  __dirname,
  '..',
  '..',
  '.pi',
  'extensions',
  'ultrafast',
  'index.js',
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
const idleSessions = new Map()
const hiddenRuntimeHandles = new Set()
const runtimeHandlePromises = new Map()
const pendingRuntimeCreations = new Set()
const runtimeInitializations = new Set()
const trashingSessionIds = new Set()
const trashingProjectCwds = new Set()
const providerSettingsRuntimes = createProviderSettingsRuntimes({ isClosing: () => runtimeShuttingDown })
const providerSessions = new Set()
const runtimeDisposals = new WeakMap()

function assertProviderRoutes(providerId, modelRuntime, action = 'Sign-in') {
  const sessions = new Set([
    ...providerSessions,
    ...[...runtimeHandles.values(), ...hiddenRuntimeHandles].map((handle) => handle.runtime.session),
  ])
  const models = new Map(modelRuntime.getAllModels(providerId).map((model) => [`${model.type || 'chat'}\0${model.id}`, model]))
  for (const session of sessions) {
    const previous = [...session.modelRuntime.getAllModels(providerId), session.model, session.state?.model]
    for (const model of previous) {
      if (!model || model.provider !== providerId) continue
      const next = models.get(`${model.type || 'chat'}\0${model.id}`)
      if (!next || next.baseUrl !== model.baseUrl || next.api !== model.api) {
        throw settingsError(`${action} is blocked because an open or background runtime still uses different provider URLs. Wait for active work to finish, then reload every affected session or restart the backend and try again.`, 409)
      }
    }
  }
}

async function settingsRuntime(target = {}, options = {}) {
  const handle = target.sessionId ? runtimeHandles.get(target.sessionId) : null
  if (handle && target.cwd && handle.runtime.cwd !== target.cwd) throw settingsError('The settings target changed. Reopen settings.', 409)
  return providerSettingsRuntimes.getRuntime({ cwd: target.cwd || handle?.runtime.cwd || process.cwd() }, options)
}

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
  onSessionAccess: id => idleRuntimeCleanup.touch(runtimeHandles.get(id)),
})


const tracing = createTracing({
  broadcastEvent: events.broadcastEvent,
  getChildMarker: manager => manager ? childSessionMarker(manager) : undefined,
})

const idleRuntimeCleanup = createIdleRuntimeCleanup({
  getHandles: () => runtimeHandles.values(),
  isProtected: handle => {
    const session = handle.runtime.session
    return runtimeShuttingDown || events.isSessionObserved(handle.sessionId)
      || handle.pendingApiRequests > 0
      || handle.disposalPromise || handle.initializing || handle.bindingExtensions
      || handle.reloading || handle.changingBranch || handle.settingModel || handle.settingServiceTier
      || handle.interruptPromise || handle.compactionPromise || handle.bashPromise
      || handle.promptSubmissionLock || handle.pendingPromptHandoff || handle.pendingPromptControllers?.size
      || handle.subagentController || handle.subagentSignal
      || handle.promptQueue?.snapshot().items.length
      || handle.extensionConfirmations?.pending.size || handle.extensionUiState?.confirmations?.length
      || !session.isIdle || session.isRetrying || session.isBashRunning || session.hasPendingBashMessages
      || session.agent.hasQueuedMessages() || session.agent.state.pendingToolCalls?.size
  },
  dispose: suspendIdleRuntime,
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
  add([...normalized.matchAll(/\/node_modules\/(?:@[^/]+\/)?([^/]+)\//g)].at(-1)?.[1])
  const marker = '/extensions/'
  const markerIndex = normalized.lastIndexOf(marker)
  if (markerIndex !== -1) {
    add(normalized.slice(markerIndex + marker.length).split('/')[0])
  }

  try {
    let directory = dirname(realpathSync(extension.resolvedPath))
    for (;;) {
      const manifestPath = join(directory, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (typeof manifest.name === 'string') add(manifest.name.split('/').at(-1))
        break
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  } catch {}

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
    { path: TRACING_EXTENSION_PATH, name: 'pi-elune' },
    { path: BUNDLED_OUTPUT_BUDGET_EXTENSION, name: 'output-budget' },
    { path: BUNDLED_ULTRAFAST_EXTENSION, name: 'ultrafast', commands: [SERVICE_TIER_COMMAND, ULTRAFAST_COMMAND] },
    { path: BUNDLED_MEMORY_EXTENSION, name: 'memory', commands: ['memory'] },
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
          || specification.commands?.some(command => extension.commands?.has(command))
          || (specification.tool && extension.tools?.has(specification.tool))
      })
    }).sort((a, b) => {
      return Number(a.resolvedPath === BUNDLED_ULTRAFAST_EXTENSION)
        - Number(b.resolvedPath === BUNDLED_ULTRAFAST_EXTENSION)
    }),
  }
}

function isolateRuntimeExtensions(result) {
  return {
    ...result,
    extensions: result.extensions.filter((extension) => {
      return extension.resolvedPath === BUNDLED_OUTPUT_BUDGET_EXTENSION
        || extension.resolvedPath === TRACING_EXTENSION_PATH
    }),
  }
}

function childSessionMarker(manager) {
  return [...manager.getEntries()].reverse().find((entry) => {
    return entry.type === 'custom'
      && entry.customType === SUBAGENT_SESSION_CUSTOM_TYPE
  })?.data
}

async function createRuntimeResult(...args) {
  const options = args[0]
  requireSessionAvailable({ id: options.sessionManager.getSessionId(), cwd: options.cwd })
  runtimeInitializations.add(options)
  idleRuntimeCleanup.start()
  try {
    return await withProviderSettingsLock(async (signal) => {
      const result = await buildRuntimeResult(...args)
      if (signal.aborted || runtimeShuttingDown) {
        await disposeRuntime(new AgentSessionRuntime(result.session, result.services, createRuntime))
        throw new Error('Runtime is shutting down')
      }
      providerSessions.add(result.session)
      return result
    })
  } finally {
    runtimeInitializations.delete(options)
  }
}

async function buildRuntimeResult(
  { cwd, agentDir, sessionManager, sessionStartEvent, reloadServices },
  { model, thinkingLevel, captureTracing = true } = {},
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
  const requestEvents = reloadServices?.requestEvents || createEventBus()
  const requestContext = new AsyncLocalStorage()
  const tracingBinding = captureTracing
    ? reloadServices?.tracingBinding || tracing.createBinding()
    : undefined
  const captureCheckpoint = tracingBinding?.checkpoint()
  let services
  let previousExtensions
  let runtime
  try {
    services = reloadServices ? {
      ...reloadServices,
      modelRuntime: await ModelRuntime.create({
        authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'),
      }),
      diagnostics: [],
    } : await createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: {
        eventBus: requestEvents,
        extensionFactories: [
          ...(tracingBinding ? [{ name: 'leyline-elune', factory: tracingBinding.factory }] : []),
          ...(systemPrompt ? [] : [
            {
              name: 'tool-search',
              factory: (pi) => {
                createToolSearchExtension()(pi)
                pi.on('session_start', () => {
                  if (pi.getSettings().defaultTools?.includes('-tool_search')) return
                  pi.setActiveTools([...pi.getActiveTools(), 'tool_search'])
                })
                // OD-2/AGT-3: on win32 offer powershell alongside bash by
                // default. Only where no explicit tool selection is in force:
                // Leyline passed no `tools` allowlist for this session, pi
                // did not exclude it, and settings hold no '-powershell' and
                // no plain defaultTools entries (plain entries replace the
                // default selection in pi; an empty list selects none).
                pi.on('session_start', () => {
                  if (process.platform !== 'win32') return
                  if (tools !== undefined || excludeTools.includes('powershell')) return
                  const defaultTools = pi.getSettings().defaultTools
                  if (defaultTools?.includes('-powershell')) return
                  if (Array.isArray(defaultTools)
                    && !defaultTools.includes('+powershell')
                    && (defaultTools.length === 0
                      || defaultTools.some((entry) => typeof entry === 'string'
                        && !entry.startsWith('+') && !entry.startsWith('-')))) return
                  const activeTools = pi.getActiveTools()
                  if (activeTools.includes('powershell')) return
                  pi.setActiveTools([...activeTools, 'powershell'])
                })
              },
              builtin: true,
              replaceable: true,
            },
            { name: 'mcp', factory: createMcpExtension(), builtin: true, replaceable: true },
          ]),
        ],
        additionalExtensionPaths: systemPrompt ? [BUNDLED_OUTPUT_BUDGET_EXTENSION] : [
          BUNDLED_OUTPUT_BUDGET_EXTENSION,
          BUNDLED_ULTRAFAST_EXTENSION,
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
              noExtensions: true,
              noContextFiles: true,
              noSkills: true,
              systemPromptOverride: () => systemPrompt,
              appendSystemPromptOverride: () => [],
            }
          : { appendSystemPromptOverride: appendLeylineSystemPrompt }),
      },
    })
    services.requestEvents = requestEvents
    services.getProviderRequest = () => requestContext.getStore()
    services.tracingBinding = tracingBinding
    previousExtensions = reloadServices && services.resourceLoader.getExtensions()
    if (reloadServices) {
      await services.resourceLoader.reload()
      const registrations = services.resourceLoader.getExtensions().runtime
      for (const [key, register] of [
        ['pendingProviderRegistrations', ({ name, config }) => services.modelRuntime.registerProvider(name, config)],
        ['pendingNativeProviderRegistrations', ({ provider }) => services.modelRuntime.registerNativeProvider(provider)],
        ['pendingVirtualModelRegistrations', ({ definition }) => services.modelRuntime.registerVirtualModel(definition)],
      ]) {
        for (const registration of registrations[key]) {
          try { register(registration) } catch { services.diagnostics.push({ type: 'error', message: 'A provider extension could not be registered.' }) }
        }
      }
    }
    services.modelRuntime = wrapModelRuntime(services.modelRuntime)
    await refreshCustomProviders(services.modelRuntime)
    if (!systemPrompt) {
      const extensions = services.resourceLoader.getExtensions()
      extensions.extensions = preferBundledExtensions(extensions).extensions
    }
    if (child?.allowImages) {
      services.settingsManager.applyOverrides({ images: { blockImages: false } })
    }
    const restored = idleSessions.get(sessionManager.getSessionId())
    let selectedModel = resolveSubagentModel(services.modelRuntime, model || restored?.model)
    if (modelRequested(model) && !selectedModel) {
      throw new Error(`Unknown subagent model: ${formatSubagentModel(model)}`)
    }
    if (selectedModel && !services.modelRuntime.hasConfiguredAuth(selectedModel.provider)) {
      if (modelRequested(model)) throw new Error(`No API key for ${selectedModel.provider}/${selectedModel.id}`)
      selectedModel = undefined
    }
    runtime = {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model: selectedModel,
        thinkingLevel: thinkingLevel ?? restored?.thinkingLevel,
        tools,
        excludeTools,
      })),
      services,
      diagnostics: services.diagnostics,
    }
    tracingBinding?.bindSession(runtime.session)
    forceOneAtATime(runtime.session)
    installVisionDelegationContext(runtime.session, systemPrompt ? undefined : (images, signal, requestModel) => {
      return prepareVisionDelegation(runtime.session, images, signal, requestModel)
    })
    const streamFunction = runtime.session.agent.streamFunction
    runtime.session.agent.streamFunction = (requestModel, context, options) => {
      const requestOptions = { ...options }
      if (options?.signal && options.signal === runtime.session.agent.signal
        && options.sessionId === runtime.session.sessionManager.getSessionId()) {
        requestEvents.emit('leyline:provider-request', {
          model: requestModel,
          options: requestOptions,
          ctx: runtime.session.extensionRunner.createContext(),
        })
        tracing.observe(runtime.session, { type: 'provider_request', model: requestModel })
      }
      return requestContext.run(requestOptions, () => streamFunction(requestModel, context, requestOptions))
    }
    requestEvents.emit('leyline:request-boundary-ready', services.getProviderRequest)
    return runtime
  } catch (error) {
    try {
      if (services && (runtime || services.resourceLoader.getExtensions() !== previousExtensions)) {
        const session = runtime?.session || await createResourceSession(services)
        await disposeRuntime(new AgentSessionRuntime(session, services, createRuntime))
      }
    } finally {
      await tracingBinding?.dispose(captureCheckpoint)
    }
    throw error
  }
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
  for (const { info } of idleSessions.values()) {
    if (!projects.has(info.cwd)) projects.set(info.cwd, {
      cwd: info.cwd,
      name: basename(info.cwd) || info.cwd,
      modified: Number(info.modified),
    })
  }
  return [...projects.values()].sort((a, b) => {
    return b.modified - a.modified || a.name.localeCompare(b.name)
  })
}

async function listSessions() {
  const sessions = await listPersistedSessions()
  const loaded = new Map([...idleSessions].map(([id, state]) => [id, state.info]))
  for (const handle of runtimeHandles.values()) loaded.set(handle.sessionId, sessionInfo(handle))
  const missing = [...loaded.values()].filter(session => !sessions.some(item => item.id === session.id))
  return [...missing, ...sessions]
}

async function findSession(id) {
  const handle = runtimeHandles.get(id)
  if (handle) return sessionInfo(handle)
  return idleSessions.get(id)?.info || findPersistedSessionRecord(id)
}

async function resolveSession(id, path, cwd) {
  const handle = runtimeHandles.get(id)
  if (handle) return sessionInfo(handle)
  if (path) return { id, path, cwd: cwd || '' }
  return findSession(id)
}

const switchActiveSession = trackRuntimeCreation(async (session) => {
  const handle = await ensureRuntimeForSession(session)
  setActiveHandle(handle)
  return activeSessionDto(handle)
})

const runtimeHandleForId = trackRuntimeCreation(async (id) => {
  const existing = runtimeHandles.get(id)
  if (existing && !existing.disposalPromise && !runtimeHandlePromises.has(id)) {
    idleRuntimeCleanup.touch(existing)
    return existing
  }
  const session = await findSession(id)
  if (!session) return null
  return ensureRuntimeForSession(session)
})

function requireActiveHandle() {
  if (!activeHandle) throw new Error('No active session')
  return activeHandle
}

function requireSessionAvailable(session) {
  if (trashingSessionIds.has(session.id) || trashingProjectCwds.has(session.cwd)) {
    throw new Error('Session deletion is in progress.')
  }
}

function requireInitializedSession(handle) {
  requireSessionAvailable({ id: handle.sessionId, cwd: handle.runtime.cwd })
  if (runtimeShuttingDown || handle.disposalPromise) throw new Error('Session is closed')
  if (handle.initializing || handle.bindingExtensions || handle.reloading) {
    throw new Error('Wait for session initialization to finish.')
  }
  idleRuntimeCleanup.touch(handle)
}

function requireSessionMutation(handle) {
  requireInitializedSession(handle)
  if (handle.changingBranch) throw new Error('Wait for the branch change to finish.')
  if (handle.settingModel) throw new Error('Wait for the model change to finish.')
  if (handle.settingServiceTier) throw new Error('Wait for the service tier change to finish.')
}

const ensureRuntimeForSession = trackRuntimeCreation(async (session) => {
  let pathManager
  if (!session.id) {
    const loaded = [...runtimeHandles.values()].find(handle => handle.runtime.session.sessionFile === session.path)
    const saved = [...idleSessions.values()].find(state => state.info.path === session.path)
    if (loaded) session = sessionInfo(loaded)
    else if (saved) session = saved.info
    else {
      pathManager = SessionManager.open(session.path)
      session = { ...session, id: pathManager.getSessionId(), cwd: pathManager.getCwd() }
    }
  }
  requireSessionAvailable(session)
  const key = session.id || session.path
  const pending = runtimeHandlePromises.get(key)
  if (pending) return pending
  const existing = runtimeHandles.get(session.id)
  if (existing?.disposalPromise) {
    await existing.disposalPromise.catch(() => {})
    return ensureRuntimeForSession(session)
  }
  if (existing) {
    idleRuntimeCleanup.touch(existing)
    return existing
  }

  const promise = (async () => {
    const saved = idleSessions.get(session.id)
    const manager = saved ? idleSessionManager(saved) : pathManager || SessionManager.open(session.path)
    const suspended = idleSessions.get(session.id)
    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: session.cwd,
      agentDir: getAgentDir(),
      sessionManager: manager,
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
    try {
      requireSessionAvailable({ id: sessionId, cwd: runtime.cwd })
      runtimeHandles.set(sessionId, handle)
      handle.activityState = suspended?.activityState
      forceOneAtATime(runtime.session)
      await bindRuntimeHandle(handle)
      const serviceTier = suspended?.serviceTier ?? (suspended?.ultrafast ? 'ultrafast' : 'standard')
      const model = runtime.session.model
      if (serviceTier !== 'standard' && model
        && model.provider === suspended.model?.provider
        && model.id === suspended.model?.id
        && runtime.session.extensionRunner.getCommand(SERVICE_TIER_COMMAND)
        && supportedServiceTiers(model, runtime.session.modelRuntime.isUsingSubscription(model.provider)).includes(serviceTier)) {
        await setSessionServiceTier(handle, serviceTier)
      }
      idleSessions.delete(sessionId)
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

  handle.sessionTitle?.cancel()
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
  editing = false,
) {
  requireSessionAvailable({ id: handle.sessionId, cwd: handle.runtime.cwd })
  if (runtimeShuttingDown || handle.disposalPromise) throw new Error('Session is closed')
  const promptText = typeof text === 'string' ? text : ''
  const promptImages = validateImages(images)
  const promptHandoffId = typeof handoffId === 'string'
    && handoffId.length <= 100
    ? handoffId
    : undefined
  if (!promptText.trim() && promptImages.length === 0) {
    throw new Error('text or image is required')
  }
  if (streamingBehavior && !['steer', 'followUp'].includes(streamingBehavior)) {
    throw new Error('invalid streaming behavior')
  }
  if (signal?.aborted) throw new Error('Prompt cancelled')
  const queue = ensurePromptQueue(handle)
  const retainPrompt = () => {
    if (editing) throw new Error('Prompt cancelled')
    if (!onAccepted) {
      queue.add({ text: promptText, images: promptImages, kind, handoffId: promptHandoffId })
    }
    if (handle.interruptPromise || handle.reloading || (handle.changingBranch && !editing)) {
      queue.hold()
    }
    return 'queued'
  }
  if (handle.reloading) return retainPrompt()
  requireInitializedSession(handle)
  const session = handle.runtime.session
  const controller = new AbortController()
  const abortPrompt = () => controller.abort()
  if (signal?.aborted) abortPrompt()
  else signal?.addEventListener?.('abort', abortPrompt, { once: true })
  handle.pendingPromptControllers ||= new Set()
  handle.pendingPromptControllers.add(controller)
  let release
  let titlePreparation

  try {
    if (controller.signal.aborted) throw new Error('Prompt cancelled')
    forceOneAtATime(session)
    const waitingForPrompt = () => {
      if (handle.interruptPromise || handle.reloading || (handle.changingBranch && !editing)) return true
      if (handle.bashPromise || session.isBashRunning || session.hasPendingBashMessages) return true
      if (isExtensionCommand(session, promptText)) return false
      if (handle.settingModel || handle.settingServiceTier
        || handle.compactionPromise || session.isCompacting) return true
      if (onAccepted) return false
      const pending = queue.snapshot()
      return pending.held || (streamingBehavior !== 'steer'
        && (streamingBehavior === 'followUp' || !session.isIdle || pending.items.length))
    }
    if (waitingForPrompt()) return retainPrompt()
    await initializeSessionKind(handle, kind)
    if (controller.signal.aborted) throw new Error('Prompt cancelled')
    if (waitingForPrompt()) return retainPrompt()

    release = await lockPromptSubmission(handle)
    if (controller.signal.aborted) throw new Error('Prompt cancelled')
    if (waitingForPrompt()) return retainPrompt()
    requireInitializedSession(handle)
    if (handle.runtime.session !== session) throw new Error('Session changed before sending')
    if (!isExtensionCommand(session, promptText)) {
      titlePreparation = handle.sessionTitle?.prepare(promptText, promptImages)
      if (titlePreparation) controller.signal.addEventListener('abort', titlePreparation.discard, { once: true })
    }

    const model = session.state?.model || session.model
    const modelSupportsImages = Boolean(model?.input?.includes('image'))
    const shouldDelegate = promptImages.length
      && !modelSupportsImages
      && !isExtensionCommand(session, promptText)
    const delegation = shouldDelegate
      ? await prepareVisionDelegation(
        session,
        promptImages,
        controller.signal,
      )
      : null
    if (controller.signal.aborted) throw new Error('Prompt cancelled')
    if (waitingForPrompt()) return retainPrompt()
    requireInitializedSession(handle)
    if (handle.runtime.session !== session) throw new Error('Session changed before sending')

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
        titlePreparation,
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
        titlePreparation,
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
    if (titlePreparation) {
      controller.signal.removeEventListener('abort', titlePreparation.discard)
      titlePreparation.discard()
    }
    signal?.removeEventListener?.('abort', abortPrompt)
    handle.pendingPromptControllers.delete(controller)
    release?.()
    handle.promptQueue?.schedule()
  }
}

function ensurePromptQueue(handle) {
  handle.promptQueue ||= createPromptQueue({
    isIdle: () => handle.runtime.session.isIdle
      && !handle.bashPromise
      && !handle.runtime.session.isBashRunning
      && !handle.runtime.session.hasPendingBashMessages
      && !handle.pendingPromptControllers?.size
      && !handle.bindingExtensions
      && !handle.reloading
      && !handle.interruptPromise
      && !handle.initializing
      && !handle.settingModel
      && !handle.settingServiceTier
      && !handle.compactionPromise
      && !handle.changingBranch
      && !handle.disposalPromise
      && !runtimeShuttingDown,
    submit: (item, streamingBehavior, signal, onAccepted) => item.shell
      ? executeQueuedBash(handle, item, signal, onAccepted)
      : promptSession(
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
  if (request.action === 'resume' && (handle.interruptPromise || handle.changingBranch)) {
    throw new Error('Wait for the current operation to finish before resuming.')
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
  titlePreparation,
) {
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
            titlePreparation?.start()
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

async function prepareVisionDelegation(session, images, signal, model = session.state?.model || session.model) {
  if (signal?.aborted) throw new Error('Prompt cancelled')
  const cwd = session.sessionManager.getCwd()
  const sessionPath = session.sessionManager.getSessionFile() || null
  const resolved = resolveVisionConfig({ cwd, sessionPath })
  if (!resolved.model) {
    throw new Error(
      `${formatModelLabel(model)} does not support images and no vision model is configured. Set a default vision model in Leyline Settings → Vision.`,
    )
  }

  const modelRuntime = session.modelRuntime
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
  return join(leylineDataDir(), 'attachments')
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

async function bashSession(handle, command, excludeFromContext = false, signal) {
  requireSessionAvailable({ id: handle.sessionId, cwd: handle.runtime.cwd })
  if (runtimeShuttingDown || handle.disposalPromise) throw new Error('Session is closed')
  const bashCommand = typeof command === 'string' ? command.trim() : ''
  if (!bashCommand) throw new Error('shell command is required')
  if (signal?.aborted) throw new Error('Shell command cancelled')
  const queue = ensurePromptQueue(handle)
  queue.add({
    text: `${excludeFromContext === true ? '!!' : '!'}${bashCommand}`,
    images: [],
    shell: { command: bashCommand, excludeFromContext: excludeFromContext === true },
  })
  if (handle.interruptPromise || handle.reloading || handle.changingBranch) queue.hold()
  return 'queued'
}

async function executeQueuedBash(handle, item, signal, onAccepted) {
  requireInitializedSession(handle)
  const session = handle.runtime.session
  const { command, excludeFromContext } = item.shell
  const controller = new AbortController()
  const abortBash = () => {
    controller.abort()
    session.abortBash()
  }
  if (signal.aborted) abortBash()
  else signal.addEventListener('abort', abortBash, { once: true })
  handle.bashController = controller
  let execution
  const publish = (type) => {
    const event = { type, ...execution }
    trackRuntimeActivity(handle, event)
    events.broadcastEvent('runtime_event', {
      activeSessionId: handle.sessionId,
      event,
    })
    events.broadcastActiveSession(handle)
  }
  handle.bashPromise = Promise.resolve().then(async () => {
    try {
      if (controller.signal.aborted) throw new Error('Shell command cancelled')
      const eventResult = await waitForSettings(session.extensionRunner.emitUserBash({
        type: 'user_bash', command, excludeFromContext,
        cwd: session.sessionManager.getCwd(),
      }), controller.signal)
      if (controller.signal.aborted) throw new Error('Shell command cancelled')
      requireInitializedSession(handle)
      if (handle.changingBranch || handle.interruptPromise || handle.runtime.session !== session) {
        throw new Error('Session changed before running the shell command')
      }
      const previousIds = new Set(session.sessionManager.getBranch().map((entry) => entry.id))
      execution = {
        id: randomUUID(), command, excludeFromContext,
        anchorId: session.sessionManager.getLeafId() || '',
        startedAt: Date.now(), status: 'running', output: '', entryId: '', revision: 0,
      }
      handle.bashExecution = execution
      onAccepted()
      publish('bash_execution_start')
      let result
      if (eventResult?.result) {
        result = eventResult.result
        session.recordBashResult(command, result, { excludeFromContext })
      } else {
        result = await session.executeBash(command, (delta) => {
          execution.output = (execution.output + delta).slice(-65536)
          execution.revision += 1
        }, { id: execution.id, excludeFromContext, operations: eventResult?.operations })
      }
      Object.assign(execution, result, {
        revision: execution.revision + 1,
        status: result.cancelled ? 'aborted' : typeof result.exitCode === 'number' && result.exitCode !== 0 ? 'error' : 'completed',
      })
      if (session.hasPendingBashMessages) {
        publish('bash_execution_end')
        await session.waitForIdle()
      }
      const entry = session.sessionManager.getBranch().findLast((entry) => {
        const message = entry.message
        return !previousIds.has(entry.id) && message?.role === 'bashExecution'
          && message.command === command && (message.excludeFromContext === true) === excludeFromContext
          && message.output === result.output && message.exitCode === result.exitCode
          && message.cancelled === result.cancelled && message.truncated === result.truncated
          && message.fullOutputPath === result.fullOutputPath
      })
      execution.entryId = entry?.id || ''
      execution.revision += 1
      if (result.cancelled || execution.status === 'error') handle.promptQueue.hold()
      publish('bash_execution_end')
    } catch (error) {
      if (execution) {
        execution.revision += 1
        execution.status = controller.signal.aborted ? 'aborted' : 'error'
        execution.error = error.message || String(error)
        handle.promptQueue.hold()
        publish('bash_execution_end')
      }
      throw error
    }
  })
  events.broadcastActiveSession(handle)
  try {
    await handle.bashPromise
  } finally {
    signal.removeEventListener('abort', abortBash)
    handle.bashController = undefined
    handle.bashPromise = undefined
    events.broadcastActiveSession(handle)
    handle.promptQueue?.schedule()
  }
}

async function compactSession(handle, customInstructions) {
  requireInitializedSession(handle)
  const session = handle.runtime.session
  if (handle.changingBranch) throw new Error('Wait for the branch change to finish.')
  if (handle.interruptPromise) throw new Error('Wait for the current run to stop.')
  if (session.isCompacting || handle.compactionPromise) {
    throw new Error('Compaction is already running.')
  }

  const entries = session.sessionManager.getEntries()
  const messageCount = entries.filter((entry) => entry.type === 'message').length
  if (messageCount < 2) throw new Error('Nothing to compact (no messages yet)')

  const instructions = typeof customInstructions === 'string'
    ? customInstructions.trim()
    : ''
  const controller = new AbortController()
  handle.compactionController = controller
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'compaction_start' && controller.signal.aborted) {
      session.abortCompaction()
    }
  })
  handle.compactionPromise = (async () => {
    const release = await lockPromptSubmission(handle)
    let operation
    try {
      requireInitializedSession(handle)
      if (controller.signal.aborted) throw new Error('Compaction cancelled')
      if (handle.runtime.session !== session) throw new Error('Session changed before compacting')
      if (session.isCompacting) throw new Error('Compaction is already running.')
      operation = session.compact(instructions || undefined)
    } finally {
      release()
    }
    await operation
  })()
  try {
    await handle.compactionPromise
  } finally {
    unsubscribe()
    handle.compactionController = undefined
    handle.compactionPromise = undefined
    handle.promptQueue?.schedule()
  }
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
  const session = handle.runtime.session
  handle.interruptPromise = Promise.resolve().then(async () => {
    await session.abort()
    await handle.promptSubmissionLock
    await handle.compactionPromise?.catch(() => {})
    if (handle.bashPromise) {
      await waitForSettings(handle.bashPromise.catch(() => {}), AbortSignal.timeout(3000))
    }
    await session.abort()
    await session.waitForIdle()
  })
  try {
    handle.subagentController?.abort()
    handle.compactionController?.abort()
    handle.bashController?.abort()
    session.abortBash()
    cleanupExtensionConfirmations(handle, { invalidate: false })
    for (const controller of handle.pendingPromptControllers || []) {
      controller.abort()
    }
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
  if (handle.settingModel) throw new Error('Finish the model change before editing.')
  if (handle.settingServiceTier) throw new Error('Finish the service tier change before editing.')
  if (handle.changingBranch) throw new Error('Wait for the branch change to finish.')
  const entry = session.sessionManager.getEntry(entryId)
  if (entry?.type !== 'message' || entry.message?.role !== 'user') {
    throw new Error('Only user messages can be edited')
  }
  const promptImages = validateImages(images)
  if ((typeof text !== 'string' || !text.trim()) && !promptImages.length) {
    throw new Error('text or image is required')
  }
  if (signal?.aborted) throw new Error('Prompt cancelled')

  const serviceTier = serviceTierFromStatuses(handle.extensionUiState?.statuses)
  const serviceTierModel = serviceTier !== 'standard' ? session.model : null
  async function rebindSession() {
    await bindRuntimeHandle(handle)
    if (serviceTierModel
      && handle.runtime.session === session
      && session.model?.provider === serviceTierModel.provider
      && session.model?.id === serviceTierModel.id) {
      await setSessionServiceTier(handle, serviceTier, undefined, true)
    }
  }

  handle.sessionTitle?.cancel()
  handle.changingBranch = true
  try {
    await interruptSession(handle)
    requireInitializedSession(handle)
    if (signal?.aborted) throw new Error('Prompt cancelled')
    if (handle.runtime.session !== session) throw new Error('Session changed before editing')
    const oldLeafId = session.sessionManager.getLeafId()
    if (oldLeafId === entryId) moveSessionLeaf(session, entry.parentId || null)
    else {
      const result = await session.navigateTree(entryId)
      if (result.cancelled) throw new Error('Edit cancelled')
    }
    try {
      await rebindSession()
      await promptSession(
        handle,
        text,
        promptImages,
        undefined,
        signal,
        undefined,
        handoffId,
        () => {},
        true,
      )
    } catch (error) {
      moveSessionLeaf(session, oldLeafId)
      await rebindSession()
      throw error
    }
  } finally {
    handle.changingBranch = false
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
  if (handle.settingModel) throw new Error('Finish the model change before resetting.')
  if (handle.settingServiceTier) throw new Error('Finish the service tier change before resetting.')
  if (handle.changingBranch) throw new Error('Wait for the branch change to finish.')
  const manager = session.sessionManager
  const entry = manager.getEntry(entryId)
  if (!entry) throw new Error('Entry not found')

  const activeBranch = manager.getBranch()
  if (!activeBranch.some((item) => item.id === entryId)) {
    throw new Error('Entry is not on the active thread')
  }

  handle.sessionTitle?.cancel()
  handle.changingBranch = true
  try {
    await interruptSession(handle)
    requireInitializedSession(handle)
    if (handle.runtime.session !== session) throw new Error('Session changed before resetting')
    const header = manager.getHeader()
    manager.fileEntries = [header, ...manager.getBranch(entryId)]
    manager._buildIndex()
    manager._rewriteFile()
    restoreTrailingResearchReport(manager)
    updateSessionContext(session)
    await bindRuntimeHandle(handle)
    return activeSessionDto(handle)
  } finally {
    handle.changingBranch = false
    handle.promptQueue?.schedule()
  }
}

function updateSessionContext(session) {
  session.refreshContext()
}

const forkSession = trackRuntimeCreation(async (handle, entryId) => {
  requireInitializedSession(handle)
  const session = handle.runtime.session
  if (!entryId) throw new Error('entryId is required')
  if (!session.sessionManager.getEntry(entryId)) throw new Error('Entry not found')
  if (handle.changingBranch) throw new Error('Wait for the branch change to finish.')

  const result = await session.extensionRunner.emit({
    type: 'session_before_fork',
    entryId,
    position: 'at',
  })
  if (result?.cancel) throw new Error('Fork cancelled')
  if (runtimeShuttingDown || handle.disposalPromise) {
    throw new Error('Runtime is shutting down')
  }
  requireInitializedSession(handle)
  if (handle.changingBranch) throw new Error('Wait for the branch change to finish.')
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
  try {
    requireSessionAvailable({ id: fork.sessionId, cwd: runtime.cwd })
    runtimeHandles.set(fork.sessionId, fork)
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
  if (handle?.disposalPromise) {
    await handle.disposalPromise.catch(() => {})
    return renameSession(id, name)
  }
  if (handle) {
    requireInitializedSession(handle)
    if (handle.changingBranch) throw new Error('Wait for the branch change to finish.')
    handle.runtime.session.setSessionName(nextName)
    return toActiveSessionDetailDto(handle)
  }

  const session = await findSession(id)
  if (!session) throw new Error('Session not found')

  requireSessionAvailable(session)
  const suspended = idleSessions.get(id)
  const manager = suspended ? idleSessionManager(suspended) : SessionManager.open(session.path)
  if (manager.getSessionId() !== id) {
    throw new Error('Session path does not match session id')
  }
  manager.appendSessionInfo(nextName)
  if (suspended) {
    suspended.leafId = manager.getLeafId()
    suspended.lastEntryId = manager.getEntries().at(-1)?.id
    suspended.info = { ...session, name: manager.getSessionName(), modified: new Date() }
  }
  return toSessionDetailFromManager(manager, { ...session, name: manager.getSessionName() })
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
  requireSessionAvailable({ id })
  if (runtimeHandlePromises.has(id)
    || [...runtimeInitializations].some((options) => options.sessionManager.getSessionId() === id)) {
    throw new Error('Wait for session initialization to finish.')
  }
  const handle = runtimeHandles.get(id)
    || [...hiddenRuntimeHandles].find((item) => item.sessionId === id)
  if (handle?.disposalPromise) {
    await handle.disposalPromise.catch(() => {})
    return trashSession(id)
  }
  if (handle) requireSessionMutation(handle)
  trashingSessionIds.add(id)
  try {
    const session = handle ? sessionInfo(handle) : await findSession(id)
    if (!session) throw new Error('Session not found')
    if (trashingProjectCwds.has(session.cwd)) throw new Error('Session deletion is in progress.')
    if (handle) await discardRuntimeHandle(handle)
    const result = await moveSessionToTrash(session, trashStamp(), Boolean(handle) || idleSessions.has(id))
    idleSessions.delete(id)
    return result
  } finally {
    trashingSessionIds.delete(id)
  }
}

async function trashProject(cwd) {
  if (!cwd) throw new Error('Project cwd is required')
  requireSessionAvailable({ cwd })
  if ([...runtimeInitializations].some((options) => options.cwd === cwd)) {
    throw new Error('Wait for session initialization to finish.')
  }
  const handles = [...runtimeHandles.values(), ...hiddenRuntimeHandles]
    .filter((handle) => handle.runtime.cwd === cwd)
  if (handles.some(handle => handle.disposalPromise)) {
    await Promise.allSettled(handles.map(handle => handle.disposalPromise))
    return trashProject(cwd)
  }
  for (const handle of handles) requireSessionMutation(handle)
  trashingProjectCwds.add(cwd)
  try {
    const stopped = Promise.allSettled(handles.map(interruptSession))
    const persisted = await listSessionsForProject(cwd)
    const sessions = new Map(persisted.map((session) => [session.id, session]))
    for (const handle of handles) sessions.set(handle.sessionId, sessionInfo(handle))
    for (const { info } of idleSessions.values()) {
      if (info.cwd === cwd) sessions.set(info.id, info)
    }
    if ([...sessions.keys()].some((id) => trashingSessionIds.has(id))) {
      throw new Error('Session deletion is in progress.')
    }
    const interruptions = await stopped
    const failures = interruptions.filter((result) => result.status === 'rejected')
    if (failures.length) {
      throw new AggregateError(failures.map((result) => result.reason), 'Could not stop project sessions')
    }
    const results = await Promise.allSettled(handles.map(discardRuntimeHandle))
    const errors = results.filter((result) => result.status === 'rejected')
    if (errors.length) {
      throw new AggregateError(errors.map((result) => result.reason), 'Could not dispose project sessions')
    }
    const stamp = trashStamp()
    const moved = []
    for (const session of sessions.values()) {
      const result = await moveSessionToTrash(session, stamp, true)
      idleSessions.delete(session.id)
      if (result.path) moved.push(result.path)
    }
    return { count: moved.length, path: moved[0] || '' }
  } finally {
    trashingProjectCwds.delete(cwd)
  }
}

async function moveSessionToTrash(session, stamp, allowMissing) {
  let path = null
  let sessionPath = session.path
  if (session.path && existsSync(session.path)) {
    sessionPath = realpathSync(session.path)
    const trashPath = trashSessionPath(session, stamp)
    await mkdir(dirname(trashPath), { recursive: true })
    try {
      await rename(session.path, trashPath)
      path = trashPath
    } catch (error) {
      if (!allowMissing || error?.code !== 'ENOENT') throw error
    }
  } else if (!allowMissing) {
    throw new Error('Session file not found')
  }
  deleteSessionSubagentBatchOverride({ cwd: session.cwd, sessionPath })
  await removeVisionAttachments(session.id)
  return { path }
}

function disposeRuntime(runtime) {
  const session = runtime.session
  if (runtimeDisposals.has(session)) return runtimeDisposals.get(session)
  const disposal = (async () => {
    try {
      await session.abort()
    } finally {
      try {
        await runtime.dispose()
      } catch (error) {
        session.dispose()
        throw error
      } finally {
        tracing.closeSession(session)
        providerSessions.delete(session)
      }
    }
  })()
  runtimeDisposals.set(session, disposal)
  return disposal
}

function idleSessionManager(state) {
  const manager = state.manager || SessionManager.open(state.info.path)
  if (!state.manager && manager.getEntries().at(-1)?.id !== state.lastEntryId) {
    idleSessions.delete(state.info.id)
    return manager
  }
  if (state.leafId && manager.getEntry(state.leafId)) manager.branch(state.leafId)
  else if (state.leafId === null) manager.resetLeaf()
  return manager
}

async function suspendIdleRuntime(handle) {
  const session = handle.runtime.session
  const manager = session.sessionManager
  const info = sessionInfo(handle)
  const suspended = {
    info: {
      ...info,
      firstMessage: info.firstMessage.slice(0, 140),
      research: compactResearchState(info.research),
    },
    model: session.model && { provider: session.model.provider, id: session.model.id },
    thinkingLevel: session.thinkingLevel,
    serviceTier: serviceTierFromStatuses(handle.extensionUiState?.statuses),
    activityState: handle.activityState,
    leafId: manager.getLeafId(),
    lastEntryId: manager.getEntries().at(-1)?.id,
    manager: !session.sessionFile || !existsSync(session.sessionFile) ? manager : undefined,
  }
  idleSessions.set(handle.sessionId, suspended)
  try {
    await discardRuntimeHandle(handle)
  } finally {
    suspended.leafId = manager.getLeafId()
    suspended.lastEntryId = manager.getEntries().at(-1)?.id
  }
}

function discardRuntimeHandle(handle) {
  if (handle.disposalPromise) return handle.disposalPromise
  handle.sessionTitle?.cancel()
  handle.promptQueue?.dispose()
  cleanupExtensionConfirmations(handle)
  for (const controller of handle.pendingPromptControllers || []) {
    controller.abort()
  }
  settlePromptHandoff(handle, handle.pendingPromptHandoff)
  handle.unsubscribe?.()
  handle.disposalPromise = Promise.resolve().then(async () => {
    try {
      try {
        await interruptSession(handle)
      } finally {
        await disposeRuntime(handle.runtime)
      }
    } finally {
      hiddenRuntimeHandles.delete(handle)
      if (runtimeHandles.get(handle.sessionId) === handle) {
        removeRuntimeHandle(handle.sessionId)
      }
      if (activeHandle === handle) setActiveHandle(undefined)
    }
  })
  return handle.disposalPromise
}

function shutdownRuntime() {
  if (runtimeShutdownPromise) return runtimeShutdownPromise
  runtimeShuttingDown = true
  idleRuntimeCleanup.stop()
  runtimeShutdownPromise = waitForSettings(Promise.resolve().then(async () => {
    await Promise.all([closeSessionSummaryWorkers(), shutdownSettingsOperations()])
    await providerSettingsRuntimes.dispose()
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
  }), AbortSignal.timeout(RUNTIME_SHUTDOWN_TIMEOUT_MS)).finally(async () => {
    await tracing.close()
    idleSessions.clear()
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
  requireSessionMutation(handle)
  const runtime = handle.runtime
  const session = runtime.session
  const restoreTitle = handle.sessionTitle?.canRebind() === true
  handle.sessionTitle?.cancel()
  handle.reloading = true
  let replacement
  let applied = false
  try {
    await interruptSession(handle)
    if (runtimeShuttingDown || handle.disposalPromise) throw new Error('Session is closed')
    if (handle.runtime.session !== session) throw new Error('Session changed before reloading')
    const previousSessionFile = session.sessionFile
    const previousLeafId = session.sessionManager.getLeafId()
    const sessionManager = previousSessionFile && existsSync(previousSessionFile)
      ? SessionManager.open(previousSessionFile)
      : session.sessionManager
    if (previousLeafId) sessionManager.branch(previousLeafId)
    else sessionManager.resetLeaf()
    providerSettingsRuntimes.invalidate(handle.runtime.cwd)
    replacement = await createAgentSessionRuntime(createRuntime, {
      cwd: sessionManager.getCwd(),
      agentDir: handle.runtime.services.agentDir,
      sessionManager,
      reloadServices: handle.runtime.services,
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
    if (!runtimeShuttingDown && !handle.disposalPromise
      && runtimeHandles.get(handle.sessionId) === handle
      && (handle.runtime === runtime || handle.runtime === replacement)) {
      if (restoreTitle) bindSessionTitle(handle)
      events.broadcastActiveSession(handle)
    }
    handle.promptQueue?.schedule()
  }
})

async function setSessionServiceTier(handle, tier, signal, editing = false) {
  requireInitializedSession(handle)
  if (handle.changingBranch && !editing) throw new Error('Wait for the branch change to finish.')
  if (!SERVICE_TIERS.includes(tier)) throw new Error('tier must be standard, fast, or ultrafast')
  if (handle.settingModel) throw new Error('Wait for the model change to finish.')
  if (handle.settingServiceTier) throw new Error('Wait for the service tier change to finish.')
  const session = handle.runtime.session
  if (!session.extensionRunner.getCommand(SERVICE_TIER_COMMAND)) {
    throw new Error('Service tier selection is not available in this runtime.')
  }
  const model = session.model
  if (tier !== 'standard' && (!model || !supportedServiceTiers(
    model,
    session.modelRuntime.isUsingSubscription(model.provider),
  ).includes(tier))) {
    throw new Error('The service tier is not available for this model and authentication method.')
  }
  if (signal?.aborted) return

  handle.settingServiceTier = true
  const release = session.isCompacting ? undefined : await lockPromptSubmission(handle)
  try {
    requireInitializedSession(handle)
    if (signal?.aborted || handle.runtime.session !== session) return
    await session.prompt(`/${SERVICE_TIER_COMMAND} ${tier}`, { source: 'api' })
  } finally {
    release?.()
    handle.settingServiceTier = false
    handle.promptQueue?.schedule()
  }
}

async function setSessionUltrafast(handle, enabled, signal, editing = false) {
  if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean')
  return setSessionServiceTier(handle, enabled ? 'ultrafast' : 'standard', signal, editing)
}

async function setSessionModel(handle, provider, id) {
  requireInitializedSession(handle)
  if (handle.changingBranch) throw new Error('Wait for the branch change to finish.')
  if (handle.settingModel) throw new Error('Wait for the model change to finish.')
  if (handle.settingServiceTier) throw new Error('Wait for the service tier change to finish.')
  if (!provider || !id) throw new Error('provider and id are required')

  const session = handle.runtime.session
  handle.settingModel = true
  const release = session.isCompacting ? undefined : await lockPromptSubmission(handle)
  try {
    requireInitializedSession(handle)
    if (handle.runtime.session !== session) throw new Error('Session changed before changing models')
    const model = session.modelRuntime.getModel(provider, id)
    if (!model) throw new Error('Model not found')
    await session.setModel(model, { persist: true })
    const branch = session.sessionManager.getBranch()
    const lastModelChange = branch.findLast((entry) => entry.type === 'model_change')
    const change = projectModelChanges(branch, {
      modelName: (provider, id) => session.modelRuntime.getModel(provider, id)?.name,
      includeUnchanged: true,
    }).at(-1)
    if (change && change.selectionId === lastModelChange?.id) {
      const unchanged = change.fromModel.provider === change.toModel.provider
        && change.fromModel.id === change.toModel.id
      broadcastEvent('runtime_event', {
        activeSessionId: handle.sessionId,
        event: {
          type: 'model_changed',
          entryId: change.id,
          entry: unchanged ? null : change,
        },
      })
    }
    broadcastActiveSession(handle)
  } finally {
    release?.()
    handle.settingModel = false
    handle.promptQueue?.schedule()
  }
}

function setSessionThinkingLevel(handle, level) {
  requireInitializedSession(handle)
  if (handle.changingBranch) throw new Error('Wait for the branch change to finish.')
  if (handle.settingModel) throw new Error('Wait for the model change to finish.')
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
  try {
    requireSessionAvailable({ id: handle.sessionId, cwd: runtime.cwd })
    runtimeHandles.set(handle.sessionId, handle)
    forceOneAtATime(runtime.session)
    await bindRuntimeHandle(handle)
    if (kind === 'session') bindSessionTitle(handle)
    setActiveHandle(handle)
    return activeSessionDto(handle)
  } catch (error) {
    await discardRuntimeHandle(handle)
    throw error
  }
})

function bindSessionTitle(handle) {
  const { runtime, sessionId } = handle
  const generator = createSessionTitleGenerator(runtime.session, () => !runtimeShuttingDown
    && runtimeHandles.get(sessionId) === handle && handle.runtime === runtime
    && !handle.disposalPromise && !handle.reloading && !handle.changingBranch, (generating) => {
    if (runtimeHandles.get(sessionId) !== handle || handle.runtime !== runtime) return
    handle.titleGenerating = generating
    events.broadcastActiveSession(handle)
  })
  if (generator.canRebind()) handle.sessionTitle = generator
  else generator.cancel()
}

function activeSessionDto(handle = activeHandle) {
  return runtimeSessionDto(handle)
}

function toActiveSessionDetailDto(handle = activeHandle, options) {
  return handleSessionDetailDto(handle, options)
}

const runtimeState = trackRuntimeCreation(async (cwd, { refresh = false } = {}) => {
  const targetCwd = cwd || activeRuntime?.cwd || process.cwd()
  if (!refresh && activeRuntime?.cwd === targetCwd) return activeSessionDto()

  const result = await createAgentSessionRuntime(
    options => createRuntimeResult(options, { captureTracing: false }),
    {
      cwd: targetCwd,
      agentDir: getAgentDir(),
      sessionManager: SessionManager.create(
        targetCwd,
        configuredSessionDir(targetCwd),
      ),
    },
  )

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
  idleRuntimeCleanup.touch(handle)
  ensurePromptQueue(handle)
  try {
    if (handle.bashExecution?.status !== 'running') handle.bashExecution = undefined
    await bindRuntimeHandleExtensions(handle, events)
    handle.runtime.services.requestEvents?.emit('leyline:request-boundary-ready', handle.runtime.services.getProviderRequest)
    if (runtimeShuttingDown) throw new Error('Runtime is shutting down')
  } finally {
    handle.bindingExtensions = false
  }
}

function openEventStream(req, ws) {
  return events.openEventStream(req, ws)
}

function broadcastActiveSession(handle = activeHandle) {
  events.broadcastActiveSession(handle)
}

function refreshSessionTitleEligibility() {
  for (const handle of runtimeHandles.values()) {
    if (handle.sessionTitle) events.broadcastActiveSession(handle)
  }
}

function broadcastEvent(type, data) {
  events.broadcastEvent(type, data)
}

async function sessionDetail(id, path, options) {
  const handle = runtimeHandles.get(id)
  if (handle) return toActiveSessionDetailDto(handle, options)
  const suspended = idleSessions.get(id)
    || (path && [...idleSessions.values()].find(state => state.info.path === path))
  if (suspended) {
    const manager = idleSessionManager(suspended)
    const info = idleSessions.has(suspended.info.id) ? suspended.info : {
      id: manager.getSessionId(), path: manager.getSessionFile(), cwd: manager.getCwd(),
    }
    return toSessionDetailFromManager(manager, info, undefined, undefined, options)
  }
  if (path) return toSessionDetailFromPath(id, path, options)

  const session = await findSession(id)
  if (!session) return null
  return toSessionDetailDto(session, options)
}

async function exportSessionDetail(id) {
  const detail = await sessionDetail(id)
  if (!detail) throw new Error('Session not found')
  return detail
}

function parentTracingContext(parentSessionId, parentSessionPath, toolCallId) {
  const handles = [...runtimeHandles.values(), ...hiddenRuntimeHandles]
  const parent = handles.find(handle => {
    if (parentSessionId && handle.sessionId !== parentSessionId) return false
    return parentSessionPath
      ? handle.runtime.session.sessionFile === parentSessionPath
      : Boolean(parentSessionId)
  })
  if (!parent) return undefined
  const callId = typeof toolCallId === 'string' && toolCallId.length <= 512 ? toolCallId : undefined
  return tracing.parentContext(parent.runtime.session, callId) || {
    sessionId: parent.sessionId,
    sessionFile: parent.runtime.session.sessionFile,
    toolCallId: callId || null,
  }
}

const runSubagent = trackRuntimeCreation(async ({ title, task, cwd, parentSessionPath, parentSessionId, _toolCallId, model, thinkingLevel, tools, excludeTools, systemPrompt, isolatedSystemPrompt, images, allowImages = false, signal, onStart }) => {
  const sessionTitle = normalizeSessionName(title)
  if (!sessionTitle) throw new Error('A nonblank subagent title is required')
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
  sessionManager.appendSessionInfo(sessionTitle)
  sessionManager.appendCustomEntry(SUBAGENT_SESSION_CUSTOM_TYPE, {
    sessionId: childId,
    parentSessionPath: parentSessionPath || null,
    tracingParent: parentTracingContext(parentSessionId, parentSessionPath, _toolCallId),
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
    requireSessionAvailable({ id: childId, cwd })
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
    let responseProvider
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
        if (msg.provider) responseProvider = msg.provider
        if (msg.stopReason) stopReason = msg.stopReason
        if (msg.errorMessage) messages.push({ role: 'error', content: msg.errorMessage })
      } else if (msg.role === 'toolResult' || msg.role === 'tool') {
        if (text) messages.push({ role: msg.role, content: text })
      }
    }

    const effectiveThinkingLevel = session.thinkingLevel
    const sessionModel = session.model
    const modelName = sessionModel && sessionModel.id === responseModel
      && (!responseProvider || sessionModel.provider === responseProvider)
      ? sessionModel.name
      : undefined

    const result = {
      childSession: { path: childPath, id: childId, cwd },
      messages,
      usage,
      model: responseModel,
      modelProvider: responseProvider,
      modelName,
      thinkingLevel: effectiveThinkingLevel,
      stopReason,
    }
    return result
  } catch (error) {
    if (signal?.aborted) {
      throw Object.assign(new Error('Subagent cancelled'), { name: 'AbortError' })
    }
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

async function runVision({ question, cwd, parentSessionPath, parentSessionId, _toolCallId, model, thinking, image, signal }) {
  if (!image) throw new Error('image is required')
  return runSubagent({
    title: 'Image inspection',
    task: question || 'Describe this image in detail.',
    cwd,
    parentSessionPath,
    parentSessionId,
    _toolCallId,
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
  tracing,
  activeRuntimeCwd: () => activeRuntime?.cwd,
  activeSessionDto,
  assertProviderRoutes,
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
  refreshSessionTitleEligibility,
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
  settingsRuntime,
  setMemoryStatus,
  setSubagentBatchSize,
  setSubagentModelOverride,
  deleteSubagentModelOverride,
  setVisionOverride,
  clearVisionOverride,
  setSessionMode,
  setSessionModel,
  setRolloutFeedback,
  setSessionThinkingLevel,
  setSessionServiceTier,
  setSessionUltrafast,
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
