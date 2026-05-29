import { computed, ref } from 'vue'
import { fuzzyScore, highlightedText as highlightFuzzyText } from '../lib/fuzzy'
import { formatMode, modelChip, projectName } from '../lib/format'
import {
  activatePiSession,
  createPiSession,
  deletePiSession,
  fetchPiRuntimeState,
  fetchSessionDetail,
  fetchSessions,
  forkPiSession,
  reloadPiSession,
  resetPiSession,
  switchPiModel,
  switchPiThinkingLevel,
} from '../lib/pi-api'

export function useSessionWorkspace({
  liveTurn,
  terminal,
  scrollToLatest,
  shouldFollowOutput,
  markNewOutput,
} = {}) {
  const sessions = ref([])
  const sessionsError = ref('')
  const sessionsLoading = ref(true)
  const creatingSessionCwd = ref('')
  const newSessionCwd = ref('')
  const startRuntimeState = ref(null)
  const startSelectedModel = ref(null)
  const startSelectedThinkingLevel = ref(null)
  const sessionQuery = ref('')
  const selectedSessionId = ref('')
  const sessionDetail = ref(null)
  const sessionLoading = ref(false)
  const sessionSwitching = ref(false)
  const sessionActivating = ref(false)
  const sessionError = ref('')
  const activeRuntimeSession = ref(null)
  const runtimeSessionsById = ref({})
  const startupRun = ref(null)
  const sessionHandoff = ref(null)
  const switchingModel = ref(false)
  const switchingThinking = ref(false)
  const reloadingSession = ref(false)
  const deletingSessionId = ref('')
  const deleteConfirmSession = ref(null)
  const deleteSessionError = ref('')
  const deleteSessionPhase = ref('')
  const forkingEntryId = ref('')
  const resettingEntryId = ref('')
  const initPhase = ref('sessions')
  const selectedSession = computed(() => {
    return sessionDetail.value?.session || sessions.value.find((s) => s.id === selectedSessionId.value)
  })
  const visibleProjects = computed(() => visibleProjectList())
  const initializing = computed(() => {
    return sessionsLoading.value && !selectedSession.value
  })
  const composerRuntime = computed(() => {
    return selectedSession.value
      ? activeRuntimeSession.value
      : startRuntimeState.value
  })
  const availableModels = computed(() => {
    return composerRuntime.value?.state?.availableModels || []
  })
  const selectedModelKey = computed(() => {
    const model = composerRuntime.value?.state?.model
    if (!model) return ''
    return modelKey(model)
  })
  const currentModelLabel = computed(() => {
    return modelChip(composerRuntime.value?.state?.model)
  })
  const availableThinkingLevels = computed(() => {
    return composerRuntime.value?.state?.availableThinkingLevels || []
  })
  const currentThinkingLabel = computed(() => {
    const level = composerRuntime.value?.state?.thinkingLevel
    return level ? `thinking · ${formatMode(level)}` : 'thinking'
  })
  const contextUsage = computed(() => {
    return selectedSession.value?.contextUsage
      || composerRuntime.value?.state?.contextUsage
      || null
  })
  const activeGoal = computed(() => {
    return activeRuntimeSession.value?.state?.goal || null
  })
  const sidebarRuntimeSummary = computed(() => {
    const states = Object.values(runtimeSessionsById.value)
    const running = states.filter((state) => state.isStreaming).length
    const compacting = states.filter((state) => state.isCompacting).length
    const unread = states.filter((state) => state.unread).length
    const parts = [
      running ? `${running} running` : '',
      compacting ? `${compacting} compacting` : '',
      unread ? `${unread} unread` : '',
    ].filter(Boolean)

    return { label: parts.join(' · ') }
  })
  let sessionSelectionToken = 0
  let sessionActivationQueue = Promise.resolve()
  let refreshTimer

  async function loadSessions({
    routeSessionId = '',
    selectFirst = false,
    showLoading = true,
  } = {}) {
    if (showLoading) sessionsLoading.value = true

    initPhase.value = 'events'
    sessionsError.value = ''

    try {
      const nextSessions = await fetchSessions()
      sessions.value = nextSessions
      if (!newSessionCwd.value && sessions.value[0]?.cwd) {
        newSessionCwd.value = sessions.value[0].cwd
        await loadStartRuntimeState(newSessionCwd.value)
      }
      const routedSession = routeSessionId
        ? sessions.value.find((session) => session.id === routeSessionId)
        : null

      if (routedSession) {
        await selectSession(routedSession, { replaceRoute: true })
      } else if (routeSessionId) sessionError.value = 'Session not found'
      else if (selectFirst && sessions.value[0]) {
        await selectSession(sessions.value[0])
      }
    } catch (error) {
      if (showLoading || sessions.value.length === 0) {
        sessionsError.value = error.message
      }
    } finally {
      if (showLoading) {
        initPhase.value = 'workspace'
        sessionsLoading.value = false
        initPhase.value = 'sessions'
      }
    }
  }

  async function loadStartRuntimeState(cwd) {
    const targetCwd = cwd?.trim()
    if (!targetCwd || selectedSession.value) return

    try {
      const state = await fetchPiRuntimeState(targetCwd)
      if (newSessionCwd.value !== targetCwd || selectedSession.value) return
      startRuntimeState.value = state
      startSelectedModel.value = null
      startSelectedThinkingLevel.value = null
    } catch (error) {
      if (!startRuntimeState.value) sessionError.value = error.message
    }
  }

  async function createSession(project) {
    if (selectedSession.value || startupRun.value) {
      await createSessionForCwd(project.cwd)
      return
    }

    beginStartupRun(project.cwd, { hasPrompt: false })

    try {
      await wait(420)
      await runStartupPhase('creating', () => createSessionForCwd(project.cwd))
    } finally {
      await wait(260)
      finishStartupRun()
    }
  }

  async function createSessionForCwd(cwd) {
    const targetCwd = cwd?.trim() || ''
    if (!targetCwd) return

    creatingSessionCwd.value = targetCwd
    sessionError.value = ''

    const handoff = selectedSession.value && !startupRun.value
      ? beginSessionHandoff(targetCwd)
      : null

    try {
      if (handoff) await waitSessionHandoffPhaseFloor(handoff)
      const data = handoff
        ? await runSessionHandoffPhase(handoff, 'creating', () => {
          return createPiSession(targetCwd)
        })
        : await createPiSession(targetCwd)

      if (handoff) setSessionHandoffPhase(handoff, 'loading')
      await loadSessions({ selectFirst: false, showLoading: false })
      setSelectedSessionData(data.detail, data.active)
      newSessionCwd.value = ''
      await scrollToLatest?.()
      if (handoff) await finishSessionHandoffFloor(handoff)
      await reconnectTerminalIfOpen()
    } catch (error) {
      sessionError.value = error.message
    } finally {
      creatingSessionCwd.value = ''
      if (handoff) finishSessionHandoff(handoff)
    }
  }

  async function selectSession(session, options = {}) {
    const token = ++sessionSelectionToken
    sessionSwitching.value = true
    const switchStarted = Date.now()
    selectedSessionId.value = session.id
    markRuntimeSessionRead(session.id)
    liveTurn?.selectSession?.(session.id)
    sessionLoading.value = true
    sessionActivating.value = false
    sessionError.value = ''

    try {
      const data = await fetchSessionDetail(session)
      if (!isCurrentSessionSelection(token, session.id)) return
      sessionDetail.value = data
      activeRuntimeSession.value = null
      liveTurn?.reset?.()
      updateSessionRoute(session.id, options)
      const elapsed = Date.now() - switchStarted
      if (elapsed < 150) await wait(150 - elapsed)
      sessionLoading.value = false
      sessionSwitching.value = false
      await scrollToLatest?.()

      sessionActivating.value = true
      await activateSelectedSession(token, session)
      if (!isCurrentSessionSelection(token, session.id)) return
      await reconnectTerminalIfOpen()
    } catch (error) {
      if (isCurrentSessionSelection(token, session.id)) {
        sessionError.value = error.message
      }
    } finally {
      if (!isCurrentSessionSelection(token, session.id)) return
      sessionLoading.value = false
      sessionSwitching.value = false
      sessionActivating.value = false
    }
  }

  function clearSelectedSession() {
    selectedSessionId.value = ''
    liveTurn?.clearSession?.()
    sessionDetail.value = null
    sessionError.value = ''
    sessionHandoff.value = null
    activeRuntimeSession.value = null
    finishStartupRun()
    liveTurn?.reset?.()
  }

  function navigateHome() {
    sessionSwitching.value = true
    const cwd = selectedSession.value?.cwd
      || newSessionCwd.value
      || sessions.value[0]?.cwd
      || ''

    clearSelectedSession()
    if (cwd) {
      newSessionCwd.value = cwd
      loadStartRuntimeState(cwd)
    }
    updateSessionRoute('')
    setTimeout(() => { sessionSwitching.value = false }, 150)
  }

  async function handleRouteChange() {
    const id = sessionIdFromRoute()
    if (!id) {
      clearSelectedSession()
      return
    }

    const session = sessions.value.find((item) => item.id === id)
    if (session) await selectSession(session, { replaceRoute: true })
    else await loadSessions({ routeSessionId: id })
  }

  async function handleNativeNewSession(event) {
    const cwd = event?.detail?.cwd?.trim() || selectedSession.value?.cwd || ''
    if (!cwd) return
    if (liveTurn?.agentRunning?.value || creatingSessionCwd.value) return

    await createSessionForCwd(cwd)
  }

  function sessionIdFromRoute() {
    const url = new URL(window.location.href)
    const match = url.pathname.match(/^\/sessions\/([^/]+)\/?$/)
    return match ? decodeURIComponent(match[1]) : ''
  }

  function updateSessionRoute(id, { replaceRoute = false } = {}) {
    const hash = window.location.hash
    const next = id ? `/sessions/${encodeURIComponent(id)}${hash}` : `/${hash}`
    const current = window.location.pathname
      + window.location.search
      + window.location.hash
    if (next === current) return
    const method = replaceRoute ? 'replaceState' : 'pushState'
    window.history[method]({}, '', next)
  }

  async function scheduleSessionRefresh(activeSessionId, event) {
    if (activeSessionId !== selectedSessionId.value) return
    if (event?.type === 'message_update') return

    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(async () => {
      try {
        const wasFollowing = shouldFollowOutput?.() ?? true
        const detail = await fetchSessionDetail(selectedSessionId.value)
        sessionDetail.value = detail
        updateSelectedSessionSummary(detail.session)
        if (wasFollowing) await scrollToLatest?.()
        else markNewOutput?.()
      } catch (error) {
        sessionError.value = error.message
      }
    }, event?.type === 'compaction_end' ? 0 : 250)
  }

  function updateRuntimeQueue(event) {
    if (event.type !== 'queue_update' || !activeRuntimeSession.value) return
    activeRuntimeSession.value = {
      ...activeRuntimeSession.value,
      state: {
        ...activeRuntimeSession.value.state,
        queuedMessages: {
          steering: event.steering || [],
          followUp: event.followUp || [],
        },
      },
    }
  }

  function updateRuntimeSessionSnapshot(runtimeSession) {
    if (!runtimeSession?.id) return
    const state = runtimeSession.state || {}
    patchRuntimeSessionState(runtimeSession.id, {
      isStreaming: state.isStreaming === true,
      isCompacting: state.isCompacting === true,
      queuedCount: queuedCount(state.queuedMessages),
      pendingToolCount: Array.isArray(state.pendingToolCalls)
        ? state.pendingToolCalls.length
        : 0,
    }, { preserveUnread: true })
  }

  function updateRuntimeEventState(data) {
    const id = data?.activeSessionId
    const event = data?.event
    if (!id || !event?.type) return

    const previous = runtimeSessionsById.value[id] || {}
    const patch = runtimePatchFromEvent(event, previous)
    if (!patch) return

    const next = { ...previous, ...patch }
    const wasBusy = previous.isStreaming || previous.isCompacting
    const willBeBusy = next.isStreaming || next.isCompacting
    const finished = wasBusy && !willBeBusy
    const unread = id !== selectedSessionId.value && (
      finished || event.type === 'error' || event.type === 'aborted'
    )

    patchRuntimeSessionState(id, patch, { unread })
  }

  function sessionRuntimeStatus(id) {
    const state = runtimeSessionsById.value[id] || {}
    if (state.error) return { label: 'error', tone: 'error' }
    if (state.isCompacting) return { label: 'compacting', tone: 'compacting' }
    if (state.isStreaming) return { label: 'running', tone: 'running' }
    if (state.unread) return { label: 'unread', tone: 'unread' }
    if (state.queuedCount) {
      return { label: `+${state.queuedCount} queued`, tone: 'queued' }
    }
    return { label: '', tone: '' }
  }

  function patchRuntimeSessionState(id, patch, options = {}) {
    const previous = runtimeSessionsById.value[id] || {}
    runtimeSessionsById.value = {
      ...runtimeSessionsById.value,
      [id]: {
        ...previous,
        ...patch,
        unread: options.preserveUnread
          ? previous.unread === true
          : options.unread === true || previous.unread === true,
        updatedAt: Date.now(),
      },
    }
  }

  function markRuntimeSessionRead(id) {
    const previous = runtimeSessionsById.value[id]
    if (!previous?.unread) return
    runtimeSessionsById.value = {
      ...runtimeSessionsById.value,
      [id]: { ...previous, unread: false },
    }
  }

  function runtimePatchFromEvent(event, previous) {
    if (['agent_start', 'turn_start', 'message_start'].includes(event.type)) {
      return { isStreaming: true, isCompacting: false, error: '' }
    }
    if (['tool_call', 'tool_execution_start'].includes(event.type)) {
      return { isStreaming: true, error: '' }
    }
    if (event.type === 'agent_end') return { isStreaming: false, error: '' }
    if (event.type === 'error') {
      return { isStreaming: false, isCompacting: false, error: 'error' }
    }
    if (event.type === 'aborted') {
      return { isStreaming: false, isCompacting: false, error: '' }
    }
    if (event.type === 'compaction_start') {
      return { isCompacting: true, error: '' }
    }
    if (event.type === 'compaction_end') {
      return { isCompacting: false, error: event.errorMessage ? 'error' : '' }
    }
    if (event.type === 'queue_update') {
      return { queuedCount: queuedCount(event) }
    }
    return previous ? {} : null
  }

  function queuedCount(queue) {
    const steering = Array.isArray(queue?.steering) ? queue.steering.length : 0
    const followUp = Array.isArray(queue?.followUp) ? queue.followUp.length : 0
    return steering + followUp
  }

  function patchRuntimeExtensionUi(extensionUi, goal) {
    if (!activeRuntimeSession.value) return
    activeRuntimeSession.value = {
      ...activeRuntimeSession.value,
      state: {
        ...activeRuntimeSession.value.state,
        extensionUi,
        goal,
      },
    }
    if (goal?.objective) patchGoalSessionTitle(goal.objective)
  }

  function patchGoalSessionTitle(objective) {
    const id = selectedSessionId.value
    if (!id) return

    sessions.value = sessions.value.map((session) => {
      if (session.id !== id) return session
      if (session.firstMessage && session.firstMessage !== '(no messages)') {
        return session
      }
      return { ...session, firstMessage: objective }
    })

    const detail = sessionDetail.value
    if (!detail || detail.session.id !== id) return
    const firstMessage = detail.session.firstMessage
    if (firstMessage && firstMessage !== '(no messages)') return
    sessionDetail.value = {
      ...detail,
      session: { ...detail.session, firstMessage: objective },
    }
  }

  function requestDeleteSession(session) {
    if (!session || deletingSessionId.value) return
    deleteConfirmSession.value = session
    deleteSessionError.value = ''
    deleteSessionPhase.value = ''
  }

  function cancelDeleteSession() {
    if (deletingSessionId.value) return
    deleteConfirmSession.value = null
    deleteSessionError.value = ''
    deleteSessionPhase.value = ''
  }

  function deleteSessionButtonLabel() {
    if (deleteSessionPhase.value === 'deleting') return 'Deleting…'
    return 'Delete'
  }

  async function confirmDeleteSession() {
    const session = deleteConfirmSession.value
    if (!session || deletingSessionId.value) return

    deletingSessionId.value = session.id
    deleteSessionPhase.value = 'deleting'
    sessionError.value = ''
    deleteSessionError.value = ''

    try {
      await deletePiSession(session.id)
      sessions.value = sessions.value.filter((item) => {
        return item.id !== session.id
      })
      deleteConfirmSession.value = null
      if (selectedSessionId.value === session.id) {
        const cwd = session.cwd || newSessionCwd.value
        clearSelectedSession()
        if (cwd) {
          newSessionCwd.value = cwd
          loadStartRuntimeState(cwd)
        }
        updateSessionRoute('')
      }
    } catch (error) {
      deleteSessionError.value = error.message
    } finally {
      deletingSessionId.value = ''
      deleteSessionPhase.value = ''
    }
  }

  async function forkSession(entry) {
    if (!entry?.id || !canBranchFromEntry()) return

    forkingEntryId.value = entry.id
    sessionError.value = ''
    liveTurn?.setActivity?.('Forking session…')

    try {
      const data = await forkPiSession(entry.id)
      setSelectedSessionData(data.detail, data.active)
      await loadSessions({ selectFirst: false, showLoading: false })
      await scrollToLatest?.()
      await reconnectTerminalIfOpen()
    } catch (error) {
      sessionError.value = error.message
      liveTurn?.setActivity?.('')
    } finally {
      forkingEntryId.value = ''
    }
  }

  async function resetSessionToEntry(entry) {
    if (!entry?.id || !selectedSession.value || !canBranchFromEntry()) return

    resettingEntryId.value = entry.id
    sessionError.value = ''
    liveTurn?.setActivity?.('Resetting session…')

    try {
      const data = await resetPiSession(entry.id)
      setSelectedSessionData(data.detail, data.active)
      updateSelectedSessionSummary(data.detail.session)
      await scrollToLatest?.()
      await reconnectTerminalIfOpen()
    } catch (error) {
      sessionError.value = error.message
      liveTurn?.setActivity?.('')
    } finally {
      resettingEntryId.value = ''
    }
  }

  function canBranchFromEntry() {
    return !forkingEntryId.value
      && !resettingEntryId.value
      && !liveTurn?.agentRunning?.value
      && !liveTurn?.compactingContext?.value
  }

  async function reloadSession() {
    if (reloadingSession.value) return

    reloadingSession.value = true
    sessionError.value = ''
    liveTurn?.setActivity?.([
      'Reloading keybindings, extensions, skills, prompts, themes…',
    ].join(''))

    const sessionId = selectedSessionId.value
    try {
      const active = await reloadPiSession(sessionId)
      if (selectedSessionId.value === sessionId) {
        activeRuntimeSession.value = active
      }
      if (selectedSessionId.value === sessionId) liveTurn?.setActivity?.('')
      await loadSessions({ selectFirst: false, showLoading: false })
      if (selectedSessionId.value === sessionId) {
        sessionDetail.value = await fetchSessionDetail(sessionId)
      }
    } catch (error) {
      if (selectedSessionId.value === sessionId) {
        sessionError.value = error.message
        liveTurn?.setActivity?.('')
      }
    } finally {
      reloadingSession.value = false
    }
  }

  async function selectModel(model) {
    if (!model || modelKey(model) === selectedModelKey.value) return false

    switchingModel.value = true
    sessionError.value = ''

    if (!selectedSession.value) {
      const state = startRuntimeState.value?.state || {}
      const levels = model.availableThinkingLevels || []
      const selectedThinking = startSelectedThinkingLevel.value
      const thinkingLevel = clampThinkingLevel(
        selectedThinking || state.thinkingLevel,
        levels,
      )

      if (selectedThinking !== null) {
        startSelectedThinkingLevel.value = thinkingLevel
      }
      startSelectedModel.value = model
      startRuntimeState.value = {
        ...startRuntimeState.value,
        state: {
          ...state,
          model,
          availableThinkingLevels: levels,
          thinkingLevel,
        },
      }
      switchingModel.value = false
      return true
    }

    const sessionId = selectedSessionId.value
    try {
      const active = await switchPiModel(sessionId, model.provider, model.id)
      if (selectedSessionId.value === sessionId) {
        activeRuntimeSession.value = active
      }
    } catch (error) {
      if (selectedSessionId.value === sessionId) {
        sessionError.value = error.message
      }
    } finally {
      switchingModel.value = false
    }
    return true
  }

  async function selectThinkingLevel(level) {
    if (!level || level === composerRuntime.value?.state?.thinkingLevel) {
      return false
    }

    switchingThinking.value = true
    sessionError.value = ''

    if (!selectedSession.value) {
      startSelectedThinkingLevel.value = level
      startRuntimeState.value = {
        ...startRuntimeState.value,
        state: { ...startRuntimeState.value?.state, thinkingLevel: level },
      }
      switchingThinking.value = false
      return true
    }

    const sessionId = selectedSessionId.value
    try {
      const active = await switchPiThinkingLevel(sessionId, level)
      if (selectedSessionId.value === sessionId) {
        activeRuntimeSession.value = active
      }
    } catch (error) {
      if (selectedSessionId.value === sessionId) {
        sessionError.value = error.message
      }
    } finally {
      switchingThinking.value = false
    }
    return true
  }

  function setSelectedSessionData(detail, active) {
    sessionSelectionToken += 1
    activeRuntimeSession.value = active || null
    sessionDetail.value = detail
    selectedSessionId.value = detail.session.id
    liveTurn?.selectSession?.(detail.session.id)
    liveTurn?.setPersistedDetail?.(detail)
    updateSessionRoute(detail.session.id)
  }

  function isCurrentSessionSelection(token, id) {
    return token === sessionSelectionToken && selectedSessionId.value === id
  }

  async function activateSelectedSession(token, session) {
    let active
    sessionActivationQueue = sessionActivationQueue.catch(() => {}).then(
      async () => {
        if (!isCurrentSessionSelection(token, session.id)) return
        active = await activatePiSession(session)
      },
    )
    await sessionActivationQueue
    if (active && isCurrentSessionSelection(token, session.id)) {
      activeRuntimeSession.value = active
    }
  }

  function beginStartupRun(cwd, options = {}) {
    startupRun.value = {
      cwd,
      project: projectName(cwd),
      hasPrompt: options.hasPrompt,
      model: options.model ? modelChip(options.model) : '',
      thinking: options.thinkingLevel ? formatMode(options.thinkingLevel) : '',
      phase: 'accepted',
    }
    setStartupPhase('accepted')
  }

  function beginSessionHandoff(cwd) {
    const handoff = {
      id: `${Date.now()}-${Math.random()}`,
      cwd,
      project: projectName(cwd),
      startedAt: Date.now(),
      phase: 'clearing',
      phaseStartedAt: Date.now(),
    }
    sessionHandoff.value = handoff
    return handoff
  }

  function setSessionHandoffPhase(handoff, phase) {
    if (sessionHandoff.value?.id !== handoff.id) return
    sessionHandoff.value = {
      ...sessionHandoff.value,
      phase,
      phaseStartedAt: Date.now(),
    }
  }

  async function runSessionHandoffPhase(handoff, phase, task) {
    setSessionHandoffPhase(handoff, phase)
    const result = await task()
    await waitSessionHandoffPhaseFloor(handoff)
    return result
  }

  async function waitSessionHandoffPhaseFloor(handoff) {
    const current = sessionHandoff.value
    if (current?.id !== handoff.id) return
    const elapsed = Date.now() - current.phaseStartedAt
    const remaining = Math.max(0, 320 - elapsed)
    if (remaining) await wait(remaining)
  }

  async function finishSessionHandoffFloor(handoff) {
    await waitSessionHandoffPhaseFloor(handoff)
    const elapsed = Date.now() - handoff.startedAt
    const remaining = Math.max(0, 860 - elapsed)
    if (remaining) await wait(remaining)
  }

  function finishSessionHandoff(handoff) {
    if (sessionHandoff.value?.id === handoff.id) sessionHandoff.value = null
  }

  function setStartupPhase(phase) {
    if (!startupRun.value) return

    startupRun.value = { ...startupRun.value, phase }
  }

  async function runStartupPhase(phase, task) {
    setStartupPhase(phase)
    const started = Date.now()
    const result = await task()
    const elapsed = Date.now() - started
    const remaining = Math.max(0, 650 - elapsed)
    if (remaining) await wait(remaining)
    return result
  }

  function finishStartupRun() {
    startupRun.value = null
  }

  function sessionTitle(session) {
    if (session?.messageCount === 0
      || session?.name === '(no messages)'
      || session?.firstMessage === '(no messages)') {
      return 'New session'
    }
    return session?.name || session?.firstMessage || 'Untitled session'
  }

  function highlightedText(value) {
    return highlightFuzzyText(value, sessionQuery.value)
  }

  function updateSelectedSessionSummary(session) {
    sessions.value = sessions.value.map((item) => {
      if (item.id !== session.id) return item
      return {
        ...item,
        name: session.name,
        firstMessage: session.firstMessage,
        messageCount: session.messageCount,
        modified: session.modified,
        timestamp: session.modified || item.timestamp,
      }
    })
  }

  function visibleProjectList() {
    const projects = new Map()
    const query = sessionQuery.value.trim().toLowerCase()

    for (const session of sessions.value) {
      const key = session.cwd || 'unknown'
      const name = projectName(key)
      const projectScore = query ? fuzzyScore(name, query) : 1
      const sessionScoreValue = query ? sessionScore(session, query) : 1

      if (query && projectScore === 0 && sessionScoreValue === 0) continue

      if (!projects.has(key)) {
        projects.set(key, {
          cwd: key,
          name,
          score: projectScore,
          sessions: [],
        })
      }

      if (!query || projectScore > 0 || sessionScoreValue > 0) {
        projects.get(key).sessions.push(session)
        projects.get(key).score = Math.max(
          projects.get(key).score,
          projectScore,
          sessionScoreValue,
        )
      }
    }

    const projectList = Array.from(projects.values())
    for (const project of projectList) {
      project.sessions.sort((a, b) => {
        return sessionTimestamp(b) - sessionTimestamp(a)
      })
    }

    return projectList
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
  }

  function sessionScore(session, query) {
    return fuzzyScore(sessionTitle(session), query)
  }

  function sessionTimestamp(session) {
    const time = new Date(session?.timestamp || 0).getTime()
    return Number.isNaN(time) ? 0 : time
  }

  async function reconnectTerminalIfOpen() {
    if (!terminal?.isOpen?.()) return
    await terminal.reconnect?.()
  }

  function modelKey(model) {
    return JSON.stringify([model.provider, model.id])
  }

  function clampThinkingLevel(level, levels) {
    if (!levels.length) return 'off'
    if (levels.includes(level)) return level

    const order = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
    const index = order.indexOf(level)
    if (index === -1) return levels[0]

    for (let i = index; i < order.length; i++) {
      if (levels.includes(order[i])) return order[i]
    }
    for (let i = index - 1; i >= 0; i--) {
      if (levels.includes(order[i])) return order[i]
    }
    return levels[0]
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function dispose() {
    clearTimeout(refreshTimer)
  }

  return {
    activeGoal,
    activeRuntimeSession,
    availableModels,
    availableThinkingLevels,
    beginStartupRun,
    cancelDeleteSession,
    clearSelectedSession,
    composerRuntime,
    confirmDeleteSession,
    contextUsage,
    createSession,
    createSessionForCwd,
    creatingSessionCwd,
    currentModelLabel,
    currentThinkingLabel,
    deleteConfirmSession,
    deleteSessionButtonLabel,
    deleteSessionError,
    deleteSessionPhase,
    deletingSessionId,
    dispose,
    finishStartupRun,
    forkingEntryId,
    forkSession,
    handleNativeNewSession,
    handleRouteChange,
    highlightedText,
    initPhase,
    initializing,
    loadSessions,
    loadStartRuntimeState,
    modelKey,
    navigateHome,
    newSessionCwd,
    patchRuntimeExtensionUi,
    reloadSession,
    reloadingSession,
    requestDeleteSession,
    resettingEntryId,
    resetSessionToEntry,
    runStartupPhase,
    scheduleSessionRefresh,
    selectModel,
    selectedModelKey,
    selectedSession,
    selectedSessionId,
    selectSession,
    selectThinkingLevel,
    sessionActivating,
    sessionDetail,
    sessionError,
    sessionHandoff,
    sessionIdFromRoute,
    sessionLoading,
    sessionQuery,
    sessionRuntimeStatus,
    sessions,
    sessionsError,
    sessionsLoading,
    sessionSwitching,
    sessionTitle,
    sidebarRuntimeSummary,
    setActiveRuntimeSession: (value) => { activeRuntimeSession.value = value },
    updateRuntimeEventState,
    updateRuntimeSessionSnapshot,
    setSessionDetail: (value) => { sessionDetail.value = value },
    startRuntimeState,
    startSelectedModel,
    startSelectedThinkingLevel,
    startupRun,
    switchingModel,
    switchingThinking,
    updateRuntimeQueue,
    updateSelectedSessionSummary,
    visibleProjects,
  }
}
