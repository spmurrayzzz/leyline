import { basename } from 'node:path'
import { projectTranscriptEntries } from '../../lib/transcript-projection.js'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { emptyExtensionUiState } from './extension-ui.js'
import { goalStateFromEntries, goalStateFromSession } from './goal-state.js'
import { applyRolloutFeedback } from './rollout-feedback.js'
import {
  compactResearchState,
  researchStateFromEntries,
  researchStateFromSession,
} from '../../lib/research-state.js'
import {
  hasSubagentSessionMarker,
  messageText,
  sessionModifiedDate,
} from './sessions.js'

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
  'memory',
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
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

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
    handle.extensionUiState,
  )
}

export function sessionStateDto(
  session,
  extensionUiState = emptyExtensionUiState(),
) {
  const activeToolNames = session.getActiveToolNames()

  return {
    model: modelDto(session.model),
    availableModels: session.modelRuntime.getAvailableSnapshot().map(modelDto),
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
    research: researchStateFromSession(session),
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
    if (level === 'xhigh' || level === 'max') return mapped !== undefined
    return true
  })
}

export function toSessionDetailDto(session) {
  return toSessionDetailFromManager(SessionManager.open(session.path), session)
}

export function toSessionDetailFromPath(id, path) {
  const manager = SessionManager.open(path)
  if (id && manager.getSessionId() !== id) {
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
  const research = researchStateFromEntries(entries, manager.getSessionId())

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

  const contextTokens = contextUsage?.tokens
    ?? contextTokensFromEntries(entries)

  const info = {
    ...session,
    id: manager.getSessionId(),
    path: manager.getSessionFile(),
    cwd: header.cwd || session.cwd,
    name,
    parentSessionPath: session.parentSessionPath || header.parentSession,
    isSubagentSession: session.isSubagentSession === true
      || hasSubagentSessionMarker(entries, manager.getSessionId()),
    research,
    firstMessage: firstMessage || research?.objective || goal?.objective || '(no messages)',
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
      research,
      messageCount: info.messageCount,
      contextTokens,
      modified: info.modified,
      created: info.created,
      contextUsage,
    },
    entries: applyRolloutFeedback(
      projectTranscriptEntries(entries, { research }),
      info.cwd,
      info.path,
      info.id,
    ),
  }
}

export function compactSessionDetailDto(detail) {
  return {
    ...detail,
    entries: detail.entries.map((entry) => {
      if (entry.type !== 'tool') return entry
      const compact = { ...entry }
      delete compact.copyText
      if (compact.preview?.fallbackText && !compact.isError) {
        delete compact.text
      }
      return compact
    }),
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
  const research = researchStateFromEntries(entries, manager.getSessionId())

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
    name: manager.getSessionName?.(),
    parentSessionPath: header.parentSession,
    isSubagentSession: hasSubagentSessionMarker(entries, manager.getSessionId()),
    research,
    firstMessage: firstMessage || research?.objective || goal?.objective || '(no messages)',
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
    parentSessionPath: session.parentSessionPath,
    isSubagentSession: session.isSubagentSession === true,
    research: compactResearchState(session.research),
    firstMessage: truncate(session.firstMessage || '', 140),
    messageCount: session.messageCount ?? 0,
    modified: session.modified || session.created || timestampFromPath(session.path),
    timestamp: session.created || timestampFromPath(session.path),
  }
}

function contextTokensFromEntries(entries) {
  let latestCompaction = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === 'compaction') {
      latestCompaction = i
      break
    }
  }

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.type !== 'message') continue
    const message = entry.message
    if (message?.role !== 'assistant' || !message.usage) continue
    if (message.stopReason === 'aborted' || message.stopReason === 'error') continue
    const tokens = usageTokens(message.usage)
    if (tokens <= 0) continue
    if (latestCompaction !== -1 && i < latestCompaction) return null
    return tokens
  }
  return null
}

function usageTokens(usage) {
  if (typeof usage.totalTokens === 'number') return usage.totalTokens
  return (usage.input || 0) + (usage.output || 0)
    + (usage.cacheRead || 0) + (usage.cacheWrite || 0)
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
