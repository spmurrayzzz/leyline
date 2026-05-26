import { goalStateFromSession, isGoalStateEvent } from './goal-state.js'

export function emptyExtensionUiState() {
  return {
    statuses: {},
    widgets: {},
    notifications: [],
  }
}

export async function bindRuntimeHandle(handle, events) {
  handle.unsubscribe?.()
  handle.extensionUiState = emptyExtensionUiState()
  await handle.runtime.session.bindExtensions({
    uiContext: createExtensionUiContext(handle, events),
    onError: (error) => {
      events.broadcastEvent('extension_error', {
        activeSessionId: handle.sessionId,
        error,
      })
    },
  })
  syncGoalStateFromSession(handle)
  handle.unsubscribe = handle.runtime.session.subscribe((event) => {
    syncGoalStateFromSession(handle)
    events.broadcastEvent('runtime_event', {
      activeSessionId: handle.sessionId,
      event,
    })
    if (event.type === 'queue_update' || isGoalStateEvent(event)) {
      events.broadcastActiveSession(handle)
    }
  })
  events.broadcastActiveSession(handle)
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
