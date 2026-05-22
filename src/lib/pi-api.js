export async function fetchSessions() {
  const data = await apiRequest('/api/pi/sessions', 'Failed to load sessions')
  return data.sessions || []
}

export function createPiSession(cwd) {
  return apiRequest('/api/pi/sessions', 'Failed to create session', {
    method: 'POST',
    body: { cwd },
  })
}

export function fetchSessionDetail(id) {
  return apiRequest(`/api/pi/sessions/${id}`, 'Failed to load session')
}

export function fetchFsDirectory(path) {
  const query = path ? `?path=${encodeURIComponent(path)}` : ''
  return apiRequest(`/api/pi/fs${query}`, 'Failed to read folder')
}

export function deletePiSession(id) {
  return apiRequest(`/api/pi/sessions/${id}`, 'Failed to delete session', {
    method: 'DELETE',
  })
}

export async function activatePiSession(id) {
  const data = await apiRequest('/api/pi/active-session', 'Failed to activate session', {
    method: 'POST',
    body: { id },
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

export function submitPrompt(text, images = []) {
  return apiRequest('/api/pi/prompt', 'Failed to submit prompt', {
    method: 'POST',
    body: { text, images },
  })
}

export function interruptPiSession() {
  return apiRequest('/api/pi/interrupt', 'Failed to stop run', {
    method: 'POST',
  })
}

export async function reloadPiSession() {
  const data = await apiRequest('/api/pi/reload', 'Failed to reload', {
    method: 'POST',
  })
  return data.active
}

export async function switchPiModel(provider, id) {
  const data = await apiRequest('/api/pi/model', 'Failed to switch model', {
    method: 'POST',
    body: { provider, id },
  })
  return data.active
}

export async function switchPiThinkingLevel(level) {
  const data = await apiRequest(
    '/api/pi/thinking',
    'Failed to switch thinking',
    {
      method: 'POST',
      body: { level },
    },
  )
  return data.active
}

export async function switchPiMode(body) {
  const data = await apiRequest('/api/pi/mode', 'Failed to switch mode', {
    method: 'POST',
    body,
  })
  return data.active
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

  const response = await fetch(url, init)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || fallbackError)
  return data
}
