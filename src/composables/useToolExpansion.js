import { computed, ref } from 'vue'
import { messageBlocksFor, renderedMarkdownPreview } from '../lib/transcript'

export function useToolExpansion() {
  const expandedTools = ref(new Set())
  const expandedSkills = ref(new Set())
  const copiedEntryId = ref('')
  const fullscreenTool = ref(null)
  const fullscreenToolView = ref('source')
  const fullscreenToolSupportsMarkdown = computed(
    () => isMarkdownRead(fullscreenTool.value),
  )
  const fullscreenToolMarkdown = computed(() => {
    if (!fullscreenToolSupportsMarkdown.value) return ''
    const { toolName, preview } = fullscreenTool.value
    const skill = toolName === 'read-skill'
      || /(?:^|\/)SKILL\.md$/.test(preview.path || '')
    const content = skill
      ? (preview.content || '').replace(/^\uFEFF?---[ \t]*\r?\n(?:[^\r\n]*\r?\n)*?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '')
      : preview.content
    return renderedMarkdownPreview({ ...preview, content })
  })
  let copiedTimer

  function toolExpansionId(entry) {
    if (entry.type === 'system' && entry.messageTimestamp !== undefined) {
      return `system-${entry.messageTimestamp}`
    }
    return entry.toolCallId || entry.id
  }

  function isToolExpanded(entry) {
    return expandedTools.value.has(toolExpansionId(entry))
  }

  function toggleTool(entry) {
    const id = toolExpansionId(entry)
    const next = new Set(expandedTools.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expandedTools.value = next
  }

  function openToolFullscreen(entry) {
    fullscreenTool.value = entry
    fullscreenToolView.value = isMarkdownRead(entry) ? 'rendered' : 'source'
  }

  function closeToolFullscreen() {
    fullscreenTool.value = null
    fullscreenToolView.value = 'source'
  }

  function isSkillExpanded(entry) {
    return expandedSkills.value.has(entry.id)
  }

  function toggleSkill(entry) {
    const next = new Set(expandedSkills.value)
    if (next.has(entry.id)) next.delete(entry.id)
    else next.add(entry.id)
    expandedSkills.value = next
  }

  function entryCopyText(entry) {
    return entry.copyText || entry.preview?.fallbackText || entry.text || ''
  }

  function liveAssistantDisplayBlocks(item) {
    if (item?.persistedEntry) return messageBlocksFor(item.persistedEntry)
    return item?.blocks || []
  }

  function liveAssistantDisplayCopyText(item) {
    return liveAssistantDisplayBlocks(item).map((block) => block.text).join('\n\n')
  }

  async function copyEntry(entry) {
    if (await copyEntryImage(entry)) return
    await copyTranscriptItem(entry.id, entryCopyText(entry))
  }

  async function copyEntryImage(entry) {
    const preview = entry?.preview
    if (preview?.kind !== 'image' || !preview.data) return false

    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false
      const blob = await clipboardImageBlob(preview)
      if (!blob) return false
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      markCopied(entry.id)
      return true
    } catch {
      return false
    }
  }

  async function copyImageSource(src, id = 'fullscreen-image') {
    if (!src || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false

    try {
      const blob = await clipboardPngBlob(await (await fetch(src)).blob())
      if (!blob) return false
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      markCopied(id)
      return true
    } catch {
      return false
    }
  }

  async function copyTranscriptItem(id, text) {
    if (!text) return

    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }

    markCopied(id)
  }

  function markCopied(id) {
    copiedEntryId.value = id
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      if (copiedEntryId.value === id) copiedEntryId.value = ''
    }, 1200)
  }

  function copyTitle(id) {
    return copiedEntryId.value === id ? 'Copied' : 'Copy to clipboard'
  }

  function dispose() {
    clearTimeout(copiedTimer)
  }

  return {
    expandedTools,
    expandedSkills,
    copiedEntryId,
    fullscreenTool,
    fullscreenToolView,
    fullscreenToolSupportsMarkdown,
    fullscreenToolMarkdown,
    isToolExpanded,
    toggleTool,
    openToolFullscreen,
    closeToolFullscreen,
    isSkillExpanded,
    toggleSkill,
    entryCopyText,
    liveAssistantDisplayBlocks,
    liveAssistantDisplayCopyText,
    copyEntry,
    copyImageSource,
    copyTranscriptItem,
    copyTitle,
    dispose,
  }
}

async function clipboardImageBlob(preview) {
  const source = await (await fetch(`data:${preview.mimeType || 'image/png'};base64,${preview.data}`)).blob()
  return clipboardPngBlob(source)
}

async function clipboardPngBlob(source) {
  if (source.type === 'image/png') return source

  // The async clipboard API reliably accepts PNG in Chromium/Electron, while
  // a read tool may hand us JPEG, GIF, WebP, or BMP data.
  const image = await createImageBitmap(source)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(image, 0, 0)
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  } finally {
    image.close()
  }
}

function isMarkdownRead(entry) {
  const preview = entry?.preview
  return (entry?.toolName === 'read' || entry?.toolName === 'read-skill')
    && preview?.kind === 'file'
    && (preview.language === 'markdown' || /\.(?:md|markdown)$/i.test(preview.path || ''))
}
