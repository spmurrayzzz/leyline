import { backendHttpUrl } from './backend'

export function settingsApiBase() {
  return backendHttpUrl('/api/pi/settings')
}

async function request(path, { method = 'GET', body, baseUrl = settingsApiBase(), signal, keepalive } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    signal,
    keepalive,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const data = await response.json()
  if (!response.ok) throw Object.assign(new Error(data.error || 'Settings request failed'), { status: response.status })
  return data
}

function targetQuery(target, { refresh = false } = {}) {
  const query = new URLSearchParams()
  if (target?.sessionId) query.set('sessionId', target.sessionId)
  if (target?.cwd) query.set('cwd', target.cwd)
  if (refresh) query.set('refresh', '1')
  return query.size ? `?${query}` : ''
}

export const fetchProviderSettings = (target, options) => request(`/providers${targetQuery(target, options)}`)
export const saveProviderSettings = (target, body) => request('/providers', { method: 'PUT', body: { ...body, target } })
export const deleteProviderSettings = (target, body) => request('/providers', { method: 'DELETE', body: { ...body, target } })
export const saveModelSettings = (target, body) => request('/models', { method: 'PUT', body: { ...body, target } })
export const deleteModelSettings = (target, body) => request('/models', { method: 'DELETE', body: { ...body, target } })
export const runProviderSettingsAction = (target, body, baseUrl) => request('/providers/action', { method: 'POST', body: { ...body, target }, baseUrl })
export const fetchMcpSettings = () => request('/mcp')
export const saveMcpSettings = (body) => request('/mcp', { method: 'PUT', body })
export const deleteMcpSettings = (body) => request('/mcp', { method: 'DELETE', body })
export const runMcpSettingsAction = (body, baseUrl) => request('/mcp/action', { method: 'POST', body, baseUrl })
export const fetchSettingsOperation = (id, baseUrl, signal) => request(`/operations/${encodeURIComponent(id)}`, { baseUrl, signal })
export const answerSettingsOperation = (id, body, baseUrl) => request(`/operations/${encodeURIComponent(id)}`, { method: 'POST', body, baseUrl })
export const cancelSettingsOperation = (id, baseUrl) => request(`/operations/${encodeURIComponent(id)}`, { method: 'DELETE', baseUrl, keepalive: true })
