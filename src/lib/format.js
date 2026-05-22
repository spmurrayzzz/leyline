export function modelChip(model) {
  if (!model) return 'No model'
  const provider = model.provider ? `${formatProvider(model.provider)} · ` : ''
  return `${provider}${formatModelId(model.id)}`
}

export function formatMode(value) {
  return String(value)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
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
  return toolName
}

export function toolTarget(args) {
  if (!args) return ''
  const value = args.command || args.path
  if (!value) return ''
  return ` · ${String(value).slice(0, 80)}`
}

function formatProvider(value) {
  return String(value)
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatModelId(value) {
  return String(value || 'Unknown model')
    .replace(/^(anthropic\.|claude-|openai\/)/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\d{8}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
