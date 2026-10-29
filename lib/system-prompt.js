export function systemSectionTitle(name) {
  const title = String(name || '').replace(/[_-]/g, ' ')
  return title.charAt(0).toUpperCase() + title.slice(1)
}

export function parseProjectContextFiles(text) {
  if (text === null) return []
  if (typeof text !== 'string') return null
  let source = text.trim()
  if (source.startsWith('<project_context>')) {
    if (!source.endsWith('</project_context>')) return null
    source = source.slice('<project_context>'.length, -'</project_context>'.length).trim()
  }
  const heading = 'Project-specific instructions and guidelines:'
  if (source.startsWith(heading)) source = source.slice(heading.length).trimStart()
  const files = []
  const paths = new Set()
  const pattern = /<project_instructions path="([^"\r\n<>]+)">\r?\n([\s\S]*?)\r?\n<\/project_instructions>/g
  let end = 0
  for (const match of source.matchAll(pattern)) {
    if (source.slice(end, match.index).trim() || paths.has(match[1])
      || /<\/?project_(?:instructions|context)\b/.test(match[2])) return null
    paths.add(match[1])
    files.push({ path: match[1], content: match[2] })
    end = match.index + match[0].length
  }
  return source.slice(end).trim() ? null : files
}

function isGlobalContextFile(file) {
  return /(^|\/)\.pi\/agent\/[^/]+$/.test(String(file).replace(/\\/g, '/'))
}

export function projectContextFileLabel(path, allPaths = []) {
  const file = String(path || '').replace(/\\/g, '/')
  const basename = file.split('/').pop() || file
  if (isGlobalContextFile(file)) return `global ${basename}`
  const projectPaths = allPaths.filter((item) => !isGlobalContextFile(item))
  if (projectPaths.length <= 1) return `project ${basename}`
  const parent = file.split('/').filter(Boolean).slice(-2, -1)[0]
  return parent ? `${parent}/${basename}` : basename
}

export function diffProjectContextFiles(previousText, currentText) {
  const current = parseProjectContextFiles(currentText)
  const previous = parseProjectContextFiles(previousText)
  const unavailable = current === null ? 'current'
    : previousText === undefined ? 'history'
      : previous === null ? 'previous' : ''
  if (unavailable === 'current' || unavailable === 'previous') {
    return { files: [], changedLabels: [], unavailable }
  }
  const before = new Map((previous || []).map((file) => [file.path, file.content]))
  const after = new Map(current.map((file) => [file.path, file.content]))
  const paths = [...new Set([...after.keys(), ...before.keys()])]
  const files = paths.map((path) => {
    const status = unavailable ? 'unknown'
      : !after.has(path) ? 'removed'
        : !before.has(path) ? 'added'
          : before.get(path) === after.get(path) ? 'unchanged' : 'modified'
    return {
      path,
      label: projectContextFileLabel(path, paths),
      status,
      ...(['modified', 'removed'].includes(status) ? { previousContent: before.get(path) } : {}),
    }
  })
  const changedLabels = files.filter((file) => ['added', 'modified', 'removed'].includes(file.status))
    .map((file) => file.status === 'modified' ? file.label : `${file.label} ${file.status}`)
  return { files, changedLabels, unavailable }
}

export function projectContextView(entry) {
  const section = (entry.sections || []).find((item) => item.name === 'project_context')
  if (!section) return { files: [], notice: '' }
  const initial = systemPromptInfo(entry).initial
  const text = section.removed ? null : section.text
  const comparison = entry.projectContextFiles?.every((file) => file.status)
    ? { files: entry.projectContextFiles, unavailable: entry.projectContextUnavailable }
    : diffProjectContextFiles(initial ? null : undefined, text)
  const messages = {
    current: 'File boundaries are unclear. Showing the full recorded section.',
    previous: 'Previous file boundaries are unclear. Showing the full recorded section.',
    history: 'Previous version unavailable. Showing full recorded content.',
  }
  const notice = messages[comparison.unavailable] || (initial ? '' : section.removed
    ? 'Comparison of recorded versions. Pi removed this section.'
    : 'Comparison of recorded versions. Pi sent the updated section in full.')
  const contents = new Map((parseProjectContextFiles(text) || []).map((file) => [file.path, file.content]))
  const files = comparison.files.map((file) => {
    const content = contents.get(file.path) ?? ''
    return {
      ...file,
      content,
      statusLabel: {
        added: 'added', modified: 'updated', removed: 'removed',
        unchanged: 'unchanged', unknown: 'recorded content',
      }[file.status],
      ...(['modified', 'removed'].includes(file.status) ? {
        preview: { kind: 'diff', path: file.label, oldText: file.previousContent, newText: content },
      } : {}),
    }
  })
  return { files, notice }
}

export function systemPromptInfo(entry) {
  const sections = entry.sections || []
  const added = entry.toolsAdded || []
  const removed = entry.toolsRemoved || []
  const initial = entry.initialSystemPrompt
    ?? sections.some((section) => section.name === 'preamble' && !section.removed)
  const count = (length, noun) => `${length} ${noun}${length === 1 ? '' : 's'}`
  const parts = []
  if (initial) {
    parts.push(count(sections.length, 'section'), count(added.length, 'tool'))
  } else {
    for (const [items, action] of [
      [sections.filter((section) => !section.removed), 'changed'],
      [sections.filter((section) => section.removed), 'removed'],
    ]) {
      if (items.length) parts.push(`${items.length === 1 ? systemSectionTitle(items[0].name) : count(items.length, 'section')} ${action}`)
    }
    if (added.length) parts.push(`${added.length === 1 ? added[0].name : count(added.length, 'tool')} added`)
    if (removed.length) parts.push(`${removed.length === 1 ? removed[0] : count(removed.length, 'tool')} removed`)
    const changedLabels = entry.projectContextChangedLabels || []
    if (changedLabels.length) parts.push(changedLabels.join(', '))
  }
  return {
    initial,
    title: initial ? 'System prompt' : 'System updated',
    summary: parts.join(' · ') || 'Prompt update',
    caption: initial ? 'Initial prompt' : 'Changes in this event',
  }
}
