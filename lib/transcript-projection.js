export function projectTranscriptEntries(entries) {
  const toolCalls = collectToolCalls(entries)
  return entries.map((entry) => projectEntry(entry, toolCalls)).filter(Boolean)
}

export function collectToolCalls(entries) {
  const calls = new Map()

  for (const entry of entries) {
    if (entry.type !== 'message') continue
    if (entry.message.role !== 'assistant') continue
    if (!Array.isArray(entry.message.content)) continue

    for (const block of entry.message.content) {
      if (block.type === 'toolCall') calls.set(block.id, block)
    }
  }

  return calls
}

export function projectEntry(entry, toolCalls = collectToolCalls([entry])) {
  if (entry.type === 'message') return projectMessageEntry(entry, toolCalls)

  if (entry.type === 'model_change') {
    return eventEntry(entry, 'Model', `${entry.provider}/${entry.modelId}`)
  }

  if (entry.type === 'thinking_level_change') {
    return eventEntry(entry, 'Thinking', entry.thinkingLevel)
  }

  if (entry.type === 'compaction') {
    return summaryEntry(entry, 'Compaction', entry.summary)
  }

  if (entry.type === 'branch_summary') {
    return summaryEntry(entry, 'Branch summary', entry.summary)
  }

  return undefined
}

function eventEntry(entry, label, text) {
  return {
    id: entry.id,
    type: 'event',
    label,
    text,
    copyText: `${label} ${text}`.trim(),
    timestamp: entry.timestamp,
  }
}

function summaryEntry(entry, label, text) {
  const projected = {
    id: entry.id,
    type: 'summary',
    label,
    text,
    timestamp: entry.timestamp,
  }
  projected.copyText = copyTextForEntry(projected)
  return projected
}

function projectMessageEntry(entry, toolCalls) {
  const message = entry.message
  const content = message.content || message.output || message.summary
  const text = textFromContent(content)

  if (message.role === 'toolResult') {
    const call = toolCalls.get(message.toolCallId)
    const annotation = toolAnnotation(message.toolName, call)
    const preview = toolPreview(message.toolName, call, message.content, text)
    const projected = {
      id: entry.id,
      type: 'tool',
      label: annotation.label,
      code: annotation.code,
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      text,
      preview,
      isError: message.isError,
      timestamp: entry.timestamp,
    }

    if (message.toolName === 'subagent') {
      projected.subagentDetails = parseSubagentDetails(message)
    }

    projected.copyText = copyTextForEntry(projected)
    return projected
  }

  if (message.role === 'bashExecution') {
    const excludeFromContext = message.excludeFromContext === true
    const preview = bashPreview(message.output || '')
    const projected = {
      id: entry.id,
      type: 'tool',
      label: 'Bash',
      code: message.command,
      toolName: 'bash',
      text: preview
        ? message.output || ''
        : truncate(message.output || '', 900),
      preview,
      isError: message.exitCode && message.exitCode !== 0,
      excludeFromContext,
      contextLabel: excludeFromContext ? 'not in context' : 'in context',
      timestamp: entry.timestamp,
    }
    projected.copyText = copyTextForEntry(projected)
    return projected
  }

  const blocks = messageBlocks(message.content)
  if (message.role === 'assistant' && !blocks.length) return undefined

  const projected = {
    id: entry.id,
    type: 'message',
    role: message.role,
    label: labelForRole(message.role),
    text,
    blocks,
    skillSummaries: skillSummariesFromText(text, message.role),
    timestamp: entry.timestamp,
  }
  projected.copyText = copyTextForEntry(projected)
  return projected
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

export function textFromContent(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content)
  return textFromBlocks(messageBlocks(content))
}

