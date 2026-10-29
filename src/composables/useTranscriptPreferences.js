import { ref } from 'vue'
import { getLeylineSetting, setLeylineSetting } from '../lib/leyline-api'
import { AUTOLINK_BARE_FILENAMES_SETTING_KEY, THINKING_DEFAULT_SETTING_KEY } from '../../lib/leyline-settings'
import { autolinkBareFilenames } from '../lib/display-preferences'

export function useTranscriptPreferences() {
  const thinkingDefault = ref('collapsed')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const [thinking, autolink] = await Promise.all([
        getLeylineSetting(THINKING_DEFAULT_SETTING_KEY),
        getLeylineSetting(AUTOLINK_BARE_FILENAMES_SETTING_KEY),
      ])
      thinkingDefault.value = thinking.value === 'expanded' ? 'expanded' : 'collapsed'
      autolinkBareFilenames.value = autolink.value === 'on'
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

  async function setAutolinkBareFilenames(value) {
    if (value === autolinkBareFilenames.value) return
    const previous = autolinkBareFilenames.value
    autolinkBareFilenames.value = value
    saving.value = true
    error.value = ''
    try {
      await setLeylineSetting(AUTOLINK_BARE_FILENAMES_SETTING_KEY, value ? 'on' : 'off')
    } catch (saveError) {
      autolinkBareFilenames.value = previous
      error.value = saveError.message
    } finally {
      saving.value = false
    }
  }

  return {
    autolinkBareFilenames,
    error,
    load,
    loading,
    saving,
    setAutolinkBareFilenames,
    setThinkingDefault,
    thinkingDefault,
  }
}