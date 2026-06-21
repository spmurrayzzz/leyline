import { computed, ref, watch } from 'vue'
import {
  createPiMemory,
  deletePiMemories,
  fetchVisibleMemories,
  setPiMemoryStatus,
  updatePiMemory,
} from '../lib/pi-api'

export function useMemoryInspector({
  selectedSession,
  selectedSessionId,
  sessionLoading,
  liveTurnActive,
  settingsOpen,
  eventLogOpen,
}) {
  const memoryOpen = ref(false)
  const memoryDirty = ref(false)
  const memoryLoading = ref(false)
  const memorySaving = ref(false)
  const memoryError = ref('')
  const memoryData = ref({
    context: {},
    counts: { active: 0, archived: 0, scopes: {} },
    memories: [],
  })
  let memoryLoadToken = 0

  const memoryEnabled = computed(() => {
    return Boolean(selectedSession.value?.cwd) && !sessionLoading.value
  })
  const memoryActiveCount = computed(() => memoryData.value.counts?.active || 0)

  watch(selectedSessionId, () => {
    if (selectedSession.value?.cwd) void loadVisibleMemory()
    else memoryData.value = {
      context: {},
      counts: { active: 0, archived: 0, scopes: {} },
      memories: [],
    }
  })

  watch(liveTurnActive, (active, wasActive) => {
    if (!active && wasActive && memoryOpen.value) void loadVisibleMemory()
  })

  function toggleMemoryDrawer() {
    if (!memoryEnabled.value && !memoryOpen.value) return
    if (memoryOpen.value && memoryDirty.value && !confirmDiscardMemoryChanges()) {
      return
    }
    memoryOpen.value = !memoryOpen.value
    if (memoryOpen.value) {
      settingsOpen.value = false
      eventLogOpen.value = false
      void loadVisibleMemory()
    }
  }

  function closeMemoryDrawer() {
    if (memoryDirty.value && !confirmDiscardMemoryChanges()) return
    memoryOpen.value = false
  }

  function confirmDiscardMemoryChanges() {
    const discard = window.confirm('Discard unsaved memory changes?')
    if (discard) memoryDirty.value = false
    return discard
  }

  async function loadVisibleMemory() {
    const session = selectedSession.value
    if (!session?.cwd) return
    const token = ++memoryLoadToken
    const sessionKey = `${session.id || ''}:${session.sessionFile || session.path || ''}`
    memoryLoading.value = true
    memoryError.value = ''
    try {
      const data = await fetchVisibleMemories(session)
      const current = selectedSession.value
      const currentKey = `${current?.id || ''}:${current?.sessionFile || current?.path || ''}`
      if (token === memoryLoadToken && sessionKey === currentKey) {
        memoryData.value = data
      }
    } catch (error) {
      if (token === memoryLoadToken) {
        memoryError.value = error.message || 'Failed to load memories'
      }
    } finally {
      if (token === memoryLoadToken) memoryLoading.value = false
    }
  }

  function memoryCounts(memories) {
    const counts = {
      active: 0,
      archived: 0,
      scopes: {
        project: { active: 0, archived: 0 },
        session: { active: 0, archived: 0 },
        global: { active: 0, archived: 0 },
      },
    }
    for (const memory of memories) {
      counts[memory.status] += 1
      counts.scopes[memory.scope][memory.status] += 1
    }
    return counts
  }

  function replaceMemories(memories) {
    memoryData.value = {
      ...memoryData.value,
      memories,
      counts: memoryCounts(memories),
    }
  }

  function upsertMemory(memory) {
    const memories = memoryData.value.memories.filter((item) => item.id !== memory.id)
    replaceMemories([memory, ...memories])
  }

  async function createMemory(payload) {
    if (!selectedSession.value) return
    memorySaving.value = true
    memoryError.value = ''
    try {
      const { memory } = await createPiMemory(
        selectedSession.value,
        payload.scope,
        payload.contentMd,
        payload.tags,
      )
      upsertMemory(memory)
    } catch (error) {
      memoryError.value = error.message || 'Failed to create memory'
      await loadVisibleMemory()
    } finally {
      memorySaving.value = false
    }
  }

  async function updateMemory(payload) {
    if (!selectedSession.value) return
    const previous = memoryData.value.memories
    const memory = previous.find((item) => item.id === payload.id)
    if (memory) {
      upsertMemory({
        ...memory,
        contentMd: payload.contentMd.trim(),
        tags: payload.tags,
        updatedAt: Date.now(),
      })
    }
    memorySaving.value = true
    memoryError.value = ''
    try {
      const { memory: updated } = await updatePiMemory(
        selectedSession.value,
        payload.id,
        payload.contentMd,
        payload.tags,
      )
      upsertMemory(updated)
    } catch (error) {
      memoryError.value = error.message || 'Failed to update memory'
      memoryData.value = { ...memoryData.value, memories: previous }
    } finally {
      memorySaving.value = false
    }
  }

  async function archiveMemories(ids) {
    await setMemoryStatus(ids, 'archived')
  }

  async function restoreMemories(ids) {
    await setMemoryStatus(ids, 'active')
  }

  async function setMemoryStatus(ids, status) {
    if (!selectedSession.value || !ids.length) return
    const previous = memoryData.value.memories
    const time = Date.now()
    replaceMemories(previous.map((memory) => {
      if (!ids.includes(memory.id)) return memory
      return {
        ...memory,
        archivedAt: status === 'archived' ? time : null,
        status,
        updatedAt: time,
      }
    }))
    memoryError.value = ''
    try {
      const { memories } = await setPiMemoryStatus(
        selectedSession.value,
        ids,
        status,
      )
      replaceMemories(memories)
    } catch (error) {
      memoryError.value = error.message || 'Failed to update memories'
      memoryData.value = { ...memoryData.value, memories: previous }
    }
  }

  async function deleteMemories(ids) {
    if (!selectedSession.value || !ids.length) return
    const previous = memoryData.value.memories
    replaceMemories(previous.filter((memory) => !ids.includes(memory.id)))
    memoryError.value = ''
    try {
      const { memories } = await deletePiMemories(selectedSession.value, ids)
      replaceMemories(memories)
    } catch (error) {
      memoryError.value = error.message || 'Failed to delete memories'
      memoryData.value = { ...memoryData.value, memories: previous }
    }
  }

  return {
    memoryOpen,
    memoryDirty,
    memoryLoading,
    memorySaving,
    memoryError,
    memoryData,
    memoryEnabled,
    memoryActiveCount,
    toggleMemoryDrawer,
    closeMemoryDrawer,
    confirmDiscardMemoryChanges,
    loadVisibleMemory,
    createMemory,
    updateMemory,
    archiveMemories,
    restoreMemories,
    deleteMemories,
  }
}
