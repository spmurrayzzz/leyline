export function fuzzyScore(value, query) {
  const text = String(value || '').toLowerCase()
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  let total = 0

  for (const term of terms) {
    const score = fuzzyTermScore(text, term)
    if (score === 0) return 0
    total += score
  }

  return total
}

export function highlightedText(value, query) {
  const text = String(value || '')
  const normalizedQuery = String(query || '').trim().toLowerCase()
  if (!normalizedQuery) return escapeHtml(text)

  const indexes = fuzzyMatchIndexes(text, normalizedQuery)
  if (!indexes.size) return escapeHtml(text)

  return Array.from(text)
    .map((char, index) => ({ char, matched: indexes.has(index) }))
    .reduce((html, item, index, items) => {
      const previous = items[index - 1]
      const next = items[index + 1]
      const open = item.matched && !previous?.matched
      const close = item.matched && !next?.matched
      return [
        html,
        open ? '<mark>' : '',
        escapeHtml(item.char),
        close ? '</mark>' : '',
      ].join('')
    }, '')
}

function fuzzyTermScore(text, term) {
  let position = -1
  let score = 0
  let streak = 0

  for (const char of term) {
    const next = text.indexOf(char, position + 1)
    if (next === -1) return 0

    streak = next === position + 1 ? streak + 1 : 1
    score += 1 + streak * 2
    if (next === 0 || /[\/\-_\s]/.test(text[next - 1])) score += 4
    position = next
  }

  if (text.includes(term)) score += 20
  if (text.startsWith(term)) score += 30
  return score
}

function fuzzyMatchIndexes(value, query) {
  const text = value.toLowerCase()
  const indexes = new Set()
  let start = 0

  for (const term of query.split(/\s+/).filter(Boolean)) {
    let position = start - 1
    const termIndexes = []

    for (const char of term) {
      const next = text.indexOf(char, position + 1)
      if (next === -1) return new Set()
      termIndexes.push(next)
      position = next
    }

    for (const index of termIndexes) indexes.add(index)
    start = position + 1
  }

  return indexes
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
