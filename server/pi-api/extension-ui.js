import { goalStateFromSession, isGoalStateEvent } from './goal-state.js'
import { isResearchEntry } from '../../lib/research-state.js'

export function emptyExtensionUiState() {
  return {
    statuses: {},
    widgets: {},
    notifications: [],
  }
}

export async function bindRuntimeHandle(handle, events) {
  settlePromptHandoff(handle)
  handle.unsubscribe?.()
  handle.extensionUiState = emptyExtensionUiState()
  handle.pendingToolResults = new Map()
  await handle.runtime.session.bindExtensions({
    uiContext: createExtensionUiContext(handle, events),
    onError: (error) => {
      events.broadcastEvent('extension_error', {
        activeSessionId: handle.sessionId,
        error: { message: error?.message || String(error) },
      })
    },
  })
  syncGoalStateFromSession(handle)
  handle.unsubscribe = handle.runtime.session.subscribe((event) => {
    const handoffId = promptHandoffId(handle, event)
    trackPendingToolResult(handle, event)
    trackRuntimeActivity(handle, event)
    syncGoalStateFromSession(handle)
    events.broadcastEvent('runtime_event', {
      activeSessionId: handle.sessionId,
      event,
      handoffId,
    })
    if (event.type === 'message_end'
      && event.message?.role === 'user'
      && (!handle.sessionSummary || handle.sessionSummary.messageCount === 0)) {
      queueMicrotask(() => events.broadcastActiveSession(handle))
    }
    if (event.type === 'compaction_end') {
      queueMicrotask(() => events.broadcastActiveSession(handle))
    } else if (event.type === 'queue_update'
      || event.type === 'turn_end'
      || event.type === 'agent_settled'
      || event.type === 'session_info_changed'
      || isGoalStateEvent(event)
      || isResearchStateEvent(event)) {
      events.broadcastActiveSession(handle)
    }
  })
  events.broadcastActiveSession(handle)
}

function isResearchStateEvent(event) {
  return event?.type === 'entry_appended' && isResearchEntry(event.entry)
}

function promptHandoffId(handle, event) {
  if (event?.type === 'message_start' && event.message?.role === 'user') {
    const handoff = handle.pendingPromptHandoff
    handle.pendingPromptHandoff = undefined
    handle.activePromptHandoffId = handoff?.id
    handoff?.resolve()
    return handoff?.id
  }
  if (event?.type === 'message_end' && event.message?.role === 'user') {
    const id = handle.activePromptHandoffId
    handle.activePromptHandoffId = undefined
    return id
  }
  if (['agent_end', 'aborted'].includes(event?.type)) {
    settlePromptHandoff(handle)
  }
  return undefined
}

function settlePromptHandoff(handle) {
  const handoff = handle.pendingPromptHandoff
  handle.pendingPromptHandoff = undefined
  handle.activePromptHandoffId = undefined
  handoff?.resolve()
}

function trackPendingToolResult(handle, event) {
  const results = handle.pendingToolResults
  if (!results) return
  if (['agent_end', 'error', 'aborted'].includes(event.type)) {
    results.clear()
    return
  }

  const id = event.toolCallId || event.id || event.callId
  if (!id) return
  if (event.type === 'tool_execution_start' && event.toolName === 'subagent') {
    results.delete(id)
    return
  }
  if (event.type === 'tool_execution_update'
    && event.toolName === 'subagent'
    && event.partialResult !== undefined) {
    results.set(id, event.partialResult)
    return
  }
  if (event.type === 'tool_execution_end') results.delete(id)
}

function trackRuntimeActivity(handle, event) {
  if (!event?.type) return
  const previous = handle.activityState || {
    active: false,
    activityAt: 0,
    error: '',
    settledAt: 0,
    settledRevision: 0,
  }
  const next = { ...previous }
  const now = Date.now()

  if (!['message_update', 'tool_execution_update'].includes(event.type)) {
    next.activityAt = now
  }

  if (runtimeActivityStarted(event)) {
    next.active = true
    next.error = ''
  }

  const error = runtimeActivityError(event)
  if (error) next.error = error
  else if (event.type === 'aborted') next.error = ''

  if (event.type === 'agent_settled'
    || (event.type === 'compaction_end' && event.reason === 'manual')) {
    settleRuntimeActivity(next, previous, now)
  }

  handle.activityState = next
}

function runtimeActivityStarted(event) {
  return [
    'agent_start',
    'turn_start',
    'compaction_start',
    'auto_retry_start',
    'summarization_retry_scheduled',
    'summarization_retry_attempt_start',
  ].includes(event.type)
    || (event.type === 'agent_end' && event.willRetry)
    || (event.type === 'message_start' && event.message?.role !== 'custom')
    || ['tool_call', 'tool_execution_start'].includes(event.type)
}

function runtimeActivityError(event) {
  if (event.willRetry) return ''
  if (event.type === 'compaction_end' && event.errorMessage) {
    return String(event.errorMessage)
  }
  if (event.type === 'message_end'
    && event.message?.role === 'assistant'
    && event.message?.stopReason === 'error') {
    return event.message.errorMessage || 'Model request failed'
  }
  if (event.type !== 'error') return ''
  if (typeof event.error === 'string') return event.error
  return event.error?.message
    || event.message?.errorMessage
    || event.message?.message
    || (typeof event.message === 'string' ? event.message : '')
    || event.errorMessage
    || 'Runtime error'
}

function settleRuntimeActivity(next, previous, now) {
  next.active = false
  if (!previous.active) return
  next.settledAt = now
  next.settledRevision = (previous.settledRevision || 0) + 1
}

function createExtensionUiContext(handle, events) {
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
      handle.extensionUiState = {
        ...handle.extensionUiState,
        notifications: [
          ...handle.extensionUiState.notifications.slice(-19),
          notification,
        ],
      }
      broadcastExtensionUi(handle, events)
    },
    onTerminalInput: () => () => {},
    setStatus(key, text) {
      const statuses = { ...handle.extensionUiState.statuses }
      if (text === undefined) delete statuses[key]
      else statuses[key] = text
      handle.extensionUiState = { ...handle.extensionUiState, statuses }
      broadcastExtensionUi(handle, events)
    },
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget(key, content, options = {}) {
      const widgets = { ...handle.extensionUiState.widgets }
      if (content === undefined) delete widgets[key]
      else if (Array.isArray(content)) {
        widgets[key] = {
          lines: content.filter((line) => typeof line === 'string'),
          placement: options.placement || 'aboveEditor',
        }
      }
      handle.extensionUiState = { ...handle.extensionUiState, widgets }
      broadcastExtensionUi(handle, events)
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

function broadcastExtensionUi(handle, events) {
  if (!handle) return
  events.broadcastEvent('extension_ui', {
    activeSessionId: handle.sessionId,
    state: handle.extensionUiState,
    goal: goalStateFromSession(handle.runtime.session),
  })
  events.broadcastActiveSession(handle)
}

function syncGoalStateFromSession(handle) {
  if (!handle) return
  const goal = goalStateFromSession(handle.runtime.session)
  if (!goal) return
  const status = goal.status === 'budget_limited'
    ? 'limited by budget'
    : goal.status === 'continuation_limited'
      ? 'limited by continuations'
      : goal.status
  handle.extensionUiState = {
    ...handle.extensionUiState,
    statuses: {
      ...handle.extensionUiState.statuses,
      goal: `goal: ${status}`,
    },
  }
}
