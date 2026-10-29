<script setup>
import { computed, markRaw, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { backendDisplayAddress } from '../lib/backend'
import { sessionTime } from '../lib/format'
import { useModalFocus } from '../composables/useModalFocus'

const isWindows = /Win/i.test(navigator.platform || navigator.userAgent || '')
const quickSwitchShortcutLabel = isWindows ? 'Ctrl+K' : '⌘K'
const activityShortcutLabel = isWindows ? 'Ctrl+Shift+A' : '⌘⇧A'

const props = defineProps({
  activityActionError: {
    type: String,
    default: '',
  },
  activeBackendConnection: {
    type: Object,
    default: null,
  },
  agentRunning: Boolean,
  tracingAvailable: Boolean,
  tracesOpen: Boolean,
  backendConnectionBusyId: {
    type: String,
    default: '',
  },
  backendConnectionError: {
    type: String,
    default: '',
  },
  backendConnections: {
    type: Array,
    default: () => [],
  },
  creatingSessionCwd: {
    type: String,
    default: '',
  },
  defaultBackendConnectionId: {
    type: String,
    default: '',
  },
  deletingSessionId: {
    type: String,
    default: '',
  },
  deletingProjectCwd: {
    type: String,
    default: '',
  },
  interruptingSessionId: {
    type: String,
    default: '',
  },
  navigator: {
    type: String,
    default: '',
  },
  navigatorFocusActive: {
    type: Boolean,
    default: true,
  },
  newSessionCwd: {
    type: String,
    default: '',
  },
  pinPendingIds: {
    type: Set,
    default: () => new Set(),
  },
  pinnedSessionIds: {
    type: Set,
    default: () => new Set(),
  },
  pinnedVersion: {
    type: Number,
    default: 0,
  },
  pinsError: {
    type: String,
    default: '',
  },
  pinsReady: Boolean,
  reloadingSession: Boolean,
  runtimeActivitySessions: {
    type: Array,
    default: () => [],
  },
  renameDraft: {
    type: String,
    default: '',
  },
  renamingSessionId: {
    type: String,
    default: '',
  },
  renamingSessionSavingId: {
    type: String,
    default: '',
  },
  renamingSessionSource: {
    type: String,
    default: '',
  },
  selectedSession: {
    type: Object,
    default: null,
  },
  selectedSessionId: {
    type: String,
    default: '',
  },
  sessionStatus: {
    type: Function,
    default: () => ({ label: '', tone: '' }),
  },
  sessionTitle: {
    type: Function,
    required: true,
  },
  sessionTitleGenerating: {
    type: Function,
    default: () => false,
  },
  sessionsError: {
    type: String,
    default: '',
  },
  sessionsHydrated: Boolean,
  sessionsHydrating: Boolean,
  sessionsHydrationError: {
    type: String,
    default: '',
  },
  sessionsLoading: Boolean,
  subagentChildrenByParentPath: {
    type: Object,
    default: () => new Map(),
  },
  visibleProjects: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits([
  'begin-rename-session',
  'cancel-rename-session',
  'commit-rename-session',
  'create-session',
  'interrupt-session',
  'open-project-browser',
  'open-project-detail',
  'open-settings',
  'open-traces',
  'reload-session',
  'request-delete-project',
  'request-delete-session',
  'retry-pins',
  'retry-sessions',
  'select-backend',
  'select-child-session',
  'select-project',
  'select-session',
  'toggle-pin-session',
  'update:navigator',
  'update:renameDraft',
])

const backendMenu = ref(null)
const backendMenuOpen = ref(false)
const projectControl = ref(null)
const navigatorSearch = ref(null)
const pinFilter = ref(null)
const navigatorDialog = ref(null)
const navigatorOpener = ref(null)
const navigatorSearchFocus = ref(null)
const sessionActionTarget = ref(null)
const sessionActionOpener = ref(null)
const sessionActionDialog = ref(null)
const sessionActionsOpen = computed(() => Boolean(sessionActionTarget.value))
const navigatorQuery = ref('')
const sessionQuery = ref('')
const pinnedOnly = ref(false)
const navigationProjectCwd = ref('')
const projectOrder = ref([])
const sessionOrder = ref([])
const expandedParentOverrides = ref(new Map())
const autoExpandedParents = ref(new Set())
const sessionFolds = ref(new Map())
const sessionOrdersByProject = new Map()
const sessionScroll = ref(null)
const sessionScrollTop = ref(0)
const sessionViewportHeight = ref(520)
const lastSessionByProject = new Map()
const SESSION_ROW_HEIGHT = 36
const SESSION_CHILD_ROW_HEIGHT = 30
const SESSION_FOLD_DURATION = 180
const SESSION_GROUP_HEIGHT = 26
const SESSION_OVERSCAN_PX = SESSION_ROW_HEIGHT * 4
const SKELETON_GROUP_ROWS = [5, 7, 6]
const SKELETON_VARIANT_COUNT = 8
const DAY_MS = 24 * 60 * 60 * 1000
const sessionClockFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const sessionWeekdayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
})
const sessionDayFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
})
const sessionMonthFormat = new Intl.DateTimeFormat(undefined, {
  month: 'long',
})
const sessionMonthYearFormat = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
})
const sessionFullFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})
useModalFocus({
  dialog: navigatorDialog,
  active: () => props.navigatorFocusActive
    && (props.navigator === 'quick' || props.navigator === 'activity'),
  opener: navigatorOpener,
  fallbackSelector: '[aria-label="Open sessions"]',
  initialFocus: () => (navigatorSearchFocus.value
    ?? !window.matchMedia('(hover: none), (pointer: coarse)').matches)
    ? navigatorSearch.value : navigatorDialog.value,
})

useModalFocus({
  dialog: sessionActionDialog,
  active: () => props.navigatorFocusActive && sessionActionsOpen.value && !props.navigator,
  opener: sessionActionOpener,
  fallbackSelector: '[aria-label="Open sessions"]',
})

let pendingPinFocusId = null
let sessionResizeObserver
let sessionFoldFrame = 0
let sessionFoldMedia

const sessionSkeletonItems = computed(() => {
  const lastSessionItem = sessionListItems.value.at(-1)
  const listedHeight = lastSessionItem
    ? lastSessionItem.top + lastSessionItem.height
    : 0
  const targetHeight = Math.max(
    sessionViewportHeight.value - listedHeight,
    SESSION_GROUP_HEIGHT,
  )
  const items = [{
    key: 'skeleton-group-0',
    type: 'group',
    separator: false,
    variant: 0,
  }]
  let filledHeight = SESSION_GROUP_HEIGHT
  let groupIndex = 0
  let remainingRows = SKELETON_GROUP_ROWS[0]
  let rowIndex = 0

  while (filledHeight < targetHeight) {
    if (remainingRows === 0) {
      const hasRoomForGroup = targetHeight - filledHeight
        >= SESSION_GROUP_HEIGHT + SESSION_ROW_HEIGHT
      if (hasRoomForGroup) {
        groupIndex += 1
        items.push({
          key: `skeleton-group-${groupIndex}`,
          type: 'group',
          separator: true,
          variant: groupIndex % 3,
        })
        filledHeight += SESSION_GROUP_HEIGHT
        remainingRows = SKELETON_GROUP_ROWS[
          groupIndex % SKELETON_GROUP_ROWS.length
        ]
      } else {
        remainingRows = Number.POSITIVE_INFINITY
      }
    }

    if (filledHeight >= targetHeight) break
    items.push({
      key: `skeleton-session-${rowIndex}`,
      type: 'session',
      variant: rowIndex % SKELETON_VARIANT_COUNT,
    })
    filledHeight += SESSION_ROW_HEIGHT
    remainingRows -= 1
    rowIndex += 1
  }

  return items
})

watch(
  () => props.visibleProjects,
  (projects) => {
    const visibleCwds = new Set(projects.map((project) => project.cwd))
    const existing = projectOrder.value.filter((cwd) => visibleCwds.has(cwd))
    const existingCwds = new Set(existing)
    const added = projects
      .map((project) => project.cwd)
      .filter((cwd) => !existingCwds.has(cwd))
    const next = [...added, ...existing]
    if (next.length !== projectOrder.value.length
      || next.some((cwd, index) => cwd !== projectOrder.value[index])) {
      projectOrder.value = next
    }

    if (!visibleCwds.has(navigationProjectCwd.value)) {
      navigationProjectCwd.value = sidebarRootCwdForSelected()
        || projects[0]?.cwd
        || ''
    }
  },
  { immediate: true },
)

