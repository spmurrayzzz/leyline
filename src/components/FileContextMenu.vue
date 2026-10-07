<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({ menu: { type: Object, required: true } })
const emit = defineEmits(['close', 'action'])
const element = ref(null)
const position = ref({ left: '8px', top: '8px' })

watch(() => props.menu, async () => {
  await nextTick()
  placeMenu()
  if (!element.value?.contains(document.activeElement) || document.activeElement === element.value) focusItem(0)
}, { flush: 'post' })

onMounted(() => {
  placeMenu()
  element.value?.focus({ preventScroll: true })
  window.addEventListener('pointerdown', outside, true)
  window.addEventListener('resize', close)
  window.addEventListener('scroll', outside, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outside, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('scroll', outside, true)
})

function close() {
  emit('close')
}

function outside(event) {
  if (!element.value?.contains(event.target)) close()
}

function placeMenu() {
  const rect = element.value?.getBoundingClientRect()
  if (!rect) return
  position.value = {
    left: `${Math.max(8, Math.min(props.menu.x, window.innerWidth - rect.width - 8))}px`,
    top: `${Math.max(8, Math.min(props.menu.y, window.innerHeight - rect.height - 8))}px`,
  }
}

function items() {
  return [...(element.value?.querySelectorAll('button:not(:disabled)') || [])]
}

function focusItem(index) {
  items()[index]?.focus({ preventScroll: true })
}

function handleKey(event) {
  const buttons = items()
  const index = buttons.indexOf(document.activeElement)
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) event.preventDefault()
  if (event.key === 'ArrowDown') focusItem((index + 1) % buttons.length)
  if (event.key === 'ArrowUp') focusItem((index - 1 + buttons.length) % buttons.length)
  if (event.key === 'Home') focusItem(0)
  if (event.key === 'End') focusItem(buttons.length - 1)
  if (event.key === 'Tab') close()
}
</script>

<template>
  <div ref="element" class="file-context-menu" :style="position" role="menu" aria-label="File actions" tabindex="-1" @keydown="handleKey" @contextmenu.prevent>
    <code :title="menu.path">{{ menu.path }}</code>
    <span v-if="menu.loading" class="file-menu-note" role="status">Reading file location…</span>
    <button type="button" role="menuitem" :disabled="menu.loading" @click="emit('action', 'preview')">Preview file</button>
    <template v-if="!menu.loading && !menu.error">
      <button v-if="menu.editorAvailable" type="button" role="menuitem" @click="emit('action', 'editor')">Open in editor</button>
      <button v-else type="button" role="menuitem" @click="emit('action', 'settings')">Configure editor…</button>
      <button v-if="menu.revealLabel" type="button" role="menuitem" @click="emit('action', 'reveal')">{{ menu.revealLabel }}</button>
    </template>
    <button type="button" role="menuitem" :disabled="menu.loading" @click="emit('action', 'copy')">Copy path</button>
    <span v-if="menu.error" class="file-menu-note" role="status">{{ menu.error }}</span>
  </div>
</template>
