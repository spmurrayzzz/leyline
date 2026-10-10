import { json, readJson } from './http.js'
import { createMcpSettings } from './mcp-settings.js'
import { createProviderSettings } from './provider-settings.js'
import { isSettingsObject, settingsError } from './pi-config.js'
import {
  answerSettingsOperation,
  cancelSettingsOperation,
  getSettingsOperation,
} from './settings-operations.js'

function sendOperation(res, operation) {
  if (res.destroyed || res.writableEnded) return cancelSettingsOperation(operation.id)
  return json(res, operation)
}

export function createPiSettingsHandler(api) {
  const providers = createProviderSettings({ getRuntime: api.settingsRuntime, assertProviderRoutes: api.assertProviderRoutes })
  const mcp = createMcpSettings()
  return async (req, res, url) => {
    res.setHeader('Cache-Control', 'no-store')
    try {
      const target = {
        sessionId: url.searchParams.get('sessionId') || '',
        cwd: url.searchParams.get('cwd') || '',
      }
      const body = req.method === 'GET' ? {} : await readJson(req)
      if (!isSettingsObject(body)) throw settingsError('Expected a settings request object')
      const { target: bodyTarget = target, ...values } = body
      if (!isSettingsObject(bodyTarget)
        || Object.keys(bodyTarget).some((key) => !['sessionId', 'cwd'].includes(key))
        || Object.values(bodyTarget).some((value) => typeof value !== 'string')) {
        throw settingsError('Invalid settings target')
      }
      if (url.pathname === '/settings/providers') {
        if (req.method === 'GET') return json(res, await providers.list(target, { refresh: url.searchParams.get('refresh') === '1' }))
        if (req.method === 'PUT') return json(res, await providers.saveProvider(bodyTarget, values))
        if (req.method === 'DELETE') return json(res, await providers.deleteProvider(bodyTarget, values))
      } else if (url.pathname === '/settings/models') {
        if (req.method === 'PUT') return json(res, await providers.saveModel(bodyTarget, values))
        if (req.method === 'DELETE') return json(res, await providers.deleteModel(bodyTarget, values))
      } else if (url.pathname === '/settings/catalog/models' && req.method === 'GET') {
        return json(res, await providers.catalog(target, url.searchParams.get('q') || '', url.searchParams.get('refresh') === '1'))
      } else if (url.pathname === '/settings/providers/action' && req.method === 'POST') {
        return sendOperation(res, await providers.action(bodyTarget, values))
      } else if (url.pathname === '/settings/mcp') {
        if (req.method === 'GET') return json(res, await mcp.list())
        if (req.method === 'PUT') return json(res, await mcp.save(values))
        if (req.method === 'DELETE') return json(res, await mcp.remove(values))
      } else if (url.pathname === '/settings/mcp/action' && req.method === 'POST') {
        return sendOperation(res, await mcp.action(values))
      } else {
        const match = url.pathname.match(/^\/settings\/operations\/([^/]+)$/)
        if (match) {
          const id = decodeURIComponent(match[1])
          if (req.method === 'GET') return json(res, getSettingsOperation(id))
          if (req.method === 'POST') return json(res, answerSettingsOperation(id, body.promptId, body.value))
          if (req.method === 'DELETE') return json(res, cancelSettingsOperation(id))
        } else return json(res, { error: 'Not found' }, 404)
      }
      return json(res, { error: 'Method not allowed' }, 405)
    } catch (error) {
      return json(res, { error: error.message || 'Settings request failed' }, error.statusCode || 500)
    }
  }
}
