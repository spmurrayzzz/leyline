import { computed, onScopeDispose, ref, watch } from 'vue'
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
  let memoryContextToken = 0

  const memoryTarget = computed(() => ({
    id: selectedSession.value?.id,
    cwd: selectedSession.value?.cwd,
    sessionFile: selectedSession.value?.sessionFile || selectedSession.value?.path,
  }))
  const memoryEnabled = computed(() => {
    return Boolean(selectedSession.value?.cwd) && !sessionLoading.value
  })
  const memoryActiveCount = computed(() => memoryData.value.counts?.active || 0)

  watch([selectedSessionId, () => memoryKey(memoryTarget.value)], () => {
    memoryContextToken += 1
    memoryLoadToken += 1
    memoryLoading.value = false
    memoryError.value = ''
    memoryData.value = {
      context: {},
      counts: { active: 0, archived: 0, scopes: {} },
      memories: [],
    }
    if (memoryTarget.value.cwd) void loadVisibleMemory()
  }, { flush: 'sync' })

  watch(liveTurnActive, (active, wasActive) => {
    if (!active && wasActive && memoryOpen.value) void loadVisibleMemory()
  })

  onScopeDispose(() => {
    memoryContextToken += 1
    memoryLoadToken += 1
  })

  function memoryKey(target) {
    return JSON.stringify([target.id, target.cwd, target.sessionFile || target.path])
  }

  function toggleMemoryDrawer() {
    if (!memoryEnabled.value && !memoryOpen.value) return
    if (memoryOpen.value && !confirmDiscardMemoryChanges()) return
    memoryOpen.value = !memoryOpen.value
    if (memoryOpen.value) {
      settingsOpen.value = false
      void loadVisibleMemory()
    }
  }

  function closeMemoryDrawer() {
    if (!confirmDiscardMemoryChanges()) return
    memoryOpen.value = false
  }

  function confirmDiscardMemoryChanges() {
    if (memorySaving.value) return false
    if (!memoryDirty.value) return true
    const discard = window.confirm('Discard unsaved memory changes?')
    if (discard) memoryDirty.value = false
    return discard
  }

  async function loadVisibleMemory() {
    const target = { ...memoryTarget.value }
    if (!target.cwd) return
    const token = ++memoryLoadToken
    const contextToken = memoryContextToken
    const current = () => token === memoryLoadToken && contextToken === memoryContextToken
      && memoryKey(target) === memoryKey(memoryTarget.value)
    memoryLoading.value = true
    memoryError.value = ''
    try {
      const data = await fetchVisibleMemories(target)
      if (current()) memoryData.value = data
    } catch (error) {
      if (current()) memoryError.value = error.message || 'Failed to load memories'
    } finally {
      if (current()) memoryLoading.value = false
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

  async function mutateMemory(target, request, accept, reportError = false) {
    if (!target?.cwd) return { ok: false, error: 'The memory target is unavailable.' }
    if (memorySaving.value) return { ok: false, error: 'A memory change is already in progress.' }
    const contextToken = memoryContextToken
    const current = () => contextToken === memoryContextToken
      && memoryKey(target) === memoryKey(memoryTarget.value)
    memorySaving.value = true
    if (reportError && current()) memoryError.value = ''
    try {
      const result = await request()
      if (current()) {
        memoryLoadToken += 1
        memoryLoading.value = false
        accept(result)
      }
      return { ok: true }
    } catch (failure) {
      const error = failure.message || 'Failed to save memory changes'
      if (reportError && current()) memoryError.value = error
      return { ok: false, error }
    } finally {
      memorySaving.value = false
    }
  }

  function saveMemory(change) {
    const target = { ...change.target }
    if (change.kind === 'create') {
      return mutateMemory(target,
        () => createPiMemory(target, change.scope, change.contentMd, change.tags),
        ({ memory }) => upsertMemory(memory))
    }
    if (change.kind === 'update') {
      return mutateMemory(target,
        () => updatePiMemory(target, change.id, change.contentMd, change.tags),
        ({ memory }) => upsertMemory(memory))
    }
    return Promise.resolve({ ok: false, error: 'Unknown memory change.' })
  }

  function archiveMemories(ids) {
    return setMemoryStatus(ids, 'archived')
  }

  function restoreMemories(ids) {
    return setMemoryStatus(ids, 'active')
  }

  function setMemoryStatus(ids, status) {
    if (!ids.length) return
    const target = { ...memoryTarget.value }
    return mutateMemory(target,
      () => setPiMemoryStatus(target, ids, status),
      ({ memories }) => replaceMemories(memories), true)
  }

  function deleteMemories(ids) {
    if (!ids.length) return
    const target = { ...memoryTarget.value }
    return mutateMemory(target,
      () => deletePiMemories(target, ids),
      ({ memories }) => replaceMemories(memories), true)
  }

  return {
    memoryOpen,
    memoryDirty,
    memoryLoading,
    memorySaving,
    memoryError,
    memoryData,
    memoryTarget,
    memoryEnabled,
    memoryActiveCount,
    toggleMemoryDrawer,
    closeMemoryDrawer,
    confirmDiscardMemoryChanges,
    loadVisibleMemory,
    saveMemory,
    archiveMemories,
    restoreMemories,
    deleteMemories,
  }
}
