import { ref } from 'vue'
import { getLeylineSetting, setLeylineSetting } from '../lib/leyline-api'
import { THINKING_DEFAULT_SETTING_KEY } from '../../lib/leyline-settings'

export function useTranscriptPreferences() {
  const thinkingDefault = ref('collapsed')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const data = await getLeylineSetting(THINKING_DEFAULT_SETTING_KEY)
      thinkingDefault.value = data.value === 'expanded' ? 'expanded' : 'collapsed'
    } catch (loadError) {
      error.value = loadError.message
    } finally {
      loading.value = false
    }
  }

  async function setThinkingDefault(value) {
    if (value === thinkingDefault.value) return
    const previous = thinkingDefault.value
    thinkingDefault.value = value
    saving.value = true
    error.value = ''
    try {
      await setLeylineSetting(THINKING_DEFAULT_SETTING_KEY, value)
    } catch (saveError) {
      thinkingDefault.value = previous
      error.value = saveError.message
    } finally {
      saving.value = false
    }
  }

  return {
    error,
    load,
    loading,
    saving,
    setThinkingDefault,
    thinkingDefault,
  }
}