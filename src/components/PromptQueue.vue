<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { updatePromptQueue } from '../lib/pi-api'

const props = defineProps({
  sessionId: { type: String, default: '' },
  editDrafts: { type: Map, default: () => new Map() },
  promptQueue: {
    type: Object,
    default: () => ({ revision: 0, held: false, error: '', items: [] }),
  },
  queuedMessages: {
    type: Object,
    default: () => ({ steering: [], followUp: [] }),
  },
})

const emit = defineEmits(['runtime'])
const root = ref(null)
const toggle = ref(null)
const popover = ref(null)
const expanded = ref(Boolean(props.editDrafts.get(props.sessionId)))
const fillsComposer = ref(false)
const menuId = ref('')
const editor = ref(props.editDrafts.get(props.sessionId) || null)
props.editDrafts.delete(props.sessionId)
const editorInput = ref(null)
const busy = ref(false)
const error = ref('')
const boundaryTitle = 'Deliver at the agent’s next input boundary. Once accepted, this input cannot be edited or removed here.'
let generation = 0
let resizeObserver

const items = computed(() => props.promptQueue?.items || [])
const held = computed(() => Boolean(props.promptQueue?.held))
const nativeMessages = computed(() => [
  ...(props.queuedMessages?.steering || []).map((text) => ({ text, kind: 'Steering' })),
  ...(props.queuedMessages?.followUp || []).map((text) => ({ text, kind: 'Follow-up' })),
])
const queueError = computed(() => error.value || props.promptQueue?.error)
const visible = computed(() => Boolean(items.value.length || held.value || queueError.value || editor.value || nativeMessages.value.length))
const queueSummary = computed(() => {
  if (items.value.length) return { label: held.value ? 'Held' : 'Up next', count: items.value.length }
  if (editor.value) return { label: 'Unsent edit' }
  if (held.value) return { label: 'Queue held' }
  if (queueError.value) return { label: 'Queue needs attention' }
  return { label: 'Sent to agent', count: nativeMessages.value.length }
})
const editedItem = computed(() => items.value.find((item) => item.id === editor.value?.id))
const editWarning = computed(() => {
  if (!editor.value) return ''
  if (!editedItem.value || editedItem.value.status !== 'pending') {
    return 'This message was sent or removed in another window. Your edit is kept here so you can copy it.'
  }
  if (editedItem.value.text !== editor.value.originalText) {
    return 'This message changed in another window. Your edit is kept here. Copy it before cancelling and reopening the message.'
  }
  if (!held.value) return 'The queue was resumed in another window. Hold it again before saving.'
  return ''
})
const canSave = computed(() => editor.value && !busy.value && !editWarning.value
  && (editor.value.text.trim() || editedItem.value?.imageCount > 0))

watch(() => props.sessionId, (id, previousId) => {
  generation += 1
  if (editor.value) props.editDrafts.set(previousId, editor.value)
  else props.editDrafts.delete(previousId)
  editor.value = props.editDrafts.get(id) || null
  props.editDrafts.delete(id)
  menuId.value = ''
  error.value = ''
  busy.value = false
  expanded.value = Boolean(editor.value)
}, { flush: 'sync' })

watch(items, (value) => {
  if (!value.some((item) => item.id === menuId.value && item.status === 'pending')) menuId.value = ''
})
watch(visible, (value) => {
  if (!value) closePopover()
})
watch(root, (element) => {
  resizeObserver?.disconnect()
  fillsComposer.value = false
  if (!element) return
  resizeObserver = new ResizeObserver(() => {
    if (root.value !== element) return
    fillsComposer.value = Boolean(popover.value
      && popover.value.offsetWidth >= element.clientWidth)
  })
  resizeObserver.observe(element)
}, { flush: 'post' })
onBeforeUnmount(() => {
  generation += 1
  if (editor.value && props.sessionId) props.editDrafts.set(props.sessionId, editor.value)
  resizeObserver?.disconnect()
})