watch(
  () => [
    props.selectedSession?.id || '',
    props.selectedSession?.cwd || '',
    props.selectedSession?.parentSessionPath || '',
    props.newSessionCwd,
  ],
  ([sessionId, sessionCwd, parentPath, newSessionCwd]) => {
    if (sessionId && (sessionCwd || parentPath)) {
      if (sessionCwd) lastSessionByProject.set(sessionCwd, sessionId)
      const rootCwd = sidebarRootCwdForSelected() || sessionCwd
      if (rootCwd) {
        navigationProjectCwd.value = rootCwd
        return
      }
    }
    if (newSessionCwd) navigationProjectCwd.value = newSessionCwd
  },
  { immediate: true },
)

watch(
  () => props.navigator,
  (navigator, previous) => {
    if (navigator !== previous) navigatorQuery.value = ''
    if (navigator) closeSessionActions()
    else {
      navigatorOpener.value = null
      navigatorSearchFocus.value = null
    }
  },
)

const orderedProjects = computed(() => {
  const projects = new Map(
    props.visibleProjects.map((project) => [project.cwd, project]),
  )
  return projectOrder.value
    .map((cwd) => projects.get(cwd))
    .filter(Boolean)
})

const currentProject = computed(() => {
  const parentCwd = parentProjectCwdForSelected()
  if (parentCwd) {
    const parentProject = orderedProjects.value.find((project) => project.cwd === parentCwd)
    if (parentProject) return parentProject
  }
  const found = orderedProjects.value.find((project) => {
    return project.cwd === navigationProjectCwd.value
  })
  if (found) return found
  if (props.selectedSession?.id) return null
  return orderedProjects.value[0] || null
})

const currentProjectSessions = computed(() => {
  const project = currentProject.value
  if (!project) return []
  const projectSessions = [...project.sessions]
  const selected = props.selectedSession
  if (selected?.cwd === project.cwd
    && !selected.isSubagentSession
    && !projectSessions.some((session) => session.id === selected.id)) {
    projectSessions.unshift(selected)
  }
  return projectSessions
})

const filteredProjectSessions = computed(() => {
  return pinnedOnly.value
    ? currentProjectSessions.value.filter(isPinned)
    : currentProjectSessions.value
})

watch(
  [
    () => props.visibleProjects,
    currentProjectSessions,
    () => props.sessionsHydrated,
    () => props.activeBackendConnection,
  ],
  ([projects, currentSessions, hydrated, connection]) => {
    const currentCwd = currentProject.value?.cwd
    const today = calendarDay(new Date())
    if (!projects.length) sessionOrder.value = []
    for (const project of projects) {
      const isCurrent = project.cwd === currentCwd
      const key = JSON.stringify([connection?.id, connection?.url, project.cwd])
      const previous = sessionOrdersByProject.get(key)
      if (!isCurrent && !previous) continue
      const sessions = isCurrent ? currentSessions : project.sessions
      const knownDays = previous?.hydrated ? previous.days : new Map()
      const days = new Map(sessions.map((session) => [
        session.id,
        Math.max(sessionActivityDay(session), knownDays.get(session.id) ?? -Infinity),
      ]))
      const promoted = sessions.filter((session) => {
        return !knownDays.has(session.id)
          || (!props.pinnedSessionIds.has(session.id)
            && sessionActivityDay(session) >= today
            && knownDays.get(session.id) < today)
      }).sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a))
      const promotedIds = new Set(promoted.map((session) => session.id))
      const order = [
        ...promotedIds,
        ...(previous?.order || []).filter((id) => {
          return days.has(id) && !promotedIds.has(id)
        }),
      ]
      sessionOrdersByProject.set(key, { order, days, hydrated })
      if (isCurrent) sessionOrder.value = order
    }
  },
  { immediate: true },
)

const searchedChildren = computed(() => {
  const matches = new Map()
  const query = sessionQuery.value.trim()
  if (!query) return matches
  for (const session of filteredProjectSessions.value) {
    const children = childrenForSession(session)
    if (!children.length) continue
    matches.set(session.path, children.filter((child) => {
      return navigationScore([
        childTitle(child),
        child.agent,
        child.id,
      ], query) > 0
    }))
  }
  return matches
})

const matchingProjectSessions = computed(() => {
  const byId = new Map(
    filteredProjectSessions.value.map((session) => [session.id, session]),
  )
  const sessions = sessionOrder.value.map((id) => byId.get(id)).filter(Boolean)
  const query = sessionQuery.value.trim()
  if (!query) return sessions
  return sessions
    .map((session) => ({
      session,
      score: navigationScore([
        props.sessionTitle(session),
        session.id,
      ], query),
    }))
    .filter((item) => item.score > 0
      || (searchedChildren.value.get(item.session.path)?.length || 0) > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.session)
})

const orderedProjectSessions = computed(() => {
  const sessions = matchingProjectSessions.value
  if (sessionQuery.value.trim()) return sessions
  return [...sessions].sort((a, b) => {
    const aPinned = props.pinnedSessionIds.has(a.id)
    const bPinned = props.pinnedSessionIds.has(b.id)
    if (aPinned !== bPinned) return aPinned ? -1 : 1
    if (aPinned) return 0
    return sessionActivityDay(b) - sessionActivityDay(a) || 0
  })
})

const sessionListItems = computed(() => {
  const items = []
  const grouped = !sessionQuery.value.trim()
  const now = new Date()
  let previousGroup = ''
  let pinnedHeaderAdded = false

  orderedProjectSessions.value.forEach((session, sessionIndex) => {
    if (grouped && props.pinnedSessionIds.has(session.id)) {
      if (!pinnedHeaderAdded) {
        items.push({
          key: 'group:pinned',
          type: 'group',
          label: 'Pinned',
          separator: false,
          height: SESSION_GROUP_HEIGHT,
        })
        pinnedHeaderAdded = true
      }
    } else if (grouped) {
      const group = sessionTimeGroup(session, now)
      if (group.key !== previousGroup) {
        items.push({
          key: `group:${group.key}:${sessionIndex}`,
          type: 'group',
          label: group.label,
          separator: items.length > 0,
          height: SESSION_GROUP_HEIGHT,
        })
        previousGroup = group.key
      }
    }
    items.push({
      key: `session:${session.path || session.id}`,
      type: 'session',
      session,
      sessionIndex,
      height: SESSION_ROW_HEIGHT,
    })
    const fold = sessionFolds.value.get(session.path)
    if (!parentIsExpanded(session) && !fold) return
    const children = visibleChildrenFor(session)
    const visibleHeight = children.length * SESSION_CHILD_ROW_HEIGHT
      * (fold?.progress ?? 1)
    children.forEach((child, index) => {
      const height = Math.max(0, Math.min(
        SESSION_CHILD_ROW_HEIGHT,
        visibleHeight - index * SESSION_CHILD_ROW_HEIGHT,
      ))
      if (!height) return
      items.push({
        key: `child:${child.path || child.id}`,
        type: 'session-child',
        session: child,
        parentSession: session,
        height,
        foldProgress: fold?.progress,
        collapsing: fold?.to === 0,
        lastChild: index === children.length - 1,
      })
    })
  })

  let top = 0
  return items.map((item) => {
    const positioned = { ...item, top }
    top += item.height
    return positioned
  })
})

const virtualSessionWindow = computed(() => {
  const items = sessionListItems.value
  const totalHeight = items.length
    ? items.at(-1).top + items.at(-1).height
    : 0
  const overscanTop = Math.max(
    0,
    sessionScrollTop.value - SESSION_OVERSCAN_PX,
  )
  const overscanBottom = sessionScrollTop.value
    + sessionViewportHeight.value
    + SESSION_OVERSCAN_PX
  const start = sessionItemIndexAt(items, overscanTop)
  let end = start
  while (end < items.length && items[end].top < overscanBottom) end += 1
  const top = items[start]?.top ?? totalHeight
  const renderedBottom = end > start
    ? items[end - 1].top + items[end - 1].height
    : top
  return {
    items: items.slice(start, end),
    top,
    bottom: Math.max(0, totalHeight - renderedBottom),
  }
})

