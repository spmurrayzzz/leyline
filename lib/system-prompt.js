export function systemSectionTitle(name) {
  const title = String(name || '').replace(/[_-]/g, ' ')
  return title.charAt(0).toUpperCase() + title.slice(1)
}

export function systemPromptInfo(entry) {
  const sections = entry.sections || []
  const added = entry.toolsAdded || []
  const removed = entry.toolsRemoved || []
  const initial = sections.some((section) => section.name === 'preamble' && !section.removed)
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
  }
  return {
    initial,
    title: initial ? 'System prompt' : 'System updated',
    summary: parts.join(' · ') || 'Prompt update',
    caption: initial ? 'Initial prompt' : 'Changes in this event',
  }
}
