<script setup>
import { computed, ref, watch } from 'vue'
import { formatDate } from '../lib/format'
import { renderedBlock } from '../lib/transcript'

const scopes = [
  { key: 'project', label: 'Project', note: 'Applies to this project.' },
  { key: 'session', label: 'Session', note: 'Applies to this session.' },
  { key: 'global', label: 'Global', note: 'Applies across projects.' },
]

const props = defineProps({
  context: { type: Object, default: () => ({}) },
  counts: { type: Object, default: () => ({ active: 0, archived: 0 }) },
  disabled: Boolean,
  error: { type: String, default: '' },
  loading: Boolean,
  memories: { type: Array, default: () => [] },
  saving: Boolean,
})

const emit = defineEmits([
  'archive',
  'close',
  'create',
  'delete',
  'dirty-change',
  'refresh',
  'restore',
  'update',
])

const query = ref('')
const archivedOpen = ref(new Set())
const creatingScope = ref('')
const editingId = ref('')
const contentDraft = ref('')
const tagsDraft = ref('')
const deleteId = ref('')
const selectionMode = ref(false)
const selectedIds = ref(new Set())
const copiedId = ref('')
let copiedTimer = null

const dirty = computed(() => Boolean(creatingScope.value || editingId.value))
const matchingMemories = computed(() => {
  const text = query.value.trim()
  if (!text) return props.memories
  return props.memories.filter((memory) => memoryMatchesSearch(memory, text))
})
const selectedMemories = computed(() => {
  return props.memories.filter((memory) => selectedIds.value.has(memory.id))
})
const selectedActiveCount = computed(() => {
  return selectedMemories.value.filter((memory) => memory.status === 'active').length
})
const selectedArchivedCount = computed(() => {
  return selectedMemories.value.filter((memory) => memory.status === 'archived').length
})

watch(dirty, (value) => emit('dirty-change', value), { immediate: true })
watch(() => props.memories, () => {
  const ids = new Set(props.memories.map((memory) => memory.id))
  selectedIds.value = new Set([...selectedIds.value].filter((id) => ids.has(id)))
})

function scopeRows(scope, status) {
  return matchingMemories.value.filter((memory) => {
    return memory.scope === scope && memory.status === status
  })
}

function scopeCount(scope, status) {
  return props.counts?.scopes?.[scope]?.[status] || 0
}

function archivedVisible(scope) {
  return query.value.trim() || archivedOpen.value.has(scope)
}

function toggleArchived(scope) {
  const next = new Set(archivedOpen.value)
  if (next.has(scope)) next.delete(scope)
  else next.add(scope)
  archivedOpen.value = next
}

function beginCreate(scope) {
  if (props.disabled || formOpen()) return
  creatingScope.value = scope
  editingId.value = ''
  contentDraft.value = ''
  tagsDraft.value = ''
  deleteId.value = ''
}

function beginEdit(memory) {
  if (formOpen()) return
  editingId.value = memory.id
  creatingScope.value = ''
  contentDraft.value = memory.contentMd || ''
  tagsDraft.value = (memory.tags || []).join(', ')
  deleteId.value = ''
}

function cancelForm() {
  creatingScope.value = ''
  editingId.value = ''
  contentDraft.value = ''
  tagsDraft.value = ''
}

function saveForm() {
  const tags = parseTags(tagsDraft.value)
  if (creatingScope.value) {
    emit('create', {
      contentMd: contentDraft.value,
      scope: creatingScope.value,
      tags,
    })
  } else if (editingId.value) {
    emit('update', {
      contentMd: contentDraft.value,
      id: editingId.value,
      tags,
    })
  }
  cancelForm()
}

function archive(memory) {
  if (formOpen()) return
  emit('archive', [memory.id])
}

function restore(memory) {
  if (formOpen()) return
  emit('restore', [memory.id])
}

function confirmDelete(memory) {
  if (formOpen()) return
  deleteId.value = memory.id
}

function deleteMemory(memory) {
  emit('delete', [memory.id])
  deleteId.value = ''
}

function toggleSelectionMode() {
  if (formOpen()) return
  selectionMode.value = !selectionMode.value
  selectedIds.value = new Set()
}

function toggleSelected(memory) {
  const next = new Set(selectedIds.value)
  if (next.has(memory.id)) next.delete(memory.id)
  else next.add(memory.id)
  selectedIds.value = next
}

function bulkArchive() {
  emit('archive', selectedMemories.value
    .filter((memory) => memory.status === 'active')
    .map((memory) => memory.id))
  clearSelection()
}

function bulkRestore() {
  emit('restore', selectedMemories.value
    .filter((memory) => memory.status === 'archived')
    .map((memory) => memory.id))
  clearSelection()
}

function bulkDelete() {
  const count = selectedIds.value.size
  if (!count) return
  if (!window.confirm(`Delete ${count} selected memories permanently?`)) return
  emit('delete', [...selectedIds.value])
  clearSelection()
}

