export const RESEARCH_CUSTOM_TYPE = 'leyline-research'
export const RESEARCH_VERSION = 1
export const RESEARCH_PHASES = ['plan', 'gather', 'synthesize', 'report']

export function isResearchEntry(entry) {
  return entry?.type === 'custom'
    && entry.customType === RESEARCH_CUSTOM_TYPE
    && entry.data?.version === RESEARCH_VERSION
    && typeof entry.data?.sessionId === 'string'
}

export function isResearchSessionMarker(entry, sessionId = '') {
  if (!isResearchEntry(entry) || entry.data.kind !== 'session') return false
  return !sessionId || entry.data.sessionId === sessionId
}

export function researchStateFromEntries(entries, sessionId = '') {
  let state = null

  for (const entry of entries || []) {
    if (!isResearchEntry(entry)) continue
    const event = {
      ...entry.data,
      entryId: entry.id,
      timestamp: entry.timestamp,
    }

    if (event.kind === 'session') {
      if (sessionId && event.sessionId !== sessionId) continue
      state = initialResearchState(event)
      continue
    }

    if (!state || event.sessionId !== state.sessionId) continue
    state = applyResearchEvent(state, event)
  }

  return state ? finalizeResearchState(state) : null
}

export function researchStateFromSession(session) {
  const manager = session?.sessionManager
  if (!manager) return null
  return researchStateFromEntries(
    manager.getBranch?.() || manager.getEntries?.() || [],
    manager.getSessionId?.() || '',
  )
}

export function applyResearchEvent(state, event) {
  if (!state || event?.sessionId !== state.sessionId) return state
  if (event.kind === 'error' && state.status !== 'running') return state
  const next = {
    ...state,
    threads: state.threads.map((thread) => ({ ...thread })),
    sources: state.sources.map((source) => ({ ...source })),
    updatedAt: eventTime(event) || state.updatedAt,
    lastEventId: event.entryId || state.lastEventId,
  }

  if (event.kind === 'objective') {
    if (typeof event.objective === 'string' && event.objective.trim()) {
      next.objective = event.objective.trim()
    }
  }

  if (event.kind === 'plan') {
    next.phase = 'plan'
    next.status = 'running'
    next.strategy = cleanText(event.strategy, 2000)
    next.threads = normalizeThreads(event.threads)
  }

  if (event.kind === 'phase' && RESEARCH_PHASES.includes(event.phase)) {
    next.phase = event.phase
    next.status = event.status === 'error' ? 'error' : 'running'
    next.note = cleanText(event.note, 1000)
    if (typeof event.title === 'string' && event.title.trim()) {
      next.reportTitle = cleanText(event.title, 240)
    }
    if (Array.isArray(event.citedSourceIds)) {
      next.citedSourceIds = normalizeSourceIds(event.citedSourceIds)
    }
    if (event.phase === 'report') next.reportRequestedAt = eventTime(event)
  }

  if (event.kind === 'thread' && event.thread?.id) {
    const thread = normalizeThread(event.thread, next.threads.length)
    const index = next.threads.findIndex((item) => item.id === thread.id)
    if (index === -1) next.threads.push(thread)
    else next.threads[index] = { ...next.threads[index], ...thread }
  }

  if (event.kind === 'source' && event.source) {
    const source = normalizeSource(event.source, next.sources)
    if (source) {
      const index = next.sources.findIndex((item) => {
        return item.id === source.id || item.key === source.key
      })
      if (index === -1) next.sources.push(source)
      else next.sources[index] = { ...next.sources[index], ...source }
    }
  }

  if (event.kind === 'report' && event.reportEntryId) {
    next.phase = 'report'
    next.status = 'complete'
    next.reportEntryId = event.reportEntryId
    next.reportTitle = cleanText(event.title, 240) || next.reportTitle
    next.citedSourceIds = normalizeSourceIds(
      event.citedSourceIds || next.citedSourceIds,
    )
    next.completedAt = eventTime(event) || next.updatedAt
  }

  if (event.kind === 'error') {
    next.status = 'error'
    next.error = cleanText(event.message, 1000) || 'Research failed'
  }

  return finalizeResearchState(next)
}

export function compactResearchState(state) {
  if (!state) return null
  return {
    sessionId: state.sessionId,
    status: state.status,
    phase: state.phase,
    objective: state.objective,
    reportTitle: state.reportTitle,
    reportEntryId: state.reportEntryId,
    threadCount: state.threadCount,
    completedThreadCount: state.completedThreadCount,
    sourceCount: state.sourceCount,
    citedSourceCount: state.citedSourceCount,
    excludedSourceCount: state.excludedSourceCount,
    updatedAt: state.updatedAt,
  }
}

export function canonicalResearchSourceKey(source) {
  const url = safeSourceUrl(source?.url)
  if (url) {
    const parsed = new URL(url)
    parsed.hash = ''
    if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/$/, '')
    return `url:${parsed.toString()}`
  }
  const path = cleanText(source?.path, 2000).replace(/^\.\//, '')
  if (path) return `path:${path}`
  return ''
}

