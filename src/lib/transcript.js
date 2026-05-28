import MarkdownIt from 'markdown-it'
import {
  imageBlocksFor,
  messageBlocks,
  messageBlocksFor,
  skillSummaries,
  textFromBlocks,
  textFromContent,
} from '../../lib/transcript-projection'

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
    'submit-handoff-message': entry.submitHandoff === true,
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

export {
  imageBlocksFor,
  messageBlocks,
  messageBlocksFor,
  skillSummaries,
  textFromBlocks,
  textFromContent,
}