export function textFromBlocks(blocks) {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

export function messageBlocksFor(entry) {
  if (entry.blocks?.length) return entry.blocks
  return [{ type: 'text', text: entry.text }]
}

export function imageBlocksFor(entry) {
  return (entry.blocks || []).filter((block) => block.type === 'image')
}

export function skillSummaries(entry) {
  return entry.skillSummaries || skillSummariesFromText(entry.text, entry.role)
}

function skillSummariesFromText(text, role) {
  if (role !== 'user' || !text?.trimStart().startsWith('<skill ')) return []

  return Array.from(text.matchAll(/<skill\s+([^>]*)>/g))
    .map((match) => ({
      name: attributeValue(match[1], 'name') || 'unknown',
      location: attributeValue(match[1], 'location'),
    }))
}

function attributeValue(source, name) {
  return source.match(new RegExp(`${name}="([^"]+)"`))?.[1]
}

function toolPreview(toolName, call, content, text) {
  const args = toolCallArgs(call)

  if (toolName === 'read' && args.path && !skillNameFromPath(args.path)) {
    const image = imageBlockFromContent(content)
    if (image) return { kind: 'image', path: args.path, ...image }
    return filePreview(args.path, text)
  }

  if (toolName === 'bash') return bashPreview(text)

  if (toolName === 'edit' && args.path) {
    const edit = args.edits?.[0]
    const oldText = args.oldText ?? edit?.oldText
    const newText = args.newText ?? edit?.newText
    if (oldText !== undefined && newText !== undefined) {
      return diffPreview(args.path, oldText, newText)
    }
  }

  if (toolName === 'write' && args.path && args.content !== undefined) {
    return filePreview(args.path, args.content)
  }

  return undefined
}

function filePreview(path, content) {
  return {
    kind: 'file',
    path,
    content,
    fallbackText: content || '',
    language: previewLanguage(path),
  }
}

function diffPreview(path, oldText, newText) {
  const preview = { kind: 'diff', path, oldText, newText }
  return {
    ...preview,
    fallbackText: previewDiffText(preview),
    language: 'diff',
  }
}

function bashPreview(text) {
  if (!looksLikePatch(text)) return undefined
  return { kind: 'patch', patch: text, fallbackText: text, language: 'diff' }
}

function imageBlockFromContent(content) {
  if (!Array.isArray(content)) return undefined
  const image = content.find((block) => block.type === 'image' && block.data)
  if (!image) return undefined
  return { data: image.data, mimeType: image.mimeType || 'image/png' }
}

function looksLikePatch(text) {
  return /^diff --git /m.test(text) || /^--- .+\n\+\+\+ /m.test(text)
}

function toolAnnotation(toolName, call) {
  const args = toolCallArgs(call)

  if (toolName === 'read-skill' && args.path) {
    const skill = skillNameFromPath(args.path)
    return {
      label: skill ? `Skill · ${skill}` : 'Skill',
      code: shortPath(args.path),
    }
  }

  if (toolName === 'read' && args.path) {
    const skill = skillNameFromPath(args.path)
    if (skill) return { label: `Skill · ${skill}`, code: shortPath(args.path) }
    return { label: 'Read', code: shortPath(args.path) }
  }

  if (toolName === 'bash' && args.command) {
    return { label: 'Bash', code: truncate(args.command, 80) }
  }

  if ((toolName === 'edit' || toolName === 'write') && args.path) {
    return { label: titleCase(toolName), code: shortPath(args.path) }
  }

  if ((toolName === 'grep' || toolName === 'find' || toolName === 'ls')
    && args.path) {
    return { label: titleCase(toolName), code: shortPath(args.path) }
  }

  if (toolName === 'list_memory') {
    return { label: 'Memory · List', code: args.scope || 'all' }
  }

  if (toolName === 'search_memory') {
    return { label: 'Memory · Search', code: truncate(args.query || '', 80) }
  }

  if (toolName === 'record_memory') {
    return { label: 'Memory · Record', code: args.scope }
  }

  if (toolName === 'update_memory') {
    return { label: 'Memory · Update', code: args.id }
  }

  if (toolName === 'archive_memory') {
    return {
      label: 'Memory · Archive',
      code: Array.isArray(args.ids) ? args.ids.join(', ') : undefined,
    }
  }

  if (toolName === 'subagent') {
    const agent = args.agent || 'subagent'
    const mode = args.mode || 'single'
    const task = args.task || (args.tasks?.length ? `${args.tasks.length} tasks` : args.chain?.length ? `${args.chain.length} steps` : '')
    return {
      label: `Subagent · ${agent}`,
      code: task ? truncate(task, 80) : undefined,
      subagentMode: mode,
    }
  }

  return { label: `Tool · ${toolName}` }
}

function toolCallArgs(call) {
  return call?.arguments || call?.args || call?.input || {}
}

function skillNameFromPath(path) {
  const match = path.match(/(?:^|\/)skills\/([^/]+)\/SKILL\.md$/)
  return match?.[1]
}

function shortPath(path) {
  const home = homePath()
  if (!home) return path
  return path.replace(`${home}/`, '~/')
}

function homePath() {
  if (typeof process === 'undefined') return ''
  return process.env?.HOME || ''
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function labelForRole(role) {
  if (role === 'user') return 'You'
  if (role === 'assistant') return 'Agent'
  if (role === 'custom') return 'Custom'
  if (role === 'compactionSummary') return 'Compaction summary'
  if (role === 'branchSummary') return 'Branch summary'
  return role
}

function copyTextForEntry(entry) {
  if (entry.type === 'event') return `${entry.label} ${entry.text}`.trim()
  if (entry.type === 'tool') return toolCopyText(entry)
  if (entry.blocks?.length) {
    return messageBlocksFor(entry).map((block) => block.text).join('\n\n')
  }
  return entry.text || ''
}

function toolCopyText(entry) {
  const preview = entry.preview
  if (!preview) return entry.text || ''
  return preview.fallbackText || entry.text || ''
}

export function previewDiffText(preview) {
  const path = preview.path || 'tool-output.txt'
  const oldLines = splitDiffLines(preview.oldText || '')
  const newLines = splitDiffLines(preview.newText || '')
  const oldCount = Math.max(oldLines.length, 1)
  const newCount = Math.max(newLines.length, 1)

  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join('\n')
}

function splitDiffLines(text) {
  return text.replace(/\n$/, '').split('\n')
}

export function previewLanguage(path) {
  const ext = path?.split('.').pop()?.toLowerCase()
  const languages = {
    cjs: 'javascript',
    css: 'css',
    html: 'html',
    js: 'javascript',
    json: 'json',
    jsonl: 'json',
    jsx: 'javascript',
    mjs: 'javascript',
    md: 'markdown',
    py: 'python',
    rb: 'ruby',
    sh: 'bash',
    ts: 'typescript',
    tsx: 'typescript',
    vue: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
  }
  return languages[ext] || ext || ''
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

function parseSubagentDetails(message) {
  const details = message.details
  if (details && details.results) {
    return {
      mode: details.mode || 'single',
      results: details.results,
      background: details.background === true,
    }
  }

  return null
}
