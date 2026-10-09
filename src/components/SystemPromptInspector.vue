<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { systemPromptInfo, systemSectionTitle } from '../../lib/system-prompt.js'
import { renderedText } from '../lib/transcript'

const props = defineProps({
  entry: { type: Object, required: true },
  copiedEntryId: { type: String, default: '' },
  branchBusy: Boolean,
  running: Boolean,
})
const emit = defineEmits(['close', 'copy', 'fork', 'reset'])
const pane = ref(null)
const body = ref(null)
const actions = ref(null)
const tab = ref(props.entry.sections?.length || !props.entry.toolsAdded?.length && !props.entry.toolsRemoved?.length ? 'prompt' : 'tools')
const raw = ref(false)
const info = computed(() => systemPromptInfo(props.entry))
const sections = computed(() => (props.entry.sections || []).map((section) => ({
  ...section,
  title: systemSectionTitle(section.name),
  html: section.removed ? '' : renderedText(section.text),
})))
const tools = computed(() => [
  ...(props.entry.toolsAdded || []).map((tool) => ({ ...tool, html: renderedText(tool.description) })),
  ...(props.entry.toolsRemoved || []).map((name) => ({ name, removed: true })),
])
const persisted = computed(() => props.entry.persisted !== false && !String(props.entry.id || '').startsWith('local-'))
const copied = computed(() => props.copiedEntryId === props.entry.id)

onMounted(() => pane.value?.focus({ preventScroll: true }))

function dismissMenu() {
  if (!actions.value?.open) return false
  actions.value.open = false
  actions.value.querySelector('summary')?.focus({ preventScroll: true })
  return true
}

function branch(action) {
  dismissMenu()
  emit(action, props.entry)
}

function selectTab(value) {
  tab.value = value
  body.value?.scrollTo({ top: 0 })
}

async function tabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  selectTab(event.key === 'Home' ? 'prompt' : event.key === 'End' ? 'tools' : tab.value === 'prompt' ? 'tools' : 'prompt')
  await nextTick()
  pane.value?.querySelector('[role="tab"][aria-selected="true"]')?.focus()
}

defineExpose({ dismissMenu })
</script>

<template>
  <aside
    id="system-prompt-inspector"
    ref="pane"
    class="system-prompt-inspector"
    tabindex="-1"
    aria-labelledby="system-prompt-title"
    @click="actions && !actions.contains($event.target) && (actions.open = false)"
  >
    <header class="system-prompt-header">
      <div>
        <h2 id="system-prompt-title">{{ info.title }}</h2>
        <p>{{ info.initial ? 'Initial prompt · ' : '' }}{{ info.summary }}</p>
      </div>
      <button class="system-prompt-icon-button" type="button" aria-label="Close prompt inspector" @click="emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
      </button>
    </header>

    <div v-show="!raw" class="system-prompt-tabs" role="tablist" aria-label="System content" @keydown="tabKeydown">
      <button
        id="system-prompt-tab"
        type="button"
        role="tab"
        :aria-selected="tab === 'prompt'"
        :tabindex="tab === 'prompt' ? 0 : -1"
        aria-controls="system-prompt-panel"
        @click="selectTab('prompt')"
      >{{ info.initial ? 'Prompt' : 'Changes' }} <span>{{ sections.length }}</span></button>
      <button
        id="system-tools-tab"
        type="button"
        role="tab"
        :aria-selected="tab === 'tools'"
        :tabindex="tab === 'tools' ? 0 : -1"
        aria-controls="system-tools-panel"
        @click="selectTab('tools')"
      >Tools <span>{{ tools.length }}</span></button>
    </div>

    <div ref="body" class="system-prompt-body" tabindex="0" aria-label="System prompt contents">
      <pre v-if="raw" class="system-prompt-raw">{{ entry.text }}</pre>
      <template v-else>
        <div v-if="tab === 'prompt'" id="system-prompt-panel" role="tabpanel" aria-labelledby="system-prompt-tab">
          <section v-for="section in sections" :key="section.name" class="system-prompt-section">
            <h3>{{ section.title }}<span v-if="section.removed"> · removed</span><span v-else-if="!info.initial"> · updated</span></h3>
            <div v-if="!section.removed" class="system-prompt-prose markdown-body" v-html="section.html"></div>
          </section>
          <div v-if="!sections.length && !tools.length" class="system-prompt-prose markdown-body" v-html="renderedText(entry.text)"></div>
          <p v-else-if="!sections.length" class="system-prompt-empty">No prompt sections changed in this event.</p>
        </div>
        <div v-else id="system-tools-panel" role="tabpanel" aria-labelledby="system-tools-tab">
          <section v-for="tool in tools" :key="`${tool.removed ? 'removed' : 'added'}-${tool.name}`" class="system-prompt-section">
            <h3><code>{{ tool.name }}</code><span v-if="tool.removed"> · removed</span><span v-else-if="!info.initial"> · added</span></h3>
            <div v-if="!tool.removed" class="system-prompt-prose markdown-body" v-html="tool.html"></div>
          </section>
          <p v-if="!tools.length" class="system-prompt-empty">{{ info.initial ? 'No tools declared in this event.' : 'No tools changed in this event.' }}</p>
        </div>
      </template>
    </div>

    <footer class="system-prompt-footer">
      <span>{{ info.caption }}</span>
      <div>
        <button type="button" :aria-pressed="raw" @click="raw = !raw">{{ raw ? 'Reading view' : 'Raw text' }}</button>
        <button type="button" :title="copied ? 'Copied' : 'Copy system event'" @click="emit('copy', entry)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg>{{ copied ? 'Copied' : 'Copy' }}
        </button>
        <details v-if="persisted" ref="actions" class="system-prompt-actions" @focusout="!$event.currentTarget.contains($event.relatedTarget) && ($event.currentTarget.open = false)">
          <summary class="system-prompt-icon-button" aria-label="System event actions" title="System event actions">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
          </summary>
          <div class="system-prompt-menu">
            <button type="button" :disabled="branchBusy" @click="branch('fork')">Fork from here</button>
            <button type="button" :disabled="branchBusy || running" @click="branch('reset')">Reset to here</button>
          </div>
        </details>
      </div>
    </footer>
  </aside>
</template>