async function request(action, fields = {}) {
  if (busy.value || !props.sessionId) return null
  const sessionId = props.sessionId
  const requestGeneration = generation
  busy.value = true
  error.value = ''
  menuId.value = ''
  try {
    const result = await updatePromptQueue(sessionId, {
      action,
      revision: props.promptQueue.revision,
      ...fields,
    })
    if (sessionId !== props.sessionId || requestGeneration !== generation) return null
    emit('runtime', result.active)
    await nextTick()
    if (sessionId !== props.sessionId || requestGeneration !== generation) return null
    return result
  } catch (cause) {
    if (sessionId === props.sessionId && requestGeneration === generation) {
      error.value = cause.message || 'Could not update the queue. Try again.'
    }
    return null
  } finally {
    if (sessionId === props.sessionId && requestGeneration === generation) busy.value = false
  }
}

function cancelEdit() {
  if (busy.value) return false
  if (editor.value?.text !== editor.value?.originalText
    && !window.confirm('Discard your changes to this queued message? The queue will stay held.')) return false
  editor.value = null
  props.editDrafts.delete(props.sessionId)
  return true
}

async function beginEdit(item) {
  if (editor.value && !cancelEdit()) return
  const editGeneration = generation
  const draft = { id: item.id, text: item.text, originalText: item.text, imageCount: item.imageCount }
  const result = await request('hold')
  if (!result || editGeneration !== generation) return
  editor.value = draft
  await nextTick()
  if (expanded.value) editorInput.value?.focus()
}

async function saveEdit() {
  if (!canSave.value) return
  const editGeneration = generation
  const result = await request('edit', { id: editor.value.id, text: editor.value.text })
  if (result && editGeneration === generation) {
    editor.value = null
    props.editDrafts.delete(props.sessionId)
  }
}

async function toggleExpanded() {
  expanded.value = !expanded.value
  menuId.value = ''
  if (expanded.value) {
    await nextTick()
    popover.value?.focus({ preventScroll: true })
  }
}

function closePopover() {
  expanded.value = false
  menuId.value = ''
}

function closeOutside(event) {
  if (!event.composedPath().includes(root.value)) closePopover()
}

function dismiss() {
  if (menuId.value) {
    menuId.value = ''
    return true
  }
  if (!expanded.value) return false
  closePopover()
  toggle.value?.focus({ preventScroll: true })
  return true
}

function hasDrafts() {
  return Boolean(editor.value || props.editDrafts.size)
}

defineExpose({ dismiss, closeOutside, hasDrafts, surfaceOpen: expanded })
</script>

