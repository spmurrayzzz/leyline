<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  category: { type: String, default: 'display' },
  backendName: { type: String, default: '' },
  fileLinksAvailable: Boolean,
  opener: { type: Object, default: null },
  fallbackSelector: { type: String, default: '' },
})
const emit = defineEmits(['update:category', 'close'])
const modalEl = ref(null)
const categories = [
  { id: 'display', label: 'Display', description: 'Choose how transcripts first appear.' },
  { id: 'connections', label: 'Connections', description: 'Save connections here. Each window keeps its own active backend.' },
  { id: 'files', label: 'Files', description: 'Set the editor for files opened on this backend.' },
  { id: 'agents', label: 'Agent defaults', description: 'Used when a project or session has no override.' },
]
const availableCategories = computed(() => categories.filter((item) => item.id !== 'files' || props.fileLinksAvailable))
const selected = computed(() => availableCategories.value.find((item) => item.id === props.category) || categories[0])
const groups = computed(() => [
  { label: 'Leyline', items: availableCategories.value.filter((item) => ['display', 'connections'].includes(item.id)) },
  { label: props.backendName, items: availableCategories.value.filter((item) => ['files', 'agents'].includes(item.id)) },
])
const backendScope = computed(() => ['files', 'agents'].includes(selected.value.id))
const scopeLabel = computed(() => backendScope.value
  ? `${props.backendName} · All projects`
  : selected.value.id === 'connections' ? 'Leyline · Saved connections' : 'Leyline · All windows')
const footerLabel = computed(() => backendScope.value
  ? `All projects on ${props.backendName}`
  : selected.value.id === 'connections' ? 'Saved in Leyline · Active backend is per window' : 'Leyline display preference')
let appRoot = null
let appRootWasInert = false
let opener = null
let restoreFocus = false

function canFocus(element) {
  return element?.isConnected && typeof element.focus === 'function'
    && !element.closest('[inert], [hidden], .event-drawer-leave-active') && !element.matches(':disabled')
    && element.getClientRects().length && !['hidden', 'collapse'].includes(getComputedStyle(element).visibility)
}

function focusCategory() {
  const controls = modalEl.value?.querySelectorAll('.global-settings-nav-item.active, .global-settings-mobile-nav select') || []
  const target = [...controls].find(canFocus) || modalEl.value?.querySelector('.settings-close')
  target?.focus({ preventScroll: true })
}

onMounted(() => {
  opener = props.opener || document.activeElement
  appRoot = document.getElementById('app')
  if (appRoot) {
    appRootWasInert = appRoot.inert
    appRoot.inert = true
  }
  modalEl.value?.focus({ preventScroll: true })
})

onBeforeUnmount(() => {
  restoreFocus = document.activeElement === document.body || modalEl.value?.contains(document.activeElement)
  if (appRoot) appRoot.inert = appRootWasInert
})

onUnmounted(() => {
  if (!restoreFocus || document.activeElement !== document.body) return
  const target = canFocus(opener) ? opener : props.fallbackSelector
    ? [...document.querySelectorAll(props.fallbackSelector)].find(canFocus)
    : null
  target?.focus({ preventScroll: true })
})

watch(() => [props.category, props.fileLinksAvailable], async () => {
  if (selected.value.id !== props.category) emit('update:category', 'display')
  const focused = modalEl.value?.contains(document.activeElement) ? document.activeElement : null
  await nextTick()
  if (modalEl.value && focused && !canFocus(focused)
    && (document.activeElement === document.body || document.activeElement === focused)) {
    focusCategory()
  }
}, { immediate: true })

function handleKeydown(event) {
  if (event.key === 'Escape') {
    const handled = event.defaultPrevented
    event.preventDefault()
    event.stopPropagation()
    if (!handled) emit('close')
    return
  }
  if (event.key !== 'Tab' || event.defaultPrevented) return
  const controls = [...modalEl.value.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]')]
    .filter((element) => element.tabIndex >= 0 && canFocus(element))
  const first = controls[0]
  const last = controls.at(-1)
  if (!controls.includes(document.activeElement)
    || (event.shiftKey && document.activeElement === first)
    || (!event.shiftKey && document.activeElement === last)) {
    event.preventDefault()
    const target = event.shiftKey ? last : first
    target?.focus({ preventScroll: true })
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="global-settings-backdrop" @click.self="emit('close')">
      <section
        ref="modalEl"
        class="global-settings-modal"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby="global-settings-title"
        @keydown="handleKeydown"
      >
        <header class="global-settings-header">
          <div>
            <strong id="global-settings-title">Leyline settings</strong>
            <small>App preferences and backend defaults</small>
          </div>
          <button class="settings-close" type="button" aria-label="Close Leyline settings" @click="emit('close')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </header>

        <label class="global-settings-mobile-nav">
          <span>Category</span>
          <select :value="selected.id" aria-label="Settings category" @change="emit('update:category', $event.target.value)">
            <optgroup v-for="(group, index) in groups" :key="index" :label="group.label">
              <option v-for="item in group.items" :key="item.id" :value="item.id">{{ item.label }}</option>
            </optgroup>
          </select>
        </label>

        <div class="global-settings-body">
          <nav class="global-settings-nav" aria-label="Settings categories">
            <template v-for="(group, index) in groups" :key="index">
              <div class="global-settings-nav-heading" :class="{ backend: index === 1 }">{{ group.label }}</div>
              <button
                v-for="item in group.items"
                :key="item.id"
                type="button"
                class="global-settings-nav-item"
                :class="{ active: selected.id === item.id }"
                :aria-current="selected.id === item.id ? 'page' : undefined"
                @click="emit('update:category', item.id)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <template v-if="item.id === 'display'">
                    <rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" />
                  </template>
                  <template v-else-if="item.id === 'connections'">
                    <rect x="3" y="3" width="18" height="7" rx="1" /><rect x="3" y="14" width="18" height="7" rx="1" /><path d="M7 6.5h.1M7 17.5h.1" />
                  </template>
                  <path v-else-if="item.id === 'files'" d="M13 3H5v18h14V9zM13 3v6h6M8 14h8M8 17h5" />
                  <template v-else>
                    <rect x="4" y="7" width="16" height="13" rx="3" /><path d="M12 7V3M9 12h.1M15 12h.1M9 16h6M1 11v5M23 11v5" />
                  </template>
                </svg>
                {{ item.label }}
              </button>
            </template>
            <p class="global-settings-nav-note">Backend defaults apply<br />to all its projects.</p>
          </nav>

          <div class="global-settings-content">
            <div class="global-settings-scope">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <template v-if="backendScope">
                  <rect x="3" y="3" width="18" height="7" rx="1" /><rect x="3" y="14" width="18" height="7" rx="1" /><path d="M7 6.5h.1M7 17.5h.1" />
                </template>
                <template v-else>
                  <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18" />
                </template>
              </svg>
              {{ scopeLabel }}
            </div>
            <h2>{{ selected.label }}</h2>
            <p>{{ selected.description }}</p>
            <slot :name="selected.id" />
          </div>
        </div>

        <footer class="global-settings-footer">
          <span>{{ footerLabel }}</span>
          <span><kbd>esc</kbd> Close</span>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