function initialResearchState(event) {
  const createdAt = eventTime(event) || Date.now()
  return finalizeResearchState({
    version: RESEARCH_VERSION,
    sessionId: event.sessionId,
    status: 'running',
    phase: 'plan',
    objective: cleanText(event.objective, 4000),
    strategy: '',
    note: '',
    threads: [],
    sources: [],
    reportTitle: '',
    reportEntryId: '',
    reportRequestedAt: 0,
    citedSourceIds: [],
    error: '',
    createdAt,
    updatedAt: createdAt,
    completedAt: 0,
    lastEventId: event.entryId || '',
  })
}

function finalizeResearchState(state) {
  const cited = new Set(normalizeSourceIds(state.citedSourceIds))
  const sources = state.sources
    .map((source) => ({
      ...source,
      status: source.status === 'excluded'
        ? 'excluded'
        : cited.has(source.id) ? 'cited' : 'candidate',
    }))
    .sort((a, b) => a.id - b.id)
  const completedThreadCount = state.threads.filter((thread) => {
    return thread.status === 'done' || thread.status === 'error'
  }).length

  return {
    ...state,
    threads: state.threads,
    sources,
    citedSourceIds: [...cited],
    threadCount: state.threads.length,
    completedThreadCount,
    sourceCount: sources.length,
    citedSourceCount: sources.filter((source) => source.status === 'cited').length,
    excludedSourceCount: sources.filter((source) => source.status === 'excluded').length,
  }
}

function normalizeThreads(threads) {
  if (!Array.isArray(threads)) return []
  return threads.slice(0, 12).map(normalizeThread)
}

function normalizeThread(thread, index = 0) {
  const fallback = `T${index + 1}`
  const status = ['queued', 'running', 'done', 'error'].includes(thread?.status)
    ? thread.status
    : 'queued'
  return {
    id: cleanText(thread?.id, 32) || fallback,
    title: cleanText(thread?.title, 240) || cleanText(thread?.task, 240) || fallback,
    task: cleanText(thread?.task, 4000),
    status,
    summary: cleanText(thread?.summary, 2000),
    sourceIds: normalizeSourceIds(thread?.sourceIds),
    childSession: normalizeChildSession(thread?.childSession),
    error: cleanText(thread?.error, 1000),
    startedAt: numericTime(thread?.startedAt),
    completedAt: numericTime(thread?.completedAt),
  }
}

function normalizeSource(source, existingSources) {
  const url = safeSourceUrl(source?.url)
  const key = canonicalResearchSourceKey({ ...source, url })
  if (!key) return null
  const existing = existingSources.find((item) => item.key === key)
  const requestedId = Number(source.id)
  const maxId = existingSources.reduce((max, item) => Math.max(max, item.id), 0)
  const requestedIdAvailable = Number.isInteger(requestedId)
    && requestedId > 0
    && !existingSources.some((item) => item.id === requestedId && item.key !== key)
  const id = existing?.id || (requestedIdAvailable ? requestedId : maxId + 1)
  const status = ['candidate', 'cited', 'excluded'].includes(source.status)
    ? source.status
    : existing?.status || 'candidate'
  return {
    id,
    key,
    url: url || existing?.url || '',
    path: cleanText(source.path, 2000) || existing?.path || '',
    title: cleanText(source.title, 500) || existing?.title || source.url || source.path || `Source ${id}`,
    publisher: cleanText(source.publisher, 240) || existing?.publisher || '',
    publishedAt: cleanText(source.publishedAt, 80) || existing?.publishedAt || '',
    kind: cleanText(source.kind, 80) || existing?.kind || 'web',
    status,
    threadIds: uniqueStrings([
      ...(existing?.threadIds || []),
      ...(Array.isArray(source.threadIds) ? source.threadIds : []),
      source.threadId,
    ], 32),
    claim: cleanText(source.claim, 1000) || existing?.claim || '',
    evidence: cleanText(source.evidence, 2000) || existing?.evidence || '',
    exclusionReason: cleanText(source.exclusionReason, 1000)
      || existing?.exclusionReason
      || '',
  }
}

function normalizeChildSession(session) {
  if (!session || typeof session !== 'object') return null
  const id = cleanText(session.id, 120)
  const path = cleanText(session.path, 2000)
  if (!id && !path) return null
  return {
    id,
    path,
    cwd: cleanText(session.cwd, 2000),
  }
}

function normalizeSourceIds(ids) {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
}

function uniqueStrings(values, maxLength) {
  return [...new Set(values
    .map((value) => cleanText(value, maxLength))
    .filter(Boolean))]
}

function safeSourceUrl(value) {
  const url = cleanText(value, 2000)
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : ''
  } catch {
    return ''
  }
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return text.length <= maxLength ? text : text.slice(0, maxLength)
}

function eventTime(event) {
  const numeric = numericTime(event?.updatedAt || event?.timestamp)
  return numeric || Date.now()
}

function numericTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = new Date(value || 0).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}
