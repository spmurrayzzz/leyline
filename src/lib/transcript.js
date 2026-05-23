import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
})

export function entryClass(entry) {
  return {
    'user-message': entry.role === 'user',
    'assistant-message': entry.role === 'assistant',
    'summary-message': entry.type === 'summary',
  }
}

export function renderedMessage(entry) {
  return markdown.render(entry.text || '')
}

export function renderedBlock(block) {
  return markdown.render(block.text || '')
}

export function renderedToolJson(entry) {
  const text = entry.text || ''
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return ''

  try {
    return highlightJson(JSON.stringify(JSON.parse(trimmed), null, 2))
  } catch {
    return ''
  }
}

function highlightJson(json) {
  return json.replace(
    /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"\s*:?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => `<span class="${jsonTokenClass(match)}">${escapeHtml(match)}</span>`,
  )
}

function jsonTokenClass(token) {
  if (token.endsWith(':')) return 'json-key'
  if (token.startsWith('"')) return 'json-string'
  if (token === 'true' || token === 'false') return 'json-boolean'
  if (token === 'null') return 'json-null'
  return 'json-number'
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function imageSrc(block) {
  return `data:${block.mimeType};base64,${block.data}`
}

export function imageBlocksFor(entry) {
  return (entry.blocks || []).filter((block) => block.type === 'image')
}

export function skillSummaries(entry) {
  if (entry.role !== 'user' || !entry.text?.trimStart().startsWith('<skill ')) {
    return []
  }

  return Array.from(entry.text.matchAll(/<skill\s+([^>]*)>/g))
    .map((match) => ({
      name: attributeValue(match[1], 'name') || 'unknown',
      location: attributeValue(match[1], 'location'),
    }))
}

function attributeValue(source, name) {
  return source.match(new RegExp(`${name}="([^"]+)"`))?.[1]
}

export function messageBlocksFor(entry) {
  if (entry.blocks?.length) return entry.blocks
  return [{ type: 'text', text: entry.text }]
}

export function textFromContent(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content)
  return textFromBlocks(messageBlocks(content))
}

export function messageBlocks(content) {
  if (!Array.isArray(content)) return []

  return content
    .map((block) => {
      if (block.type === 'text') return { type: 'text', text: block.text }
      if (block.type === 'image') {
        return {
          type: 'image',
          data: block.data,
          mimeType: block.mimeType,
        }
      }
      if (block.type === 'thinking') {
        return { type: 'thinking', text: block.thinking }
      }
      return undefined
    })
    .filter((block) => block?.text || block?.data)
}

export function textFromBlocks(blocks) {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}
