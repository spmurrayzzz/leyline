import { computed, ref } from 'vue'
import { fuzzyScore } from '../lib/fuzzy'
import { projectName } from '../lib/format'

export function useProjectBrowser({
  visibleProjects,
  newSessionCwd,
  selectedSession,
}) {
  const projectBrowserOpen = ref(false)
  const projectBrowserInitialPath = ref('')
  const startProjectPickerOpen = ref(false)
  const startProjectQuery = ref('')

  const startProjectOptions = computed(() => {
    const query = startProjectQuery.value.trim().toLowerCase()
    return visibleProjects.value.filter((project) => {
      return !query || fuzzyScore(project.name, query) > 0
    })
  })

  const startProjectLabel = computed(() => {
    return newSessionCwd.value ? projectName(newSessionCwd.value) : 'Choose project'
  })

  function selectStartProject(cwd) {
    newSessionCwd.value = cwd
    startProjectPickerOpen.value = false
    startProjectQuery.value = ''
  }

  function openProjectBrowser(path = '') {
    startProjectPickerOpen.value = false
    projectBrowserInitialPath.value =
      path || newSessionCwd.value || selectedSession.value?.cwd || ''
    projectBrowserOpen.value = true
  }

  function closeProjectBrowser() {
    projectBrowserOpen.value = false
  }

  return {
    projectBrowserOpen,
    projectBrowserInitialPath,
    startProjectPickerOpen,
    startProjectQuery,
    startProjectOptions,
    startProjectLabel,
    selectStartProject,
    openProjectBrowser,
    closeProjectBrowser,
  }
}
