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

export async function activatePiSession(id) {
  const data = await apiRequest('/api/pi/active-session', 'Failed to activate session', {
    method: 'POST',
    body: { id },
  })
  return data.active
}

export function submitPrompt(text) {
  return apiRequest('/api/pi/prompt', 'Failed to submit prompt', {
    method: 'POST',
    body: { text },
  })
}

export function interruptPiSession() {
  return apiRequest('/api/pi/interrupt', 'Failed to stop run', {
    method: 'POST',
  })
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
