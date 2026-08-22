import { backendHttpUrl } from './backend'

export async function fetchProjects() {
  const data = await apiRequest('/api/pi/projects', 'Failed to load projects')
  return data.projects || []
}

export async function fetchSessions() {
  const data = await apiRequest('/api/pi/sessions', 'Failed to load sessions')
  return data.sessions || []
}

export function createPiSession(cwd, kind = 'session') {
  return apiRequest('/api/pi/sessions', 'Failed to create session', {
    method: 'POST',
    body: { cwd, kind },
  })
}

export function fetchSessionDetail(session) {
  const id = typeof session === 'string' ? session : session.id
  const path = typeof session === 'string' ? '' : session.path
  const params = new URLSearchParams({ compact: '1' })
  if (path) params.set('path', path)
  return apiRequest(
    `/api/pi/sessions/${encodeURIComponent(id)}?${params}`,
    'Failed to load session',
  )
}

export function fetchSessionDetailByPath(path) {
  const params = new URLSearchParams({ compact: '1', path })
  return apiRequest(
    `/api/pi/sessions/by-path?${params}`,
    'Failed to load session',
  )
}

export function fetchFsDirectory(path, cwd = '') {
  const params = new URLSearchParams()
  if (path) params.set('path', path)
  if (cwd) params.set('cwd', cwd)
  const query = params.toString() ? `?${params}` : ''
  return apiRequest(`/api/pi/fs${query}`, 'Failed to read folder')
}

export function fetchGitReview(cwd) {
  const params = new URLSearchParams({ cwd })
  return apiRequest(
    `/api/pi/review?${params}`,
    'Failed to load project changes',
  )
}

export function fetchGitReviewDiff(cwd, path) {
  const params = new URLSearchParams({ cwd, path })
  return apiRequest(
    `/api/pi/review/diff?${params}`,
    'Failed to load file diff',
  )
}

export function deletePiSession(id) {
  return apiRequest(
    `/api/pi/sessions/${encodeURIComponent(id)}`,
    'Failed to delete session',
    { method: 'DELETE' },
  )
}

export function deletePiProject(cwd) {
  return apiRequest(
    `/api/pi/projects/${encodeURIComponent(cwd)}`,
    'Failed to delete project',
    { method: 'DELETE' },
  )
}

export function renamePiSession(session, name) {
  const id = typeof session === 'string' ? session : session.id
  return apiRequest(
    `/api/pi/sessions/${encodeURIComponent(id)}`,
    'Failed to rename session',
    { method: 'PATCH', body: { name } },
  )
}

export async function activatePiSession(session) {
  const data = await apiRequest('/api/pi/active-session', 'Failed to activate session', {
    method: 'POST',
    body: typeof session === 'string' ? { id: session } : {
      id: session.id,
      path: session.path,
      cwd: session.cwd,
    },
  })
  return data.active
}

export async function fetchPiRuntimeState(cwd) {
  const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
  const data = await apiRequest(
    `/api/pi/state${query}`,
    'Failed to load runtime state',
  )
  return data.active
}

export function fetchSubagentConfigs(session) {
  const params = scopedSessionParams(session)
  return apiRequest(`/api/pi/subagents?${params}`, 'Failed to load subagents')
}

export function setSubagentModelOverride(session, agentKey, scope, model) {
  return apiRequest(
    `/api/pi/subagents/${encodeURIComponent(agentKey)}/model`,
    'Failed to update subagent',
    {
      method: 'PUT',
      body: scopedBody(session, { scope, model }),
    },
  )
}

export function clearSubagentModelOverride(session, agentKey, scope) {
  return apiRequest(
    `/api/pi/subagents/${encodeURIComponent(agentKey)}/model`,
    'Failed to reset subagent',
    {
      method: 'DELETE',
      body: scopedBody(session, { scope }),
    },
  )
}

export function fetchVisionConfig(session) {
  const params = scopedSessionParams(session)
  return apiRequest(`/api/pi/vision/config?${params}`, 'Failed to load vision config')
}

export function setVisionOverride(session, scope, model, thinking) {
  return apiRequest(
    '/api/pi/vision/override',
    'Failed to update vision agent',
    {
      method: 'PUT',
      body: scopedBody(session, { scope, model, thinking }),
    },
  )
}

export function clearVisionOverride(session, scope) {
  return apiRequest(
    '/api/pi/vision/override',
    'Failed to reset vision agent',
    {
      method: 'DELETE',
      body: scopedBody(session, { scope }),
    },
  )
}

export function fetchVisibleMemories(session) {
  const params = scopedSessionParams(session)
  return apiRequest(
    `/api/pi/memories?${params}`,
    'Failed to load memories',
  )
}

