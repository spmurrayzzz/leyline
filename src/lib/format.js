export function modelChip(model) {
  if (!model) return 'no model'
  return [model.provider, model.id].filter(Boolean).join('/')
}

export function formatMode(value) {
  return String(value).replace(/[-_]/g, ' ').toLowerCase()
}

export function projectName(cwd) {
  if (!cwd) return 'unknown'
  return cwd.split('/').filter(Boolean).at(-1) || cwd
}

export function formatDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export function eventTime(item) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(item.loggedAt))
}

export function sessionTime(session) {
  if (!session.timestamp) return ''

  const then = new Date(session.timestamp).getTime()
  const diff = Date.now() - then
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))}m`
  if (diff < day) return `${Math.round(diff / hour)}h`
  return `${Math.round(diff / day)}d`
}

export function toolLabel(toolName) {
  if (!toolName) return 'tool'
  if (toolName === 'bash') return 'bash'
  if (toolName === 'compact') return 'Compact'
  if (toolName === 'list_memory') return 'Memory · List'
  if (toolName === 'search_memory') return 'Memory · Search'
  if (toolName === 'record_memory') return 'Memory · Record'
  if (toolName === 'update_memory') return 'Memory · Update'
  if (toolName === 'archive_memory') return 'Memory · Archive'
  return toolName
}

export function toolTarget(args) {
  if (!args) return ''
  let value = args.command || args.path
  value ||= args.query || args.id || args.scope
  if (!value && Array.isArray(args.ids)) value = args.ids.join(', ')
  if (!value) return ''
  return ` · ${String(value).slice(0, 80)}`
}

