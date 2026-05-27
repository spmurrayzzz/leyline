import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'
import {
  imageBlocksFor,
  messageBlocksFor,
  skillSummaries,
} from '../../lib/transcript-projection.js'

const exportMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
})

export function exportFilename(detail) {
  const session = detail.session
  const title = session.name || session.firstMessage || session.id
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'session'
  return `leyline-${slug}.html`
}

export function exportShareMeta(id) {
  const publicUrl = process.env.LEYLINE_PUBLIC_URL?.replace(/\/$/, '')
  if (!publicUrl) return {}

  const path = `/api/pi/sessions/${encodeURIComponent(id)}/export`
  return {
    imageUrl: `${publicUrl}/og-image.png`,
    pageUrl: `${publicUrl}${path}?disposition=inline`,
  }
}

export async function renderSessionExportHtml(detail, shareMeta = {}) {
  const session = detail.session
  const title = session.name || session.firstMessage || 'Untitled session'
  const entries = detail.entries
    .filter(isExportRenderableEntry)
    .map(toExportEntry)
  const body = entries.map(renderExportEntry).join('\n')
  const exportData = Buffer.from(JSON.stringify({ entries })).toString('base64')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
${exportMetaTags(session, title, shareMeta)}
<style>${exportCss()}</style>
</head>
<body>
<main class="export-shell">
<header class="export-header">
<div class="export-meta-row">
${exportLogoSvg()}
<dl>
<div><dt>Project</dt><dd>${escapeHtml(projectLabel(session.cwd))}</dd></div>
<div><dt>Path</dt><dd>${escapeHtml(session.cwd || '')}</dd></div>
<div><dt>Messages</dt><dd>${escapeHtml(String(session.messageCount || 0))}</dd></div>
<div><dt>Modified</dt><dd>${escapeHtml(formatExportDate(session.modified))}</dd></div>
</dl>
</div>
<h1>${escapeHtml(title)}</h1>
</header>
<section class="transcript">
${body || '<div class="empty-workbench">No transcript entries found.</div>'}
</section>
</main>
<script id="export-data" type="application/json">${exportData}</script>
<script>${highlightJsSource()}</script>
<script type="module">${exportJs()}</script>
</body>
</html>`
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

function exportMetaTags(session, title, shareMeta) {
  const messageCount = session.messageCount || 0
  const description = truncate(
    `Leyline transcript export · ${projectLabel(session.cwd)}`
      + ` · ${messageCount} messages`,
    180,
  )
  const tags = [
    ['meta', 'name="description"', description],
    ['meta', 'property="og:type"', 'article'],
    ['meta', 'property="og:title"', title],
    ['meta', 'property="og:description"', description],
    ['meta', 'property="og:site_name"', 'Leyline'],
    ['meta', 'name="twitter:card"', 'summary_large_image'],
    ['meta', 'name="twitter:title"', title],
    ['meta', 'name="twitter:description"', description],
  ]

  if (shareMeta.pageUrl) {
    tags.push(['meta', 'property="og:url"', shareMeta.pageUrl])
    tags.push(['link', 'rel="canonical"', shareMeta.pageUrl])
  }
  if (shareMeta.imageUrl) {
    tags.push(['meta', 'property="og:image"', shareMeta.imageUrl])
    tags.push(['meta', 'property="og:image:width"', '1024'])
    tags.push(['meta', 'property="og:image:height"', '1024'])
    tags.push(['meta', 'property="og:image:alt"', 'Leyline transcript export'])
    tags.push(['meta', 'name="twitter:image"', shareMeta.imageUrl])
  }

  return tags.map(renderMetaTag).join('\n')
}

function renderMetaTag(tag) {
  const [type, attribute, content] = tag
  if (type === 'link') {
    return `<link ${attribute} href="${escapeHtml(content)}">`
  }
  return `<meta ${attribute} content="${escapeHtml(content)}">`
}

function exportLogoSvg() {
  return `<svg class="export-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" aria-hidden="true">
  <defs>
    <linearGradient id="export-logo-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#201f34"/>
      <stop offset="100%" stop-color="#10101c"/>
    </linearGradient>
    <radialGradient id="export-logo-glow" cx="38%" cy="28%" r="70%">
      <stop offset="0%" stop-color="#4f46e5" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#export-logo-bg)"/>
  <rect width="128" height="128" rx="28" fill="url(#export-logo-glow)"/>
  <rect x="0.75" y="0.75" width="126.5" height="126.5" rx="27.25" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
  <g transform="translate(5 7.3) scale(0.9)">
    <path d="M63 72c12 3 22 11 31 24" fill="none" stroke="#60a5fa" stroke-width="9" stroke-linecap="round"/>
    <path d="M33 96c17-8 27-22 30-42 3-16 15-24 35-24" fill="none" stroke="#a78bfa" stroke-width="9" stroke-linecap="round"/>
    <g fill="#f8f4ff">
      <circle cx="33" cy="96" r="9"/>
      <circle cx="98" cy="30" r="9"/>
      <circle cx="94" cy="96" r="9"/>
    </g>
  </g>
</svg>`
}

function isExportRenderableEntry(entry) {
  if (entry.type === 'event') return false
  if (entry.type !== 'message') return true
  if (entry.role !== 'assistant') return true
  return Boolean(entry.blocks?.length || entry.text?.trim())
}

function toExportEntry(entry) {
  if (entry.type !== 'tool') return entry
  if (!entry.preview) return entry

  const next = { ...entry, text: '' }
  if (entry.preview.kind === 'file') {
    const content = clippedExportContent(entry.preview.content || '')
    next.preview = {
      ...entry.preview,
      content,
      fallbackText: content,
    }
  }
  return next
}

function renderExportEntry(entry, index) {
  if (entry.type === 'tool') return renderExportTool(entry, index)
  return renderExportMessage(entry)
}

function renderExportTool(entry, index) {
  return `<details class="tool-card transcript-tool${entry.isError ? ' error-card' : ''}">
<summary class="tool-card-header">
<span class="chevron tool-chevron">›</span>
<span>${escapeHtml(entry.label)}</span>
${entry.code ? `<code>${escapeHtml(entry.code)}</code>` : ''}
${entry.contextLabel ? renderToolContext(entry) : ''}
<em>${entry.isError ? 'error' : 'completed'}</em>
</summary>
<div class="tool-expanded-body" data-tool-index="${index}">
<div class="tool-lazy-placeholder">Open to render preview</div>
</div>
</details>`
}

function renderToolContext(entry) {
  const excluded = entry.excludeFromContext ? ' is-excluded' : ''
  return `<span class="tool-context-pill${excluded}">${escapeHtml(entry.contextLabel)}</span>`
}

function exportCodeLanguage(entry) {
  return entry.preview?.language || ''
}

function toolPreviewText(entry) {
  const preview = entry.preview
  if (!preview) return entry.text || ''
  if (preview.kind === 'file') {
    return clippedExportContent(preview.fallbackText || entry.text || '')
  }
  return preview.fallbackText || entry.text || ''
}

function clippedExportContent(content) {
  const lines = content.split('\n')
  if (lines.length <= 400) return content
  return [
    ...lines.slice(0, 400),
    '',
    `… clipped ${lines.length - 400} more lines.`,
  ].join('\n')
}

function renderedExportToolJson(text) {
  const trimmed = (text || '').trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return ''

  try {
    return highlightExportJson(JSON.stringify(JSON.parse(trimmed), null, 2))
  } catch {
    return ''
  }
}

function jsonTokenClass(token) {
  if (token.endsWith(':')) return 'json-key'
  if (token.startsWith('"')) return 'json-string'
  if (token === 'true' || token === 'false') return 'json-boolean'
  if (token === 'null') return 'json-null'
  return 'json-number'
}

function highlightExportJson(json) {
  const token = /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"\s*:?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g
  let html = ''
  let offset = 0
  for (const match of json.matchAll(token)) {
    html += escapeHtml(json.slice(offset, match.index))
    html += `<span class="${jsonTokenClass(match[0])}">`
    html += escapeHtml(match[0])
    html += '</span>'
    offset = match.index + match[0].length
  }
  return html + escapeHtml(json.slice(offset))
}

function renderExportMessage(entry) {
  const classes = [
    'message compact-message transcript-message',
    entry.role === 'user' ? 'user-message' : '',
    entry.role === 'assistant' ? 'assistant-message' : '',
    entry.type === 'summary' ? 'summary-message' : '',
  ].filter(Boolean).join(' ')

  return `<article class="${classes}">
<div class="message-meta message-meta-row"><span>${escapeHtml(entry.label)}</span></div>
${renderMessageBody(entry)}
${renderMessageImages(entry)}
</article>`
}

function renderMessageBody(entry) {
  if (entry.role === 'assistant' && entry.blocks?.length) {
    return messageBlocksFor(entry).map(renderMessageBlock).join('\n')
  }

  const skills = skillSummaries(entry)
  if (skills.length) return renderSkillSummaries(entry, skills)

  return `<div class="entry-text markdown-body">${renderMarkdown(entry.text)}</div>`
}

function renderMessageBlock(block) {
  if (block.type === 'thinking') {
    return `<div class="thinking-block is-expanded">
<button class="thinking-trigger" type="button">
<span class="chevron">›</span>
<span class="thinking-label">Thinking</span>
</button>
<div class="thinking-expand-wrapper is-expanded">
<div class="thinking-expand-inner">
<pre>${escapeHtml(block.text || '')}</pre>
</div>
</div>
</div>`
  }

  return `<div class="entry-text markdown-body assistant-text-block">
${renderMarkdown(block.text || '')}
</div>`
}

function renderSkillSummaries(entry, skills) {
  const rows = skills.map((skill) => {
    return `<div class="skill-summary"><span>[skill]</span><strong>${escapeHtml(skill.name)}</strong><em>expand</em></div>`
  }).join('')

  return `<div class="skill-summary-list"><details><summary>${rows}</summary>
<div class="skill-expanded entry-text markdown-body">
${renderMarkdown(entry.text || '')}
</div>
</details></div>`
}

function renderMessageImages(entry) {
  const images = imageBlocksFor(entry)
  if (!images.length) return ''
  const tags = images.map((image, index) => {
    const src = `data:${image.mimeType};base64,${image.data}`
    return `<img src="${src}" alt="Attached image ${index + 1}">`
  }).join('')
  return `<div class="message-images">${tags}</div>`
}

function renderMarkdown(text) {
  return exportMarkdown.render(text || '')
}


function projectLabel(cwd) {
  if (!cwd) return 'Unknown project'
  return basename(cwd)
}

function formatExportDate(value) {
  if (!value) return 'unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function highlightJsSource() {
  const mainPath = fileURLToPath(import.meta.resolve(
    '@earendil-works/pi-coding-agent',
  ))
  return readFileSync(
    join(dirname(mainPath), 'core/export-html/vendor/highlight.min.js'),
    'utf8',
  )
}

function exportJs() {
  return `import {
  DIFFS_TAG_NAME,
  File,
  FileDiff,
  parsePatchFiles,
} from 'https://esm.sh/@pierre/diffs@1.2.0-beta.6'

const encoded = document.getElementById('export-data').textContent
const data = JSON.parse(new TextDecoder().decode(
  Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)),
))
const pierreOptions = {
  theme: 'pierre-dark',
  themeType: 'dark',
  overflow: 'wrap',
  tokenizeMaxLineLength: 20000,
  unsafeCSS: \`
    [data-diffs] {
      --diffs-font-family: ui-monospace, SFMono-Regular, Menlo, Monaco,
        Consolas, "Liberation Mono", "Courier New", monospace;
      --diffs-font-size: 12px;
      --diffs-line-height: 18px;
    }
  \`,
}
const pierreDiffOptions = {
  ...pierreOptions,
  diffStyle: 'unified',
  hunkSeparators: 'metadata',
}

if (window.hljs) hljs.highlightAll()

document.querySelectorAll('details').forEach((item) => {
  item.addEventListener('toggle', () => {
    const icon = item.querySelector('.tool-chevron')
    if (icon) icon.textContent = item.open ? '⌄' : '›'
    item.classList.toggle('is-expanded', item.open)
    if (item.open) renderTool(item.querySelector('[data-tool-index]'))
  })
})

function renderTool(container) {
  if (!container || container.dataset.rendered) return
  const entry = data.entries[Number(container.dataset.toolIndex)]
  container.dataset.rendered = 'true'
  container.innerHTML = ''

  if (entry.preview?.kind === 'image') {
    const img = document.createElement('img')
    img.src = \`data:\${entry.preview.mimeType};base64,\${entry.preview.data}\`
    img.alt = 'Read image preview'
    const wrap = document.createElement('div')
    wrap.className = 'tool-image-preview'
    wrap.appendChild(img)
    container.appendChild(wrap)
    return
  }

  if (entry.preview && renderPierre(container, entry.preview)) return
  renderPlainTool(container, entry)
}

function renderPierre(container, preview) {
  try {
    const target = document.createElement(DIFFS_TAG_NAME)
    target.className = 'pierre-diffs-container'
    container.appendChild(target)

    if (preview.kind === 'file') {
      new File(pierreOptions).render({
        fileContainer: target,
        file: {
          name: preview.path || 'tool-output.txt',
          contents: preview.content || '',
        },
      })
      return true
    }

    if (preview.kind === 'diff') {
      new FileDiff(pierreDiffOptions).render({
        fileContainer: target,
        oldFile: {
          name: preview.path || 'before.txt',
          contents: preview.oldText || '',
        },
        newFile: {
          name: preview.path || 'after.txt',
          contents: preview.newText || '',
        },
      })
      return true
    }

    if (preview.kind === 'patch') {
      const parsed = parsePatchFiles(preview.patch || '')
      const fileDiff = parsed.flatMap((patch) => patch.files || [])[0]
      if (!fileDiff) throw new Error('No diff found')
      new FileDiff(pierreDiffOptions).render({ fileContainer: target, fileDiff })
      return true
    }
  } catch {}

  container.innerHTML = ''
  return false
}

function renderPlainTool(container, entry) {
  const text = toolPreviewText(entry)
  const pre = document.createElement('pre')
  pre.className = 'tool-output'
  const code = document.createElement('code')
  const language = exportCodeLanguage(entry)
  if (language) code.className = \`language-\${language}\`
  code.textContent = text
  pre.appendChild(code)
  container.appendChild(pre)
  if (window.hljs) hljs.highlightElement(code)
}

function toolPreviewText(entry) {
  const preview = entry.preview
  if (!preview) return entry.text || ''
  return preview.fallbackText || entry.text || ''
}

function exportCodeLanguage(entry) {
  return entry.preview?.language || ''
}`
}

