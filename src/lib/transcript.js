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
      if (block.type === 'thinking') {
        return { type: 'thinking', text: block.thinking }
      }
      return undefined
    })
    .filter((block) => block?.text)
}

export function textFromBlocks(blocks) {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}
