<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from 'vue'
import { imageSrc, renderedMarkdownPreview } from '../lib/transcript'

const PierrePreview = defineAsyncComponent(() => import('./PierrePreview.vue'))
const props = defineProps({
  file: { type: Object, required: true },
  copiedId: { type: String, default: '' },
})
const emit = defineEmits(['close', 'back', 'approve', 'copy', 'menu'])
const dialog = ref(null)
const body = ref(null)
const view = ref('source')
const markdown = computed(() => props.file.language === 'markdown' && props.file.kind === 'file')
const html = computed(() => markdown.value ? renderedMarkdownPreview(props.file) : '')
const positionWarning = computed(() => {
  if (!props.file.line || props.file.kind !== 'file') return ''
  const lines = props.file.content.split('\n').length
  return props.file.line > lines ? `Line ${props.file.line} is beyond this file (${lines} lines).` : ''
})

onMounted(() => dialog.value?.focus({ preventScroll: true }))
watch(() => [props.file.target, props.file.content], () => {
  view.value = markdown.value && !props.file.line ? 'rendered' : 'source'
  nextTick(() => {
    if (!dialog.value?.contains(document.activeElement)) dialog.value?.focus({ preventScroll: true })
    if (body.value && !(props.file.line && view.value === 'source')) body.value.scrollTop = 0
    scrollToHeading(props.file.anchor)
  })
}, { immediate: true })
watch(view, () => nextTick(() => scrollToHeading(props.file.anchor)))

function scrollToHeading(anchor) {
  if (!anchor || view.value !== 'rendered') return
  const heading = [...(body.value?.querySelectorAll('[id]') || [])]
    .find((element) => element.id === anchor)
  if (heading) body.value.scrollTop += heading.getBoundingClientRect().top - body.value.getBoundingClientRect().top - 20
}

function trapFocus(event) {
  if (event.key !== 'Tab') return
  const focusable = [...dialog.value.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')]
    .filter((element) => element.getClientRects().length)
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
</script>

<template>
  <div class="tool-fullscreen-backdrop tool-preview-fullscreen-backdrop file-preview-backdrop" @click.self="emit('close')">
    <section
      ref="dialog"
      class="tool-fullscreen file-preview"
      role="dialog"
      aria-modal="true"
      aria-label="File preview"
      tabindex="-1"
      @keydown="trapFocus"
    >
      <header class="tool-fullscreen-header">
        <div class="file-preview-heading">
          <button v-if="file.canGoBack" type="button" @click="emit('back')">Back</button>
          <span>File preview</span>
          <code :title="file.path">{{ file.path }}</code>
        </div>
        <div class="file-preview-actions">
          <div v-if="markdown" class="tool-fullscreen-view-toggle" role="group" aria-label="Markdown view">
            <button type="button" :class="{ active: view === 'rendered' }" :aria-pressed="view === 'rendered'" @click="view = 'rendered'">Rendered</button>
            <button type="button" :class="{ active: view === 'source' }" :aria-pressed="view === 'source'" @click="view = 'source'">Source</button>
          </div>
          <button type="button" :disabled="file.loading" @click="emit('copy', 'file-path', file.path)">{{ copiedId === 'file-path' ? 'Copied' : 'Copy path' }}</button>
          <button v-if="file.kind === 'file'" type="button" @click="emit('copy', 'file-content', file.content)">{{ copiedId === 'file-content' ? 'Copied' : 'Copy content' }}</button>
          <button type="button" aria-label="File actions" aria-haspopup="menu" :disabled="file.loading" @click="emit('menu', $event)">Actions</button>
          <button type="button" aria-label="Close file preview" @click="emit('close')">×</button>
        </div>
      </header>
      <div v-if="file.source === 'disk'" class="file-preview-meta">
        Current file on disk<span v-if="file.line"> · Line {{ file.line }}<template v-if="file.endLine">–{{ file.endLine }}</template></span>
      </div>
      <div ref="body" class="tool-fullscreen-body" :aria-busy="file.loading" tabindex="0" aria-label="File contents">
        <div v-if="file.loading" class="file-preview-message" role="status">Opening file…</div>
        <div v-else-if="file.error" class="file-preview-message" role="alert">
          <strong>Cannot open file</strong>
          <p>{{ file.error }}</p>
        </div>
        <div v-else-if="file.needsApproval" class="file-preview-message">
          <strong>This file is outside the project</strong>
          <p>Allow Leyline to {{ file.action === 'preview' ? 'preview' : 'open' }} this file on the session’s backend?</p>
          <code>{{ file.path }}</code>
          <button type="button" @click="emit('approve')">{{ file.action === 'preview' ? 'Preview file' : 'Open file' }}</button>
        </div>
        <template v-else>
          <p v-if="positionWarning" class="file-preview-meta" role="status">{{ positionWarning }}</p>
          <div v-if="file.kind === 'image'" class="tool-fullscreen-image">
            <img :src="imageSrc(file)" :alt="file.path" />
          </div>
          <div
            v-else-if="markdown && view === 'rendered'"
            class="tool-fullscreen-markdown markdown-body"
            :data-file-base="file.path"
            v-html="html"
          ></div>
          <PierrePreview v-else-if="file.kind === 'file'" :key="file.path" :preview="file" :clipped="false" />
        </template>
      </div>
    </section>
  </div>
</template>
