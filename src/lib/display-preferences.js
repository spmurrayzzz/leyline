import { ref } from 'vue'

// Backend-local Display preference, loaded by useTranscriptPreferences.
// Renderers read it per render so toggling affects presentation only.
export const autolinkBareFilenames = ref(false)