function clearSelection() {
  selectedIds.value = new Set()
  selectionMode.value = false
}

function formOpen() {
  return Boolean(creatingScope.value || editingId.value)
}

function parseTags(value) {
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function memoryMatchesSearch(memory, query) {
  const text = [
    memory.contentMd,
    memory.reasonMd,
    memory.source,
    ...(memory.tags || []),
  ].filter(Boolean).join(' ').toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => {
    return text.includes(term)
  })
}

function sourceLabel(source) {
  return String(source || 'unknown')
}

async function copyId(id) {
  try {
    await navigator.clipboard.writeText(id)
    copiedId.value = id
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copiedId.value = '' }, 900)
  } catch {}
}

function renderedMemory(memory) {
  return renderedBlock({ text: memory.contentMd || '' })
}

function canCreate(scope) {
  return !props.disabled && (scope !== 'session' || props.context?.sessionAvailable)
}
</script>

<template>
  <aside class="memory-drawer" aria-label="Memory Inspector">
    <header class="memory-drawer-header">
      <div>
        <strong>Memory</strong>
        <span>{{ counts.active || 0 }} active · {{ counts.archived || 0 }} archived</span>
      </div>
      <div class="memory-header-actions">
        <button type="button" @click="emit('refresh')">Refresh</button>
        <button type="button" @click="toggleSelectionMode">
          {{ selectionMode ? 'Done' : 'Select' }}
        </button>
        <button type="button" @click="emit('close')">×</button>
      </div>
    </header>

    <div class="memory-caveat">
      Changes affect future turns only. Memories already used earlier in this
      session may remain in transcript context.
    </div>

    <label class="memory-search">
      <span>Search visible memory</span>
      <input v-model="query" type="search" placeholder="Filter content, tags, reason…">
    </label>

    <div v-if="selectionMode" class="memory-bulk-bar">
      <strong>{{ selectedIds.size }} selected</strong>
      <button type="button" :disabled="!selectedActiveCount" @click="bulkArchive">
        Archive {{ selectedActiveCount || '' }}
      </button>
      <button type="button" :disabled="!selectedArchivedCount" @click="bulkRestore">
        Restore {{ selectedArchivedCount || '' }}
      </button>
      <button type="button" :disabled="!selectedIds.size" @click="bulkDelete">
        Delete {{ selectedIds.size || '' }}
      </button>
    </div>

    <div v-if="loading" class="memory-empty">Loading memory…</div>
    <div v-else-if="error" class="memory-error">{{ error }}</div>

    <div v-else class="memory-sections">
      <section
        v-for="scope in scopes"
        :key="scope.key"
        class="memory-section"
        :class="{ disabled: scope.key === 'session' && !context.sessionAvailable }"
      >
        <header class="memory-section-header">
          <div>
            <h2>{{ scope.label }}</h2>
            <span>
              {{ scopeCount(scope.key, 'active') }} active ·
              {{ scopeCount(scope.key, 'archived') }} archived
            </span>
          </div>
          <button
            type="button"
            :disabled="!canCreate(scope.key) || selectionMode || formOpen()"
            @click="beginCreate(scope.key)"
          >+ {{ scope.label }}</button>
        </header>
        <p class="memory-section-note">
          <template v-if="scope.key === 'session' && !context.sessionAvailable">
            Session memory is available after a session is created.
          </template>
          <template v-else>{{ scope.note }}</template>
        </p>

        <form
          v-if="creatingScope === scope.key"
          class="memory-card memory-form"
          @submit.prevent="saveForm"
        >
          <textarea v-model="contentDraft" rows="5" placeholder="Memory markdown…" />
          <input v-model="tagsDraft" type="text" placeholder="tags, comma-separated">
          <div class="memory-form-actions">
            <button type="button" @click="cancelForm">Cancel</button>
            <button type="submit" :disabled="saving || !contentDraft.trim()">Save</button>
          </div>
        </form>

        <div v-if="scopeRows(scope.key, 'active').length" class="memory-card-list">
          <article
            v-for="memory in scopeRows(scope.key, 'active')"
            :key="memory.id"
            class="memory-card"
          >
            <label v-if="selectionMode" class="memory-select">
              <input
                type="checkbox"
                :checked="selectedIds.has(memory.id)"
                @change="toggleSelected(memory)"
              >
            </label>
            <form v-if="editingId === memory.id" class="memory-form" @submit.prevent="saveForm">
              <textarea v-model="contentDraft" rows="5" />
              <input v-model="tagsDraft" type="text" placeholder="tags, comma-separated">
              <div class="memory-form-actions">
                <button type="button" @click="cancelForm">Cancel</button>
                <button type="submit" :disabled="saving || !contentDraft.trim()">Save</button>
              </div>
            </form>
            <template v-else>
              <div class="memory-card-markdown markdown-body" v-html="renderedMemory(memory)" />
              <div class="memory-card-meta">
                <span class="memory-source">{{ sourceLabel(memory.source) }}</span>
                <span v-for="tag in memory.tags" :key="tag" class="memory-tag">{{ tag }}</span>
              </div>
              <details class="memory-details">
                <summary>Details</summary>
                <dl>
                  <div>
                    <dt>ID</dt>
                    <dd class="memory-id-row">
                      <span>{{ memory.id }}</span>
                      <button type="button" @click="copyId(memory.id)">
                        {{ copiedId === memory.id ? 'Copied' : 'Copy' }}
                      </button>
                    </dd>
                  </div>
                  <div><dt>Updated</dt><dd>{{ formatDate(memory.updatedAt) }}</dd></div>
                  <div><dt>Created</dt><dd>{{ formatDate(memory.createdAt) }}</dd></div>
                  <div v-if="memory.reasonMd"><dt>Reason</dt><dd>{{ memory.reasonMd }}</dd></div>
                </dl>
              </details>
              <div v-if="deleteId === memory.id" class="memory-delete-confirm">
                <span>Delete permanently?</span>
                <button type="button" @click="deleteId = ''">Cancel</button>
                <button type="button" @click="deleteMemory(memory)">Delete</button>
              </div>
              <div v-else class="memory-card-actions">
                <button type="button" :disabled="selectionMode" @click="beginEdit(memory)">Edit</button>
                <button type="button" :disabled="selectionMode" @click="archive(memory)">Archive</button>
                <button type="button" :disabled="selectionMode" @click="confirmDelete(memory)">Delete</button>
              </div>
            </template>
          </article>
        </div>
        <div v-else class="memory-empty">
          No active {{ scope.label.toLowerCase() }} memories.
        </div>

        <button
          v-if="scopeCount(scope.key, 'archived') || scopeRows(scope.key, 'archived').length"
          type="button"
          class="memory-archived-toggle"
          @click="toggleArchived(scope.key)"
        >
          {{ archivedVisible(scope.key) ? 'Hide' : 'Show' }} archived
          · {{ scopeCount(scope.key, 'archived') }}
        </button>

        <div v-if="archivedVisible(scope.key)" class="memory-archived-list">
          <article
            v-for="memory in scopeRows(scope.key, 'archived')"
            :key="memory.id"
            class="memory-card archived"
          >
            <label v-if="selectionMode" class="memory-select">
              <input
                type="checkbox"
                :checked="selectedIds.has(memory.id)"
                @change="toggleSelected(memory)"
              >
            </label>
            <form v-if="editingId === memory.id" class="memory-form" @submit.prevent="saveForm">
              <textarea v-model="contentDraft" rows="5" />
              <input v-model="tagsDraft" type="text" placeholder="tags, comma-separated">
              <div class="memory-form-actions">
                <button type="button" @click="cancelForm">Cancel</button>
                <button type="submit" :disabled="saving || !contentDraft.trim()">Save</button>
              </div>
            </form>
            <template v-else>
              <div class="memory-card-markdown markdown-body" v-html="renderedMemory(memory)" />
              <div class="memory-card-meta">
                <span class="memory-source">{{ sourceLabel(memory.source) }}</span>
                <span v-for="tag in memory.tags" :key="tag" class="memory-tag">{{ tag }}</span>
              </div>
              <details class="memory-details">
                <summary>Details</summary>
                <dl>
                  <div>
                    <dt>ID</dt>
                    <dd class="memory-id-row">
                      <span>{{ memory.id }}</span>
                      <button type="button" @click="copyId(memory.id)">
                        {{ copiedId === memory.id ? 'Copied' : 'Copy' }}
                      </button>
                    </dd>
                  </div>
                  <div><dt>Updated</dt><dd>{{ formatDate(memory.updatedAt) }}</dd></div>
                  <div><dt>Archived</dt><dd>{{ formatDate(memory.archivedAt) }}</dd></div>
                  <div v-if="memory.reasonMd"><dt>Reason</dt><dd>{{ memory.reasonMd }}</dd></div>
                </dl>
              </details>
              <div v-if="deleteId === memory.id" class="memory-delete-confirm">
                <span>Delete permanently?</span>
                <button type="button" @click="deleteId = ''">Cancel</button>
                <button type="button" @click="deleteMemory(memory)">Delete</button>
              </div>
              <div v-else class="memory-card-actions">
                <button type="button" :disabled="selectionMode" @click="beginEdit(memory)">Edit</button>
                <button type="button" :disabled="selectionMode" @click="restore(memory)">Restore</button>
                <button type="button" :disabled="selectionMode" @click="confirmDelete(memory)">Delete</button>
              </div>
            </template>
          </article>
          <div v-if="!scopeRows(scope.key, 'archived').length" class="memory-empty">
            No archived matches.
          </div>
        </div>
      </section>
    </div>
  </aside>
</template>
