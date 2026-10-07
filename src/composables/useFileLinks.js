import { nextTick, onBeforeUnmount, shallowRef, watch } from 'vue'
import { performFileAction } from '../lib/pi-api'

export function useFileLinks({ sessionId, available, copyText, openEditorTerminal, openSettings }) {
  const filePreview = shallowRef(null)
  const fileMenu = shallowRef(null)
  const history = []
  let previewRequest = 0
  let menuRequest = 0
  let previewAnchor
  let menuAnchor

  watch(sessionId, () => {
    closeFileMenu(false)
    closeFilePreview(false)
  })
  onBeforeUnmount(() => {
    previewRequest++
    menuRequest++
  })

  function linkTarget(event) {
    const anchor = event.target?.closest?.('a[data-local-file]')
    if (!anchor) return null
    event.preventDefault()
    event.stopPropagation()
    return {
      anchor,
      href: anchor.getAttribute('data-local-file'),
      basePath: anchor.closest('[data-file-base]')?.getAttribute('data-file-base') || '',
      sessionId: sessionId.value,
    }
  }

  function handleFileClick(event) {
    if (event.defaultPrevented || (event.type === 'auxclick' && event.button !== 1)) return
    const citation = event.target?.closest?.('.research-report-message a[data-local-file]')
    if (event.eventPhase === Event.CAPTURING_PHASE && citation
      && /^\[?\d+\]?$/.test(citation.textContent.trim())) return
    const anchor = event.target?.closest?.('a[href^="#"]:not([data-local-file])')
    const scope = anchor?.closest('[data-file-base]')
    if (scope) {
      event.preventDefault()
      event.stopPropagation()
      try {
        const id = decodeURIComponent(anchor.getAttribute('href').slice(1))
        const heading = [...scope.querySelectorAll('[id]')].find((item) => item.id === id)
        const scroller = scope.closest('.tool-fullscreen-body')
        if (heading && scroller) scroller.scrollTop += heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 20
      } catch {}
      return
    }
    const target = linkTarget(event)
    if (target) void openFilePreview(target)
  }

  function handleFileContextMenu(event) {
    const target = linkTarget(event)
    if (target) void openFileMenu(target, event)
  }

  async function openFileMenu(target, event) {
    closeFileMenu(false)
    const request = menuRequest
    menuAnchor = target.anchor || event.currentTarget
    const rect = menuAnchor?.getBoundingClientRect()
    const x = event.clientX || rect?.left || 8
    const y = event.clientY || rect?.bottom || 8
    fileMenu.value = { target, path: target.href, x, y, loading: true }
    try {
      requireAvailable(target)
      const data = await requestFile(target, 'resolve')
      if (request !== menuRequest) return
      fileMenu.value = { ...fileMenu.value, ...data, loading: false }
    } catch (error) {
      if (request === menuRequest) fileMenu.value = { ...fileMenu.value, loading: false, error: error.message }
    }
  }

  function closeFileMenu(restoreFocus = true) {
    menuRequest++
    fileMenu.value = null
    if (restoreFocus) menuAnchor?.focus({ preventScroll: true })
    menuAnchor = null
  }

  async function openFilePreview(target, action = 'preview', remember = true, allowOutsideProject = false, approvedPath = '') {
    const previous = filePreview.value
    if (!previous) previewAnchor = target.anchor || menuAnchor || document.activeElement
    if (remember && previous && action === 'preview') history.push(previous.target)
    closeFileMenu(false)
    const request = ++previewRequest
    filePreview.value = { target, action, path: target.href, loading: true, canGoBack: history.length > 0 }
    try {
      requireAvailable(target)
      const data = await requestFile(target, action, allowOutsideProject, approvedPath)
      if (request !== previewRequest) return
      filePreview.value = { ...filePreview.value, ...data, loading: false, allowOutsideProject }
      if (data.terminal) {
        const opened = await openEditorTerminal(target.sessionId, data, allowOutsideProject)
        if (request !== previewRequest) return
        if (opened) closeFilePreview(false)
        else filePreview.value = { ...filePreview.value, error: 'Editor launch cancelled. The existing terminal is unchanged.' }
      } else if (data.ok) {
        closeFilePreview()
      }
    } catch (error) {
      if (request === previewRequest) filePreview.value = { ...filePreview.value, loading: false, error: error.message }
    }
  }

  function requireAvailable(target) {
    if (!target.sessionId) throw new Error('Select a session to preview its files.')
    if (!available.value) throw new Error('This backend does not support file previews. Update or restart the backend.')
  }

  function requestFile(target, action, allowOutsideProject = false, approvedPath = '') {
    return performFileAction(target.sessionId, {
      href: target.href,
      basePath: target.basePath,
      allowOutsideProject,
      ...(allowOutsideProject ? { approvedPath } : {}),
    }, action)
  }

  function closeFilePreview(restoreFocus = true) {
    previewRequest++
    filePreview.value = null
    history.length = 0
    const anchor = previewAnchor
    previewAnchor = null
    if (restoreFocus) nextTick(() => anchor?.focus({ preventScroll: true }))
  }

  function approveFile() {
    const preview = filePreview.value
    if (preview) void openFilePreview(preview.target, preview.action, false, true, preview.path)
  }

  function goBackFile() {
    const target = history.pop()
    if (target) void openFilePreview(target, 'preview', false)
  }

  function previewFileMenu(event) {
    if (filePreview.value) void openFileMenu({ ...filePreview.value.target, anchor: event.currentTarget }, event)
  }

  async function fileMenuAction(action) {
    const menu = fileMenu.value
    if (!menu) return
    if (action === 'copy') {
      await copyText('file-path', menu.path)
      closeFileMenu()
    } else if (action === 'settings') {
      closeFileMenu(false)
      closeFilePreview(false)
      openSettings()
    } else {
      const current = filePreview.value
      const remember = action === 'preview' && current?.path !== menu.path
      const approved = current?.allowOutsideProject === true && current?.path === menu.path
      await openFilePreview(menu.target, action, remember, approved, current?.path)
    }
  }

  return {
    filePreview,
    fileMenu,
    handleFileClick,
    handleFileContextMenu,
    closeFileMenu,
    closeFilePreview,
    approveFile,
    goBackFile,
    previewFileMenu,
    fileMenuAction,
  }
}
