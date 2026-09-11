import { nextTick, ref } from 'vue'
import { backendWebSocketUrl } from '../lib/backend'

export function useTerminal() {
  const terminalOpen = ref(false)
  const terminalEl = ref(null)
  const terminalStatus = ref('closed')
  const terminalCwd = ref('')
  const terminalDrawerHeight = ref(310)
  let terminalInstance
  let terminalFitAddon
  let terminalSocket
  let terminalInputDisposable
  let terminalRunId = 0
  let terminalResizeStartY = 0
  let terminalResizeStartHeight = 0
  let terminalResizeFrame = 0

  async function toggleTerminal(sessionId = '') {
    if (terminalOpen.value) {
      closeTerminalPanel()
      return
    }

    terminalOpen.value = true
    await connectTerminal(sessionId)
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
    terminalStatus.value = 'closed'
    terminalCwd.value = ''
    disposeTerminalConnection()
  }

  async function connectTerminal(sessionId = '') {
    const runId = terminalRunId + 1
    terminalRunId = runId
    terminalStatus.value = 'connecting'
    terminalCwd.value = ''
    disposeTerminalConnection()

    await nextTick()
    if (!terminalOpen.value || runId !== terminalRunId || !terminalEl.value) return

    const { FitAddon } = await import('@xterm/addon-fit')
    const { Terminal } = await import('@xterm/xterm')
    await import('@xterm/xterm/css/xterm.css')

    if (!terminalOpen.value || runId !== terminalRunId || !terminalEl.value) return

    terminalInstance = new Terminal({
      cursorBlink: true,
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
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

    const terminalPath = sessionId
      ? `/api/pi/terminal?sessionId=${encodeURIComponent(sessionId)}`
      : '/api/pi/terminal'
    const socket = new WebSocket(backendWebSocketUrl(terminalPath))
    const pendingInput = []
    let terminalReady = false
    terminalSocket = socket

    terminalInputDisposable = term.onData((data) => {
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
        terminalStatus.value = 'connected'
        resizeTerminal()
        for (const data of pendingInput.splice(0)) {
          socket.send(JSON.stringify({ type: 'input', data }))
        }
      }
      if (payload.type === 'data') {
        term.write(payload.data, () => term.scrollToBottom())
      }
      if (payload.type === 'error') {
        terminalStatus.value = 'error'
        term.write(`\r\n${payload.message}\r\n`)
      }
      if (payload.type === 'exit') terminalStatus.value = 'exited'
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

  function resizeTerminal() {
    if (!terminalInstance || !terminalEl.value || !terminalFitAddon) return
    terminalFitAddon.fit()
    terminalInstance.scrollToBottom()
    if (terminalSocket?.readyState === WebSocket.OPEN
      && terminalStatus.value === 'connected') {
      terminalSocket.send(JSON.stringify({
        type: 'resize',
        cols: terminalInstance.cols,
        rows: terminalInstance.rows,
      }))
    }
  }

  function setTerminalDrawerHeight(height) {
    const max = Math.max(220, Math.round(window.innerHeight * 0.72))
    terminalDrawerHeight.value = Math.min(max, Math.max(180, Math.round(height)))
    cancelAnimationFrame(terminalResizeFrame)
    terminalResizeFrame = requestAnimationFrame(resizeTerminal)
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
    document.body.style.userSelect = ''
  }

  function startTerminalResize(event) {
    terminalResizeStartY = event.clientY
    terminalResizeStartHeight = terminalDrawerHeight.value
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
    terminalCwd,
    terminalEl,
    terminalOpen,
    terminalStatus,
    terminalDrawerHeight,
    resizeTerminal,
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