export function createPiMemory(session, scope, contentMd, tags = []) {
  return apiRequest('/api/pi/memories', 'Failed to create memory', {
    method: 'POST',
    body: scopedBody(session, { contentMd, scope, tags }),
  })
}

export function updatePiMemory(session, memoryId, contentMd, tags = []) {
  return apiRequest(
    `/api/pi/memories/${encodeURIComponent(memoryId)}`,
    'Failed to update memory',
    {
      method: 'PATCH',
      body: scopedBody(session, { contentMd, tags }),
    },
  )
}

export function setPiMemoryStatus(session, ids, status) {
  return apiRequest('/api/pi/memories/status', 'Failed to update memories', {
    method: 'POST',
    body: scopedBody(session, { ids, status }),
  })
}

export function deletePiMemories(session, ids) {
  return apiRequest('/api/pi/memories', 'Failed to delete memories', {
    method: 'DELETE',
    body: scopedBody(session, { ids }),
  })
}

export function submitPrompt(
  sessionId,
  text,
  images = [],
  streamingBehavior,
  kind,
) {
  return apiRequest(
    sessionActionUrl(sessionId, 'prompt'),
    'Failed to submit prompt',
    {
      method: 'POST',
      body: { text, images, streamingBehavior, kind },
    },
  )
}

export function runShellCommand(
  sessionId,
  command,
  excludeFromContext = false,
) {
  return apiRequest(
    sessionActionUrl(sessionId, 'bash'),
    'Failed to run shell command',
    {
      method: 'POST',
      body: { command, excludeFromContext },
    },
  )
}

export function compactPiSession(sessionId, customInstructions = '') {
  return apiRequest(
    sessionActionUrl(sessionId, 'compact'),
    'Failed to compact session',
    {
      method: 'POST',
      body: { customInstructions },
    },
  )
}

export function editPrompt(sessionId, entryId, text, images = []) {
  return apiRequest(
    sessionActionUrl(sessionId, 'edit-prompt'),
    'Failed to edit prompt',
    {
      method: 'POST',
      body: { entryId, text, images },
    },
  )
}

export function interruptPiSession(sessionId) {
  return apiRequest(
    sessionActionUrl(sessionId, 'interrupt'),
    'Failed to stop run',
    { method: 'POST' },
  )
}

export function forkPiSession(entryId) {
  return apiRequest('/api/pi/fork', 'Failed to fork session', {
    method: 'POST',
    body: { entryId },
  })
}

export function resetPiSession(entryId) {
  return apiRequest('/api/pi/reset-to-entry', 'Failed to reset session', {
    method: 'POST',
    body: { entryId },
  })
}

export function setEntryFeedback(session, entryId, label, feedbackText = '') {
  return apiRequest(
    `/api/pi/sessions/${encodeURIComponent(session.id)}/feedback`,
    'Failed to mark rollout',
    {
      method: 'POST',
      body: {
        cwd: session.cwd,
        entryId,
        feedbackText,
        label,
        sessionPath: session.sessionFile || session.path,
      },
    },
  )
}

export async function reloadPiSession(sessionId) {
  const data = await apiRequest(
    sessionActionUrl(sessionId, 'reload'),
    'Failed to reload',
    { method: 'POST' },
  )
  return data.active
}

export async function switchPiModel(sessionId, provider, id) {
  const data = await apiRequest(
    sessionActionUrl(sessionId, 'model'),
    'Failed to switch model',
    {
      method: 'POST',
      body: { provider, id },
    },
  )
  return data.active
}

export async function switchPiThinkingLevel(sessionId, level) {
  const data = await apiRequest(
    sessionActionUrl(sessionId, 'thinking'),
    'Failed to switch thinking',
    {
      method: 'POST',
      body: { level },
    },
  )
  return data.active
}

function scopedSessionParams(session) {
  const params = new URLSearchParams()
  if (session?.cwd) params.set('cwd', session.cwd)
  const path = session?.sessionFile || session?.path
  if (path) params.set('sessionPath', path)
  return params.toString()
}

function scopedBody(session, body) {
  return {
    ...body,
    cwd: session?.cwd || '',
    sessionPath: session?.sessionFile || session?.path || '',
  }
}

function sessionActionUrl(sessionId, action) {
  if (!sessionId) return `/api/pi/${action}`
  return `/api/pi/sessions/${encodeURIComponent(sessionId)}/${action}`
}

async function apiRequest(url, fallbackError, options = {}) {
  if (typeof fallbackError !== 'string') {
    options = fallbackError
    fallbackError = 'Request failed'
  }

  const init = { ...options }
  if (init.body && typeof init.body !== 'string') {
    init.headers = { 'Content-Type': 'application/json', ...init.headers }
    init.body = JSON.stringify(init.body)
  }

  const response = await fetch(backendHttpUrl(url), init)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || fallbackError)
  return data
}
