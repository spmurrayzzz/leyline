import { setCorsHeaders } from './cors.js'

export function createPiApiHandler(api) {
  const {
    activeSessionDto,
    bashSession,
    compactSession,
    createMemory,
    createNewSession,
    deleteMemories,
    deleteSubagentModelOverride,
    editSessionPrompt,
    exportFilename,
    exportSessionDetail,
    exportShareMeta,
    forkActiveSession,
    html,
    interruptSession,
    json,
    listProjects,
    listSessions,
    listSubagentConfigs,
    listVisibleMemories,
    listVisionConfig,
    openEventStream,
    openGitReviewEventStream,
    promptSession,
    readDirectory,
    readGitReview,
    readGitReviewDiff,
    readJson,
    reloadSession,
    renameSession,
    requireActiveHandle,
    resetSessionToEntry,
    resolveSession,
    resolveSubagentConfig,
    resolveVisionConfig,
    runSubagent,
    runVision,
    runtimeHandleForId,
    runtimeState,
    setMemoryStatus,
    setRolloutFeedback,
    setSubagentModelOverride,
    setVisionOverride,
    clearVisionOverride,
    setSessionMode,
    setSessionModel,
    setSessionThinkingLevel,
    sessionDetail,
    switchActiveSession,
    toActiveSessionDetailDto,
    toSessionDto,
    trashProject,
    trashSession,
    updateMemory,
    renderSessionExportHtml,
  } = api

async function piApiHandler(req, res) {
    if (!setCorsHeaders(req, res)) {
      return json(res, { error: 'Cross-origin request denied' }, 403)
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      return res.end()
    }

    const url = new URL(req.url, 'http://localhost')
  
    try {
      if (url.pathname === '/info') {
        if (req.method !== 'GET') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
        return json(res, {
          name: 'Leyline',
          version: process.env.npm_package_version || '0.0.0',
          apiVersion: 1,
          capabilities: {
            events: true,
            exports: true,
            review: true,
            reviewWatch: true,
            terminal: true,
          },
        })
      }

      if (url.pathname === '/projects') {
        if (req.method !== 'GET') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
        return json(res, { projects: await listProjects() })
      }

      const projectMatch = url.pathname.match(/^\/projects\/([^/]+)$/)
      if (projectMatch) {
        if (req.method !== 'DELETE') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
        const trashed = await trashProject(decodeURIComponent(projectMatch[1]))
        return json(res, { ok: true, trashed })
      }

      if (url.pathname === '/sessions') {
        if (req.method === 'GET') {
          const sessions = await listSessions()
          return json(res, { sessions: sessions.map(toSessionDto) })
        }
  
        if (req.method === 'POST') {
          const body = await readJson(req)
          const active = await createNewSession(body.cwd)
          return json(res, {
            active,
            detail: toActiveSessionDetailDto(),
          })
        }
  
        return json(res, { error: 'Method not allowed' }, 405)
      }
  
      if (url.pathname === '/active-session') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const body = await readJson(req)
        const session = await resolveSession(body.id, body.path, body.cwd)
        if (!session) return json(res, { error: 'Session not found' }, 404)
  
        const active = await switchActiveSession(session)
        return json(res, { active })
      }
  
      if (url.pathname === '/state') {
        if (req.method !== 'GET') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const active = await runtimeState(url.searchParams.get('cwd'))
        return json(res, { active })
      }
  
      if (url.pathname === '/fs') {
        if (req.method !== 'GET') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        return json(res, await readDirectory(
          url.searchParams.get('path'),
          url.searchParams.get('cwd'),
        ))
      }
  
      if (url.pathname === '/review') {
        if (req.method !== 'GET') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
        const cwd = url.searchParams.get('cwd')
        if (!cwd) return json(res, { error: 'Project path is required' }, 400)
        return json(res, await readGitReview(cwd))
      }

      if (url.pathname === '/review/events') {
        if (req.method !== 'GET') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
        const cwd = url.searchParams.get('cwd')
        if (!cwd) return json(res, { error: 'Project path is required' }, 400)
        return openGitReviewEventStream(cwd, req, res)
      }

      if (url.pathname === '/review/diff') {
        if (req.method !== 'GET') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
        const cwd = url.searchParams.get('cwd')
        const path = url.searchParams.get('path')
        if (!cwd || !path) {
          return json(res, { error: 'Project path and file path are required' }, 400)
        }
        return json(res, await readGitReviewDiff(cwd, path))
      }

      if (url.pathname === '/prompt') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const body = await readJson(req)
        const handle = requireActiveHandle()
        await promptSession(
          handle,
          body.text,
          body.images,
          body.streamingBehavior,
          responseAbortSignal(res),
        )
        return json(res, { ok: true, active: activeSessionDto(handle) })
      }
  
      if (url.pathname === '/bash') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const body = await readJson(req)
        const handle = requireActiveHandle()
        await bashSession(handle, body.command, body.excludeFromContext)
        return json(res, {
          ok: true,
          active: activeSessionDto(handle),
          detail: toActiveSessionDetailDto(handle),
        })
      }
  
      if (url.pathname === '/compact') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const body = await readJson(req)
        const handle = requireActiveHandle()
        await compactSession(handle, body.customInstructions)
        return json(res, {
          ok: true,
          active: activeSessionDto(handle),
          detail: toActiveSessionDetailDto(handle),
        })
      }
  
      if (url.pathname === '/edit-prompt') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const body = await readJson(req)
        const handle = requireActiveHandle()
        await editSessionPrompt(
          handle,
          body.entryId,
          body.text,
          body.images,
          responseAbortSignal(res),
        )
        return json(res, { ok: true, active: activeSessionDto(handle) })
      }
  
      if (url.pathname === '/fork') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const body = await readJson(req)
        const active = await forkActiveSession(body.entryId)
        return json(res, {
          ok: true,
          active,
          detail: toActiveSessionDetailDto(),
        })
      }

      if (url.pathname === '/reset-to-entry') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const body = await readJson(req)
        const handle = requireActiveHandle()
        await resetSessionToEntry(handle, body.entryId)
        return json(res, {
          ok: true,
          active: activeSessionDto(handle),
          detail: toActiveSessionDetailDto(handle),
        })
      }
  
      if (url.pathname === '/reload') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const handle = requireActiveHandle()
        await reloadSession(handle)
        return json(res, { ok: true, active: activeSessionDto(handle) })
      }
  
      if (url.pathname === '/model') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const body = await readJson(req)
        const handle = requireActiveHandle()
        await setSessionModel(handle, body.provider, body.id)
        return json(res, { ok: true, active: activeSessionDto(handle) })
      }
  
      if (url.pathname === '/thinking') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const body = await readJson(req)
        const handle = requireActiveHandle()
        setSessionThinkingLevel(handle, body.level)
        return json(res, { ok: true, active: activeSessionDto(handle) })
      }
  
      if (url.pathname === '/mode') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        await readJson(req)
        const handle = requireActiveHandle()
        setSessionMode(handle)
        return json(res, { ok: true, active: activeSessionDto(handle) })
      }
  
      if (url.pathname === '/interrupt') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const handle = requireActiveHandle()
        await interruptSession(handle)
        return json(res, { ok: true, active: activeSessionDto(handle) })
      }
  
      if (url.pathname === '/events') {
        if (req.method !== 'GET') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        return openEventStream(req, res)
      }

      if (url.pathname === '/memories') {
        if (req.method === 'GET') {
          return json(res, await listVisibleMemories({
            cwd: url.searchParams.get('cwd'),
            sessionPath: url.searchParams.get('sessionPath'),
          }))
        }

        if (req.method === 'POST') {
          const body = await readJson(req)
          const memory = await createMemory({
            contentMd: body.contentMd,
            cwd: body.cwd,
            scope: body.scope,
            sessionPath: body.sessionPath,
            tags: body.tags,
          })
          return json(res, { ok: true, memory })
        }

        if (req.method === 'DELETE') {
          const body = await readJson(req)
          const memories = await deleteMemories({
            cwd: body.cwd,
            ids: body.ids,
            sessionPath: body.sessionPath,
          })
          return json(res, { ok: true, memories })
        }

        return json(res, { error: 'Method not allowed' }, 405)
      }

      if (url.pathname === '/memories/status') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }

        const body = await readJson(req)
        const memories = await setMemoryStatus({
          cwd: body.cwd,
          ids: body.ids,
          sessionPath: body.sessionPath,
          status: body.status,
        })
        return json(res, { ok: true, memories })
      }

      const memoryMatch = url.pathname.match(/^\/memories\/([^/]+)$/)
      if (memoryMatch) {
        if (req.method === 'PATCH') {
          const body = await readJson(req)
          const memory = await updateMemory({
            contentMd: body.contentMd,
            cwd: body.cwd,
            id: decodeURIComponent(memoryMatch[1]),
            sessionPath: body.sessionPath,
            tags: body.tags,
          })
          return json(res, { ok: true, memory })
        }

        if (req.method === 'DELETE') {
          const body = await readJson(req)
          const memories = await deleteMemories({
            cwd: body.cwd,
            ids: [decodeURIComponent(memoryMatch[1])],
            sessionPath: body.sessionPath,
          })
          return json(res, { ok: true, memories })
        }

        return json(res, { error: 'Method not allowed' }, 405)
      }

      if (url.pathname === '/subagents') {
        if (req.method !== 'GET') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
        return json(res, listSubagentConfigs({
          cwd: url.searchParams.get('cwd'),
          sessionPath: url.searchParams.get('sessionPath'),
        }))
      }

      if (url.pathname === '/subagents/resolve') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
        const body = await readJson(req)
        return json(res, resolveSubagentConfig({
          agentKey: body.agentKey,
          cwd: body.cwd,
          sessionPath: body.sessionPath,
          staticModel: body.staticModel,
          staticThinking: body.staticThinking,
        }))
      }

      const subagentOverrideMatch = url.pathname.match(/^\/subagents\/(.+)\/model$/)
      if (subagentOverrideMatch) {
        if (!['PUT', 'DELETE'].includes(req.method)) {
          return json(res, { error: 'Method not allowed' }, 405)
        }
        const agentKey = decodeURIComponent(subagentOverrideMatch[1])
        const body = await readJson(req)
        if (req.method === 'PUT') {
          return json(res, setSubagentModelOverride({
            agentKey,
            cwd: body.cwd,
            model: body.model,
            scope: body.scope,
            sessionPath: body.sessionPath,
          }))
        }
        return json(res, deleteSubagentModelOverride({
          agentKey,
          cwd: body.cwd,
          scope: body.scope,
          sessionPath: body.sessionPath,
        }))
      }

      if (url.pathname === '/subagent') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }

        const body = await readJson(req)
        const controller = new AbortController()
        let responseFinished = false
        res.on('finish', () => { responseFinished = true })
        res.on('close', () => {
          if (!responseFinished) controller.abort()
        })
        try {
          const result = await runSubagent({
            task: body.task,
            cwd: body.cwd,
            parentSessionPath: body.parentSessionPath,
            model: body.model,
            thinkingLevel: body.thinkingLevel,
            tools: body.tools,
            systemPrompt: body.systemPrompt,
            signal: controller.signal,
          })
          return json(res, result)
        } catch (error) {
          return json(res, { error: error.message }, 500)
        }
      }

      if (url.pathname === '/vision/config') {
        if (req.method !== 'GET') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
        return json(res, listVisionConfig({
          cwd: url.searchParams.get('cwd'),
          sessionPath: url.searchParams.get('sessionPath'),
        }))
      }

      if (url.pathname === '/vision/override') {
        if (!['PUT', 'DELETE'].includes(req.method)) {
          return json(res, { error: 'Method not allowed' }, 405)
        }
        const body = await readJson(req)
        if (req.method === 'PUT') {
          return json(res, setVisionOverride({
            cwd: body.cwd,
            model: body.model,
            thinking: body.thinking,
            scope: body.scope,
            sessionPath: body.sessionPath,
          }))
        }
        return json(res, clearVisionOverride({
          cwd: body.cwd,
          scope: body.scope,
          sessionPath: body.sessionPath,
        }))
      }

      if (url.pathname === '/vision/resolve') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
        const body = await readJson(req)
        return json(res, resolveVisionConfig({
          cwd: body.cwd,
          sessionPath: body.sessionPath,
          staticModel: body.staticModel,
        }))
      }

      if (url.pathname === '/vision') {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }

        const body = await readJson(req)
        const controller = new AbortController()
        let responseFinished = false
        res.on('finish', () => { responseFinished = true })
        res.on('close', () => {
          if (!responseFinished) controller.abort()
        })
        try {
          const result = await runVision({
            question: body.question,
            cwd: body.cwd,
            parentSessionPath: body.parentSessionPath,
            model: body.model,
            thinking: body.thinking,
            image: body.image,
            signal: controller.signal,
          })
          return json(res, result)
        } catch (error) {
          return json(res, { error: error.message }, 500)
        }
      }

      const scopedActions = [
        'prompt',
        'bash',
        'compact',
        'edit-prompt',
        'interrupt',
        'reload',
        'model',
        'thinking',
      ].join('|')
      const scopedActionMatch = url.pathname.match(
        new RegExp(`^/sessions/([^/]+)/(${scopedActions})$`),
      )
      if (scopedActionMatch) {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const handle = await runtimeHandleForId(
          decodeURIComponent(scopedActionMatch[1]),
        )
        if (!handle) return json(res, { error: 'Session not found' }, 404)
  
        const body = await readJson(req)
        const action = scopedActionMatch[2]
        if (action === 'prompt') {
          await promptSession(
            handle,
            body.text,
            body.images,
            body.streamingBehavior,
            responseAbortSignal(res),
          )
          return json(res, { ok: true, active: activeSessionDto(handle) })
        }
        if (action === 'bash') {
          await bashSession(handle, body.command, body.excludeFromContext)
          return json(res, {
            ok: true,
            active: activeSessionDto(handle),
            detail: toActiveSessionDetailDto(handle),
          })
        }
        if (action === 'compact') {
          await compactSession(handle, body.customInstructions)
          return json(res, {
            ok: true,
            active: activeSessionDto(handle),
            detail: toActiveSessionDetailDto(handle),
          })
        }
        if (action === 'edit-prompt') {
          await editSessionPrompt(
            handle,
            body.entryId,
            body.text,
            body.images,
            responseAbortSignal(res),
          )
          return json(res, { ok: true, active: activeSessionDto(handle) })
        }
        if (action === 'interrupt') {
          await interruptSession(handle)
          return json(res, { ok: true, active: activeSessionDto(handle) })
        }
        if (action === 'reload') {
          await reloadSession(handle)
          return json(res, { ok: true, active: activeSessionDto(handle) })
        }
        if (action === 'model') {
          await setSessionModel(handle, body.provider, body.id)
          return json(res, { ok: true, active: activeSessionDto(handle) })
        }
  
        setSessionThinkingLevel(handle, body.level)
        return json(res, { ok: true, active: activeSessionDto(handle) })
      }
  
      const feedbackMatch = url.pathname.match(
        /^\/sessions\/([^/]+)\/feedback$/,
      )
      if (feedbackMatch) {
        if (req.method !== 'POST') {
          return json(res, { error: 'Method not allowed' }, 405)
        }

        const body = await readJson(req)
        const feedback = await setRolloutFeedback({
          cwd: body.cwd,
          entryId: body.entryId,
          feedbackText: body.feedbackText,
          label: body.label,
          sessionId: decodeURIComponent(feedbackMatch[1]),
          sessionPath: body.sessionPath,
        })
        return json(res, { ok: true, feedback })
      }

      const exportMatch = url.pathname.match(/^\/sessions\/([^/]+)\/export$/)
      if (exportMatch) {
        if (req.method !== 'GET') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const id = decodeURIComponent(exportMatch[1])
        const detail = await exportSessionDetail(id)
        return html(
          res,
          await renderSessionExportHtml(detail, exportShareMeta(id)),
          exportFilename(detail),
          url.searchParams.get('disposition') === 'inline',
        )
      }
  
      if (url.pathname === '/sessions/by-path') {
        if (req.method !== 'GET') {
          return json(res, { error: 'Method not allowed' }, 405)
        }

        const path = url.searchParams.get('path')
        if (!path) return json(res, { error: 'Session path is required' }, 400)

        const detail = await sessionDetail('', path)
        if (!detail) return json(res, { error: 'Session not found' }, 404)
        return json(res, detail)
      }

      const match = url.pathname.match(/^\/sessions\/([^/]+)$/)
      if (match) {
        const id = decodeURIComponent(match[1])
        if (req.method === 'PATCH') {
          const body = await readJson(req)
          const detail = await renameSession(id, body.name)
          return json(res, { ok: true, detail, session: detail.session })
        }

        if (req.method === 'DELETE') {
          const trashed = await trashSession(id)
          return json(res, { ok: true, trashed })
        }
  
        if (req.method !== 'GET') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
  
        const detail = await sessionDetail(id, url.searchParams.get('path'))
        if (!detail) return json(res, { error: 'Session not found' }, 404)
        return json(res, detail)
      }
  
      return json(res, { error: 'Not found' }, 404)
    } catch (error) {
      return json(res, { error: error.message }, 500)
    }
  }

  return piApiHandler
}

function responseAbortSignal(res) {
  const controller = new AbortController()
  let finished = false
  res.once('finish', () => { finished = true })
  res.once('close', () => {
    if (!finished) controller.abort()
  })
  return controller.signal
}