<template>
  <section
    v-if="visible"
    ref="root"
    class="prompt-queue"
    :class="{ 'is-open': expanded, 'fills-composer': fillsComposer }"
    aria-label="Prompt queue"
  >
    <div class="queue-heading" :class="{ 'is-held': held }">
      <button
        ref="toggle"
        class="queue-toggle"
        type="button"
        :aria-expanded="expanded"
        aria-haspopup="dialog"
        :title="queueError || 'Manage queued messages'"
        @click="toggleExpanded"
      >
        <svg class="queue-stack-icon" viewBox="0 0 18 18" aria-hidden="true"><rect x="4" y="6" width="11" height="9" rx="2" /><path d="M12 3H5a3 3 0 0 0-3 3v6" /></svg>
        <span class="queue-summary-label" :class="{ 'queue-held': held }">{{ queueSummary.label }}</span>
        <span v-if="queueSummary.count" class="queue-count">{{ queueSummary.count }}</span>
        <span v-if="queueError && items.length" class="queue-attention">Needs attention</span>
        <svg class="queue-chevron" viewBox="0 0 16 16" :class="{ 'queue-expanded': expanded }" aria-hidden="true"><path d="m5 6 3 3 3-3" /></svg>
      </button>
      <button v-if="held" class="queue-resume" type="button" aria-label="Resume queue" :disabled="busy || !!editor" :title="editor ? 'Save or cancel your edit before resuming' : 'Resume sending queued messages'" @click="request('resume')">Resume</button>
    </div>
    <div v-if="expanded" ref="popover" class="queue-popover" role="dialog" aria-label="Queued messages" tabindex="-1">
      <ol v-if="items.length" class="queue-list">
        <li v-for="(item, index) in items" :key="item.id" :class="{ 'queue-editing': editor?.id === item.id }">
          <div class="queue-item">
            <span class="queue-number" aria-hidden="true">{{ index + 1 }}</span>
            <span class="queue-text" :title="item.text">{{ item.text || 'Image attachment' }}</span>
            <span v-if="item.imageCount" class="queue-images">{{ item.imageCount }} {{ item.imageCount === 1 ? 'image' : 'images' }}</span>
            <span v-if="item.status === 'sending'" class="queue-sending" :title="boundaryTitle">Sending</span>
            <button v-else class="queue-icon" type="button" :disabled="busy" :aria-label="`Actions for queued message ${index + 1}`" :aria-expanded="menuId === item.id" title="Message actions" @click="menuId = menuId === item.id ? '' : item.id">
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r=".7" /><circle cx="8" cy="8" r=".7" /><circle cx="13" cy="8" r=".7" /></svg>
            </button>
          </div>
          <div v-if="menuId === item.id" class="queue-more-actions" role="group" :aria-label="`Actions for queued message ${index + 1}`">
            <button type="button" :disabled="busy" @click="beginEdit(item)">Edit</button>
            <button type="button" :disabled="busy || index === 0 || items[index - 1]?.status === 'sending'" @click="request('move', { id: item.id, direction: 'up' })">Move up</button>
            <button type="button" :disabled="busy || index === items.length - 1 || items[index + 1]?.status === 'sending'" @click="request('move', { id: item.id, direction: 'down' })">Move down</button>
            <button type="button" :disabled="busy || held || !!editor" :title="boundaryTitle" @click="request('steer', { id: item.id })">Steer now</button>
            <button type="button" :disabled="busy || editor?.id === item.id" @click="request('remove', { id: item.id })">Remove</button>
          </div>
        </li>
      </ol>
      <div v-if="editor" class="queue-editor">
        <label>
          <span>Edit queued message</span>
          <textarea ref="editorInput" v-model="editor.text" :disabled="busy" @keydown.stop @paste.stop></textarea>
        </label>
        <p class="queue-edit-hint">The queue stays held until you resume.</p>
        <p v-if="editor.imageCount" class="queue-edit-hint">{{ editor.imageCount }} {{ editor.imageCount === 1 ? 'image is' : 'images are' }} kept with this message.</p>
        <p v-if="editWarning" class="queue-edit-warning" role="status">{{ editWarning }}</p>
        <div class="queue-editor-actions">
          <button v-if="!held && editedItem?.status === 'pending'" type="button" :disabled="busy" @click="request('hold')">Hold queue</button>
          <button type="button" :disabled="busy" @click="cancelEdit">Cancel</button>
          <button class="queue-save" type="button" :disabled="!canSave" @click="saveEdit">Save</button>
        </div>
      </div>
      <p v-else-if="held && !items.length" class="queue-empty">New messages will stay queued until you resume.</p>
      <p v-if="queueError" class="queue-error" role="alert">{{ queueError }}</p>
      <details v-if="nativeMessages.length" class="queue-sent">
        <summary :title="boundaryTitle">Sent to agent <span class="queue-count">{{ nativeMessages.length }}</span></summary>
        <div v-for="(message, index) in nativeMessages" :key="index" class="queue-sent-row" :title="boundaryTitle">
          <span>{{ message.kind }}</span>
          <span class="queue-text" :title="message.text">{{ message.text || 'Image attachment' }}</span>
        </div>
      </details>
    </div>
  </section>
</template>
