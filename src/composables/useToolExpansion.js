import { ref } from 'vue'
import { messageBlocksFor } from '../lib/transcript'

export function useToolExpansion({ liveAssistantBlocks }) {
  const expandedTools = ref(new Set())
  const expandedSkills = ref(new Set())
  const copiedEntryId = ref('')
  const fullscreenTool = ref(null)
  let copiedTimer

  function isToolExpanded(entry) {
    return expandedTools.value.has(entry.id)
  }

  function toggleTool(entry) {
    const next = new Set(expandedTools.value)
    if (next.has(entry.id)) next.delete(entry.id)
    else next.add(entry.id)
    expandedTools.value = next
  }

  function openToolFullscreen(entry) {
    fullscreenTool.value = entry
  }

  function closeToolFullscreen() {
    fullscreenTool.value = null
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

  function liveAssistantCopyText(blocks = liveAssistantBlocks.value) {
    return blocks.map((block) => block.text).join('\n\n')
  }

  function liveAssistantDisplayCopyText(item) {
    return liveAssistantCopyText(liveAssistantDisplayBlocks(item))
  }

  async function copyEntry(entry) {
    await copyTranscriptItem(entry.id, entryCopyText(entry))
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

    copiedEntryId.value = id
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      if (copiedEntryId.value === id) copiedEntryId.value = ''
    }, 1200)
  }

  function copyTitle(id) {
    return copiedEntryId.value === id ? 'Copied' : 'Copy to clipboard'
  }

  function copyGlyph(id) {
    return copiedEntryId.value === id ? '✓' : '⧉'
  }

  function dispose() {
    clearTimeout(copiedTimer)
  }

  return {
    expandedTools,
    expandedSkills,
    copiedEntryId,
    fullscreenTool,
    isToolExpanded,
    toggleTool,
    openToolFullscreen,
    closeToolFullscreen,
    isSkillExpanded,
    toggleSkill,
    entryCopyText,
    liveAssistantDisplayBlocks,
    liveAssistantCopyText,
    liveAssistantDisplayCopyText,
    copyEntry,
    copyTranscriptItem,
    copyTitle,
    copyGlyph,
    dispose,
  }
}
