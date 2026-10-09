<script setup>
defineProps({
  enabled: Boolean,
  disabled: Boolean,
  start: Boolean,
})

const emit = defineEmits(['toggle'])
</script>

<template>
  <button
    class="composer-chip model-picker-button ultrafast-toggle"
    :class="{ active: enabled, 'start-composer-chip': start }"
    type="button"
    :disabled="disabled"
    :aria-pressed="enabled"
    title="Ultrafast uses premium pricing. Applies to this session only."
    @click="emit('toggle')"
  >
    <svg viewBox="0 0 8 8" aria-hidden="true">
      <circle cx="4" cy="4" r="2.5"></circle>
    </svg>
    <span>ultrafast</span>
  </button>
</template>

<style scoped>
.ultrafast-toggle.composer-chip.model-picker-button {
  flex: none;
  width: auto;
  gap: 6px;
}

.ultrafast-toggle svg {
  flex: none;
  width: 8px;
  height: 8px;
  fill: none;
  stroke: currentColor;
}

.ultrafast-toggle.composer-chip.active {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: #d8d0ff;
}

.ultrafast-toggle.active svg {
  fill: var(--accent);
  stroke: var(--accent);
}

.ultrafast-toggle.composer-chip:hover:not(:disabled) {
  color: var(--text);
}

.ultrafast-toggle.composer-chip:disabled {
  opacity: 0.45;
  transform: none;
}

.ultrafast-toggle:focus-visible {
  outline: 2px solid var(--accent-border);
  outline-offset: 2px;
}
</style>
