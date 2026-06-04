<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { fuzzyScore } from '../lib/fuzzy'
import { modelChip } from '../lib/format'

const props = defineProps({
  availableModels: {
    type: Array,
    default: () => [],
  },
  currentMobileModelLabel: {
    type: String,
    default: '',
  },
  currentModelLabel: {
    type: String,
    default: '',
  },
  disabled: Boolean,
  modelKey: {
    type: Function,
    required: true,
  },
  open: Boolean,
  selectedModelKey: {
    type: String,
    default: '',
  },
  start: Boolean,
})

const emit = defineEmits(['select', 'toggle'])
const query = ref('')
const input = ref(null)

const filteredModels = computed(() => {
  const rawQuery = query.value.trim().toLowerCase()
  const terms = tokenize(rawQuery)
  if (!terms.length) return props.availableModels

  return props.availableModels
    .map((model) => ({ model, score: modelScore(model, terms, rawQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      return b.score - a.score || modelChip(a.model).localeCompare(
        modelChip(b.model),
      )
    })
    .map((item) => item.model)
})

watch(() => props.open, async (open) => {
  if (!open) {
    query.value = ''
    return
  }
  await nextTick()
  input.value?.focus()
})

function modelScore(model, terms, rawQuery) {
  const fields = [
    modelChip(model),
    model.name || '',
    model.provider || '',
    model.id || '',
  ]
  const tokens = [...new Set(fields.flatMap(tokenize))]
  let total = Math.max(
    ...fields.map((field) => exactScore(field, rawQuery, 200)),
  )

  for (const term of terms) {
    const score = Math.max(
      ...tokens.map((token) => fuzzyScore(token, term)),
      ...fields.map((field) => exactScore(field, term)),
    )
    if (score === 0) return 0
    total += score
  }

  return total
}

function tokenize(value) {
  return String(value || '').toLowerCase().match(/[a-z0-9]+/g) || []
}

function exactScore(value, term, bonus = 0) {
  const text = String(value || '').toLowerCase()
  if (!text.includes(term)) return 0
  return text.startsWith(term)
    ? term.length + 30 + bonus
    : term.length + 20 + bonus
}

function selectModel(model) {
  query.value = ''
  emit('select', model)
}
</script>

<template>
  <div class="model-picker" :class="{ 'start-picker': start }">
    <button
      class="composer-chip model-picker-button"
      :class="{ 'start-composer-chip': start }"
      type="button"
      :disabled="disabled"
      @click="emit('toggle')"
    >
      <span
        class="model-label"
        :class="{ 'desktop-label': currentMobileModelLabel }"
      >
        {{ currentModelLabel }}
      </span>
      <span v-if="currentMobileModelLabel" class="model-label mobile-label">
        {{ currentMobileModelLabel }}
      </span>
      <span class="model-caret">▾</span>
    </button>
    <Transition name="composer-popover">
      <div v-if="open" class="model-menu model-search-menu">
        <label class="model-search-field">
          <span>⌕</span>
          <input
            ref="input"
            v-model="query"
            placeholder="Filter models"
            @keydown.enter.prevent
            @keydown.escape.prevent.stop="emit('toggle')"
          />
        </label>
        <button
          v-for="model in filteredModels"
          :key="modelKey(model)"
          type="button"
          :class="{ active: modelKey(model) === selectedModelKey }"
          @click="selectModel(model)"
        >
          <span>{{ modelChip(model) }}</span>
          <span v-if="modelKey(model) === selectedModelKey">✓</span>
        </button>
        <div v-if="!filteredModels.length" class="model-menu-empty">
          No models match “{{ query }}”.
        </div>
      </div>
    </Transition>
  </div>
</template>
