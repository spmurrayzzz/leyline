import { computed, nextTick, ref, toValue, watch } from 'vue'
import { backendWebSocketUrl } from '../lib/backend'

export function useTerminal({ maxHeight } = {}) {
  const terminalOpen = ref(false)
  const terminalEl = ref(null)
  const terminalStatus = ref('closed')
  const terminalCwd = ref('')
  const terminalShell = ref('')
  const preferredHeight = ref(310)
  const terminalResizing = ref(false)
  const terminalDrawerHeight = computed(() => Math.min(
    preferredHeight.value,
    Math.max(0, Math.floor(toValue(maxHeight) ?? Infinity)),
  ))
  let terminalLayoutReleaseTimer = 0
  let terminalPointerResizing = false
  let terminalInstance
  let terminalFitAddon
  let terminalSocket
  let terminalInputDisposable
  let terminalRunId = 0
  let terminalResizeStartY = 0
  let terminalResizeStartHeight = 0
  let terminalResizeFrame = 0

  watch(terminalDrawerHeight, () => {
    if (terminalOpen.value && !terminalPointerResizing) {
      terminalResizing.value = true
      scheduleTerminalLayoutRelease()
    }
    scheduleTerminalResize()
  }, { flush: 'post' })

  async function toggleTerminal(sessionId = '') {
    if (terminalOpen.value) {
      closeTerminalPanel()
      return
    }

    terminalOpen.value = true
    await connectTerminal(sessionId)
  }

  async function openEditorTerminal(sessionId, file, allowOutsideProject = false) {
    if (terminalOpen.value && ['connected', 'connecting'].includes(terminalStatus.value)
      && !window.confirm('Opening this editor will replace the current terminal and stop its process. Continue?')) return false
    terminalOpen.value = true
    await connectTerminal(sessionId, { ...file, allowOutsideProject })
    return true
  }

  function scheduleTerminalLayoutRelease() {
    clearTimeout(terminalLayoutReleaseTimer)
    terminalLayoutReleaseTimer = setTimeout(() => { terminalResizing.value = false }, 120)
  }

  function disposeTerminalConnection() {
    terminalInputDisposable?.dispose()
    terminalInputDisposable = undefined
    terminalSocket?.close()
    terminalSocket = undefined
    terminalInstance?.dispose()
    terminalInstance = undefined
    terminalFitAddon = undefined
    window.removeEventListener('resize', resizeTerminal)
  }

  function closeTerminalPanel() {
    terminalRunId += 1
    terminalOpen.value = false
    clearTimeout(terminalLayoutReleaseTimer)
    terminalResizing.value = false
    terminalStatus.value = 'closed'
    terminalCwd.value = ''
    terminalShell.value = ''
    disposeTerminalResize()
    disposeTerminalConnection()
  }

  async function connectTerminal(sessionId = '', editor = null) {
    const runId = terminalRunId + 1
    terminalRunId = runId
    terminalStatus.value = 'connecting'
    terminalCwd.value = ''
    terminalShell.value = ''
    disposeTerminalConnection()

    await nextTick()
    if (!terminalOpen.value || runId !== terminalRunId || !terminalEl.value) return

    const { FitAddon } = await import('@xterm/addon-fit')
    const { Terminal } = await import('@xterm/xterm')
    await import('@xterm/xterm/css/xterm.css')

    if (!terminalOpen.value || runId !== terminalRunId || !terminalEl.value) return

    terminalInstance = new Terminal({
      cursorBlink: true,
      fontFamily: 'Cascadia Code, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 10000,
      theme: {
        background: '#0b0c0f',
        foreground: '#d8dbe3',
        cursor: '#cfc5ff',
        selectionBackground: '#3d3650',
      },
    })
    const term = terminalInstance
    terminalFitAddon = new FitAddon()
    term.loadAddon(terminalFitAddon)
    term.open(terminalEl.value)
    resizeTerminal()
    focusTerminal()

    const params = new URLSearchParams()
    if (sessionId) params.set('sessionId', sessionId)
    if (editor) {
      params.set('editorPath', editor.path)
      if (editor.line) params.set('editorLine', editor.line)
      if (editor.allowOutsideProject) params.set('allowOutsideProject', 'true')
    }
    const terminalPath = `/api/pi/terminal${params.size ? `?${params}` : ''}`
    const socket = new WebSocket(backendWebSocketUrl(terminalPath))
    const pendingInput = []
    let terminalReady = false
    terminalSocket = socket

    terminalInputDisposable = term.onData((data) => {
      if (runId !== terminalRunId) return
      if (!terminalReady) {
        if ([WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) {
          pendingInput.push(data)
        }
        return
      }
      if (socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify({ type: 'input', data }))
    })

    socket.addEventListener('open', () => {
      if (runId !== terminalRunId) return
      focusTerminal()
    })

    socket.addEventListener('message', (event) => {
      if (runId !== terminalRunId) return
      const payload = parseTerminalMessage(event.data)
      if (!payload) return

      if (payload.type === 'ready') {
        terminalReady = true
        terminalCwd.value = payload.cwd
        terminalShell.value = payload.shell
        terminalStatus.value = 'connected'
        resizeTerminal()
        for (const data of pendingInput.splice(0)) {
          socket.send(JSON.stringify({ type: 'input', data }))
        }
      }
      if (payload.type === 'data') {
        term.write(payload.data)
      }
      if (payload.type === 'error') {
        terminalStatus.value = 'error'
        term.write(`\r\n${payload.message}\r\n`)
      }
      if (payload.type === 'exit') {
        terminalStatus.value = 'exited'
        term.write(`\r\n[process exited with code ${payload.exitCode}]\r\n`)
      }
    })

    socket.addEventListener('close', () => {
      pendingInput.length = 0
      if (runId !== terminalRunId) return
      if (!['error', 'exited'].includes(terminalStatus.value)) {
        terminalStatus.value = 'closed'
      }
    })

    window.addEventListener('resize', resizeTerminal)
  }

  function focusTerminal() {
    requestAnimationFrame(() => terminalInstance?.focus())
  }

  function sendKey(name) {
    if (!terminalOpen.value || !terminalInstance
      || !['connecting', 'connected'].includes(terminalStatus.value)
      || ![WebSocket.CONNECTING, WebSocket.OPEN].includes(terminalSocket?.readyState)) return false
    const cursorPrefix = terminalInstance.modes.applicationCursorKeysMode ? '\x1bO' : '\x1b['
    const data = {
      interrupt: '\x03',
      escape: '\x1b',
      tab: '\t',
      up: `${cursorPrefix}A`,
      down: `${cursorPrefix}B`,
      right: `${cursorPrefix}C`,
      left: `${cursorPrefix}D`,
    }[name]
    if (typeof data !== 'string') return false
    terminalInstance.input(data)
    return true
  }

  function resizeTerminal() {
    if (!terminalInstance || !terminalEl.value || !terminalFitAddon
      || !terminalEl.value.clientWidth || !terminalEl.value.clientHeight
      || !terminalInstance.element?.clientHeight) return
    terminalFitAddon.fit()
    if (terminalSocket?.readyState === WebSocket.OPEN
      && terminalStatus.value === 'connected') {
      terminalSocket.send(JSON.stringify({
        type: 'resize',
        cols: terminalInstance.cols,
        rows: terminalInstance.rows,
      }))
    }
  }

  function scheduleTerminalResize() {
    cancelAnimationFrame(terminalResizeFrame)
    terminalResizeFrame = requestAnimationFrame(resizeTerminal)
  }

  function setTerminalDrawerHeight(height) {
    if (!Number.isFinite(height)) return
    preferredHeight.value = Math.max(36, Math.round(height))
  }

  function resizeTerminalDrawer(event) {
    const nextHeight = terminalResizeStartHeight + terminalResizeStartY
      - event.clientY
    setTerminalDrawerHeight(nextHeight)
  }

  function stopTerminalResize() {
    window.removeEventListener('pointermove', resizeTerminalDrawer)
    window.removeEventListener('pointerup', stopTerminalResize)
    window.removeEventListener('pointercancel', stopTerminalResize)
    terminalPointerResizing = false
    document.body.style.userSelect = ''
    scheduleTerminalLayoutRelease()
  }

  function startTerminalResize(event) {
    terminalResizeStartY = event.clientY
    terminalResizeStartHeight = terminalDrawerHeight.value
    clearTimeout(terminalLayoutReleaseTimer)
    terminalPointerResizing = true
    terminalResizing.value = true
    window.addEventListener('pointermove', resizeTerminalDrawer)
    window.addEventListener('pointerup', stopTerminalResize)
    window.addEventListener('pointercancel', stopTerminalResize)
    document.body.style.userSelect = 'none'
  }

  function nudgeTerminalHeight(amount) {
    setTerminalDrawerHeight(terminalDrawerHeight.value + amount)
  }

  function disposeTerminalResize() {
    stopTerminalResize()
    cancelAnimationFrame(terminalResizeFrame)
  }

  return {
    closeTerminalPanel,
    connectTerminal,
    openEditorTerminal,
    terminalCwd,
    terminalShell,
    terminalEl,
    terminalOpen,
    terminalStatus,
    terminalResizing,
    terminalDrawerHeight,
    resizeTerminal,
    sendKey,
    toggleTerminal,
    startTerminalResize,
    stopTerminalResize,
    nudgeTerminalHeight,
    setTerminalDrawerHeight,
    disposeTerminalResize,
  }
}

function parseTerminalMessage(data) {
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}
