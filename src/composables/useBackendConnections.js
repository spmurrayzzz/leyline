import { computed, ref } from 'vue'
import {
  BUILTIN_BACKEND_CONNECTION_ID,
  backendDisplayAddress,
  builtInBackendConnection,
  setActiveBackendConnection,
} from '../lib/backend'
import {
  createBackendConnection,
  deleteBackendConnection,
  fetchBackendConnections,
  fetchBackendInfo,
  setDefaultBackendConnection,
  updateBackendConnection,
} from '../lib/leyline-api'

const ACTIVE_CONNECTION_KEY = 'leyline.activeBackendConnectionId'

export function useBackendConnections() {
  const connections = ref([builtInBackendConnection()])
  const activeConnectionId = ref(BUILTIN_BACKEND_CONNECTION_ID)
  const defaultConnectionId = ref(BUILTIN_BACKEND_CONNECTION_ID)
  const loading = ref(true)
  const error = ref('')
  const busyId = ref('')
  const testResult = ref(null)
  const activeConnectionInfo = ref(null)
  const activeConnection = computed(() => {
    return connectionForId(activeConnectionId.value) || connections.value[0]
  })
  const activeConnectionAddress = computed(() => {
    return backendDisplayAddress(activeConnection.value)
  })

  async function initialize() {
    loading.value = true
    error.value = ''
    const requestedId = consumeInitialConnectionId()

    try {
      applyRegistry(await fetchBackendConnections())
    } catch (loadError) {
      error.value = loadError.message
    }

    const storedId = readActiveConnectionId()
    const preferredId = requestedId || storedId || defaultConnectionId.value
    const resolvedId = connectionForId(preferredId)
      ? preferredId
      : connectionForId(defaultConnectionId.value)
        ? defaultConnectionId.value
        : BUILTIN_BACKEND_CONNECTION_ID
    applyActiveConnection(resolvedId)
    loading.value = false
  }

  async function createConnection(name, url) {
    return runOperation('new', async () => {
      const previousIds = new Set(connections.value.map((connection) => connection.id))
      applyRegistry(await createBackendConnection(name, url))
      return connections.value.find((connection) => !previousIds.has(connection.id))
    })
  }

  async function updateConnection(id, name, url) {
    return runOperation(id, async () => {
      const previous = connectionForId(id)
      applyRegistry(await updateBackendConnection(id, name, url))
      const connection = connectionForId(id)
      return {
        connection,
        requiresReconnect: id === activeConnectionId.value
          && previous?.url !== connection?.url,
      }
    })
  }

  async function removeConnection(id) {
    if (id === activeConnectionId.value) {
      throw new Error('Switch this window before removing its active backend')
    }
    return runOperation(id, async () => {
      applyRegistry(await deleteBackendConnection(id))
    })
  }

  async function setDefault(id) {
    return runOperation(id, async () => {
      applyRegistry(await setDefaultBackendConnection(id))
    })
  }

  async function testConnection(connection) {
    const id = connection.id || 'draft'
    busyId.value = id
    error.value = ''
    testResult.value = null
    try {
      const info = await fetchBackendInfo(connection)
      testResult.value = {
        id,
        message: `Connected to ${info.name} · API ${info.apiVersion}`,
      }
      return info
    } catch (testError) {
      error.value = testError.message
      throw testError
    } finally {
      busyId.value = ''
    }
  }

  async function activateConnection(id, { skipTest = false } = {}) {
    const connection = connectionForId(id)
    if (!connection) throw new Error('Backend connection not found')
    busyId.value = id
    error.value = ''
    testResult.value = null

    try {
      if (!skipTest) await fetchBackendInfo(connection)
      applyActiveConnection(id)
      window.location.replace(backendReloadPath())
    } catch (switchError) {
      error.value = switchError.message
      throw switchError
    } finally {
      busyId.value = ''
    }
  }

  async function inspectActiveConnection() {
    const info = await fetchBackendInfo(activeConnection.value)
    activeConnectionInfo.value = info
    return info
  }

  function clearResult() {
    error.value = ''
    testResult.value = null
  }

  function connectionForId(id) {
    return connections.value.find((connection) => connection.id === id)
  }

  function applyRegistry(registry) {
    connections.value = [
      builtInBackendConnection(),
      ...(registry.connections || []).map((connection) => ({
        ...connection,
        builtIn: false,
      })),
    ]
    defaultConnectionId.value = registry.defaultConnectionId
      || BUILTIN_BACKEND_CONNECTION_ID
  }

  function applyActiveConnection(id) {
    const connection = connectionForId(id) || connections.value[0]
    activeConnectionInfo.value = null
    activeConnectionId.value = connection.id
    setActiveBackendConnection(connection)
    writeActiveConnectionId(connection.id)
    window.__leylineBackendConnectionId = connection.id
  }

  async function runOperation(id, operation) {
    busyId.value = id
    error.value = ''
    testResult.value = null
    try {
      return await operation()
    } catch (operationError) {
      error.value = operationError.message
      throw operationError
    } finally {
      busyId.value = ''
    }
  }

  return {
    activeConnection,
    activeConnectionAddress,
    activeConnectionId,
    activeConnectionInfo,
    activateConnection,
    busyId,
    clearResult,
    connections,
    createConnection,
    defaultConnectionId,
    error,
    initialize,
    inspectActiveConnection,
    loading,
    removeConnection,
    setDefault,
    testConnection,
    testResult,
    updateConnection,
  }
}

function consumeInitialConnectionId() {
  const url = new URL(window.location.href)
  const id = url.searchParams.get('leylineBackendConnectionId')?.trim() || ''
  if (!id) return ''

  url.searchParams.delete('leylineBackendConnectionId')
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState({}, '', next)
  return id
}

function backendReloadPath() {
  const current = new URL(window.location.href)
  const cwd = current.searchParams.get('leylineNewSessionCwd')?.trim() || ''
  if (!cwd) return '/'
  return `/?leylineNewSessionCwd=${encodeURIComponent(cwd)}`
}

function readActiveConnectionId() {
  try {
    return window.sessionStorage.getItem(ACTIVE_CONNECTION_KEY) || ''
  } catch {
    return ''
  }
}

function writeActiveConnectionId(id) {
  try {
    window.sessionStorage.setItem(ACTIVE_CONNECTION_KEY, id)
  } catch {
  }
}
