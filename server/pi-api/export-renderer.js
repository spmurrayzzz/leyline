import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'
import { parseDiffFromFile } from '@pierre/diffs'
import { configureMarkdownLinks } from '../../lib/markdown-file-links.js'
import { projectContextView, systemPromptInfo, systemSectionTitle } from '../../lib/system-prompt.js'
import { subagentStatus, subagentStatuses, subagentSummary } from '../../lib/subagent-status.js'
import { subagentCallTitle, subagentEmptyText, subagentFallback, subagentModelChips, subagentOutput, subagentTasks, subagentTaskTitle } from '../../lib/subagent-view.js'
import { subagentLedgerRows } from '../../lib/subagent-ledger.js'
import { activityEntry, activitySummary, groupToolActivity, mobileToolStatus, singleSubagentEntry, toolStatusTone } from '../../lib/tool-activity.js'
import {
  imageBlocksFor,
  messageBlocksFor,
  parseSkillPrompt,
  skillReadName,
  skillSummaries,
  textFromContent,
} from '../../lib/transcript-projection.js'

const exportMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

configureMarkdownLinks(exportMarkdown, { interactive: false })

const exportImage = exportMarkdown.renderer.rules.image
exportMarkdown.renderer.rules.image = (tokens, index, options, env, renderer) => env.subagentExport
  ? `<span class="markdown-image-reference">Image: ${escapeHtml(tokens[index].content || 'Untitled')}</span>`
  : exportImage(tokens, index, options, env, renderer)

exportMarkdown.renderer.rules.table_open = () =>
  '<div class="table-wrap"><table>'
exportMarkdown.renderer.rules.table_close = () =>
  '</table></div>'

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