function exportCss() {
  return `:root {
  color: #e8e9ef;
  color-scheme: dark;
  background: #0d0e11;
  --bg: #0d0e11;
  --panel-soft: #1a1b21;
  --border: #30313a;
  --border-soft: #252730;
  --text: #e8e9ef;
  --muted: #7f8390;
  --muted-strong: #a7aab5;
  --accent: #7c5cff;
  --accent-border: rgb(124 92 255 / 34%);
  --syntax-comment: #6b7280;
  --syntax-keyword: #c084fc;
  --syntax-number: #f7c986;
  --syntax-string: #86efac;
  --syntax-function: #93c5fd;
  --syntax-type: #67e8f9;
  --syntax-variable: #fca5a5;
  --syntax-operator: #d8dbe3;
  --syntax-punctuation: #9ca3af;
  --motion-quick: 100ms;
  --motion-fast: 180ms;
  --motion-base: 220ms;
  --motion-slow: 300ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-emphasized: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-decelerate: cubic-bezier(0, 0, 0.2, 1);
  --ease-accelerate: cubic-bezier(0.4, 0, 1, 1);
  --content-max: 1080px;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system,
    BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
button, input, textarea { color: inherit; font: inherit; }
.export-shell { min-height: 100vh; padding: 32px 22px 64px; }
.export-header {
  width: min(var(--content-max), 100%);
  margin: 0 auto 28px;
  border: 1px solid var(--border-soft);
  border-radius: 16px;
  background: #14151a;
  padding: 18px 20px;
}
.export-meta-row {
  display: flex;
  align-items: center;
  gap: 16px;
}
.export-logo {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 7%),
    0 10px 26px rgb(0 0 0 / 24%);
}
.export-header h1 {
  margin: 18px 0 0;
  font-size: 20px;
  line-height: 1.25;
}
.export-header dl {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(100px, 0.9fr) minmax(220px, 1.8fr)
    minmax(90px, 0.7fr) minmax(150px, 1fr);
  gap: 12px;
  margin: 0;
}
.export-header dt {
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.export-header dd {
  overflow-wrap: anywhere;
  margin: 4px 0 0;
  color: #d9dbe3;
  font-size: 13px;
}
.transcript { display: grid; gap: 0; }
.message {
  width: min(var(--content-max), 100%);
  margin-right: auto;
  margin-left: auto;
  color: #e2e3ea;
  font-size: 14px;
  line-height: 1.45;
}
.message p { margin: 0 0 12px; }
.message-meta {
  margin-bottom: 6px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.02em;
}
.message-meta-row { display: flex; align-items: center; gap: 7px; }
.compact-message { margin-top: 14px; }
.transcript-message {
  border-radius: 10px;
  padding: 2px 0;
  transition:
    background-color var(--motion-base) var(--ease-standard),
    border-color var(--motion-base) var(--ease-standard),
    opacity var(--motion-base) var(--ease-standard),
    transform var(--motion-base) var(--ease-standard);
}
.assistant-message {
  background: rgb(124 92 255 / 5%);
  padding: 8px 12px;
  color: #d8dbe3;
}
.assistant-message .message-meta { color: var(--muted); }
.thinking-block {
  margin: 0 0 8px;
  border: 1px solid #2b2d36;
  border-radius: 9px;
  background: #15161b;
  transition:
    border-color var(--motion-base) var(--ease-standard),
    background-color var(--motion-base) var(--ease-standard);
}
.thinking-block.is-expanded {
  border-color: #353740;
  background: #181a20;
}
.thinking-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 11px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-align: left;
  cursor: pointer;
  border: none;
  background: transparent;
}
.thinking-trigger:hover { color: #c9c9c9; }
.thinking-trigger .thinking-label {
  color: var(--muted);
}
.thinking-trigger .chevron {
  display: inline-block;
  font-size: 14px;
  line-height: 1;
  transition:
    transform var(--motion-base) var(--ease-emphasized),
    color var(--motion-base) var(--ease-standard);
}
.thinking-block.is-expanded .thinking-trigger .chevron {
  transform: rotate(90deg);
}
.thinking-expand-wrapper {
  display: grid;
  grid-template-rows: 1fr;
}
.thinking-expand-inner {
  overflow: auto;
  max-height: 180px;
  min-height: 0;
}
.thinking-expand-inner pre {
  margin: 0;
  padding: 0 11px 9px;
  color: #a3a3a3;
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.45;
}
.assistant-text-block + .thinking-block,
.thinking-block + .assistant-text-block { margin-top: 8px; }
.user-message {
  margin-top: 22px;
  border: 1px solid #40384d;
  border-radius: 12px;
  background: #1d1a27;
  padding: 10px 12px;
  box-shadow: 0 1px 0 rgb(255 255 255 / 4%) inset;
}
.user-message .message-meta { color: #bfb5ff; }
.message-images {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}
.message-images img {
  max-width: min(360px, 100%);
  max-height: 320px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 10px;
  object-fit: contain;
}
.summary-message {
  border-left: 2px solid #4f5360;
  padding-left: 12px;
  color: #aeb2bd;
}
.entry-text { margin-bottom: 0 !important; }
.markdown-body p,
.markdown-body ul,
.markdown-body ol,
.markdown-body pre,
.markdown-body blockquote { margin: 0 0 10px; }
.markdown-body > :last-child { margin-bottom: 0; }
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 {
  margin: 14px 0 8px;
  color: var(--text);
  font-size: 15px;
  line-height: 1.25;
}
.markdown-body h1:first-child,
.markdown-body h2:first-child,
.markdown-body h3:first-child,
.markdown-body h4:first-child { margin-top: 0; }
.markdown-body ul,
.markdown-body ol { padding-left: 20px; }
.markdown-body li { margin: 3px 0; }
.markdown-body code {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-soft);
  padding: 1px 5px;
  color: #e5e5e5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.92em;
}
.markdown-body pre {
  overflow: auto;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  background: #131419;
  padding: 10px 12px;
}
.markdown-body pre code {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
}
.markdown-body blockquote {
  border-left: 2px solid #4f5360;
  padding-left: 10px;
  color: #adb1bc;
}
.markdown-body a { color: #bfb5ff; text-decoration: none; }
.tool-card {
  width: min(var(--content-max), 100%);
  margin: 8px auto 0;
  border: 1px solid #292b34;
  border-radius: 12px;
  background: #131419;
  padding: 8px 10px;
  color: #bdbdbd;
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color var(--motion-base) var(--ease-standard),
    background-color var(--motion-base) var(--ease-standard),
    opacity var(--motion-base) var(--ease-standard),
    transform var(--motion-base) var(--ease-standard);
}
.tool-card summary { list-style: none; cursor: pointer; }
.tool-card summary::-webkit-details-marker { display: none; }
.tool-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #777;
  font-size: 12px;
  font-weight: 700;
}
.tool-card-header > span:first-child {
  transition: color var(--motion-base) var(--ease-standard);
}
.tool-card-header .chevron,
.tool-card-header .tool-chevron {
  display: inline-block;
  transition:
    transform var(--motion-base) var(--ease-emphasized),
    color var(--motion-base) var(--ease-standard);
}
.tool-card[open] .chevron,
.tool-card[open] .tool-chevron {
  transform: rotate(90deg);
}
.transcript-tool.is-expanded {
  border-color: #33353f;
  background: #171820;
}
.transcript-tool.is-expanded:hover {
  border-color: #3b3d49;
  background: #1a1c25;
}
.transcript-tool:hover {
  border-color: var(--border);
  background: #181a21;
  transform: translateY(-0.5px);
  transition-duration: var(--motion-quick);
  transition-timing-function: var(--ease-accelerate);
}
.tool-card-header em {
  margin-left: auto;
  color: #82d69a;
  font-style: normal;
  font-size: 11px;
  text-transform: uppercase;
}
.error-card .tool-card-header em { color: #fca5a5; }
.tool-card-header code {
  overflow: hidden;
  min-width: 0;
  border: 1px solid var(--border-soft);
  border-radius: 7px;
  background: #17181e;
  padding: 2px 6px;
  color: #aaa;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-context-pill {
  border: 1px solid rgb(130 214 154 / 24%);
  border-radius: 999px;
  padding: 1px 7px;
  color: #82d69a;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  transition:
    border-color var(--motion-base) var(--ease-decelerate),
    color var(--motion-base) var(--ease-decelerate),
    opacity var(--motion-base) var(--ease-decelerate);
}
.tool-context-pill.is-excluded { border-color: var(--border); color: var(--muted); }
.tool-expanded-body {
  margin-top: 9px;
  border-top: 1px solid var(--border-soft);
  padding-top: 9px;
  transition: border-top-color var(--motion-base) var(--ease-decelerate);
}
.tool-output {
  overflow: auto;
  max-height: 420px;
  margin: 0;
  background: #0f1014;
  padding: 14px 16px;
  color: #b8b8b8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
}
.tool-output code {
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  white-space: pre-wrap;
}
.tool-image-preview img {
  max-width: 100%;
  max-height: 520px;
  border-radius: 10px;
  object-fit: contain;
}
.json-output .json-key { color: #bfb5ff; }
.json-output .json-string { color: #b8e6c1; }
.json-output .json-number { color: #f7c986; }
.json-output .json-boolean { color: #8fbfff; }
.json-output .json-null { color: #fca5a5; }
.hljs { background: transparent; color: #d8dbe3; }
.hljs-comment,
.hljs-quote { color: var(--syntax-comment); }
.hljs-keyword,
.hljs-selector-tag { color: var(--syntax-keyword); }
.hljs-number,
.hljs-literal { color: var(--syntax-number); }
.hljs-string,
.hljs-doctag { color: var(--syntax-string); }
.hljs-function,
.hljs-title,
.hljs-title.function_,
.hljs-section,
.hljs-name { color: var(--syntax-function); }
.hljs-type,
.hljs-class,
.hljs-title.class_,
.hljs-built_in { color: var(--syntax-type); }
.hljs-attr,
.hljs-variable,
.hljs-variable.language_,
.hljs-params,
.hljs-property { color: var(--syntax-variable); }
.hljs-meta,
.hljs-meta .hljs-keyword,
.hljs-meta .hljs-string { color: var(--syntax-keyword); }
.hljs-operator { color: var(--syntax-operator); }
.hljs-punctuation { color: var(--syntax-punctuation); }
.hljs-subst { color: #d8dbe3; }
.hljs-regexp { color: var(--syntax-string); }
.hljs-symbol,
.hljs-bullet { color: var(--syntax-keyword); }
.hljs-addition { color: var(--syntax-string); }
.hljs-deletion { color: var(--syntax-variable); }
.skill-summary-list { display: grid; gap: 8px; }
.skill-summary-list summary { list-style: none; cursor: pointer; }
.skill-summary-list summary::-webkit-details-marker { display: none; }
.skill-summary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  border: 1px solid rgb(124 92 255 / 22%);
  border-radius: 9px;
  background: rgb(124 92 255 / 10%);
  padding: 7px 9px;
  color: #d9d5e8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color var(--motion-base) var(--ease-decelerate),
    background-color var(--motion-base) var(--ease-decelerate),
    transform var(--motion-base) var(--ease-decelerate);
}
.skill-summary:hover {
  border-color: rgb(124 92 255 / 40%);
  background: rgb(124 92 255 / 14%);
  transform: translateY(-0.5px);
  transition-duration: var(--motion-quick);
  transition-timing-function: var(--ease-accelerate);
}
.skill-summary span { color: #9d7dff; font-weight: 800; }
.skill-summary strong { color: #e4e2ec; font-weight: 700; }
.skill-summary em { color: var(--muted); font-style: normal; }
.skill-expanded {
  max-height: 520px;
  overflow: auto;
  margin-top: 8px;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  background: #111217;
  padding: 10px 12px;
  transition:
    border-color var(--motion-base) var(--ease-decelerate),
    opacity var(--motion-base) var(--ease-decelerate);
}
.empty-workbench {
  width: min(var(--content-max), 100%);
  margin: 0 auto;
  color: var(--muted);
}
@media (max-width: 760px) {
  .export-shell { padding: 16px 12px 42px; }
  .export-meta-row { align-items: flex-start; flex-wrap: wrap; }
  .export-header dl {
    flex-basis: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .assistant-message { padding-left: 0; }
  .user-message { padding: 9px 10px; }
  .tool-card-header { gap: 7px; }
}
@media (prefers-reduced-motion: reduce) {
  .transcript-message,
  .tool-card,
  .skill-summary,
  .thinking-block,
  .thinking-trigger .chevron,
  .tool-chevron,
  .tool-expanded-body,
  .tool-context-pill,
  .skill-expanded {
    transition-duration: 1ms;
  }
  .tool-card:hover {
    transform: none;
  }
  .skill-summary:hover {
    transform: none;
  }
  .tool-card[open] .chevron,
  .tool-card[open] .tool-chevron {
    transform: rotate(90deg);
  }
}`
}