const navigatorProjects = computed(() => {
  const query = navigatorQuery.value.trim()
  if (!query) return orderedProjects.value.slice(0, 4)
  return orderedProjects.value
    .map((project) => ({
      project,
      score: navigationScore([project.name, project.cwd], query),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.project)
})

const quickDefaultSessions = computed(() => {
  if (props.navigator !== 'quick' || navigatorQuery.value.trim()) return []
  const activeIds = new Set(
    props.runtimeActivitySessions.map((item) => item.session.id),
  )
  const recent = orderedProjects.value
    .flatMap((project) => project.sessions.map((session) => ({
      project,
      session,
    })))
    .filter((item) => !activeIds.has(item.session.id))
    .sort((a, b) => sessionTimestamp(b.session)
      - sessionTimestamp(a.session))
  return [...props.runtimeActivitySessions, ...recent].slice(0, 6)
})

const navigatorSessions = computed(() => {
  const query = navigatorQuery.value.trim()
  if (!query) return quickDefaultSessions.value
  const termCount = query.split(/\s+/).filter(Boolean).length
  return orderedProjects.value
    .flatMap((project) => project.sessions.map((session) => {
      const directScore = navigationScore([
        props.sessionTitle(session),
        session.id,
      ], query)
      const contextualScore = termCount > 1
        ? navigationScore([
          props.sessionTitle(session),
          session.id,
          project.name,
          project.cwd,
        ], query)
        : 0
      return {
        project,
        session,
        score: directScore || contextualScore,
      }
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      return b.score - a.score || sessionTimestamp(b.session)
        - sessionTimestamp(a.session)
    })
    .slice(0, 12)
})

const activitySessions = computed(() => {
  const query = navigatorQuery.value.trim()
  return props.runtimeActivitySessions
    .filter((item) => item.session.id !== props.selectedSessionId)
    .filter((item) => {
      if (!query) return true
      return navigationScore([
        props.sessionTitle(item.session),
        item.project.name,
        item.project.cwd,
        item.detail,
      ], query) > 0
    })
    .sort((a, b) => (b.activityAt || 0) - (a.activityAt || 0))
})

const attentionSessions = computed(() => {
  return activitySessions.value.filter((item) => {
    return item.status.tone === 'error' || item.status.tone === 'unread'
  })
})

const workingSessions = computed(() => {
  return activitySessions.value.filter((item) => {
    return item.status.tone === 'running'
      || item.status.tone === 'compacting'
  })
})

const queuedSessions = computed(() => {
  return activitySessions.value.filter((item) => {
    return item.status.tone === 'queued'
  })
})

const activityGroups = computed(() => [
  { key: 'attention', label: 'Needs attention', items: attentionSessions.value },
  { key: 'running', label: 'Running', items: workingSessions.value },
  { key: 'queued', label: 'Queued', items: queuedSessions.value },
].filter((group) => group.items.length))

const sharedWorkingTrees = computed(() => {
  const projects = new Map()
  for (const item of activitySessions.value) {
    if (item.sharedWorkingTreeCount < 2 || projects.has(item.project.cwd)) continue
    projects.set(item.project.cwd, item)
  }
  return [...projects.values()]
})

const activitySummary = computed(() => {
  const counts = {
    running: 0,
    compacting: 0,
    unread: 0,
    error: 0,
    queued: 0,
  }
  for (const item of activitySessions.value) {
    if (Object.hasOwn(counts, item.status.tone)) counts[item.status.tone] += 1
  }
  const parts = [
    countLabel(counts.running, 'running'),
    countLabel(counts.compacting, 'compacting'),
    countLabel(counts.unread, 'unread'),
    countLabel(counts.error, 'error'),
    countLabel(counts.queued, 'queued'),
  ].filter(Boolean)
  return parts.join(' · ') || 'No other activity'
})

const projectSessionCount = computed(() => {
  const count = currentProjectSessions.value.length
  if (!props.sessionsHydrated
    && !props.sessionsHydrationError
    && !props.sessionsError) return '…'
  if (pinnedOnly.value && !props.pinsReady) return '…'
  return pinnedOnly.value
    ? `${matchingProjectSessions.value.length} of ${count}`
    : count
})

const navigatorTitle = computed(() => {
  if (props.navigator === 'activity') return 'Activity'
  return 'Go to'
})

const navigatorSubtitle = computed(() => {
  if (props.navigator === 'activity') {
    const count = activitySessions.value.length
    return `${count} other ${count === 1 ? 'session' : 'sessions'}`
  }
  return 'Sessions and projects'
})

watch(
  [
    () => currentProject.value?.cwd || '',
    sessionQuery,
    pinnedOnly,
    () => props.activeBackendConnection?.id || '',
    () => props.activeBackendConnection?.url || '',
  ],
  async ([cwd], [previousCwd] = []) => {
    finishSessionFolds()
    pendingPinFocusId = null
    closeSessionActions()
    if (cwd !== previousCwd) sessionQuery.value = ''
    sessionScrollTop.value = 0
    await nextTick()
    if (sessionScroll.value) sessionScroll.value.scrollTop = 0
    updateSessionViewport()
  },
)

watch(
  [
    () => props.selectedSessionId,
    () => currentProject.value?.cwd || '',
    () => orderedProjectSessions.value.length,
    () => props.pinnedVersion,
    () => sessionListItems.value.some((item) => {
      return item.type === 'session-child'
        && item.session.id === props.selectedSessionId
    }),
  ],
  async () => {
    await nextTick()
    scrollSelectedSessionIntoView()
  },
)

watch(() => props.selectedSessionId, () => {
  finishSessionFolds()
  closeSessionActions()
})

watch(
  () => props.pinnedVersion,
  async () => {
    if (!pendingPinFocusId) return
    if (document.activeElement
      && document.activeElement !== document.body) {
      pendingPinFocusId = null
      return
    }
    const id = pendingPinFocusId
    pendingPinFocusId = null
    await nextTick()
    const index = orderedProjectSessions.value.findIndex((session) => {
      return session.id === id
    })
    if (index < 0) {
      if (pinnedOnly.value) pinFilter.value?.focus({ preventScroll: true })
      return
    }
    scrollSessionIntoView(index)
    await nextTick()
    if (document.activeElement
      && document.activeElement !== document.body) return
    const row = sessionScroll.value?.querySelector(
      `[data-session-id="${CSS.escape(id)}"]`,
    )
    if (!row) return
    const actionButton = row.querySelector('.session-row-actions-button')
    const pinButton = actionButton?.getClientRects().length
      ? actionButton : row.querySelector('.session-pin-button')
    pinButton?.focus({ preventScroll: true })
    if (document.activeElement !== pinButton) {
      row.querySelector('.session-link')?.focus({ preventScroll: true })
    }
  },
)

watch(
  () => props.pinsError,
  (error) => {
    if (error) pendingPinFocusId = null
  },
)

watch(sessionScroll, (element, previous) => {
  if (previous) sessionResizeObserver?.unobserve(previous)
  if (element) sessionResizeObserver?.observe(element)
  updateSessionViewport()
})

onMounted(() => {
  sessionFoldMedia = window.matchMedia('(prefers-reduced-motion: reduce)')
  sessionFoldMedia.addEventListener('change', finishSessionFolds)
  document.addEventListener('click', closeMenusOnOutsideClick)
  sessionResizeObserver = new ResizeObserver(updateSessionViewport)
  if (sessionScroll.value) sessionResizeObserver.observe(sessionScroll.value)
  updateSessionViewport()
})

onUnmounted(() => {
  finishSessionFolds()
  sessionFoldMedia?.removeEventListener('change', finishSessionFolds)
  document.removeEventListener('click', closeMenusOnOutsideClick)
  sessionResizeObserver?.disconnect()
})

function parentProjectCwdForSelected() {
  const selected = props.selectedSession
  const parentPath = selected?.parentSessionPath
  if (!selected?.isSubagentSession || !parentPath) return ''
  for (const project of props.visibleProjects) {
    if ((project.sessions || []).some((session) => session.path === parentPath)) {
      return project.cwd
    }
  }
  return ''
}

function sidebarRootCwdForSelected() {
  return parentProjectCwdForSelected()
    || props.selectedSession?.cwd
    || props.newSessionCwd
    || ''
}



function updateSessionViewport() {
  if (!sessionScroll.value) return
  sessionViewportHeight.value = sessionScroll.value.clientHeight
}

function updateSessionScroll(event) {
  sessionScrollTop.value = event.currentTarget.scrollTop
}

function scrollSelectedSessionIntoView() {
  const index = orderedProjectSessions.value.findIndex((session) => {
    return session.id === props.selectedSessionId
  })
  if (index >= 0) {
    scrollSessionIntoView(index)
    return
  }
  const child = sessionListItems.value.find((item) => {
    return item.type === 'session-child'
      && item.session.id === props.selectedSessionId
  })
  scrollItemIntoView(child)
}

function scrollSessionIntoView(index) {
  if (index < 0) return
  const item = sessionListItems.value.find((candidate) => {
    return candidate.type === 'session' && candidate.sessionIndex === index
  })
  scrollItemIntoView(item)
}

function scrollItemIntoView(item) {
  const element = sessionScroll.value
  if (!element || !item) return
  const top = item.top
  const bottom = top + item.height
  if (top < element.scrollTop) element.scrollTop = top
  else if (bottom > element.scrollTop + element.clientHeight) {
    element.scrollTop = bottom - element.clientHeight
  }
  sessionScrollTop.value = element.scrollTop
}

async function moveSessionFocus(item, direction) {
  const rows = sessionListItems.value.filter((row) => {
    return row.type === 'session' || (row.type === 'session-child'
      && !row.collapsing && row.height >= SESSION_CHILD_ROW_HEIGHT)
  })
  const index = rows.findIndex((row) => row.key === item.key)
  const target = rows[index + direction]
  if (!target) return
  scrollItemIntoView(target)
  await nextTick()
  const row = sessionScroll.value?.querySelector(
    `[data-session-id="${CSS.escape(target.session.id)}"]`,
  )
  row?.querySelector('.session-link, .session-child-link')?.focus()
}

function closeMenusOnOutsideClick(event) {
  if (!backendMenu.value?.contains(event.target)) backendMenuOpen.value = false
  if (props.navigator === 'actions'
    && !projectControl.value?.contains(event.target)) {
    closeNavigator()
  }
}

function openNavigator(navigator, event) {
  navigatorOpener.value = event?.currentTarget instanceof HTMLElement
    ? event.currentTarget : document.activeElement
  navigatorSearchFocus.value = event
    ? event.type === 'keydown' || event.detail === 0 || (event.pointerType !== 'touch'
      && !window.matchMedia('(hover: none), (pointer: coarse)').matches)
    : null
  navigatorQuery.value = ''
  backendMenuOpen.value = false
  closeSessionActions()
  emit('update:navigator', navigator)
}

function closeNavigator() {
  if (props.navigator === 'actions') navigatorOpener.value?.focus({ preventScroll: true })
  emit('update:navigator', '')
}

function openSessionActions(session, event) {
  sessionActionOpener.value = event.currentTarget
  sessionActionTarget.value = session
  backendMenuOpen.value = false
}

function closeSessionActions() {
  sessionActionTarget.value = null
}

defineExpose({ openNavigator, closeSessionActions, sessionActionsOpen })

function isNewWindowClick(event) {
  return Boolean(
    event && (event.metaKey || event.ctrlKey || event.button === 1),
  )
}

function selectBackend(connection, event) {
  if (props.backendConnectionBusyId) return
  if (!isNewWindowClick(event)) backendMenuOpen.value = false
  emit('select-backend', connection, event)
}

function openBackendSettings() {
  backendMenuOpen.value = false
  closeNavigator()
  emit('open-settings', 'connections')
}

function selectProject(project, event) {
  const lastSessionId = lastSessionByProject.get(project.cwd)
  const target = project.sessions.find((session) => {
    return session.id === lastSessionId
  }) || project.sessions[0]
  const newWindow = isNewWindowClick(event)
  if (!newWindow) closeNavigator()
  if (target?.id === props.selectedSessionId && !newWindow) return
  if (target) emit('select-session', target, event)
  else emit('select-project', project, event)
}

function selectNavigatorSession(session, event) {
  if (!isNewWindowClick(event)) closeNavigator()
  emit('select-session', session, event)
}

function interruptActivitySession(item) {
  if (!item.canStop || props.interruptingSessionId) return
  emit('interrupt-session', item.session)
}

function createCurrentProjectSession(event) {
  const project = currentProject.value
  if (!project || props.creatingSessionCwd === project.cwd) return
  if (!isNewWindowClick(event)) closeNavigator()
  emit('create-session', project, event)
}

function openProjectBrowser() {
  closeNavigator()
  emit('open-project-browser', currentProject.value?.cwd || '')
}

function openCurrentProjectDetail() {
  const project = currentProject.value
  if (!project) return
  closeNavigator()
  emit('open-project-detail', project)
}

function requestCurrentProjectDelete() {
  const project = currentProject.value
  if (!project) return
  closeNavigator()
  emit('request-delete-project', project)
}

function isRenaming(session) {
  return props.renamingSessionId === session.id
    && props.renamingSessionSource === 'sidebar'
}

function isPinned(session) {
  return props.pinnedSessionIds.has(session.id)
}

function isPinPending(session) {
  return props.pinPendingIds.has(session.id)
}

function togglePin(session) {
  if (!props.pinsReady || isPinPending(session)) return
  pendingPinFocusId = session.id
  emit('toggle-pin-session', session)
}

function beginRename(session) {
  emit('begin-rename-session', session, 'sidebar')
}

function sessionDate(session) {
  const value = session?.modified || session?.timestamp
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function calendarDay(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS
}

function daysBefore(date, now = new Date()) {
  return Math.floor(calendarDay(now) - calendarDay(date))
}

function sessionActivityDay(session) {
  const date = sessionDate(session)
  return date ? calendarDay(date) : -Infinity
}

function sessionTimeGroup(session, now) {
  const date = sessionDate(session)
  if (!date) return { key: 'earlier', label: 'Earlier' }
  const days = daysBefore(date, now)
  if (days <= 0) return { key: 'today', label: 'Today' }
  if (days === 1) return { key: 'yesterday', label: 'Yesterday' }
  if (days < 7) return { key: 'week', label: 'Past 7 days' }
  const year = date.getFullYear()
  const month = date.getMonth()
  const currentYear = year === now.getFullYear()
  return {
    key: `month:${year}-${month}`,
    label: currentYear
      ? sessionMonthFormat.format(date)
      : sessionMonthYearFormat.format(date),
  }
}

function sessionListTime(session) {
  const date = sessionDate(session)
  if (!date) return 'new'
  const days = daysBefore(date)
  if (days <= 1) return sessionClockFormat.format(date)
  if (days < 7) return sessionWeekdayFormat.format(date)
  return sessionDayFormat.format(date)
}

function sessionDateTime(session) {
  return sessionDate(session)?.toISOString() || ''
}

function sessionFullTime(session) {
  const date = sessionDate(session)
  return date ? sessionFullFormat.format(date) : 'New session'
}

function sessionItemIndexAt(items, offset) {
  let low = 0
  let high = items.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const item = items[middle]
    if (item.top + item.height <= offset) low = middle + 1
    else high = middle
  }
  return low
}

function projectResultMeta(project) {
  const count = project.sessions.length
  const relative = sessionTime(project)
  return [
    `${count} ${count === 1 ? 'session' : 'sessions'}`,
    relative || 'new',
  ].join(' · ')
}

function statusFor(session) {
  return props.sessionStatus(session.id) || { label: '', tone: '' }
}

function childrenForSession(session) {
  if (!session?.path || session.isSubagentSession) return []
  return props.subagentChildrenByParentPath.get(session.path) || []
}

function childTitle(child) {
  return child.name || child.label || props.sessionTitle(child)
}

function childIsLive(child) {
  return ['running', 'compacting', 'queued'].includes(statusFor(child).tone)
}

function visibleChildrenFor(session) {
  const searched = searchedChildren.value.get(session.path)
  if (searched) return searched
  return sessionQuery.value.trim() ? [] : childrenForSession(session)
}

function parentIsExpanded(session) {
  if (!childrenForSession(session).length) return false
  if (sessionQuery.value.trim()) return visibleChildrenFor(session).length > 0
  const override = expandedParentOverrides.value.get(session.path)
  if (override !== undefined) return override
  return autoExpandedParents.value.has(session.path)
    || childrenForSession(session).some((child) => {
      return child.id === props.selectedSessionId || childIsLive(child)
    })
}

watch(
  () => {
    const paths = []
    for (const [path, children] of props.subagentChildrenByParentPath) {
      if (children.some((child) => child.id === props.selectedSessionId || childIsLive(child))) {
        paths.push(path)
      }
    }
    return paths
  },
  (paths) => {
    if (paths.every((path) => autoExpandedParents.value.has(path))) return
    autoExpandedParents.value = new Set([...autoExpandedParents.value, ...paths])
  },
  { immediate: true },
)

function childrenToggleLabel(session) {
  const count = childrenForSession(session).length
  const action = parentIsExpanded(session) ? 'Hide' : 'Show'
  return `${action} ${count} subagent ${count === 1 ? 'session' : 'sessions'} for ${props.sessionTitle(session)}`
}

function toggleSessionChildren(session) {
  const expanded = parentIsExpanded(session)
  const from = sessionFolds.value.get(session.path)?.progress ?? Number(expanded)
  const to = Number(!expanded)
  const next = new Map(expandedParentOverrides.value)
  next.set(session.path, !expanded)
  expandedParentOverrides.value = next
  if (sessionFoldMedia?.matches) {
    finishSessionFolds()
    return
  }
  const folds = new Map(sessionFolds.value)
  if (from === to) folds.delete(session.path)
  else folds.set(session.path, {
    from,
    to,
    progress: from,
    startedAt: performance.now(),
    duration: SESSION_FOLD_DURATION * Math.abs(to - from),
  })
  sessionFolds.value = folds
  if (!sessionFoldFrame && folds.size) {
    sessionFoldFrame = requestAnimationFrame(animateSessionFolds)
  }
}

function animateSessionFolds(now) {
  const next = new Map()
  for (const [path, fold] of sessionFolds.value) {
    const progress = Math.max(0, Math.min(1, (now - fold.startedAt) / fold.duration))
    if (progress >= 1) continue
    const eased = 1 - Math.pow(1 - progress, 3)
    next.set(path, {
      ...fold,
      progress: fold.from + (fold.to - fold.from) * eased,
    })
  }
  sessionFolds.value = next
  sessionFoldFrame = next.size ? requestAnimationFrame(animateSessionFolds) : 0
}

function finishSessionFolds() {
  cancelAnimationFrame(sessionFoldFrame)
  sessionFoldFrame = 0
  sessionFolds.value = new Map()
}

function countLabel(count, label) {
  return count ? `${count} ${label}` : ''
}

function navigationScore(values, query) {
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean)
  let total = 0
  for (const term of terms) {
    let best = 0
    for (const value of values) {
      const text = String(value || '').toLowerCase()
      if (text === term) best = Math.max(best, 1000)
      else if (text.startsWith(term)) best = Math.max(best, 800)
      else if (text.includes(` ${term}`)
        || text.includes(`/${term}`)
        || text.includes(`-${term}`)) best = Math.max(best, 650)
      else if (text.includes(term)) best = Math.max(best, 500)
    }
    if (!best) return 0
    total += best
  }
  return total
}

function sessionTimestamp(session) {
  const time = new Date(session?.modified || session?.timestamp || 0).getTime()
  return Number.isNaN(time) ? 0 : time
}

const vFocusSelect = {
  mounted(el) {
    requestAnimationFrame(() => {
      el.focus()
      el.select()
    })
  },
}
</script>

<template>
  <aside class="sidebar project-sidebar">
    <template v-if="visibleProjects.length === 0
      && (sessionsLoading || sessionsHydrating)">
      <div
        class="sidebar-project-header sidebar-project-header-skeleton"
        aria-hidden="true"
      >
        <div class="sidebar-project-control">
          <div class="sidebar-project-identity">
            <span class="skeleton-line project-name-skeleton"></span>
            <span class="skeleton-line project-path-skeleton"></span>
          </div>
        </div>
        <div class="skeleton-line session-search-skeleton"></div>
      </div>
      <section class="project-session-section" aria-hidden="true">
        <div class="project-session-heading">
          <span>Sessions</span>
          <span>…</span>
        </div>
        <div ref="sessionScroll" class="project-session-scroll">
          <div class="project-session-skeleton">
            <template
              v-for="item in sessionSkeletonItems"
              :key="item.key"
            >
              <div
                v-if="item.type === 'group'"
                class="session-skeleton-group"
                :class="[
                  `variant-${item.variant}`,
                  { 'has-separator': item.separator },
                ]"
              >
                <span class="skeleton-line"></span>
              </div>
              <div
                v-else
                class="session-skeleton-row"
                :class="`variant-${item.variant}`"
              >
                <span
                  class="skeleton-line session-skeleton-title"
                ></span>
                <span
                  class="skeleton-line session-skeleton-meta"
                ></span>
              </div>
            </template>
          </div>
        </div>
      </section>
      <div
        class="sidebar-project-shortcuts sidebar-project-shortcuts-skeleton"
        aria-hidden="true"
      >
        <div v-for="index in 3" :key="index" class="sidebar-project-shortcut">
          <span class="skeleton-line shortcut-icon-skeleton"></span>
          <span>
            <span class="skeleton-line shortcut-title-skeleton"></span>
            <span class="skeleton-line shortcut-detail-skeleton"></span>
          </span>
        </div>
      </div>
    </template>

    <template v-else-if="currentProject">
      <div class="sidebar-project-header">
        <div ref="projectControl" class="sidebar-project-control">
          <div class="sidebar-project-identity">
            <strong>{{ currentProject.name }}</strong>
            <small :title="currentProject.cwd">{{ currentProject.cwd }}</small>
          </div>
          <button
            class="sidebar-project-more"
            type="button"
            title="Project actions"
            aria-label="Project actions"
            :aria-expanded="navigator === 'actions'"
            @click="openNavigator(
              navigator === 'actions' ? '' : 'actions',
              $event,
            )"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1"></circle>
              <circle cx="8" cy="8" r="1"></circle>
              <circle cx="12.5" cy="8" r="1"></circle>
            </svg>
          </button>
          <div
            v-if="navigator === 'actions'"
            class="sidebar-project-action-menu"
          >
            <button
              type="button"
              @click="openCurrentProjectDetail"
            >Project settings</button>
            <button
              class="destructive"
              type="button"
              :disabled="deletingProjectCwd === currentProject.cwd"
              @click="requestCurrentProjectDelete"
            >{{ deletingProjectCwd === currentProject.cwd ? 'Trashing…' : 'Trash project' }}</button>
          </div>
        </div>
        <div class="search-field sidebar-session-search">
          <svg
            class="sidebar-session-search-icon"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.25"></circle>
            <path d="M10.2 10.2l3.3 3.3"></path>
          </svg>
          <input
            v-model="sessionQuery"
            type="text"
            :placeholder="pinnedOnly ? 'Search pinned sessions' : 'Search sessions'"
            :aria-label="pinnedOnly
              ? 'Search pinned sessions in this project'
              : 'Search sessions in this project'"
          />
          <div class="sidebar-session-search-actions">
            <button
              v-if="sessionQuery"
              type="button"
              aria-label="Clear session search"
              @click="sessionQuery = ''"
            >×</button>
            <button
              ref="pinFilter"
              class="sidebar-pin-filter"
              type="button"
              aria-label="Show pinned sessions only"
              :aria-pressed="pinnedOnly"
              :title="pinnedOnly ? 'Show all sessions' : 'Show pinned sessions only'"
              @click="pinnedOnly = !pinnedOnly"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path class="pin-head" d="m10 2 4 4-3 1-2 2v3L4 7h3l2-2z"></path>
                <path d="m6.5 9.5-4 4"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <section class="project-session-section">
        <div class="project-session-heading">
          <span>Sessions</span>
          <span>{{ projectSessionCount }}</span>
        </div>
        <div
          ref="sessionScroll"
          class="project-session-scroll"
          @scroll.passive="updateSessionScroll"
        >
          <div v-if="pinsError" class="sidebar-note error-note">
            {{ pinsError }}
            <button type="button" @click="emit('retry-pins')">Retry</button>
          </div>
          <div v-if="sessionsError" class="sidebar-note error-note">
            {{ sessionsError }}
            <button type="button" @click="emit('retry-sessions')">Retry</button>
          </div>
          <div
            v-else-if="currentProjectSessions.length === 0
              && sessionsHydrationError"
            class="sidebar-note error-note"
          >
            Session history unavailable
            <button type="button" @click="emit('retry-sessions')">Retry</button>
          </div>
          <div
            v-else-if="sessionsHydrated && currentProjectSessions.length === 0"
            class="sidebar-note project-session-empty"
          >
            No sessions in this project
          </div>
          <div
            v-else-if="pinnedOnly && !pinsReady"
            class="sidebar-note project-session-empty"
          >
            {{ pinsError ? 'Pinned sessions unavailable' : 'Loading pinned sessions…' }}
          </div>
          <div
            v-else-if="sessionsHydrated && pinnedOnly
              && filteredProjectSessions.length === 0"
            class="sidebar-note project-session-empty"
          >
            No pinned sessions in this project
            <button type="button" @click="pinnedOnly = false">Show all sessions</button>
          </div>
          <div
            v-else-if="sessionsHydrated && matchingProjectSessions.length === 0"
            class="sidebar-note project-session-empty"
          >
            {{ pinnedOnly ? 'No matching pinned sessions' : 'No matching sessions' }}
          </div>
          <template v-else-if="matchingProjectSessions.length > 0">
            <div
              v-if="virtualSessionWindow.top"
              class="project-session-virtual-spacer"
              :style="{ height: `${virtualSessionWindow.top}px` }"
              aria-hidden="true"
            ></div>
            <template
              v-for="item in virtualSessionWindow.items"
              :key="item.key"
            >
              <div
                v-if="item.type === 'group'"
                class="session-time-heading"
                :class="{ 'has-separator': item.separator }"
                role="heading"
                aria-level="3"
              >
                {{ item.label }}
              </div>
              <div
                v-else-if="item.type === 'session'"
                class="session project-session-row"
                :data-session-id="item.session.id"
                :class="{
                  active: item.session.id === selectedSessionId,
                  'is-renaming': isRenaming(item.session),
                }"
              >
                <input
                  v-if="isRenaming(item.session)"
                  v-focus-select
                  class="session-title-input"
                  :value="renameDraft"
                  aria-label="Session name"
                  @click.stop
                  @input="emit('update:renameDraft', $event.target.value)"
                  @keydown.space.stop
                  @keydown.enter.stop.prevent="emit(
                    'commit-rename-session',
                    item.session,
                  )"
                  @keydown.esc.stop.prevent="emit('cancel-rename-session')"
                  @blur="isRenaming(item.session)
                    && emit('commit-rename-session', item.session)"
                />
                <template v-else>
                  <button
                    v-if="childrenForSession(item.session).length
                      && !sessionQuery.trim()"
                    class="session-children-toggle"
                    type="button"
                    :aria-expanded="parentIsExpanded(item.session)"
                    :aria-label="childrenToggleLabel(item.session)"
                    :title="parentIsExpanded(item.session)
                      ? 'Hide subagents'
                      : 'Show subagents'"
                    @click.stop="toggleSessionChildren(item.session)"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="m6 4 4 4-4 4"></path>
                    </svg>
                  </button>
                  <button
                    class="session-link"
                    type="button"
                    :aria-current="item.session.id === selectedSessionId
                      ? 'page'
                      : undefined"
                    @click="emit('select-session', item.session, $event)"
                    @auxclick.middle.prevent="emit(
                      'select-session',
                      item.session,
                      $event,
                    )"
                    @keydown.down.prevent="moveSessionFocus(item, 1)"
                    @keydown.up.prevent="moveSessionFocus(item, -1)"
                  >
                    <span class="session-title-with-kind">
                      <span
                        class="session-title"
                        :class="{ 'session-title-pending': sessionTitleGenerating(item.session.id) }"
                        :title="sessionTitleGenerating(item.session.id)
                          ? 'Generating title…'
                          : sessionTitle(item.session)"
                        aria-live="polite"
                        aria-atomic="true"
                        @dblclick.stop="beginRename(item.session)"
                      >{{ sessionTitleGenerating(item.session.id)
                        ? 'Generating title…'
                        : sessionTitle(item.session) }}</span>
                      <span
                        v-if="sessionTitleGenerating(item.session.id)"
                        class="session-title-spinner"
                        aria-hidden="true"
                      ></span>
                      <svg
                        v-if="item.session.research"
                        class="session-research-icon"
                        viewBox="0 0 16 16"
                        role="img"
                        aria-label="Research session"
                      >
                        <path d="M6 2h4M7 2v4l-3.5 6A1.3 1.3 0 0 0 4.6 14h6.8a1.3 1.3 0 0 0 1.1-2L9 6V2M5.5 10h5"></path>
                      </svg>
                    </span>
                    <span class="session-meta">
                      <svg
                        v-if="isPinned(item.session)"
                        class="session-pinned-icon"
                        viewBox="0 0 16 16"
                        role="img"
                        aria-label="Pinned session"
                      >
                        <path class="pin-head" d="m10 2 4 4-3 1-2 2v3L4 7h3l2-2z"></path>
                        <path d="m6.5 9.5-4 4"></path>
                      </svg>
                      <span
                        v-if="statusFor(item.session).label"
                        class="session-status"
                        :class="`status-${statusFor(item.session).tone}`"
                      >
                        {{ statusFor(item.session).label }}
                      </span>
                      <time
                        v-else
                        class="session-time"
                        :datetime="sessionDateTime(item.session)"
                        :title="sessionFullTime(item.session)"
                      >{{ sessionListTime(item.session) }}</time>
                    </span>
                  </button>
                  <button
                    class="session-row-actions-button"
                    type="button"
                    :aria-label="`Actions for ${sessionTitle(item.session)}`"
                    aria-haspopup="dialog"
                    :aria-expanded="sessionActionTarget?.id === item.session.id"
                    @click.stop="openSessionActions(item.session, $event)"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="3.5" cy="8" r="1"></circle>
                      <circle cx="8" cy="8" r="1"></circle>
                      <circle cx="12.5" cy="8" r="1"></circle>
                    </svg>
                  </button>
                  <div class="session-actions">
                    <button
                      class="session-pin-button"
                      type="button"
                      :title="isPinned(item.session)
                        ? 'Unpin session'
                        : 'Pin session'"
                      :aria-label="isPinned(item.session)
                        ? 'Unpin session'
                        : 'Pin session'"
                      :aria-pressed="isPinned(item.session)"
                      :disabled="!pinsReady || isPinPending(item.session)"
                      @click.stop="togglePin(item.session)"
                    >
                      <span v-if="isPinPending(item.session)">…</span>
                      <svg v-else viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M10.667 8V2.667h.667V1.333H4.667v1.333h.667V8l-1.333 1.333v1.333h3.467v4h1.067v-4H12V9.333z"></path>
                      </svg>
                    </button>
                    <button
                      class="session-rename-button"
                      type="button"
                      title="Rename session"
                      aria-label="Rename session"
                      :disabled="renamingSessionSavingId === item.session.id"
                      @click.stop="beginRename(item.session)"
                    >
                      <span
                        v-if="renamingSessionSavingId === item.session.id"
                      >…</span>
                      <svg v-else viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M10.8 2.8l2.4 2.4"></path>
                        <path d="M4 12l2.1-.4 6.2-6.2-1.7-1.7-6.2 6.2z"></path>
                      </svg>
                    </button>
                    <button
                      class="session-delete-button"
                      type="button"
                      title="Delete session"
                      aria-label="Delete session"
                      :disabled="deletingSessionId === item.session.id"
                      @click.stop="emit(
                        'request-delete-session',
                        item.session,
                      )"
                    >
                      <span v-if="deletingSessionId === item.session.id">…</span>
                      <svg v-else viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M3.5 4.5h9"></path>
                        <path d="M6.5 4.5v-2h3v2"></path>
                        <path d="M5 6.5l.5 6h5l.5-6"></path>
                        <path d="M7 7.5v4"></path>
                        <path d="M9 7.5v4"></path>
                      </svg>
                    </button>
                  </div>
                </template>
              </div>
              <div
                v-else
                class="session-child-row"
                :data-session-id="item.session.id"
                :class="{
                  active: item.session.id === selectedSessionId,
                  'is-folding': item.foldProgress !== undefined,
                  'is-last-child': item.lastChild,
                }"
                :style="item.foldProgress === undefined ? undefined : {
                  height: `${item.height}px`,
                  opacity: item.foldProgress,
                }"
                :inert="item.collapsing || item.height < SESSION_CHILD_ROW_HEIGHT"
                :aria-hidden="item.collapsing || item.height < SESSION_CHILD_ROW_HEIGHT
                  ? true
                  : undefined"
              >
                <button
                  class="session-child-link"
                  type="button"
                  :aria-current="item.session.id === selectedSessionId
                    ? 'page'
                    : undefined"
                  :title="item.session.agent
                    ? `${item.session.agent} subagent: ${childTitle(item.session)}`
                    : childTitle(item.session)"
                  @keydown.down.prevent="moveSessionFocus(item, 1)"
                  @keydown.up.prevent="moveSessionFocus(item, -1)"
                  @click="emit('select-child-session', item.session, $event)"
                  @auxclick.middle.prevent="emit(
                    'select-child-session',
                    item.session,
                    $event,
                  )"
                >
                  <span class="session-child-node" aria-hidden="true"></span>
                  <span
                    class="session-child-title"
                  >{{ childTitle(item.session) }}</span>
                  <span
                    v-if="statusFor(item.session).label"
                    class="session-status"
                    :class="`status-${statusFor(item.session).tone}`"
                  >{{ statusFor(item.session).label }}</span>
                  <time
                    v-else
                    class="session-time"
                    :datetime="sessionDateTime(item.session)"
                    :title="sessionFullTime(item.session)"
                  >{{ sessionListTime(item.session) }}</time>
                </button>
                <button
                  class="session-child-delete"
                  type="button"
                  title="Delete subagent session"
                  :aria-label="`Delete ${sessionTitle(item.session)}`"
                  :disabled="deletingSessionId === item.session.id"
                  @click.stop="emit('request-delete-session', item.session)"
                >
                  <span v-if="deletingSessionId === item.session.id">…</span>
                  <svg v-else viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.5 4.5h9"></path>
                    <path d="M6.5 4.5v-2h3v2"></path>
                    <path d="M5 6.5l.5 6h5l.5-6"></path>
                    <path d="M7 7.5v4"></path>
                    <path d="M9 7.5v4"></path>
                  </svg>
                </button>
              </div>
            </template>
            <div
              v-if="virtualSessionWindow.bottom"
              class="project-session-virtual-spacer"
              :style="{ height: `${virtualSessionWindow.bottom}px` }"
              aria-hidden="true"
            ></div>
          </template>
          <div
            v-if="!sessionsHydrated && !sessionsHydrationError && !sessionsError"
            class="project-session-skeleton"
            :class="{ 'has-session-rows': matchingProjectSessions.length > 0 }"
            aria-hidden="true"
          >
            <template v-for="item in sessionSkeletonItems" :key="item.key">
              <div
                v-if="item.type === 'group'"
                class="session-skeleton-group"
                :class="[
                  `variant-${item.variant}`,
                  { 'has-separator': item.separator },
                ]"
              >
                <span class="skeleton-line"></span>
              </div>
              <div
                v-else
                class="session-skeleton-row"
                :class="`variant-${item.variant}`"
              >
                <span class="skeleton-line session-skeleton-title"></span>
                <span class="skeleton-line session-skeleton-meta"></span>
              </div>
            </template>
          </div>
          <div
            v-if="currentProjectSessions.length > 0
              && sessionsHydrationError"
            class="sidebar-note error-note session-hydration-error"
          >
            Session history unavailable
            <button type="button" @click="emit('retry-sessions')">Retry</button>
          </div>
        </div>
      </section>

      <div class="sidebar-project-shortcuts">
        <button
          class="sidebar-project-shortcut"
          type="button"
          aria-keyshortcuts="Meta+Shift+A Control+Shift+A"
          @click="openNavigator('activity', $event)"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M1.5 8h3l1.8-4 3.4 8 1.8-4h3"></path>
          </svg>
          <span>
            <strong>{{ activitySummary }}</strong>
            <small>Activity</small>
          </span>
          <kbd class="sidebar-project-shortcut-key" aria-hidden="true">{{ activityShortcutLabel }}</kbd>
        </button>
        <button
          class="sidebar-project-shortcut"
          type="button"
          aria-keyshortcuts="Meta+K Control+K"
          @click="openNavigator('quick', $event)"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M2.2 5.2c0-1 .8-1.8 1.8-1.8h2l1.6 1.8h4.6c1 0 1.8.8 1.8 1.8v4.6c0 1-.8 1.8-1.8 1.8H4c-1 0-1.8-.8-1.8-1.8z"
            ></path>
          </svg>
          <span>
            <strong>Go to</strong>
            <small>Projects and sessions</small>
          </span>
          <kbd class="sidebar-project-shortcut-key" aria-hidden="true">{{ quickSwitchShortcutLabel }}</kbd>
        </button>
        <button
          class="sidebar-project-shortcut"
          type="button"
          :disabled="creatingSessionCwd === currentProject.cwd"
          @click="createCurrentProjectSession"
          @auxclick.middle.prevent="createCurrentProjectSession"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3v10M3 8h10"></path>
          </svg>
          <span>
            <strong>{{ creatingSessionCwd === currentProject.cwd ? 'Creating…' : 'New session' }}</strong>
            <small>{{ currentProject.name }} · {{ activeBackendConnection?.name || 'Native backend' }}</small>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </template>

    <div
      v-else
      class="sidebar-note project-sidebar-empty"
      :class="{ 'error-note': !!sessionsError }"
    >
      {{ sessionsError || 'No projects found' }}
      <button v-if="sessionsError" type="button" @click="emit('retry-sessions')">
        Retry
      </button>
      <button v-else type="button" @click="openProjectBrowser">
        Open a folder
      </button>
    </div>

    <div class="sidebar-actions">
      <div ref="backendMenu" class="backend-switcher">
        <button
          class="backend-switcher-trigger"
          type="button"
          :title="activeBackendConnection?.url"
          :aria-expanded="backendMenuOpen"
          @click="backendMenuOpen = !backendMenuOpen"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="4" rx="1"></rect>
            <rect x="2.5" y="9.5" width="11" height="4" rx="1"></rect>
            <path d="M5 4.5h.01M5 11.5h.01"></path>
          </svg>
          <span>
            <strong>{{ activeBackendConnection?.name || 'Native backend' }}</strong>
            <small>{{ backendDisplayAddress(activeBackendConnection) }}</small>
          </span>
          <svg class="backend-switcher-caret" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 6.5l3 3 3-3"></path>
          </svg>
        </button>

        <div v-if="backendMenuOpen" class="backend-switcher-menu">
          <span class="backend-switcher-heading">Backends</span>
          <button
            v-for="connection in backendConnections"
            :key="connection.id"
            type="button"
            :class="{ active: connection.id === activeBackendConnection?.id }"
            :disabled="!!backendConnectionBusyId"
            @click="selectBackend(connection, $event)"
            @auxclick.middle.prevent="selectBackend(connection, $event)"
          >
            <span>
              <strong>{{ connection.name }}</strong>
              <small>
                {{ backendDisplayAddress(connection) }}
                <template v-if="connection.id === defaultBackendConnectionId"> · default</template>
              </small>
            </span>
            <span v-if="connection.id === activeBackendConnection?.id">✓</span>
            <span v-else-if="backendConnectionBusyId === connection.id">…</span>
          </button>
          <span v-if="backendConnectionError" class="backend-switcher-error">
            {{ backendConnectionError }}
          </span>
          <button type="button" class="backend-switcher-manage" @click="openBackendSettings">
            Manage backends
          </button>
        </div>
      </div>

      <div class="sidebar-action-buttons">
        <button
          v-if="tracingAvailable"
          class="settings-button sidebar-traces-button"
          :class="{ active: tracesOpen }"
          type="button"
          title="Trace explorer"
          aria-label="Trace explorer"
          :aria-pressed="tracesOpen"
          @click="emit('open-traces', $event)"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 3h4M2 8h8M2 13h12M6 1v4M10 6v4M14 11v4" /></svg>
        </button>
        <button
          class="settings-button"
          type="button"
          title="Reload runtime"
          aria-label="Reload runtime"
          :disabled="!selectedSession || agentRunning || reloadingSession"
          @click="emit('reload-session')"
        >{{ reloadingSession ? '…' : '↻' }}</button>
        <button
          class="settings-button"
          type="button"
          title="Settings"
          aria-label="Open settings"
          @click="emit('open-settings')"
        >⚙</button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="sessionActionTarget"
        class="session-actions-backdrop"
        @click.self="closeSessionActions"
      >
        <section
          ref="sessionActionDialog"
          class="session-actions-menu"
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-actions-title"
          tabindex="-1"
          @keydown.esc.stop.prevent="closeSessionActions"
        >
          <header>
            <strong id="session-actions-title">{{ sessionTitle(sessionActionTarget) }}</strong>
            <button type="button" aria-label="Close session actions" @click="closeSessionActions">×</button>
          </header>
          <button
            type="button"
            :disabled="!pinsReady || isPinPending(sessionActionTarget)"
            @click="togglePin(sessionActionTarget); closeSessionActions()"
          >{{ isPinned(sessionActionTarget) ? 'Unpin session' : 'Pin session' }}</button>
          <button
            type="button"
            :disabled="renamingSessionSavingId === sessionActionTarget.id"
            @click="beginRename(sessionActionTarget); closeSessionActions()"
          >Rename session</button>
          <button
            class="destructive"
            type="button"
            :disabled="deletingSessionId === sessionActionTarget.id"
            @click="emit('request-delete-session', sessionActionTarget); closeSessionActions()"
          >Delete session</button>
        </section>
      </div>
      <div
        v-if="navigator === 'quick' || navigator === 'activity'"
        class="sidebar-navigator-backdrop"
        @mousedown.self="closeNavigator"
      >
        <section
          ref="navigatorDialog"
          class="sidebar-navigator-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sidebar-navigator-title"
          tabindex="-1"
        >
          <header class="sidebar-navigator-header">
            <div>
              <strong id="sidebar-navigator-title">{{ navigatorTitle }}</strong>
              <span>{{ navigatorSubtitle }}</span>
            </div>
            <div class="sidebar-navigator-header-actions">
              <button
                v-if="navigator === 'quick'"
                class="sidebar-navigator-add-project"
                type="button"
                @click="openProjectBrowser"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 3v10M3 8h10"></path>
                </svg>
                Add project
              </button>
              <button
                type="button"
                aria-label="Close"
                @click="closeNavigator"
              >×</button>
            </div>
          </header>
          <label class="sidebar-navigator-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref="navigatorSearch"
              v-model="navigatorQuery"
              :aria-label="navigator === 'activity' ? 'Search active sessions' : 'Search sessions or projects'"
              :placeholder="navigator === 'activity'
                ? 'Search active sessions'
                : 'Search sessions or projects'"
            />
            <kbd>esc</kbd>
          </label>

          <div class="sidebar-navigator-results">
            <template v-if="navigator === 'quick'">
              <section v-if="navigatorProjects.length" class="navigator-result-section">
                <div class="navigator-result-heading">
                  <span>Projects</span>
                  <span>{{ navigatorProjects.length }}</span>
                </div>
                <button
                  v-for="project in navigatorProjects"
                  :key="project.cwd"
                  class="sidebar-navigator-result"
                  :class="{ selected: project.cwd === currentProject.cwd }"
                  type="button"
                  @click="selectProject(project, $event)"
                  @auxclick.middle.prevent="selectProject(project, $event)"
                >
                  <span class="navigator-result-icon">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path
                        d="M2.2 5.2c0-1 .8-1.8 1.8-1.8h2l1.6 1.8h4.6c1 0 1.8.8 1.8 1.8v4.6c0 1-.8 1.8-1.8 1.8H4c-1 0-1.8-.8-1.8-1.8z"
                      ></path>
                    </svg>
                  </span>
                  <span>
                    <strong>{{ project.name }}</strong>
                    <small>{{ project.cwd }}</small>
                  </span>
                  <time>{{ projectResultMeta(project) }}</time>
                </button>
              </section>

              <section v-if="navigatorSessions.length" class="navigator-result-section">
                <div class="navigator-result-heading">
                  <span>{{ !navigatorQuery.trim()
                    ? 'Current and recent'
                    : 'Sessions' }}</span>
                  <span>{{ navigatorSessions.length }}</span>
                </div>
                <button
                  v-for="item in navigatorSessions"
                  :key="item.session.path || item.session.id"
                  class="sidebar-navigator-result"
                  type="button"
                  @click="selectNavigatorSession(item.session, $event)"
                  @auxclick.middle.prevent="selectNavigatorSession(
                    item.session,
                    $event,
                  )"
                >
                  <span class="navigator-result-icon">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3 3.5h10v7H7l-3.5 2v-2H3z"></path>
                    </svg>
                  </span>
                  <span>
                    <strong>{{ sessionTitle(item.session) }}</strong>
                    <small>{{ item.project.name }} · {{ item.project.cwd }}</small>
                  </span>
                  <time>{{ sessionTime(item.session) || 'new' }}</time>
                </button>
              </section>

              <div
                v-if="navigatorSessions.length === 0
                  && navigatorProjects.length === 0"
                class="sidebar-navigator-empty"
              >No matching projects or sessions</div>

            </template>

            <template v-else>
              <div
                v-for="item in sharedWorkingTrees"
                :key="item.project.cwd"
                class="activity-working-tree-warning"
                :title="item.project.cwd"
              >
                {{ item.sharedWorkingTreeCount }} active sessions share the
                <strong>{{ item.project.name }}</strong> working tree
              </div>

              <div
                v-if="activityActionError"
                class="activity-action-error"
                role="alert"
              >{{ activityActionError }}</div>

              <section
                v-for="group in activityGroups"
                :key="group.key"
                class="navigator-result-section"
              >
                <div class="navigator-result-heading">
                  <span>{{ group.label }}</span>
                  <span>{{ group.items.length }}</span>
                </div>
                <div
                  v-for="item in group.items"
                  :key="item.session.path || item.session.id"
                  class="sidebar-navigator-result activity-navigator-result"
                >
                  <span class="navigator-result-icon">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3 3.5h10v7H7l-3.5 2v-2H3z"></path>
                    </svg>
                  </span>
                  <span>
                    <strong>{{ sessionTitle(item.session) }}</strong>
                    <small
                      :title="`${item.project.cwd}${item.detail
                        ? ` · ${item.detail}`
                        : ''}`"
                    >
                      {{ item.project.name }}
                      <template v-if="item.detail"> · {{ item.detail }}</template>
                    </small>
                  </span>
                  <span
                    class="navigator-result-status"
                    :class="`status-${item.status.tone}`"
                  >{{ item.status.label }}</span>
                  <span class="activity-result-actions">
                    <button
                      type="button"
                      :aria-label="`Open ${sessionTitle(item.session)}`"
                      @click="selectNavigatorSession(item.session, $event)"
                      @auxclick.middle.prevent="selectNavigatorSession(
                        item.session,
                        $event,
                      )"
                    >Open</button>
                    <button
                      v-if="item.canStop"
                      class="activity-stop-button"
                      type="button"
                      :aria-label="`Stop ${sessionTitle(item.session)}`"
                      :disabled="!!interruptingSessionId"
                      @click="interruptActivitySession(item)"
                    >{{ interruptingSessionId === item.session.id
                      ? 'Stopping…'
                      : 'Stop' }}</button>
                  </span>
                </div>
              </section>

              <div
                v-if="activitySessions.length === 0"
                class="sidebar-navigator-empty"
              >No other session activity</div>
            </template>
          </div>
        </section>
      </div>
    </Teleport>
  </aside>
</template>

<style scoped>
.session-row-actions-button {
  display: none;
}

.session-actions-backdrop {
  position: fixed;
  inset: 0;
  z-index: 38;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgb(0 0 0 / 45%);
}

.session-actions-menu {
  display: grid;
  width: min(320px, 100%);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
  padding: 8px;
}

.session-actions-menu header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-left: 12px;
}

.session-actions-menu strong {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.session-actions-menu button {
  min-width: 44px;
  min-height: 44px;
  flex: none;
  border: 0;
  border-radius: 6px;
  background: transparent;
  padding: 10px 12px;
  color: var(--text);
  text-align: left;
}

.session-actions-menu button:hover,
.session-actions-menu button:focus-visible {
  background: var(--panel-soft);
}

.session-actions-menu button:disabled {
  opacity: 0.45;
}

.session-actions-menu .destructive {
  color: #fca5a5;
}

@media (hover: none), (pointer: coarse) {
  .project-session-row .session-actions {
    display: none;
  }

  .project-session-row.session .session-link {
    width: calc(100% - 36px);
    padding-right: 7px;
  }

  .project-session-row.session .session-time,
  .project-session-row.session .session-status {
    display: block;
  }

  .session-row-actions-button {
    position: absolute;
    top: 0;
    right: 0;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--muted-strong);
  }

  .session-row-actions-button svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }

  .session-row-actions-button:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: -2px;
  }

  .sidebar-session-search input,
  .sidebar-navigator-search input,
  .project-session-row .session-title-input {
    font-size: 16px;
  }
}
</style>
