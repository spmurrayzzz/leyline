<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  operation: { type: Object, default: null },
  busy: Boolean,
  error: { type: String, default: '' },
})
const emit = defineEmits(['answer', 'cancel'])
const response = ref('')
const submitted = ref(false)
const prompt = computed(() => props.operation?.prompt)
const events = computed(() => props.operation?.events || [])
const state = computed(() => props.operation?.state)
watch(() => prompt.value?.id, () => {
  response.value = prompt.value?.type === 'select' ? prompt.value.options[0]?.id || '' : ''
  submitted.value = false
}, { immediate: true })
watch(() => props.error, (error) => { if (error) submitted.value = false })

function answer() {
  if (!prompt.value || submitted.value) return
  submitted.value = true
  emit('answer', { promptId: prompt.value.id, value: response.value })
  response.value = ''
}
</script>

<template>
  <section v-if="operation || busy || error" class="pi-settings-operation" aria-label="Settings operation" aria-live="polite">
    <div v-for="(event, index) in events" :key="index" class="pi-settings-operation-event">
      <template v-if="event.type === 'auth_url'">
        <a class="pi-settings-button" :href="event.url" target="_blank" rel="noopener noreferrer">Open sign-in page <span aria-hidden="true">↗</span></a>
        <p v-if="event.instructions" class="settings-note">{{ event.instructions }}</p>
      </template>
      <template v-else-if="event.type === 'device_code'">
        <p>Enter this code on the provider’s sign-in page:</p>
        <code class="pi-settings-device-code">{{ event.userCode }}</code>
        <a class="settings-text-link" :href="event.verificationUri" target="_blank" rel="noopener noreferrer">Open sign-in page</a>
      </template>
      <template v-else>
        <p :class="event.level === 'error' ? 'settings-error' : 'settings-note'">{{ event.message }}</p>
        <a v-for="link in event.links || []" :key="link.url" class="settings-text-link" :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.label || 'Open link' }}</a>
      </template>
    </div>
    <form v-if="prompt" class="pi-settings-form" autocomplete="off" @submit.prevent="answer">
      <label class="pi-settings-field">
        <span>{{ prompt.message }}</span>
        <select v-if="prompt.type === 'select'" v-model="response" :disabled="submitted">
          <option v-for="option in prompt.options" :key="option.id" :value="option.id">{{ option.label }}{{ option.description ? ` · ${option.description}` : '' }}</option>
        </select>
        <input v-else :key="prompt.id" v-model="response" :type="['secret', 'manual_code'].includes(prompt.type) ? 'password' : 'text'" :placeholder="prompt.placeholder" :disabled="submitted" autocomplete="off" spellcheck="false" />
      </label>
      <p v-if="prompt.type === 'manual_code'" class="settings-note">If the browser cannot reach the backend’s callback, paste the final redirect URL here.</p>
      <div class="pi-settings-actions"><button class="pi-settings-button primary" type="submit" :disabled="submitted">{{ submitted ? 'Waiting…' : 'Continue' }}</button></div>
    </form>
    <p v-if="error || operation?.error" class="settings-error" role="alert">{{ error || operation.error }}</p>
    <p v-if="state === 'completed'" class="settings-note">Operation finished.</p>
    <p v-if="operation?.result?.warning" class="settings-note">{{ operation.result.warning }}</p>
    <p v-if="state === 'cancelled'" class="settings-note">Operation stopped. Refresh to check whether any credential changes completed before cancellation.</p>
    <div v-if="busy" class="pi-settings-operation-footer">
      <small>{{ state === 'cancelling' ? 'Stopping. Waiting for pi to finish the current request…' : prompt ? 'Waiting for your response' : 'Working…' }}</small>
      <button class="pi-settings-button" type="button" :disabled="state === 'cancelling'" @click="emit('cancel')">Cancel</button>
    </div>
  </section>
</template>