export async function renderSessionExportHtml(detail, shareMeta = {}, options = {}) {
  const renderEnv = { autolinkBareFilenames: options.autolinkBareFilenames === true }
  const session = detail.session
  const title = session.name || session.firstMessage || 'Untitled session'
  const entries = detail.entries
    .filter(isExportRenderableEntry)
    .map(toExportEntry)
  const entryIndices = new Map(entries.map((entry, index) => [entry, index]))
  const body = groupToolActivity(entries).map(item => {
    if (item.type !== 'tool-activity') return renderExportEntry(item, entryIndices.get(item), renderEnv)
    const summary = activitySummary(item.items)
    const inspectOnly = Boolean(singleSubagentEntry(item))
    const disclosure = inspectOnly
      ? '<svg class="mobile-activity-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4h7v7M20 4 10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg>'
      : '<span class="mobile-activity-chevron" aria-hidden="true">›</span>'
    const statusLabel = [
      ...(summary.busy ? ['running'] : []),
      ...summary.outcomes.map(outcome => outcome.text),
    ].join(' · ') || 'Completed'
    const outcomeHtml = summary.outcomes.length
      ? `<span class="mobile-activity-outcomes">${summary.outcomes.map(outcome => `<span class="status-${outcome.status}">${escapeHtml(outcome.text)}</span>`).join('')}</span>`
      : summary.busy ? '<span class="mobile-activity-live">running</span>' : '<span class="mobile-activity-check" aria-hidden="true">✓</span>'
    return `<section class="export-tool-activity mobile-activity-card${inspectOnly ? '' : ' is-expanded'}${summary.hasSubagents ? ' has-subagents' : ''}"${inspectOnly ? ' data-subagent-only' : ''}>
<button type="button" class="mobile-activity-summary" ${inspectOnly ? 'aria-haspopup="dialog" title="Inspect subagent tasks"' : 'aria-expanded="true"'}>
<span class="mobile-activity-heading"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 4.5-9 4.5-9-4.5L12 3ZM3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5" /></svg><strong>${item.items.length} tool ${item.items.length === 1 ? 'call' : 'calls'}</strong><span class="mobile-activity-state" title="${escapeHtml(statusLabel)}" aria-label="${escapeHtml(statusLabel)}">${summary.busy ? '<span class="mobile-activity-spinner" aria-hidden="true"></span>' : ''}${outcomeHtml}</span>${disclosure}</span>
<span class="mobile-activity-breakdown">${item.operations.map(operation => `<span>${escapeHtml(operation)}</span>`).join('')}</span>
</button>
<div class="mobile-activity-list">${item.items.map(call => renderExportEntry(activityEntry(call), entryIndices.get(call), renderEnv)).join('\n')}</div>
</section>`
  }).join('\n')
  const researchSources = renderExportResearchSources(session.research)
  const exportData = Buffer.from(JSON.stringify({
    entries,
    subagentOutputs: entries.map(entry => entry.toolName === 'subagent' ? subagentTasks(entry).map(subagentOutput) : null),
  })).toString('base64')

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
<div><dt>Tokens</dt><dd>${escapeHtml(formatExportTokens(session.contextTokens))}</dd></div>
<div><dt>Modified</dt><dd>${escapeHtml(formatExportDate(session.modified))}</dd></div>
</dl>
</div>
<h1>${escapeHtml(title)}</h1>
</header>
<section class="transcript">
${body || '<div class="empty-workbench">No transcript entries found.</div>'}
${researchSources}
</section>
</main>
<script id="export-data" type="application/json">${exportData}</script>
<script>${systemInspectorJs()}</script>
<script>${subagentInspectorJs()}</script>
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
  <rect width="128" height="128" rx="28" fill="#161616"/>
  <rect x="0.75" y="0.75" width="126.5" height="126.5" rx="27.25" fill="none" stroke="#2a2a2a" stroke-width="1.5"/>
  <g transform="translate(5 7.3) scale(0.9)">
    <path d="M63 72c12 3 22 11 31 24" fill="none" stroke="#8a78ff" stroke-width="9" stroke-linecap="round"/>
    <path d="M33 96c17-8 27-22 30-42 3-16 15-24 35-24" fill="none" stroke="#8a78ff" stroke-width="9" stroke-linecap="round"/>
    <g fill="#e6e6e8">
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
  if (entry.toolName === 'subagent' && entry.subagentDetails?.results) {
    entry = {
      ...entry,
      subagentDetails: {
        ...entry.subagentDetails,
        results: entry.subagentDetails.results.map(task => ({
          ...task,
          messages: (task.messages || []).filter(message => ['assistant', 'error'].includes(message.role))
            .map(({ role, content, timestamp }) => ({ role, content: textFromContent(content), timestamp })),
        })),
      },
    }
  }
  if (!entry.preview) return entry

  const next = { ...entry, text: '', toolOutcome: mobileToolStatus(entry) }
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

function renderExportEntry(entry, index, env) {
  if (entry.type === 'tool') return renderExportTool(entry, index)
  if (entry.type === 'system') return renderExportSystem(entry, index, env)
  if (entry.type === 'model-change') return renderExportModelChange(entry)
  return renderExportMessage(entry, env)
}

function renderExportModelChange(entry) {
  const from = entry.fromModel
  const to = entry.toModel
  return `<div class="model-change-row">
<span class="model-change-label">
<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
<path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z" />
<path d="m3 8 9 5 9-5M12 13v8M8 5l9 5" />
</svg>
<span>Model changed from <strong title="${escapeHtml(`${from.provider}/${from.id}`)}">${escapeHtml(from.name)}</strong> to <strong title="${escapeHtml(`${to.provider}/${to.id}`)}">${escapeHtml(to.name)}</strong></span>
</span>
</div>`
}

function skillIcon() {
  return '<svg class="skill-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5-4 7 4 7m8-14 4 7-4 7M14 4l-4 16" /></svg>'
}

function toolStatusMark(tone) {
  if (tone === 'running') return '<span class="tool-status-spinner" aria-hidden="true"></span>'
  if (tone === 'stopped') return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5h6v6H5z" /></svg>'
  if (tone === 'unknown') return '<span class="tool-status-question" aria-hidden="true">?</span>'
  const path = tone === 'error'
    ? 'M4.3 4.3 11.7 11.7M11.7 4.3 4.3 11.7'
    : 'M3.1 8.5 6.4 11.7 12.9 4.4'
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${path}" /></svg>`
}

function renderExportTool(entry, index) {
  if (entry.toolName === 'subagent') {
    return renderExportSubagent(entry, index)
  }
  const status = mobileToolStatus(entry)
  const tone = toolStatusTone(status)
  const skill = skillReadName(entry)
  const skillStatus = { completed: 'Loaded', running: 'Loading', error: 'Failed', stopped: 'Stopped', unknown: 'Unknown' }[tone]
  const statusLabel = skill ? skillStatus : status
  return `<details class="tool-card transcript-tool${skill ? ' skill-tool-card' : ''}${['error', 'failed'].includes(status) ? ' error-card' : ''}">
<summary class="tool-card-header">
${skill ? skillIcon() : '<span class="chevron tool-chevron">›</span>'}
<span class="tool-label"${skill ? ` title="${escapeHtml(entry.preview?.path || entry.code || '')}"` : ''}>${escapeHtml(skill || entry.label)}</span>
${skill ? '<svg class="chevron skill-tool-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>' : ''}
${entry.code && !skill ? `<code>${escapeHtml(entry.code)}</code>` : ''}
${entry.contextLabel ? renderToolContext(entry) : ''}
<span class="tool-status-mark status-${tone}" title="${escapeHtml(statusLabel)}" role="img" aria-label="${escapeHtml(statusLabel)}">${toolStatusMark(tone)}${skill ? `<span class="skill-tool-status" aria-hidden="true">${skillStatus}</span>` : ''}</span>
</summary>
${entry.code && !['bash', 'search_memory'].includes(entry.toolName) ? `<div class="mobile-tool-target"><code>${escapeHtml(entry.preview?.path || entry.code)}</code></div>` : ''}
<div class="tool-expanded-body" data-tool-index="${index}">
<div class="tool-lazy-placeholder">Open to render preview</div>
</div>
</details>`
}

function renderSystemFileDiff(preview) {
  try {
    const diff = parseDiffFromFile(
      { name: preview.path, contents: preview.oldText },
      { name: preview.path, contents: preview.newText },
      { context: 3, timeout: 1000 },
      true,
    )
    const rows = []
    const row = (type, text) => rows.push(`<span data-line-type="${type}">${escapeHtml(text.replace(/\r?\n$/, ''))}</span>`)
    const lines = (type, prefix, source, start, count, noNewline) => {
      for (let index = start; index < start + count; index++) {
        row(type, prefix + source[index])
        if (noNewline && index === source.length - 1) row('metadata', '\\ No newline at end of file')
      }
    }
    for (const hunk of diff.hunks) {
      row('metadata', hunk.hunkSpecs)
      for (const part of hunk.hunkContent) {
        if (part.type === 'context') {
          lines('context', ' ', diff.additionLines, part.additionLineIndex, part.lines, hunk.noEOFCRAdditions)
        } else {
          lines('deletion', '-', diff.deletionLines, part.deletionLineIndex, part.deletions, hunk.noEOFCRDeletions)
          lines('addition', '+', diff.additionLines, part.additionLineIndex, part.additions, hunk.noEOFCRAdditions)
        }
      }
    }
    return `<pre class="system-prompt-diff" aria-label="Recorded file changes">${rows.join('')}</pre>`
  } catch {
    return `<p class="system-prompt-notice">Diff unavailable. Both recorded versions are shown below.</p>
<h4>Before</h4><pre class="system-prompt-raw">${escapeHtml(preview.oldText)}</pre>
<h4>After</h4><pre class="system-prompt-raw">${escapeHtml(preview.newText)}</pre>`
  }
}

function renderExportProjectContextFile(file, initial, env) {
  const label = `<code title="${escapeHtml(file.path)}">${escapeHtml(file.label)}</code>`
  if (file.status === 'unchanged' && !initial) {
    return `<details class="system-prompt-file is-unchanged"><summary>${label}<span> · unchanged</span></summary><div class="system-prompt-prose markdown-body">${renderMarkdown(file.content, env)}</div></details>`
  }
  const content = file.preview
    ? renderSystemFileDiff(file.preview)
    : `<div class="system-prompt-prose markdown-body">${renderMarkdown(file.content, env)}</div>`
  return `<div class="system-prompt-file"><h4>${label}${initial ? '' : `<span> · ${escapeHtml(file.statusLabel)}</span>`}</h4>${content}</div>`
}

function renderExportSystem(entry, index, env) {
  const info = systemPromptInfo(entry)
  const sections = entry.sections || []
  const tools = [
    ...(entry.toolsAdded || []),
    ...(entry.toolsRemoved || []).map((name) => ({ name, removed: true })),
  ]
  const promptSelected = Boolean(sections.length || !tools.length)
  const id = `system-${index}`
  const context = projectContextView(entry)
  const prompt = sections.map((section) => {
    const files = section.name === 'project_context' ? context.files : []
    const body = files.length
      ? [...files.filter((file) => file.status !== 'unchanged'), ...files.filter((file) => file.status === 'unchanged')]
        .map((file) => renderExportProjectContextFile(file, info.initial, env)).join('')
      : section.removed ? '' : `<div class="system-prompt-prose markdown-body">${renderMarkdown(section.text, env)}</div>`
    const notice = section.name === 'project_context' && context.notice
      ? `<p class="system-prompt-notice">${escapeHtml(context.notice)}</p>` : ''
    return `<section class="system-prompt-section">
<h3>${escapeHtml(systemSectionTitle(section.name))}${section.removed ? '<span> · removed</span>' : info.initial ? '' : '<span> · updated</span>'}</h3>
${notice}${body}
</section>`
  }).join('') || (tools.length
    ? '<p class="system-prompt-empty">No prompt sections changed in this event.</p>'
    : `<div class="system-prompt-prose markdown-body">${renderMarkdown(entry.text, env)}</div>`)
  const toolContent = tools.map((tool) => `<section class="system-prompt-section">
<h3><code>${escapeHtml(tool.name)}</code>${tool.removed ? '<span> · removed</span>' : info.initial ? '' : '<span> · added</span>'}</h3>
${tool.removed ? '' : `<div class="system-prompt-prose markdown-body">${renderMarkdown(tool.description, env)}</div>`}
</section>`).join('') || `<p class="system-prompt-empty">${info.initial ? 'No tools declared in this event.' : 'No tools changed in this event.'}</p>`

  return `<details class="system-prompt-export" name="system-inspectors" data-system-index="${index}">
<summary class="system-prompt-row" aria-controls="${id}-inspector" title="${escapeHtml(`${info.title} · ${info.summary}`)}">
<span class="system-prompt-trigger">
<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H5v18h14V8l-5-5Z" /><path d="M14 3v5h5M8 12h8M8 16h6" /></svg>
<span class="system-prompt-label">${escapeHtml(info.title)}</span>
<span class="system-prompt-meta">· ${escapeHtml(info.summary)}</span>
<svg class="system-prompt-open-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>
</span>
</summary>
<aside id="${id}-inspector" class="system-prompt-inspector" tabindex="-1" aria-labelledby="${id}-title">
<header class="system-prompt-header">
<div><h2 id="${id}-title">${escapeHtml(info.title)}</h2><p>${info.initial ? 'Initial prompt · ' : ''}${escapeHtml(info.summary)}</p></div>
<button class="system-prompt-icon-button" type="button" aria-label="Close prompt inspector" data-system-close><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
</header>
<div class="system-prompt-tabs" role="tablist" aria-label="System content">
<button id="${id}-prompt-tab" type="button" role="tab" aria-selected="${promptSelected}" tabindex="${promptSelected ? 0 : -1}" aria-controls="${id}-prompt-panel">${info.initial ? 'Prompt' : 'Changes'} <span>${sections.length}</span></button>
<button id="${id}-tools-tab" type="button" role="tab" aria-selected="${!promptSelected}" tabindex="${promptSelected ? -1 : 0}" aria-controls="${id}-tools-panel">Tools <span>${tools.length}</span></button>
</div>
<div class="system-prompt-body" tabindex="0" aria-label="System prompt contents">
<pre class="system-prompt-raw" hidden>${escapeHtml(entry.text)}</pre>
<div id="${id}-prompt-panel" role="tabpanel" aria-labelledby="${id}-prompt-tab"${promptSelected ? '' : ' hidden'}>${prompt}</div>
<div id="${id}-tools-panel" role="tabpanel" aria-labelledby="${id}-tools-tab"${promptSelected ? ' hidden' : ''}>${toolContent}</div>
</div>
<footer class="system-prompt-footer">
<span>${escapeHtml(info.caption)}</span>
<div>
<button type="button" aria-pressed="false" data-system-raw>Raw text</button>
<button type="button" title="Copy system event" data-system-copy><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><span aria-live="polite">Copy</span></button>
</div>
</footer>
</aside>
</details>`
}

function exportSubagentRow(key, text, properties) {
  const [row] = subagentLedgerRows([{ key, item: { type: 'message', role: 'assistant', text, timestamp: properties.timestamp } }])
  return { ...row, key, ...properties }
}

function exportSubagentRows(entry, task, active) {
  const status = task ? subagentStatus(task, active) : subagentFallback(entry).status
  const rows = (task?.messages || []).flatMap((message, index) => message.content.trim() ? [
    exportSubagentRow(`message:${index}`, message.content, {
      kind: message.role === 'error' ? 'error' : 'message',
      action: message.role === 'error' ? 'Error' : 'Message',
      status: message.role === 'error' ? 'error' : 'saved',
      timestamp: message.timestamp,
      source: 'message',
      messageIndex: index,
    }),
  ] : [])
  const output = task ? subagentOutput(task) : ''
  const matching = output && rows.findLast(row => row.text.trim() === output.trim())
  if (matching?.kind === 'message' && status === 'completed') {
    matching.kind = 'result'
    matching.action = 'Result'
  } else if (output && !matching) {
    rows.push(exportSubagentRow('result', output, { kind: 'result', action: status === 'running' ? 'Output' : 'Result', status: status === 'failed' ? 'error' : 'saved', source: 'output' }))
  }
  if (task?.error && !rows.some(row => row.text.trim() === task.error.trim())) {
    rows.push(exportSubagentRow('error', task.error, { kind: 'error', action: 'Error', status: 'error', source: 'error' }))
  }
  if (entry.text && (!task || entry.subagentDetails?.resultsUnavailable)) {
    rows.push(exportSubagentRow('call', entry.text, { kind: 'call', action: 'Call output', status: 'saved', source: 'call' }))
  }
  return rows
}

function renderExportSubagentRow(row) {
  const size = row.text.length >= 1000 ? `${(row.text.length / 1000).toFixed(1)}k` : row.text.length
  return `<button class="subagent-ledger-row" type="button" data-subagent-tail-entry="${escapeHtml(row.key)}" data-subagent-open="${escapeHtml(row.key)}" title="${escapeHtml(row.title)}">
<span class="subagent-ledger-icon"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5l3 3v10H4zM9 1.5v3h3M6 8h4m-4 3h4" /></svg></span>
<span class="subagent-ledger-body"><span class="subagent-ledger-line"><span class="subagent-ledger-action">${row.action}</span><span class="subagent-ledger-target">${escapeHtml(row.title)}</span></span>${row.excerpt ? `<span class="subagent-ledger-excerpt">${escapeHtml(row.excerpt)}</span>` : ''}</span>
<span class="subagent-ledger-outcome"><span class="subagent-ledger-status status-${row.status}">${row.status === 'error' ? 'Failed' : 'Saved'}</span><span class="subagent-ledger-size">${size} chars</span></span>
</button>`
}

function renderExportSubagentReader(row) {
  const raw = ['prompt', 'call', 'error'].includes(row.kind)
  const time = row.timestamp != null && !Number.isNaN(new Date(row.timestamp).getTime())
    ? new Date(row.timestamp).toLocaleTimeString() : ''
  return `<template data-subagent-entry-content="${escapeHtml(row.key)}" data-subagent-source="${row.source}"${row.source === 'message' ? ` data-subagent-message="${row.messageIndex}"` : ''} data-subagent-format="${raw ? 'raw' : 'formatted'}">
<div class="subagent-entry-nav"><button class="subagent-entry-back" type="button" data-subagent-back><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M14 8H2m5-5L2 8l5 5" /></svg>Back to activity</button><span>${row.text.length.toLocaleString()} chars · ${row.text.split('\n').length.toLocaleString()} lines</span></div>
<div class="subagent-entry-sections">
<header class="subagent-entry-header">
<h3 class="subagent-entry-title">${escapeHtml(row.title)}</h3><div class="subagent-entry-meta"><span>${row.action}</span>${time ? `<span>${escapeHtml(time)}</span>` : ''}<span class="subagent-ledger-status status-${row.status}">${row.status === 'error' ? 'Failed' : 'Saved'}</span></div>
</header>
<nav class="subagent-entry-formats" aria-label="Content format"><button type="button" data-subagent-format="formatted" aria-pressed="${!raw}">Formatted</button><button type="button" data-subagent-format="raw" aria-pressed="${raw}">Source</button><button class="subagent-entry-copy" type="button" data-subagent-copy-text title="Copy full text" aria-label="Copy full text"><span aria-live="polite">Copy full text</span></button></nav>
<div class="subagent-entry-scroll" tabindex="0" aria-label="Full entry content"><div class="subagent-inspector-output markdown-body"${raw ? ' hidden' : ''}>${renderMarkdown(row.text, { subagentExport: true })}</div><pre class="subagent-entry-raw"${raw ? '' : ' hidden'}></pre><p class="subagent-entry-end">End of entry. Full text retained.</p></div>
<div class="subagent-entry-position"><span>Start of entry</span><button type="button" data-subagent-jump>Jump to end</button></div>
</div>
</template>`
}

function exportSubagentModelChips(task) {
  const chips = subagentModelChips(task)
  const model = chips.model
    ? `<span class="subagent-inspector-model"${chips.model.title ? ` title="${escapeHtml(chips.model.title)}"` : ''}><span>Model</span><code>${escapeHtml(chips.model.code)}</code>${chips.model.source ? `<span class="subagent-inspector-model-source">· ${escapeHtml(chips.model.source)}</span>` : ''}</span>`
    : ''
  return model + (chips.thinking
    ? `<span class="subagent-inspector-thinking"><span>Thinking</span><code>${escapeHtml(chips.thinking.level)}</code></span>`
    : '')
}

function renderExportSubagent(entry, index) {
  const tasks = subagentTasks(entry)
  const outcome = subagentSummary(entry)
  const fallback = subagentFallback(entry)
  const label = entry.researchThreads ? 'Research threads' : 'Subagent'
  const callTitle = subagentCallTitle(entry)
  const title = tasks.length ? callTitle : 'Task details'
  const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg>'
  const status = task => {
    const key = task ? subagentStatus(task, outcome.active) : fallback.status
    return `<span class="subagent-task-status status-${key}">${task ? subagentStatuses[key].label : escapeHtml(fallback.label)}</span>`
  }
  const summary = `<div class="subagent-summary" aria-label="Task outcomes">${outcome.counts.length
    ? outcome.counts.map(count => `<span class="status-${count.status}">${escapeHtml(count.text)}</span>`).join('')
    : status()}</div>`
  const taskTemplates = (tasks.length ? tasks : [undefined]).map((task, taskIndex) => {
    const key = task ? subagentStatus(task, outcome.active) : fallback.status
    const rows = exportSubagentRows(entry, task, outcome.active)
    const latest = rows.findLast(row => ['message', 'result'].includes(row.kind))
    const prompt = task?.task ? exportSubagentRow('prompt', task.task, { kind: 'prompt', action: 'Task prompt', title: 'Full task prompt', status: 'saved', source: 'prompt' }) : null
    return `<template data-subagent-task-content="${taskIndex}">
<div class="subagent-inspector-meta">${task ? exportSubagentModelChips(task) : ''}${task?.research ? `<span>${escapeHtml(task.research.sources?.length || 0)} sources</span>` : ''}${status(task)}</div>
<template data-subagent-ledger><div class="subagent-ledger-overview">
<div class="subagent-ledger-summary" tabindex="0" aria-label="Latest activity">
${latest ? `<section class="subagent-ledger-latest"><div class="subagent-ledger-latest-heading"><span><span class="subagent-ledger-latest-icon"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2.5h12v8H7l-3.5 3v-3H2z" /></svg></span>Latest response</span><button type="button" data-subagent-open="${escapeHtml(latest.key)}">Read full · ${latest.text.length.toLocaleString()} chars</button></div><h3>${escapeHtml(latest.title)}</h3>${latest.excerpt ? `<p>${escapeHtml(latest.excerpt)}</p>` : ''}</section>` : ''}
</div>
<div class="subagent-ledger-labels"><span class="subagent-ledger-activity-label">Activity</span><span>${rows.length} entries · ${rows.filter(row => row.kind === 'tool').length} calls</span><span class="subagent-ledger-connection">Saved task output</span></div>
<div class="subagent-ledger-scroll" tabindex="0" aria-label="Saved task output"><div class="subagent-ledger-rows">${rows.map(renderExportSubagentRow).join('')}${rows.length ? '' : `<p class="subagent-inspector-empty">${escapeHtml(task ? subagentEmptyText(key) : 'Individual task details are unavailable.')}</p>`}</div></div>
</div></template>
${[...rows, ...(prompt ? [prompt] : [])].map(renderExportSubagentReader).join('')}
</template>`
  }).join('')

  return `<div class="tool-card subagent-card transcript-tool">
<div class="subagent-header">
<button type="button" class="tool-inspect-button" data-subagent-index="${index}" aria-haspopup="dialog" aria-label="${escapeHtml(`Inspect ${label}: ${callTitle}`)}">
<span class="subagent-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M3 2.5v4A3.5 3.5 0 0 0 6.5 10H13" /><path d="m10 7 3 3-3 3" /></svg></span>
<span class="subagent-label">${label}</span>
<span class="subagent-call-title">${escapeHtml(callTitle)}</span>
<svg class="subagent-inspect-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4h7v7M20 4 10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg>
</button>
</div>
<template id="subagent-template-${index}">
<div class="subagent-inspector-context" tabindex="0" aria-label="Task details">
<header class="subagent-inspector-header">
<div class="subagent-inspector-heading"><p>${label}<span class="subagent-inspector-agent" data-subagent-agent hidden></span></p><h2 id="subagent-inspector-title">${escapeHtml(title)}</h2></div>
<div class="subagent-inspector-actions">
<button class="subagent-inspector-icon-button" type="button" title="Copy tool output" aria-label="Copy tool output" data-subagent-copy-tool>${copyIcon}</button>
<button class="subagent-inspector-icon-button" type="button" aria-label="Close subagent inspector" data-subagent-close><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
</div>
<button class="subagent-inspector-prompt" type="button" data-subagent-open="prompt" hidden>Full task prompt <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg></button>
${tasks.length !== 1 ? summary : ''}
</header>
${tasks.length > 1 ? `<nav class="subagent-inspector-tasks" aria-label="Subagent tasks">${tasks.map((task, taskIndex) => `<button class="subagent-inspector-task" type="button" data-subagent-task="${taskIndex}" aria-pressed="${taskIndex === 0}" title="${escapeHtml(subagentTaskTitle(task, taskIndex))}"><span class="subagent-inspector-index">${taskIndex + 1}</span><span class="subagent-inspector-task-label">${escapeHtml(subagentTaskTitle(task, taskIndex))}</span>${status(task)}</button>`).join('')}</nav>` : ''}
<div class="subagent-inspector-meta"></div>
</div>
<div class="subagent-inspector-reader-stack"><div class="subagent-inspector-content"></div></div>
${taskTemplates}
<footer class="subagent-inspector-footer"><span>Child sessions are available in Leyline</span><span class="subagent-tail-following" data-subagent-reading>Saved task output</span></footer>
</template>
</div>`
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

function renderExportMessage(entry, env) {
  const skills = skillSummaries(entry)
  const classes = [
    'message compact-message transcript-message',
    entry.role === 'user' ? 'user-message' : '',
    entry.role === 'assistant' ? 'assistant-message' : '',
    entry.type === 'summary' ? 'summary-message' : '',
    entry.researchReport ? 'research-report-message' : '',
    skills.length ? 'skill-message' : '',
  ].filter(Boolean).join(' ')

  return `<article class="${classes}">
${skills.length ? renderSkillSummaries(entry, skills, env) : ''}
<div class="message-meta message-meta-row"><span>${escapeHtml(entry.label)}</span></div>
${renderExportResearchReportHeading(entry)}
${renderMessageBody(entry, env)}
${renderMessageImages(entry)}
</article>`
}

function renderExportResearchReportHeading(entry) {
  const report = entry.researchReport
  if (!report) return ''
  return `<div class="research-report-heading">
<span class="research-report-icon">R</span>
<span><strong>${escapeHtml(report.title)}</strong><small>Markdown report · ${escapeHtml(report.sourceCount)} sources · ${escapeHtml(report.citedSourceCount)} cited</small></span>
</div>`
}

function renderExportResearchSources(research) {
  if (!research?.sources?.length) return ''
  const sources = research.sources.map((source) => {
    const location = source.publisher || source.url || source.path || ''
    const evidence = source.exclusionReason || source.evidence || source.claim || ''
    const link = source.url
      ? `<a href="${escapeHtml(source.url)}">Open source ↗</a>`
      : source.path ? `<code>${escapeHtml(source.path)}</code>` : ''
    return `<article class="export-research-source${source.status === 'excluded' ? ' is-excluded' : ''}">
<b>${escapeHtml(source.id)}</b>
<div><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(location)}</small>${evidence ? `<p>${escapeHtml(evidence)}</p>` : ''}${link}</div>
<em>${escapeHtml(source.status)}</em>
</article>`
  }).join('')
  return `<section class="export-research-sources"><header><strong>Sources</strong><span>${escapeHtml(research.sourceCount)} total · ${escapeHtml(research.citedSourceCount)} cited · ${escapeHtml(research.excludedSourceCount)} excluded</span></header>${sources}</section>`
}

function renderMessageBody(entry, env) {
  if (entry.role === 'assistant' && entry.blocks?.length) {
    return messageBlocksFor(entry).map(block => renderMessageBlock(block, env)).join('\n')
  }

  if (skillSummaries(entry).length) {
    const userMessage = parseSkillPrompt(entry.text)?.userMessage
    return userMessage ? `<div class="entry-text markdown-body">${renderMarkdown(userMessage, env)}</div>` : ''
  }

  return `<div class="entry-text markdown-body">${renderMarkdown(entry.text, env)}</div>`
}

function renderMessageBlock(block, env) {
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
${renderMarkdown(block.text || '', env)}
</div>`
}

function renderSkillSummaries(entry, skills, env) {
  const rows = skills.map((skill) => {
    return `<span class="skill-summary" title="${escapeHtml(skill.location || '')}">${skillIcon()}<strong>${escapeHtml(skill.name)}</strong><span class="skill-kind">Skill</span><svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></span>`
  }).join('')
  const content = parseSkillPrompt(entry.text)?.content || entry.text || ''

  return `<div class="skill-message-header"><details><summary>${rows}</summary>
<div class="skill-expanded entry-text markdown-body">
${renderMarkdown(content, env)}
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

function renderMarkdown(text, env) {
  return exportMarkdown.render(text || '', env)
}


function projectLabel(cwd) {
  if (!cwd) return 'Unknown project'
  return basename(cwd)
}

function formatExportTokens(value) {
  const count = Number(value)
  if (!Number.isFinite(count) || count <= 0) return '—'
  if (count >= 1_000_000) return `${trimNumber(count / 1_000_000)}M`
  if (count >= 1_000) return `${trimNumber(count / 1_000)}K`
  return String(count)
}

function trimNumber(value) {
  return value.toFixed(1).replace(/\.0$/, '')
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

function systemInspectorJs() {
  return `(() => {
  const encoded = document.getElementById('export-data').textContent
  const { entries } = JSON.parse(new TextDecoder().decode(
    Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)),
  ))
  const inspectors = [...document.querySelectorAll('[data-system-index]')]
  for (const item of inspectors) {
    const pane = item.querySelector('.system-prompt-inspector')
    const trigger = item.querySelector('summary')
    const body = pane.querySelector('.system-prompt-body')
    const tabs = [...pane.querySelectorAll('[role="tab"]')]
    const panels = [...pane.querySelectorAll('[role="tabpanel"]')]
    const raw = pane.querySelector('.system-prompt-raw')
    const rawButton = pane.querySelector('[data-system-raw]')
    const text = entries[Number(item.dataset.systemIndex)].text || ''
    raw.textContent = text
    trigger.setAttribute('aria-expanded', 'false')

    function selectTab(tab) {
      for (const current of tabs) {
        const selected = current === tab
        current.setAttribute('aria-selected', String(selected))
        current.tabIndex = selected ? 0 : -1
      }
      for (const panel of panels) panel.hidden = panel.id !== tab.getAttribute('aria-controls')
      body.scrollTop = 0
    }

    function close() {
      item.open = false
      trigger.focus({ preventScroll: true })
    }

    item.addEventListener('toggle', () => {
      trigger.setAttribute('aria-expanded', String(item.open))
      if (!item.open) return
      for (const other of inspectors) if (other !== item) other.open = false
      pane.focus({ preventScroll: true })
    })
    pane.querySelector('[data-system-close]').addEventListener('click', close)
    pane.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    })
    for (const tab of tabs) {
      tab.addEventListener('click', () => selectTab(tab))
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1] : tabs.find((current) => current !== tab)
        selectTab(next)
        next.focus()
      })
    }
    rawButton.addEventListener('click', () => {
      const showingRaw = raw.hidden
      raw.hidden = !showingRaw
      pane.querySelector('.system-prompt-tabs').hidden = showingRaw
      for (const panel of panels) panel.hidden = showingRaw || panel.id !== tabs.find((tab) => tab.getAttribute('aria-selected') === 'true').getAttribute('aria-controls')
      rawButton.setAttribute('aria-pressed', String(showingRaw))
      rawButton.textContent = showingRaw ? 'Reading view' : 'Raw text'
      body.scrollTop = 0
    })
    const copy = pane.querySelector('[data-system-copy]')
    let copyTimer
    copy.addEventListener('click', async () => {
      let copied = false
      try {
        await navigator.clipboard.writeText(text)
        copied = true
      } catch {
        const input = document.createElement('textarea')
        input.value = text
        input.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
        pane.appendChild(input)
        input.select()
        try { copied = document.execCommand('copy') } catch {}
        input.remove()
        copy.focus({ preventScroll: true })
      }
      copy.querySelector('span').textContent = copied ? 'Copied' : 'Copy failed'
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => { copy.querySelector('span').textContent = 'Copy' }, 2000)
    })
  }
})()`
}

function subagentInspectorJs() {
  return `(() => {
  for (const button of document.querySelectorAll('.export-tool-activity > .mobile-activity-summary')) {
    const card = button.parentElement
    card.classList.remove('is-expanded')
    if (card.hasAttribute('data-subagent-only')) continue
    button.setAttribute('aria-expanded', 'false')
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') !== 'true'
      button.setAttribute('aria-expanded', String(expanded))
      card.classList.toggle('is-expanded', expanded)
    })
    card.addEventListener('click', (event) => {
      if (card.classList.contains('is-expanded') || button.contains(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      button.click()
    }, true)
  }

  let dialog
  let data
  for (const trigger of document.querySelectorAll('[data-subagent-index]')) {
    const open = (opener) => {
      if (dialog) return
      if (!data) {
        const encoded = document.getElementById('export-data').textContent
        data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), char => char.charCodeAt(0))))
      }
      const index = Number(trigger.dataset.subagentIndex)
      const template = document.getElementById('subagent-template-' + index)
      const pane = document.createElement('dialog')
      pane.id = 'subagent-inspector'
      pane.className = 'subagent-inspector'
      pane.tabIndex = -1
      pane.autofocus = true
      pane.setAttribute('aria-modal', 'true')
      pane.setAttribute('aria-labelledby', 'subagent-inspector-title')
      pane.appendChild(template.content.cloneNode(true))
      dialog = pane
      const body = pane.querySelector('.subagent-inspector-content')
      const meta = pane.querySelector('.subagent-inspector-meta')
      const taskTemplates = [...pane.querySelectorAll('[data-subagent-task-content]')]
      const tasks = [...pane.querySelectorAll('[data-subagent-task]')]
      const entry = data.entries[index]
      const taskData = entry.subagentDetails?.results?.length ? entry.subagentDetails.results
        : entry.args?.tasks || entry.args?.chain || (entry.args?.agent ? [entry.args] : [])
      const states = taskTemplates.map(() => ({ reader: null, lastRead: null, formats: new Map(), positions: new Map() }))
      let selected = -1
      let selectionRevision = 0
      let readerText = ''

      function state() { return states[selected] }
      function scroller() { return body.querySelector('.subagent-entry-scroll, .subagent-ledger-scroll') }
      function readerTemplate(key) {
        return taskTemplates[selected].content.querySelector('[data-subagent-entry-content="' + CSS.escape(key) + '"]')
      }
      function format() {
        return state().formats.get(state().reader) || readerTemplate(state().reader)?.dataset.subagentFormat || 'formatted'
      }
      function positionKey() { return state().reader ? state().reader + ':' + format() : 'ledger' }
      function rememberPosition() {
        if (selected >= 0 && scroller()) state().positions.set(positionKey(), scroller().scrollTop)
      }
      function restorePosition() {
        if (scroller()) scroller().scrollTop = state().positions.get(positionKey()) || 0
        updateReadPosition()
      }
      function updateReadPosition() {
        if (!state().reader || !scroller()) return
        const scroll = scroller()
        const max = scroll.scrollHeight - scroll.clientHeight
        const atEnd = max - scroll.scrollTop < 3
        const progress = max > 0 ? Math.min(100, scroll.scrollTop / max * 100) : 100
        const position = body.querySelector('.subagent-entry-position')
        position.style.setProperty('--read-progress', progress + '%')
        position.querySelector('span').textContent = max < 2 ? 'Entire entry visible' : scroll.scrollTop < 2 ? 'Start of entry'
          : atEnd ? 'End of entry' : Math.round(progress) + '% through this entry'
        position.querySelector('button').textContent = atEnd ? 'Back to top' : 'Jump to end'
      }
      function entryText(template) {
        const task = taskData[selected]
        const source = template.dataset.subagentSource
        if (source === 'message') return task?.messages?.[Number(template.dataset.subagentMessage)]?.content || ''
        if (source === 'prompt') return task?.task || ''
        if (source === 'error') return task?.error || ''
        if (source === 'call') return entry.text || ''
        return data.subagentOutputs[index]?.[selected] || ''
      }
      function applyFormat() {
        const value = format()
        body.querySelector('.subagent-inspector-output').hidden = value !== 'formatted'
        body.querySelector('.subagent-entry-raw').hidden = value !== 'raw'
        for (const button of body.querySelectorAll('[data-subagent-format]')) button.setAttribute('aria-pressed', String(button.dataset.subagentFormat === value))
      }
      function renderView(focus = false) {
        selectionRevision++
        const current = state()
        const template = current.reader ? readerTemplate(current.reader) : taskTemplates[selected].content.querySelector('[data-subagent-ledger]')
        body.replaceChildren(template.content.cloneNode(true))
        readerText = current.reader ? entryText(template) : ''
        if (current.reader) {
          body.querySelector('.subagent-entry-raw').textContent = readerText
          applyFormat()
          bindCopy(body.querySelector('[data-subagent-copy-text]'), () => readerText, 'Copy full text')
          if (window.hljs) body.querySelectorAll('pre code').forEach(code => window.hljs.highlightElement(code))
        } else {
          for (const row of body.querySelectorAll('[data-subagent-tail-entry]')) row.dataset.lastRead = String(row.dataset.subagentTailEntry === current.lastRead)
        }
        pane.querySelector('[data-subagent-reading]').textContent = current.reader ? 'Reading saved content' : 'Saved task output'
        scroller().addEventListener('scroll', () => { updateReadPosition(); rememberPosition() })
        restorePosition()
        if (focus) scroller().focus({ preventScroll: true })
      }
      function selectTask(taskIndex) {
        if (taskIndex === selected || !taskTemplates[taskIndex]) return
        rememberPosition()
        selected = taskIndex
        for (const task of tasks) task.setAttribute('aria-pressed', String(Number(task.dataset.subagentTask) === selected))
        const content = taskTemplates[selected].content.querySelector('.subagent-inspector-meta')
        meta.replaceChildren(...[...content.childNodes].map(node => node.cloneNode(true)))
        const agent = pane.querySelector('[data-subagent-agent]')
        agent.textContent = taskData[selected]?.agent ? ' · ' + taskData[selected].agent : ''
        agent.hidden = !agent.textContent
        pane.querySelector('.subagent-inspector-prompt').hidden = !readerTemplate('prompt')
        renderView()
      }
      function openEntry(key) {
        if (!readerTemplate(key)) return
        rememberPosition()
        state().reader = key
        state().lastRead = key
        renderView(true)
      }
      function backToLedger() {
        rememberPosition()
        const key = state().reader
        state().reader = null
        renderView()
        const row = body.querySelector('[data-subagent-tail-entry="' + CSS.escape(key) + '"]')
          || pane.querySelector('[data-subagent-open="prompt"]')
        ;(row || scroller()).focus({ preventScroll: true })
      }
      function changeFormat(value) {
        if (!state().reader || format() === value) return
        rememberPosition()
        state().formats.set(state().reader, value)
        applyFormat()
        restorePosition()
      }

      function bindCopy(button, getText, label) {
        let timer
        button.addEventListener('click', async () => {
          const revision = selectionRevision
          const text = getText()
          let copied = false
          try {
            await navigator.clipboard.writeText(text)
            copied = true
          } catch {
            if (!pane.isConnected) return
            const input = document.createElement('textarea')
            input.value = text
            input.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
            pane.appendChild(input)
            input.focus({ preventScroll: true })
            input.select()
            try { copied = document.execCommand('copy') } catch {}
            input.remove()
            button.focus({ preventScroll: true })
          }
          if (!pane.isConnected || !button.isConnected || revision !== selectionRevision) return
          const feedback = copied ? 'Copied' : 'Copy failed'
          const span = button.querySelector('span')
          if (span) span.textContent = feedback
          button.title = feedback
          button.setAttribute('aria-label', feedback)
          clearTimeout(timer)
          timer = setTimeout(() => {
            if (span) span.textContent = label
            button.title = label
            button.setAttribute('aria-label', label)
          }, 2000)
        })
      }

      for (const task of tasks) task.addEventListener('click', () => selectTask(Number(task.dataset.subagentTask)))
      pane.addEventListener('click', event => {
        const button = event.target.closest('button')
        if (!button) return
        if (button.hasAttribute('data-subagent-open')) openEntry(button.dataset.subagentOpen)
        else if (button.hasAttribute('data-subagent-back')) backToLedger()
        else if (button.hasAttribute('data-subagent-format')) changeFormat(button.dataset.subagentFormat)
        else if (button.hasAttribute('data-subagent-jump')) {
          const scroll = scroller()
          scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 3 ? 0 : scroll.scrollHeight
          updateReadPosition()
          rememberPosition()
        }
      })
      bindCopy(pane.querySelector('[data-subagent-copy-tool]'), () => entry.text || '', 'Copy tool output')
      pane.querySelector('[data-subagent-close]').addEventListener('click', () => pane.close())
      pane.addEventListener('cancel', event => {
        event.preventDefault()
        if (state().reader) backToLedger()
        else pane.close()
      })
      const resizeObserver = new ResizeObserver(updateReadPosition)
      resizeObserver.observe(body)
      let backdropPointer = false
      function outside(event) {
        const rect = pane.getBoundingClientRect()
        return event.target === pane && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
      }
      pane.addEventListener('pointerdown', (event) => { backdropPointer = outside(event) })
      pane.addEventListener('click', (event) => {
        if (backdropPointer && outside(event)) pane.close()
        backdropPointer = false
      })
      const scrollX = window.scrollX
      const scrollY = window.scrollY
      const overflow = document.documentElement.style.overflow
      pane.addEventListener('close', () => {
        resizeObserver.disconnect()
        pane.remove()
        dialog = null
        document.documentElement.style.overflow = overflow
        opener.focus({ preventScroll: true })
        window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' })
      }, { once: true })
      selectTask(0)
      document.body.appendChild(pane)
      document.documentElement.style.overflow = 'hidden'
      pane.showModal()
      restorePosition()
      pane.focus({ preventScroll: true })
      window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' })
    }
    trigger.addEventListener('click', () => open(trigger))
    const card = trigger.closest('[data-subagent-only]')
    if (card) {
      const summary = card.querySelector('.mobile-activity-summary')
      summary.addEventListener('click', () => open(summary))
    }
  }
})()`
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
  if (entry.code && (entry.toolName === 'bash' || entry.toolName === 'search_memory')) {
    const commandWrap = document.createElement('div')
    commandWrap.className = 'tool-command-block'
    const label = document.createElement('strong')
    label.textContent = 'Command'
    const pre = document.createElement('pre')
    pre.textContent = entry.code
    commandWrap.appendChild(label)
    commandWrap.appendChild(pre)
    container.appendChild(commandWrap)
  }
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
    minmax(90px, 0.7fr) minmax(90px, 0.7fr) minmax(150px, 1fr);
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
.transcript {
  display: grid;
  gap: 0;
  grid-template-columns: minmax(0, 1fr);
}
.message {
  min-width: 0;
  width: min(var(--content-max), 100%);
  margin-right: auto;
  margin-left: auto;
  color: #e1e1e4;
  font-size: 14px;
  line-height: 1.45;
}
.message p { margin: 0 0 12px; }
.model-change-row {
  display: flex;
  align-items: center;
  gap: 13px;
  width: min(var(--content-max), 100%);
  margin: 20px auto 0;
  color: var(--muted-strong);
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}
.model-change-row::before,
.model-change-row::after {
  flex: 1 1 24px;
  min-width: 16px;
  height: 1px;
  background: var(--border);
  content: '';
}
.model-change-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: calc(100% - 58px);
}
.model-change-label > span {
  min-width: 0;
  overflow-wrap: anywhere;
  text-wrap: balance;
}
.model-change-label svg {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  color: #969699;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.model-change-label strong {
  display: inline-block;
  max-width: 100%;
  color: #c6c6cb;
  font-weight: 500;
  vertical-align: bottom;
}
@media (max-width: 760px) {
  .model-change-row {
    gap: 8px;
    font-size: 11px;
  }
  .model-change-label {
    max-width: calc(100% - 48px);
  }
}
.message-meta {
  margin-bottom: 6px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.01em;
  overflow-wrap: anywhere;
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
  border-radius: 12px;
  background: rgb(255 255 255 / 2.4%);
  padding: 12px 14px;
  color: #dedee2;
}
.assistant-message .message-meta { color: var(--muted); }
.research-report-message {
  overflow: hidden;
  border: 1px solid #35333e;
  background: #171717;
  padding: 0;
}
.research-report-message > .message-meta {
  min-height: 34px;
  margin: 0;
  border-bottom: 1px solid var(--border-soft);
  padding: 6px 12px;
}
.research-report-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 51px;
  border-bottom: 1px solid var(--border-soft);
  padding: 9px 13px;
}
.research-report-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: none;
  border: 1px solid rgb(138 120 255 / 28%);
  border-radius: 7px;
  background: rgb(138 120 255 / 10%);
  color: #b8adff;
  font-size: 12px;
}
.research-report-heading strong,
.research-report-heading small { display: block; }
.research-report-heading strong { color: var(--text); font-size: 11px; }
.research-report-heading small { margin-top: 3px; color: var(--muted); font-size: 8px; }
.research-report-message > .entry-text,
.research-report-message > .assistant-text-block { padding: 16px; }
.research-report-message .markdown-body a {
  display: inline-flex;
  border: 1px solid rgb(138 120 255 / 28%);
  border-radius: 5px;
  background: rgb(138 120 255 / 10%);
  padding: 0 4px;
  color: #b9aeff;
  font-size: 0.82em;
  line-height: 1.55;
}
.export-research-sources {
  display: grid;
  gap: 8px;
  width: min(var(--content-max), 100%);
  margin: 26px auto 0;
  border-top: 1px solid var(--border-soft);
  padding-top: 18px;
}
.export-research-sources > header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 2px;
}
.export-research-sources > header strong { font-size: 13px; }
.export-research-sources > header span { color: var(--muted); font-size: 10px; }
.export-research-source {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  gap: 9px;
  border: 1px solid var(--border-soft);
  border-radius: 9px;
  background: #171717;
  padding: 10px;
}
.export-research-source > b {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 1px solid #37343f;
  border-radius: 5px;
  color: #a99cff;
  font-size: 9px;
}
.export-research-source strong,
.export-research-source small { display: block; }
.export-research-source strong { color: #ddd; font-size: 11px; }
.export-research-source small { margin-top: 3px; color: var(--muted); font-size: 9px; overflow-wrap: anywhere; }
.export-research-source p { margin: 7px 0 0; color: #999; font-size: 10px; line-height: 1.45; }
.export-research-source a,
.export-research-source code { display: block; width: fit-content; margin-top: 7px; color: #a99cff; font-size: 9px; }
.export-research-source em { color: var(--muted); font-size: 9px; font-style: normal; }
.export-research-source.is-excluded { opacity: 0.68; }
.thinking-block {
  margin: 0 0 8px;
  border: 0;
  border-radius: 9px;
  background: rgb(255 255 255 / 2%);
  transition: background-color var(--motion-base) var(--ease-standard);
}
.thinking-block.is-expanded {
  background: rgb(255 255 255 / 3.5%);
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
  border: 0;
  border-radius: 14px;
  background: #242424;
  padding: 10px 14px;
}
.user-message .message-meta { color: var(--muted-strong); }
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
.markdown-body {
  min-width: 0;
  overflow-wrap: anywhere;
}
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
  overflow-wrap: normal;
  word-break: normal;
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
.markdown-body .table-wrap {
  overflow-x: auto;
  max-width: 100%;
  margin: 0 0 10px;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
}
.markdown-body .table-wrap > table {
  width: 100%;
  margin: 0;
  border: 0;
  border-collapse: collapse;
  font-size: 13px;
  overflow-wrap: normal;
  word-break: normal;
}
.markdown-body th,
.markdown-body td {
  border: 1px solid var(--border-soft);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}
.markdown-body th {
  background: #17181e;
  color: var(--text);
  font-weight: 700;
}
.markdown-body blockquote {
  border-left: 2px solid #4f5360;
  padding-left: 10px;
  color: #adb1bc;
}
.markdown-body a { color: #bfb5ff; text-decoration: none; }
.markdown-body .markdown-relative-link { border-bottom: 1px dotted currentColor; color: #bfb5ff; }
.tool-card {
  min-width: 0;
  width: min(var(--content-max), 100%);
  margin: 6px auto 0;
  border: 0;
  border-radius: 8px;
  background: rgb(255 255 255 / 2.2%);
  padding: 9px 10px;
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
  min-width: 0;
  color: #85858c;
  font-size: 12px;
  font-weight: 650;
}
.tool-card-header > span:nth-child(2) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  background: rgb(255 255 255 / 4%);
}
.transcript-tool.is-expanded:hover {
  background: rgb(255 255 255 / 5%);
}
.transcript-tool:hover {
  background: rgb(255 255 255 / 3.4%);
  transition-duration: var(--motion-quick);
  transition-timing-function: var(--ease-accelerate);
}
.tool-status-mark {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: auto;
  border-radius: 6px;
  background: rgb(120 189 139 / 13%);
  color: #78bd8b;
}
.tool-status-mark svg {
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.tool-status-mark.status-running { background: rgb(169 156 255 / 13%); color: #a99cff; }
.tool-status-mark.status-error { background: rgb(216 138 150 / 13%); color: #d88a96; }
.tool-status-mark.status-stopped { background: rgb(198 173 131 / 13%); color: #c6ad83; }
.tool-status-mark.status-unknown { background: rgb(147 147 155 / 13%); color: #93939b; }
.tool-status-spinner {
  width: 10px;
  height: 10px;
  border: 1.4px solid rgb(191 181 255 / 24%);
  border-top-color: #bfb5ff;
  border-radius: 999px;
  animation: session-loading-spin 800ms linear infinite;
}
.tool-status-question { font-size: 11px; font-weight: 650; line-height: 1; }
.tool-card-header code {
  overflow: hidden;
  min-width: 0;
  max-width: 100%;
  border: 1px solid var(--border-soft);
  border-radius: 7px;
  background: #17181e;
  padding: 2px 6px;
  color: #aaa;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-command-block {
  display: grid;
  gap: 7px;
  margin-bottom: 9px;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  background: rgb(255 255 255 / 2%);
  padding: 9px 10px;
}
.tool-command-block strong {
  color: #9b9ba4;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.tool-command-block pre {
  overflow: auto;
  max-height: 220px;
  margin: 0;
  color: #c6c7cc;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
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
.system-prompt-row {
  display: flex;
  align-items: center;
  gap: 11px;
  width: min(var(--content-max), 100%);
  min-height: 24px;
  margin: 20px auto 0;
  list-style: none;
  cursor: pointer;
}
.system-prompt-row::-webkit-details-marker { display: none; }
.system-prompt-row::before,
.system-prompt-row::after {
  flex: 1 1 16px;
  min-width: 12px;
  height: 1px;
  background: var(--border);
  content: '';
}
.system-prompt-trigger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  max-width: calc(100% - 46px);
  border: 0;
  border-radius: 3px;
  padding: 5px 2px;
  background: transparent;
  color: #969696;
  font-size: 12px;
  line-height: 1.6;
  text-align: left;
  cursor: pointer;
  transition: color var(--motion-base) var(--ease-standard);
}
.system-prompt-label { flex: none; font-weight: 400; white-space: nowrap; }
.system-prompt-meta { overflow: hidden; color: #7e7e7e; text-overflow: ellipsis; white-space: nowrap; }
.system-prompt-row:hover .system-prompt-trigger,
.system-prompt-export[open] .system-prompt-trigger { color: #ccc; }
.system-prompt-trigger svg,
.system-prompt-inspector svg {
  flex: none;
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.system-prompt-trigger .system-prompt-open-icon { width: 12px; height: 12px; color: #777; }
.system-prompt-inspector {
  position: fixed;
  z-index: 20;
  inset: 0 0 0 auto;
  display: flex;
  flex-direction: column;
  width: min(440px, 100%);
  min-width: 0;
  min-height: 0;
  border-left: 1px solid #303030;
  outline: none;
  background: #171717;
  box-shadow: -12px 0 40px rgb(0 0 0 / 16%);
  color: var(--text);
  text-align: left;
}
.system-prompt-inspector [hidden] { display: none !important; }
.system-prompt-header {
  display: flex;
  flex: none;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 20px 22px 17px;
}
.system-prompt-header > div { min-width: 0; }
.system-prompt-header h2 { margin: 0 0 7px; color: #d4d4d4; font-size: 16px; font-weight: 550; }
.system-prompt-header p { margin: 0; color: #858585; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.system-prompt-icon-button {
  display: grid;
  flex: none;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 5px;
  padding: 0;
  background: transparent;
  color: #858585;
  cursor: pointer;
}
.system-prompt-icon-button:hover { background: #282828; color: #ddd; }
.system-prompt-tabs { display: flex; flex: none; gap: 20px; border-bottom: 1px solid #2b2b2b; padding: 0 22px; }
.system-prompt-tabs button {
  margin-bottom: -1px;
  border: 0;
  border-bottom: 1px solid transparent;
  background: transparent;
  padding: 0 0 13px;
  color: #838383;
  font-size: 12px;
  cursor: pointer;
}
.system-prompt-tabs button[aria-selected="true"] { border-bottom-color: #bdbdbd; color: #d4d4d4; }
.system-prompt-tabs button span { margin-left: 4px; color: #858585; font-size: 11px; }
.system-prompt-body { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 22px; scrollbar-width: thin; scrollbar-color: #3a3a3a transparent; }
.system-prompt-section { margin: 0 0 18px; border-bottom: 1px solid #282828; padding: 0 0 18px; }
.system-prompt-section:last-child { margin-bottom: 0; border-bottom: 0; padding-bottom: 0; }
.system-prompt-section > h3 {
  margin: 0 0 9px;
  color: #a5a5a5;
  font-size: 13px;
  font-weight: 550;
  overflow-wrap: anywhere;
}
.system-prompt-section > h3 span { color: #858585; font-weight: 400; }
.system-prompt-section > h3 code { font-size: 12px; }
.system-prompt-notice { margin: 0 0 14px; color: #999; font-size: 11px; line-height: 1.6; }
.system-prompt-diff { margin: 0; padding: 8px 0; background: #111; color: #bcbcbc; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
.system-prompt-diff > span { display: block; padding: 0 8px; min-height: 18px; }
.system-prompt-diff [data-line-type="addition"] { color: #a8d9b6; background: rgb(47 143 70 / 15%); }
.system-prompt-diff [data-line-type="deletion"] { color: #e4aaa5; background: rgb(180 60 50 / 15%); }
.system-prompt-diff [data-line-type="metadata"] { color: #858585; }
.system-prompt-file { margin: 0 0 14px; }
.system-prompt-file:last-child { margin-bottom: 0; }
.system-prompt-file > h4 { margin: 0 0 8px; color: #a5a5a5; font-size: 12px; font-weight: 550; overflow-wrap: anywhere; }
.system-prompt-file > h4 span { color: #858585; font-weight: 400; }
.system-prompt-file > h4 code { font-size: 12px; }
.system-prompt-file.is-unchanged { border-top: 1px solid #282828; padding-top: 10px; }
.system-prompt-file.is-unchanged > summary { color: #858585; font-size: 12px; cursor: pointer; overflow-wrap: anywhere; }
.system-prompt-file.is-unchanged > summary code { font-size: 12px; }
.system-prompt-file.is-unchanged .system-prompt-prose { margin-top: 8px; }
.system-prompt-prose { color: #bcbcbc; font-size: 13px; line-height: 1.75; overflow-wrap: anywhere; }
.system-prompt-prose img { max-width: 100%; }
.system-prompt-prose code { border: 0; padding: 0; background: transparent; color: #cecad6; }
.system-prompt-prose pre { background: #111; white-space: pre-wrap; }
.system-prompt-prose :is(h1, h2, h3, h4) { color: #bcbcbc; font-size: 13px; }
.system-prompt-empty { margin: 0; color: #999; font-size: 13px; line-height: 1.6; }
.system-prompt-raw {
  margin: 0;
  color: #aaa;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.system-prompt-footer {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 49px;
  border-top: 1px solid #292929;
  padding: 8px 22px;
  color: #858585;
  font-size: 11px;
}
.system-prompt-footer > div { display: flex; align-items: center; gap: 12px; }
.system-prompt-footer button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  padding: 4px 0;
  color: #999;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
.system-prompt-inspector button:hover:not(:disabled) { color: #ddd; }
.system-prompt-row:focus-visible { outline: none; }
.system-prompt-row:focus-visible .system-prompt-trigger,
.system-prompt-inspector button:focus-visible { outline: 1px solid #999; outline-offset: 3px; }
.system-prompt-body:focus-visible { outline: 1px solid #777; outline-offset: -4px; }
@media (min-width: 1121px) {
  .export-shell:has(.system-prompt-export[open]) { width: calc(100% - 440px); margin-right: 440px; }
  .export-shell:has(.system-prompt-export[open]) .export-header dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .system-prompt-row { gap: 6px; }
  .system-prompt-trigger { gap: 5px; max-width: calc(100% - 36px); font-size: 11px; }
  .system-prompt-inspector { width: 100%; border-left: 0; }
  .system-prompt-header { padding: 18px 16px 16px; }
  .system-prompt-tabs { padding: 0 16px; }
  .system-prompt-body { padding: 20px 16px; }
  .system-prompt-footer { gap: 8px; padding: 8px 16px; }
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
.user-message.skill-message {
  --skill-message-inset: 14px;
  padding-top: 0;
}
.skill-message-header {
  overflow: hidden;
  margin: 0 calc(-1 * var(--skill-message-inset)) 10px;
  border-radius: 14px 14px 0 0;
}
.skill-message-header summary { list-style: none; cursor: pointer; }
.skill-message-header summary::-webkit-details-marker { display: none; }
.skill-message-header summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }
.skill-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
  min-height: 42px;
  border: 0;
  border-bottom: 1px solid rgb(255 255 255 / 2%);
  background: #2d2a31;
  padding: 0 var(--skill-message-inset);
  color: #ddd8e5;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--motion-base) var(--ease-decelerate);
}
.skill-summary:hover { background: #35303c; }
.skill-icon {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: #a89bbf;
  stroke-width: 1.65;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.skill-summary strong {
  min-width: 0;
  overflow: hidden;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skill-summary .skill-kind {
  flex: none;
  margin-left: auto;
  color: #978da3;
  font-size: 11px;
}
.skill-summary .chevron {
  flex: none;
  width: 11px;
  height: 11px;
  fill: none;
  stroke: #a79caf;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform var(--motion-base) var(--ease-emphasized);
}
.skill-message-header details[open] .chevron { transform: rotate(90deg); }
.skill-expanded {
  max-height: 520px;
  overflow: auto;
  border-top: 1px solid rgb(255 255 255 / 5%);
  background: #1a191c;
  padding: 12px var(--skill-message-inset);
}
@media (max-width: 820px) {
  .user-message.skill-message { --skill-message-inset: 10px; }
}
.empty-workbench {
  width: min(var(--content-max), 100%);
  margin: 0 auto;
  color: var(--muted);
}
@media (max-width: 820px) {
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
@media (pointer: coarse) {
  .tool-card > summary,
  .thinking-trigger,
  .skill-summary,
  .system-prompt-trigger,
  .system-prompt-inspector button,
  .system-prompt-inspector summary {
    min-width: 44px;
    min-height: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .transcript-message,
  .tool-card,
  .skill-summary,
  .skill-summary .chevron,
  .skill-tool-card .skill-tool-chevron,
  .mobile-activity-list .skill-tool-card .skill-tool-chevron,
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
}

.subagent-header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: #85858c;
  font-size: 12px;
  font-weight: 650;
}

.tool-inspect-button {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-width: 0;
  min-height: 38px;
  border: 0;
  border-radius: 5px;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.subagent-card.is-inspected .tool-inspect-button {
  background: rgb(255 255 255 / 3%);
}

.tool-card .tool-inspect-button:focus-visible {
  outline: 1px solid #aaa;
  outline-offset: -2px;
}

.subagent-call-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #bdbdc5;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subagent-inspect-icon {
  flex: none;
  width: 14px;
  height: 14px;
  margin-left: auto;
  fill: none;
  stroke: #a5a0b5;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.subagent-icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  color: var(--accent);
}

.subagent-icon svg {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
}

.subagent-label {
  flex: 0 0 auto;
  color: #929299;
  font-weight: 650;
}

.subagent-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.6;
}

.subagent-summary > span {
  white-space: nowrap;
}

.subagent-task-status {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 11px;
  white-space: nowrap;
}

.subagent-task-status svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.subagent-summary .status-completed,
.subagent-task-status.status-completed {
  color: #8abb97;
}

.subagent-summary .status-running,
.subagent-task-status.status-running {
  color: #b0a2f4;
}

.subagent-summary .status-stopped,
.subagent-task-status.status-stopped {
  color: #c6ad83;
}

.subagent-summary .status-failed,
.subagent-task-status.status-failed {
  color: #d88a96;
}

.subagent-summary .status-queued,
.subagent-summary .status-not-started,
.subagent-summary .status-unknown,
.subagent-task-status.status-queued,
.subagent-task-status.status-not-started,
.subagent-task-status.status-unknown {
  color: #93939b;
}

.subagent-inspector {
  display: flex;
  flex-direction: column;
  width: min(700px, 100%);
  height: 100%;
  max-height: 900px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid #444449;
  border-radius: 13px;
  padding: 0;
  outline: none;
  background: #242427;
  color: #e9e9ed;
  font-family: inherit;
  line-height: 1.5;
  box-shadow: 0 16px 48px rgb(0 0 0 / 40%);
}

.subagent-inspector [hidden],
dialog.subagent-inspector:not([open]) {
  display: none;
}

.subagent-inspector svg {
  flex: none;
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.subagent-inspector-context {
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  min-height: 0;
  max-height: 45%;
  overflow: auto;
}

.subagent-inspector-header {
  display: grid;
  flex: none;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid rgb(255 255 255 / 7%);
  padding: 15px 20px 13px;
}

.subagent-inspector-header:has(> .subagent-inspector-prompt:not([hidden])) {
  grid-template-columns: minmax(0, 1fr) auto auto;
}

.subagent-inspector-heading {
  min-width: 0;
}

.subagent-inspector-actions {
  display: flex;
  gap: 7px;
}

.subagent-inspector-header p {
  overflow: hidden;
  margin: 0 0 4px;
  color: #93959f;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subagent-inspector-header h2 {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: #e9e9ed;
  font-size: 17px;
  font-weight: 550;
  letter-spacing: -0.025em;
  line-height: 1.4;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.subagent-inspector-header .subagent-summary {
  grid-column: 1 / -1;
  justify-content: flex-start;
  gap: 2px 8px;
  font-variant-numeric: tabular-nums;
}

.subagent-inspector-icon-button {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid rgb(255 255 255 / 7%);
  border-radius: 8px;
  padding: 0;
  background: #2b2b2f;
  color: #b0b1b9;
  cursor: pointer;
}

.subagent-inspector-icon-button:hover {
  background: rgb(255 255 255 / 2%);
}

.subagent-inspector .subagent-task-status {
  gap: 6px;
  font-size: 11px;
}

.subagent-inspector .subagent-task-status svg {
  width: 13px;
  height: 13px;
}

.subagent-inspector .subagent-summary .status-completed,
.subagent-inspector .subagent-task-status.status-completed,
.subagent-ledger-status.status-completed {
  color: #acb9af;
}

.subagent-ledger-status.status-completed {
  background: rgb(172 185 175 / 12%);
}

.subagent-ledger-status.status-running {
  background: rgb(176 162 244 / 13%);
  color: #b0a2f4;
}

.subagent-ledger-status.status-error,
.subagent-ledger-status.status-failed {
  background: rgb(216 138 150 / 12%);
  color: #d88a96;
}

.subagent-ledger-status.status-stopped {
  background: rgb(198 173 131 / 12%);
  color: #c6ad83;
}

.subagent-ledger-status.status-unknown {
  border: 1px dashed #55555d;
  color: #b0b1b9;
}

.subagent-ledger-status.status-saved {
  background: rgb(255 255 255 / 5%);
  color: #93959f;
}

.subagent-inspector-tasks {
  position: relative;
  flex: 0 1 auto;
  min-height: 54px;
  max-height: 240px;
  overflow: auto;
  border-bottom: 1px solid rgb(255 255 255 / 4.3%);
  padding: 0 12px 9px;
}

.subagent-inspector-task {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 38px;
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 7px 9px;
  background: transparent;
  color: #b0b1b9;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.subagent-inspector-task:hover {
  background: rgb(255 255 255 / 1.2%);
}

.subagent-inspector-task[aria-pressed="true"] {
  background: #323236;
  color: #e9e9ed;
}

.subagent-inspector-task-marker {
  position: absolute;
  z-index: 0;
  top: 0;
  left: 0;
  border-radius: 5px;
  background: #323236;
  pointer-events: none;
}

.has-selection-marker .subagent-inspector-task[aria-pressed="true"] {
  background: transparent;
}

.subagent-inspector-index {
  color: #93959f;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  text-align: center;
}

.subagent-inspector-task[aria-pressed="true"] .subagent-inspector-index {
  color: #c7c8ce;
}

.subagent-inspector-task-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subagent-inspector-reader-stack {
  position: relative;
  display: grid;
  flex: 1 0 min(300px, 60%);
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  isolation: isolate;
}

.subagent-inspector-reader-stack > .subagent-inspector-content {
  grid-area: 1 / 1;
}

.subagent-inspector-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #1c1c1f;
  overflow-wrap: anywhere;
}

.subagent-inspector-context,
.subagent-inspector-tasks,
.subagent-ledger-summary,
.subagent-ledger-scroll,
.subagent-entry-sections,
.subagent-entry-scroll,
.subagent-inspector-error {
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #45454b transparent;
}

.subagent-inspector-meta {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  border-bottom: 1px solid rgb(255 255 255 / 7%);
  padding: 11px 20px;
  background: #242427;
  color: #93959f;
  font-size: 11px;
}

.subagent-inspector-meta > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 24px;
  max-width: 100%;
  border: 1px solid rgb(255 255 255 / 7%);
  border-radius: 999px;
  padding: 2px 10px;
  background: #2b2b2f;
  overflow-wrap: anywhere;
}

.subagent-inspector-agent {
  color: #b0b1b9;
}

.subagent-inspector-meta code {
  min-width: 0;
  color: #e9e9ed;
  font-size: inherit;
  font-weight: 400;
}

.subagent-inspector-model > span,
.subagent-inspector-thinking > span {
  flex: none;
  white-space: nowrap;
}

.subagent-inspector-model code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subagent-inspector-meta .subagent-task-status {
  margin-left: 0;
}

.subagent-inspector-meta .subagent-task-status::before {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  content: '';
}

.subagent-inspector-meta .status-running {
  border-color: rgb(176 162 244 / 32%);
  background: rgb(176 162 244 / 13%);
  color: #b0a2f4;
}

.subagent-inspector-prompt,
.subagent-ledger-latest-heading button,
.subagent-entry-back,
.subagent-entry-formats button,
.subagent-entry-position button,
.subagent-inspector-notice button,
.subagent-inspector-footer button {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  border: 0;
  border-radius: 4px;
  padding: 4px 0;
  background: transparent;
  color: #c4c1cf;
  font: inherit;
  cursor: pointer;
}

.subagent-inspector-prompt,
.subagent-ledger-latest-heading button {
  border: 1px solid #3d3d44;
  border-radius: 7px;
  padding: 3px 12px;
  background: #2b2b30;
  color: #e9e9ed;
  font-weight: 550;
}

.subagent-inspector-prompt {
  font-size: 11px;
  white-space: nowrap;
}

.subagent-inspector-prompt svg {
  width: 12px;
  height: 12px;
}

.subagent-ledger-overview {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.subagent-ledger-summary {
  flex: 0 1 auto;
  min-height: 0;
  overflow: auto;
}

.subagent-ledger-latest {
  flex: none;
  margin: 14px 16px 8px;
  border: 1px solid #3d3d44;
  border-radius: 11px;
  padding: 14px 16px 15px;
  background: #26262b;
}

.subagent-ledger-latest-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  color: #e9e9ed;
  font-size: 12.5px;
  font-weight: 600;
}

.subagent-ledger-latest-heading > span {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.subagent-ledger-icon,
.subagent-ledger-latest-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid #3a3a41;
  border-radius: 8px;
  background: #26262b;
  color: #b0b1b9;
}

.subagent-ledger-latest-icon {
  border-color: rgb(176 162 244 / 32%);
  background: rgb(176 162 244 / 13%);
  color: #b0a2f4;
}

.subagent-ledger-latest-heading button {
  min-height: 26px;
  margin-left: auto;
  font-size: 11.5px;
  white-space: nowrap;
}

.subagent-ledger-latest h3 {
  display: -webkit-box;
  overflow: hidden;
  margin: 0 0 6px;
  color: #e9e9ed;
  font-size: 13.5px;
  font-weight: 550;
  letter-spacing: -0.012em;
  line-height: 1.6;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.subagent-ledger-latest p {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: #b0b1b9;
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.subagent-ledger-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  gap: 11px;
}

.subagent-ledger-labels {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  margin: 0 16px;
  border-bottom: 1px solid rgb(255 255 255 / 6%);
  padding: 8px 6px 7px;
  color: #93959f;
  font-size: 11px;
}

.subagent-ledger-activity-label {
  color: #b0b1b9;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.subagent-ledger-read-hint {
  margin-left: auto;
  text-align: right;
}

.subagent-ledger-connection {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.subagent-ledger-connection.is-live {
  color: #b0a2f4;
}

.subagent-ledger-connection.is-live::before {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  content: '';
}

.subagent-ledger-scroll {
  flex: 1 0 112px;
  min-width: 0;
  min-height: 112px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0 16px 12px;
}

.subagent-ledger-rows {
  min-width: 0;
}

.subagent-ledger-row {
  position: relative;
  align-items: start;
  width: 100%;
  border: 1px solid transparent;
  border-top-color: rgb(255 255 255 / 6%);
  border-radius: 0;
  padding: 11px 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.subagent-ledger-rows > .subagent-ledger-row:first-child,
.subagent-ledger-row-slot:first-child .subagent-ledger-row {
  border-top-color: transparent;
}

.subagent-ledger-row-slot {
  display: grid;
  grid-template-rows: 1fr;
}

.subagent-ledger-row-clip {
  min-height: 0;
  overflow: hidden;
}

.has-row-motion .subagent-row-move {
  transition: transform 300ms cubic-bezier(.22, 1, .36, 1);
}

.has-row-motion .subagent-row-enter-active[data-row-motion="true"],
.has-row-motion .subagent-row-leave-active[data-row-motion="true"] {
  transition: grid-template-rows 300ms cubic-bezier(.22, 1, .36, 1),
    opacity 220ms ease-out,
    transform 300ms cubic-bezier(.22, 1, .36, 1);
}

.has-row-motion .subagent-row-enter-from[data-row-motion="true"],
.has-row-motion .subagent-row-leave-to[data-row-motion="true"] {
  grid-template-rows: 0fr;
  opacity: 0;
  transform: translateY(6px);
}

.subagent-ledger-row:focus-visible {
  outline-offset: -2px;
}

.subagent-ledger-row:hover {
  background: rgb(255 255 255 / 1.6%);
}

.subagent-ledger-row:active {
  background: rgb(255 255 255 / 3.2%);
}

.subagent-ledger-row[data-last-read="true"]::before {
  position: absolute;
  top: 14px;
  bottom: 14px;
  left: 0;
  width: 2px;
  border-radius: 1px;
  background: #aaa4b9;
  content: '';
}

.subagent-ledger-action {
  margin-right: 8px;
  color: #93959f;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.subagent-ledger-body {
  min-width: 0;
}

.subagent-ledger-line {
  display: -webkit-box;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.subagent-ledger-target {
  color: #e9e9ed;
  font-size: 13px;
  font-weight: 520;
}

.subagent-ledger-excerpt {
  display: block;
  overflow: hidden;
  margin-top: 4px;
  color: #93959f;
  font-size: 12px;
  line-height: 1.6;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-height: 1.6em;
}

.has-row-motion [data-row-motion="true"] .subagent-excerpt-enter-active,
.has-row-motion [data-row-motion="true"] .subagent-excerpt-leave-active {
  transition: max-height 220ms cubic-bezier(.22, 1, .36, 1),
    margin-top 220ms cubic-bezier(.22, 1, .36, 1),
    opacity 180ms ease-out;
}

.has-row-motion [data-row-motion="true"] .subagent-excerpt-enter-from,
.has-row-motion [data-row-motion="true"] .subagent-excerpt-leave-to {
  max-height: 0;
  margin-top: 0;
  opacity: 0;
}

.subagent-ledger-outcome {
  min-width: 0;
  text-align: right;
}

.subagent-ledger-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 21px;
  border-radius: 999px;
  padding: 2px 8px;
  color: #93959f;
  font-size: 10.5px;
  line-height: 1.4;
  white-space: nowrap;
}

.subagent-ledger-status svg {
  width: 12px;
  height: 12px;
}

.subagent-ledger-status-stack {
  display: grid;
  justify-items: end;
}

.subagent-ledger-status-stack > .subagent-ledger-status {
  grid-area: 1 / 1;
}

.has-row-motion [data-row-motion="true"] .subagent-status-enter-active {
  transition: opacity 180ms ease-out, transform 220ms cubic-bezier(.22, 1, .36, 1);
}

.has-row-motion [data-row-motion="true"] .subagent-status-leave-active {
  transition: opacity 100ms cubic-bezier(.2, 0, 0, 1), transform 160ms ease-out;
}

.has-row-motion [data-row-motion="true"] .subagent-status-enter-from {
  opacity: 0;
  transform: translateY(2px);
}

.has-row-motion [data-row-motion="true"] .subagent-status-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

.subagent-ledger-size {
  display: block;
  padding-top: 4px;
  color: #93959f;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.subagent-entry-sections {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}

.subagent-entry-header {
  flex: none;
  padding: 0 21px 14px;
  background: #242427;
}

.subagent-entry-nav {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  padding: 12px 21px;
  background: #242427;
  color: #93959f;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.subagent-entry-nav > span {
  min-width: 0;
  margin-left: auto;
  text-align: right;
}

.subagent-entry-back svg {
  width: 13px;
  height: 13px;
}

.subagent-entry-title {
  display: -webkit-box;
  overflow: hidden;
  margin: 0 0 7px;
  color: #e9e9ed;
  font-size: 15px;
  font-weight: 550;
  letter-spacing: -0.015em;
  line-height: 1.6;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.subagent-entry-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 7px;
  color: #93959f;
  font-size: 11px;
}

.subagent-entry-meta .subagent-ledger-status {
  margin-left: auto;
  padding-top: 0;
  font-size: inherit;
}

.subagent-entry-formats {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid #37373b;
  padding: 7px 17px;
  background: #242427;
  font-size: 11px;
}

.subagent-entry-formats button {
  padding: 5px 8px;
  color: #b0b1b9;
}

.subagent-entry-formats button:hover {
  background: rgb(255 255 255 / 3%);
}

.subagent-entry-formats button[aria-pressed="true"] {
  background: #333337;
  color: #e9e9ed;
}

.subagent-entry-formats .subagent-entry-copy {
  margin-left: auto;
  color: #c4c1cf;
}

.subagent-entry-scroll {
  flex: 1 0 96px;
  min-width: 0;
  min-height: 96px;
  overflow: auto;
  padding: 21px 24px 30px;
  overflow-wrap: anywhere;
}

.subagent-entry-raw {
  margin: 0;
  color: #b0b1b9;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.9;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.subagent-entry-image,
.subagent-inspector-output img {
  display: block;
  max-width: 100%;
  height: auto;
  object-fit: contain;
  cursor: zoom-in;
}

.subagent-entry-end {
  margin: 25px 0 0;
  border-top: 1px solid rgb(255 255 255 / 5%);
  padding-top: 14px;
  color: #93959f;
  font-size: 11px;
}

.subagent-entry-position {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  border-top: 1px solid rgb(255 255 255 / 4.3%);
  padding: 8px 21px;
  color: #93959f;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.subagent-entry-position > span {
  min-width: 0;
}

.subagent-entry-position button {
  margin-left: auto;
}

.subagent-inspector-output {
  min-width: 0;
  margin: 0;
  color: #c3c4cc;
  font-size: 14px;
  line-height: 1.85;
  overflow-wrap: anywhere;
}

.subagent-inspector-output :is(p, ul, ol, pre, blockquote, .table-wrap) {
  margin: 0 0 18px;
}

.subagent-inspector-output :is(h1, h2, h3, h4, h5, h6) {
  overflow: visible;
  margin: 24px 0 12px;
  color: #e9e9ed;
  font-size: 15px;
  font-weight: 550;
  letter-spacing: -0.015em;
  line-height: 1.5;
  text-overflow: clip;
  white-space: normal;
}

.subagent-inspector-output h1 {
  font-size: 21px;
}

.subagent-inspector-output h2 {
  font-size: 18px;
}

.subagent-inspector-output h3 {
  font-size: 16px;
}

.subagent-inspector-output :is(h5, h6) {
  font-size: 14px;
}

.subagent-inspector-output > :first-child {
  margin-top: 0;
}

.subagent-inspector-output > :last-child {
  margin-bottom: 0;
}

.subagent-inspector-output :is(ul, ol) {
  padding-left: 22px;
}

.subagent-inspector-output li {
  margin: 12px 0;
  padding-left: 3px;
}

.subagent-inspector-output strong {
  color: #e9e9ed;
  font-weight: 600;
}

.subagent-inspector-output a {
  color: #c4c1cf;
  text-decoration: underline;
  text-decoration-color: #8a739e;
  text-underline-offset: 3px;
}

.subagent-inspector-output .markdown-relative-link {
  color: #c4c1cf;
  text-decoration: none;
}

.subagent-inspector-output .markdown-image-reference {
  display: inline-block;
  border-radius: 4px;
  padding: 2px 5px;
  background: #242427;
  color: #b0b1b9;
  font-size: 12px;
}

.subagent-inspector-output code {
  border: 0;
  border-radius: 3px;
  background: #27272b;
  padding: 2px 4px;
  color: #d0ced9;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.88em;
}

.subagent-inspector-output pre {
  overflow: auto;
  max-width: 100%;
  border: 0;
  border-radius: 6px;
  background: #27272b;
  padding: 14px;
  font-size: 12px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.subagent-inspector-output pre code {
  border: 0;
  background: transparent;
  padding: 0;
  color: #d0ced9;
  font-size: inherit;
}

.subagent-inspector-output blockquote {
  border: 0;
  border-left: 2px solid #45454b;
  border-radius: 0;
  padding: 0 0 0 14px;
  background: transparent;
  color: #b0b1b9;
}

.subagent-inspector-output hr {
  margin: 24px 0;
  border: 0;
  border-top: 1px solid rgb(255 255 255 / 8%);
}

.subagent-inspector-output .table-wrap {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid #37373b;
  border-radius: 6px;
}

.subagent-inspector-output table {
  width: 100%;
  margin: 0 0 18px;
  border-collapse: collapse;
  font-size: 13px;
}

.subagent-inspector-output .table-wrap > table {
  margin: 0;
}

.subagent-inspector-output :is(th, td) {
  border: 1px solid #37373b;
  padding: 7px 10px;
  text-align: left;
  vertical-align: top;
}

.subagent-inspector-output th {
  background: #242427;
  color: #e9e9ed;
  font-weight: 550;
}

.subagent-inspector-notice {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  padding: 9px 21px;
  background: #242427;
  color: #b0b1b9;
  font-size: 11px;
  line-height: 1.6;
}

.subagent-inspector-notice > span {
  min-width: 0;
}

.subagent-inspector-notice button {
  margin-left: auto;
}

.subagent-inspector-error {
  flex: 0 1 auto;
  max-height: 160px;
  overflow: auto;
  margin: 0;
  padding: 12px 22px;
  color: #dca0aa;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.subagent-inspector-empty {
  margin: 0;
  padding: 18px 22px;
  color: #b0b1b9;
  font-size: 13px;
  line-height: 1.75;
}

.subagent-tail-activity,
.subagent-tail-following {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #93959f;
  font-size: 11px;
}

.subagent-tail-activity {
  flex: none;
  margin: 0;
  padding: 12px 22px;
}

.subagent-inspector-footer {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 46px;
  border-top: 1px solid rgb(255 255 255 / 7%);
  padding: 8px 20px;
  background: #242427;
  color: #93959f;
  font-size: 11px;
}

.subagent-inspector-footer.has-motion-footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.subagent-inspector-footer-content {
  display: flex;
  grid-area: 1 / 1;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  background: #242427;
}

.subagent-inspector-footer > span,
.subagent-inspector-footer-content > span {
  min-width: 0;
}

.subagent-inspector-footer button {
  gap: 7px;
  min-height: 32px;
}

.subagent-inspector :is(button, a):hover:not(:disabled) {
  color: #f2f2f5;
}

.subagent-inspector button:disabled {
  opacity: 0.5;
  cursor: default;
}

.subagent-inspector :is(button, a) {
  -webkit-tap-highlight-color: transparent;
}

.subagent-inspector :is(button, a):focus-visible {
  outline: 2px solid #bdb6cc;
  outline-offset: -2px;
}

.subagent-inspector :is(.subagent-inspector-context, .subagent-ledger-summary, .subagent-ledger-scroll, .subagent-entry-scroll):focus-visible {
  outline: 1px solid #bdb6cc;
  outline-offset: -1px;
}

dialog.subagent-inspector {
  position: fixed;
  inset: 16px 16px 16px auto;
  width: min(700px, calc(100% - 32px));
  max-width: none;
  height: calc(100dvh - 32px);
  margin: auto 0;
}

dialog.subagent-inspector::backdrop {
  background: rgb(0 0 0 / 58%);
}

dialog.subagent-inspector[open] {
  animation: subagent-inspector-in var(--motion-slow) var(--ease-emphasized);
}

@keyframes subagent-inspector-in {
  from { opacity: 0; transform: translateX(30px); }
  to { opacity: 1; transform: translateX(0); }
}

@media (max-width: 760px) {
  .tool-inspect-button {
    gap: 7px;
    min-height: 44px;
  }

  .subagent-inspector {
    width: 100%;
    height: 90%;
    max-height: 90dvh;
    border-radius: 16px 16px 0 0;
    border-bottom: 0;
  }

  .subagent-inspector::before {
    flex: none;
    width: 30px;
    height: 3px;
    margin: 8px auto 0;
    border-radius: 3px;
    background: #57575d;
    content: '';
  }

  .subagent-inspector-header,
  .subagent-inspector-header:has(> .subagent-inspector-prompt:not([hidden])) {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 7px;
    padding: 11px 16px 10px;
  }

  .subagent-inspector-header h2 {
    font-size: 16px;
  }

  .subagent-inspector-header .subagent-summary {
    gap: 2px 6px;
  }

  .subagent-inspector-prompt {
    grid-column: 1 / -1;
    justify-content: space-between;
    width: 100%;
    font-size: 12px;
  }

  .subagent-inspector-tasks {
    max-height: 142px;
    padding: 0 8px 9px;
  }

  .subagent-inspector-task {
    grid-template-columns: 15px minmax(0, 1fr) auto;
    gap: 5px;
    padding: 7px;
    font-size: 11px;
  }

  .subagent-inspector .subagent-task-status {
    gap: 4px;
  }

  .subagent-inspector .subagent-task-status svg {
    width: 11px;
    height: 11px;
  }

  .subagent-inspector-meta {
    padding: 8px 16px;
  }

  .subagent-ledger-latest {
    margin: 12px 12px 6px;
    padding: 12px;
  }

  .subagent-ledger-latest p {
    -webkit-line-clamp: 3;
  }

  .subagent-ledger-labels {
    margin: 0 12px;
    padding: 8px 4px;
  }

  .subagent-ledger-read-hint {
    display: none;
  }

  .subagent-ledger-scroll {
    padding: 0 12px 8px;
  }

  .subagent-ledger-row {
    gap: 8px;
    padding: 10px 4px;
  }

  .subagent-entry-header {
    padding: 0 16px 12px;
  }

  .subagent-entry-nav {
    gap: 6px;
    padding: 11px 16px 8px;
  }

  .subagent-entry-title {
    font-size: 13px;
  }

  .subagent-entry-formats {
    padding: 6px 11px;
  }

  .subagent-entry-scroll {
    padding: 17px 17px 25px;
  }

  .subagent-entry-raw {
    font-size: 11px;
  }

  .subagent-entry-position {
    padding: 6px 16px;
  }

  .subagent-inspector-output {
    font-size: 13px;
  }

  .subagent-inspector-output h2 {
    font-size: 17px;
  }

  .subagent-inspector-notice {
    padding: 8px 16px;
  }

  .subagent-inspector-error,
  .subagent-inspector-empty,
  .subagent-tail-activity {
    padding-right: 16px;
    padding-left: 16px;
  }

  .subagent-inspector-footer {
    gap: 8px;
    padding: 6px 16px max(6px, env(safe-area-inset-bottom));
  }

  .subagent-inspector-footer-content {
    gap: 8px;
  }

  dialog.subagent-inspector {
    inset: auto 0 0;
    width: 100%;
    height: 90dvh;
    margin: 0;
  }

  dialog.subagent-inspector[open] {
    animation-name: subagent-inspector-up;
  }

  @keyframes subagent-inspector-up {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
  }
}

@media (max-width: 760px) and (max-height: 650px) {
  .subagent-inspector-header {
    padding-top: 8px;
    padding-bottom: 8px;
  }

  .subagent-inspector-tasks {
    max-height: 54px;
  }

  .subagent-inspector-meta {
    padding-top: 4px;
    padding-bottom: 4px;
  }

  .subagent-ledger-latest {
    padding-top: 10px;
    padding-bottom: 10px;
  }

  .subagent-ledger-latest p {
    display: none;
  }

  .subagent-ledger-latest h3,
  .subagent-entry-title {
    -webkit-line-clamp: 1;
  }
}

@media (max-width: 760px), (pointer: coarse) {
  .subagent-inspector-icon-button,
  .subagent-inspector-footer button,
  .subagent-inspector-prompt,
  .subagent-ledger-latest-heading button,
  .subagent-entry-back,
  .subagent-entry-formats button,
  .subagent-entry-position button,
  .subagent-inspector-notice button,
  .subagent-inspector-task {
    min-width: 44px;
    min-height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .subagent-inspector-tasks,
  .subagent-ledger-scroll,
  .subagent-entry-scroll {
    scroll-behavior: auto;
  }

  dialog.subagent-inspector[open] {
    animation: none;
  }
}
.export-tool-activity {
  --activity-row-height: 38px;
  overflow: hidden;
  width: min(var(--content-max), 100%);
  margin: 16px auto 20px;
  border: 1px solid rgb(255 255 255 / 7%);
  border-radius: 10px;
  background: rgb(255 255 255 / 2.4%);
}
.export-tool-activity > .mobile-activity-summary {
  display: block;
  width: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.mobile-activity-heading { display: flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 13px; background: rgb(255 255 255 / 4%); }
.mobile-activity-heading svg { flex: none; width: 16px; height: 16px; fill: none; stroke: #b7b0ce; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.mobile-activity-heading strong { color: #a5a5a5; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; }
.mobile-activity-state { display: flex; align-items: center; gap: 6px; min-width: 0; margin-left: auto; font-size: 11px; font-weight: 550; }
.mobile-activity-check { color: #8fbc9b; font-size: 13px; }
.mobile-activity-live { color: #b8aafa; }
.mobile-activity-outcomes { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 2px 10px; min-width: 0; padding: 6px 0; line-height: 1.6; }
.mobile-activity-outcomes > span { white-space: nowrap; }
.mobile-activity-outcomes .status-completed { color: #8abb97; }
.mobile-activity-outcomes .status-running { color: #b0a2f4; }
.mobile-activity-outcomes .status-queued { color: #93939b; }
.mobile-activity-outcomes .status-error { color: #fca5a5; }
.mobile-activity-outcomes .status-stopped { color: #c6ad83; }
.mobile-activity-outcomes .status-unknown,
.mobile-activity-outcomes .status-not-started { color: #93939b; }
.mobile-activity-spinner { flex: none; width: 11px; height: 11px; border: 1.5px solid rgb(191 181 255 / 24%); border-top-color: #bfb5ff; border-radius: 999px; animation: session-loading-spin 800ms linear infinite; }
@keyframes session-loading-spin { to { transform: rotate(360deg); } }
.mobile-activity-chevron { flex: none; color: #aaa; transition: transform 280ms var(--ease-emphasized); }
.mobile-activity-card.is-expanded .mobile-activity-chevron { transform: rotate(90deg); }
.mobile-activity-breakdown { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; min-height: 30px; border-top: 1px solid rgb(255 255 255 / 6%); padding: 7px 13px; background: rgb(255 255 255 / 3%); color: #b8b8b8; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; }
.export-tool-activity > .mobile-activity-list { display: flex; flex-direction: column; justify-content: flex-end; height: calc(var(--activity-row-height) + 1px); padding: 0 13px; overflow: hidden; }
.export-tool-activity.is-expanded > .mobile-activity-list { display: block; height: auto; padding: 3px 13px; overflow: visible; pointer-events: auto; }
.mobile-activity-list .tool-card { margin: 0; border-top: 1px solid rgb(255 255 255 / 5%); border-radius: 0; padding: 0; background: transparent; }
.mobile-activity-list > .tool-card:first-child { border-top: 0; }
.mobile-activity-list .tool-card:is(.is-expanded, :hover) { background: transparent; }
.mobile-activity-list .tool-expanded-body { margin-top: 0; padding: 9px 0 12px 13px; }
.mobile-activity-list .tool-card-header .chevron { flex-shrink: 0; width: 6px; text-align: center; }
.export-tool-activity:not(.is-expanded) > .mobile-activity-list > .tool-card:last-child { border-top-color: transparent; }
.export-tool-activity:not(.is-expanded) > .mobile-activity-list > .tool-card:not(:last-child) { display: none; }
.export-tool-activity:not(.is-expanded) > .mobile-activity-list .tool-expanded-body,
.export-tool-activity:not(.is-expanded) > .mobile-activity-list .mobile-tool-target { display: none; }
.mobile-activity-list .tool-card:not(.subagent-card) .tool-card-header { flex-wrap: nowrap; gap: 7px; min-height: var(--activity-row-height); }
.mobile-activity-list .tool-card:not(.subagent-card) .tool-card-header > span:nth-child(2) { flex: none; font-size: 12px; }
.mobile-activity-list .tool-card:not(.subagent-card) .tool-card-header code { flex: 1; min-width: 0; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.mobile-activity-list .tool-card:not(.subagent-card) .tool-card-header .copy-button { display: none; }
.mobile-activity-list .tool-card:not(.subagent-card)[open] .tool-card-header .copy-button { display: grid; place-items: center; min-width: 30px; min-height: 30px; }
.tool-card[open] .tool-chevron { transform: none; }
.mobile-tool-target { display: none; }
.mobile-activity-list .subagent-header .tool-inspect-button { height: var(--activity-row-height); min-height: var(--activity-row-height); }
.mobile-activity-card.has-subagents .mobile-activity-state { flex: 1; justify-content: flex-end; }
.mobile-activity-summary:focus-visible { outline: 2px solid #aaa; outline-offset: -2px; }
.tool-card.skill-tool-card .tool-label,
.mobile-activity-list .tool-card.skill-tool-card:not(.subagent-card) .tool-label {
  flex: 0 1 auto;
  max-width: none;
  color: #c5bbcf;
  font-weight: 550;
}
.skill-tool-card .skill-tool-chevron,
.mobile-activity-list .skill-tool-card .skill-tool-chevron {
  flex: none;
  width: 11px;
  height: 11px;
  margin-left: 2px;
  fill: none;
  stroke: #8e839b;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.skill-tool-card .tool-status-mark {
  gap: 5px;
  width: auto;
  background: transparent;
  font-size: 11px;
  font-weight: 400;
  white-space: nowrap;
}
.skill-tool-card .tool-status-mark.status-completed { color: #929a93; }
.skill-tool-card .status-completed svg { color: #8fbc9b; }
.mobile-activity-list .skill-tool-card .tool-expanded-body { padding-left: 23px; }
.mobile-activity-list .skill-tool-card[open] > .mobile-tool-target { margin-left: 23px; }
@media (max-width: 760px) {
  .export-tool-activity { --activity-row-height: 44px; }
  .mobile-activity-heading { min-height: 46px; padding: 0 11px; }
  .mobile-activity-breakdown { min-height: 31px; padding: 8px 12px; }
  .export-tool-activity > .mobile-activity-list { padding: 0 10px; }
  .export-tool-activity.is-expanded > .mobile-activity-list { padding: 4px 10px; }
  .mobile-activity-list .tool-card:not(.subagent-card) .tool-card-header { min-height: 44px; }
  .mobile-activity-list .tool-card:not(.subagent-card) .tool-card-header > span:nth-child(2) { max-width: 40%; font-size: 11px; }
  .mobile-activity-list .tool-card:not(.subagent-card) .tool-card-header code { font-size: 11px; }
  .mobile-activity-card.has-subagents .mobile-activity-heading { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; gap: 0 8px; padding: 9px 11px; }
  .mobile-activity-card.has-subagents .mobile-activity-chevron { grid-column: 3; grid-row: 1; }
  .mobile-activity-card.has-subagents .mobile-activity-state { grid-column: 1 / -1; grid-row: 2; justify-content: flex-start; min-height: 36px; margin: 5px 0 0; }
  .mobile-activity-card.has-subagents .mobile-activity-outcomes { justify-content: flex-start; padding: 0; }
  .tool-card:not(.subagent-card) .tool-card-header { flex-wrap: nowrap; gap: 7px; min-height: 44px; }
  .tool-card:not(.subagent-card) .tool-card-header > span:nth-child(2) { flex: none; max-width: 40%; font-size: 11px; }
  .tool-card:not(.subagent-card) .tool-card-header code { flex: 1; min-width: 0; overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .tool-card[open] > .mobile-tool-target { display: block; padding: 8px 0; color: #ccc; font-size: 11px; overflow-wrap: anywhere; }
  .mobile-activity-list .tool-card[open] > .mobile-tool-target { margin-left: 13px; }
}
`
}
