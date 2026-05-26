import { basename } from 'node:path'
import { projectTranscriptEntries } from '../../lib/transcript-projection.js'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { emptyExtensionUiState } from './extension-ui.js'
import { goalStateFromEntries, goalStateFromSession } from './goal-state.js'
import { messageText, sessionModifiedDate } from './sessions.js'

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
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']

export function runtimeSessionDto(handle) {
  return {
    id: handle.sessionId,
    path: handle.runtime.session.sessionFile,
    cwd: handle.runtime.cwd,
    diagnostics: handle.runtime.diagnostics,
    state: activeSessionStateDto(handle),
  }
}

export function activeSessionStateDto(handle) {
  return sessionStateDto(
    handle.runtime.session,
    handle.runtime.services,
    handle.extensionUiState,
  )
}

export function sessionStateDto(
  session,
  services,
  extensionUiState = emptyExtensionUiState(),
) {
  const activeToolNames = session.getActiveToolNames()

  return {
    model: modelDto(session.model),
    availableModels: services.modelRegistry.getAvailable().map(modelDto),
    thinkingLevel: session.thinkingLevel,
    availableThinkingLevels: session.getAvailableThinkingLevels(),
    isStreaming: session.isStreaming,
    isCompacting: session.isCompacting,
    pendingToolCalls: [...(session.agent?.state?.pendingToolCalls || [])],
    steeringMode: session.steeringMode,
    followUpMode: session.followUpMode,
    activeToolCount: activeToolNames.length,
    activeToolNames,
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

export function toSessionDetailDto(session) {
  return toSessionDetailFromManager(SessionManager.open(session.path), session)
}

export function toSessionDetailFromPath(id, path) {
  const manager = SessionManager.open(path)
  if (manager.getSessionId() !== id) {
    throw new Error('Session path does not match session id')
  }
  return toSessionDetailFromManager(manager, { id, path })
}

export function toActiveSessionDetailDto(handle) {
  return toSessionDetailFromManager(
    handle.runtime.session.sessionManager,
    sessionInfo(handle),
    handle.runtime.session.getContextUsage?.(),
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

export function sessionInfo(handle) {
  const manager = handle.runtime.session.sessionManager
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
    cwd: header.cwd || handle.runtime.cwd,
    name: undefined,
    firstMessage: firstMessage || goal?.objective || '(no messages)',
    created,
    modified: sessionModifiedDate(entries, header, created),
    messageCount,
  }
}

export function toSessionDto(session) {
  return {
    id: session.id,
    path: session.path,
    cwd: session.cwd,
    name: session.name,
    firstMessage: truncate(session.firstMessage || '', 140),
    timestamp: session.created || timestampFromPath(session.path),
  }
}

export function truncate(value, maxLength) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

function timestampFromPath(path) {
  const match = path?.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_/)
  if (!match) return undefined
  return match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z')
}

export function projectLabel(cwd) {
  if (!cwd) return 'Unknown project'
  return basename(cwd)
}
