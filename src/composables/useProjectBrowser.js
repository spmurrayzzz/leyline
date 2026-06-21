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
  const expandedProjects = ref(new Set())

  const startProjectOptions = computed(() => {
    const query = startProjectQuery.value.trim().toLowerCase()
    return visibleProjects.value.filter((project) => {
      return !query || fuzzyScore(project.name, query) > 0
    })
  })

  const startProjectLabel = computed(() => {
    return newSessionCwd.value ? projectName(newSessionCwd.value) : 'Choose project'
  })

  function isProjectExpanded(project) {
    return expandedProjects.value.has(project.cwd)
  }

  function expandProject(cwd) {
    if (!cwd) return
    expandedProjects.value = new Set([...expandedProjects.value, cwd])
  }

  function toggleProject(project) {
    const next = new Set(expandedProjects.value)
    if (next.has(project.cwd)) next.delete(project.cwd)
    else next.add(project.cwd)
    expandedProjects.value = next
  }

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
    expandedProjects,
    startProjectOptions,
    startProjectLabel,
    isProjectExpanded,
    expandProject,
    toggleProject,
    selectStartProject,
    openProjectBrowser,
    closeProjectBrowser,
  }
}
