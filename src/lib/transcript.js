import MarkdownIt from 'markdown-it'
import highlightJsSource from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/vendor/highlight.min.js?raw'
import {
  imageBlocksFor,
  messageBlocks,
  messageBlocksFor,
  projectEntry,
  skillSummaries,
  textFromBlocks,
  textFromContent,
  toolAnnotation,
} from '../../lib/transcript-projection'

const hljs = loadHighlightJs()
const markdown = createMarkdown()
const previewMarkdown = createMarkdown()
previewMarkdown.renderer.rules.image = renderPreviewImage
previewMarkdown.renderer.rules.link_open = renderPreviewLinkOpen
previewMarkdown.renderer.rules.link_close = renderPreviewLinkClose

export function entryClass(entry) {
  return {
    'user-message': entry.role === 'user',
    'assistant-message': entry.role === 'assistant',
    'summary-message': entry.type === 'summary',
    'research-report-message': Boolean(entry.researchReport),
    'submit-handoff-message': entry.submitHandoff === true,
  }
}

export function renderedMessage(entry) {
  return markdown.render(entry.text || '')
}

export function renderedBlock(block) {
  return markdown.render(block.text || '')
}

export function renderedMarkdownPreview(preview) {
  return previewMarkdown.render(preview?.content || '', {})
}

export function toolCommandCode(entry) {
  if (!entry?.code) return ''
  if (entry.toolName === 'bash' || entry.toolName === 'search_memory') return entry.code
  return ''
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

function createMarkdown() {
  return new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    highlight: highlightCode,
  })
}

function renderPreviewImage(tokens, index) {
  return `<span class="markdown-image-reference">Image: ${escapeHtml(tokens[index].content || 'Untitled')}</span>`
}

function renderPreviewLinkOpen(tokens, index, options, env, renderer) {
  const token = tokens[index]
  const external = /^(?:https?:|mailto:)/i.test(token.attrGet('href') || '')
  const stack = env.previewLinkStack || (env.previewLinkStack = [])
  stack.push(external)
  if (!external) return '<span class="markdown-relative-link">'

  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener noreferrer')
  return renderer.renderToken(tokens, index, options)
}

function renderPreviewLinkClose(_tokens, _index, _options, env) {
  return env.previewLinkStack?.pop() ? '</a>' : '</span>'
}

function highlightCode(source, language) {
  const lang = normalizeLanguage(language)
  if (hljs && lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(source, {
        language: lang,
        ignoreIllegals: true,
      }).value
    } catch {}
  }

  if (hljs && !lang) {
    try {
      return hljs.highlightAuto(source).value
    } catch {}
  }

  return escapeHtml(source)
}

function normalizeLanguage(language) {
  const value = String(language || '').trim().toLowerCase()
  if (!value) return ''
  return {
    bash: 'bash',
    cjs: 'javascript',
    console: 'bash',
    html: 'xml',
    js: 'javascript',
    jsx: 'javascript',
    md: 'markdown',
    mjs: 'javascript',
    py: 'python',
    rb: 'ruby',
    shell: 'bash',
    sh: 'bash',
    ts: 'typescript',
    tsx: 'typescript',
    vue: 'xml',
    yml: 'yaml',
    zsh: 'bash',
  }[value] || value
}

function loadHighlightJs() {
  const globalHljs = globalThis.hljs
  if (globalHljs) return globalHljs

  const previousModule = globalThis.module
  const previousExports = globalThis.exports
  try {
    globalThis.module = undefined
    globalThis.exports = undefined
    return new Function(`${highlightJsSource}; return hljs`)()
  } finally {
    globalThis.module = previousModule
    globalThis.exports = previousExports
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
  projectEntry,
  skillSummaries,
  textFromBlocks,
  textFromContent,
  toolAnnotation,
}
