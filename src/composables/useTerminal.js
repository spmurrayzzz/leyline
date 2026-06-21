import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { nextTick, ref } from 'vue'

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

  async function toggleTerminal() {
    if (terminalOpen.value) {
      closeTerminalPanel()
      return
    }

    terminalOpen.value = true
    await connectTerminal()
  }

  function closeTerminalPanel() {
    terminalRunId += 1
    terminalOpen.value = false
    terminalStatus.value = 'closed'
    terminalInputDisposable?.dispose()
    terminalInputDisposable = undefined
    terminalSocket?.close()
    terminalSocket = undefined
    terminalInstance?.dispose()
    terminalInstance = undefined
    terminalFitAddon = undefined
    window.removeEventListener('resize', resizeTerminal)
  }

  async function connectTerminal() {
    terminalStatus.value = 'connecting'
    await nextTick()
    if (!terminalEl.value) return

    const runId = terminalRunId + 1
    terminalRunId = runId
    terminalInputDisposable?.dispose()
    terminalSocket?.close()
    terminalInstance?.dispose()
    terminalFitAddon = undefined
    window.removeEventListener('resize', resizeTerminal)

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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/api/pi/terminal`,
    )
    terminalSocket = socket

    terminalInputDisposable = term.onData((data) => {
      if (socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify({ type: 'input', data }))
    })

    socket.addEventListener('open', () => {
      if (runId !== terminalRunId) return
      terminalStatus.value = 'connected'
      resizeTerminal()
      focusTerminal()
    })

    socket.addEventListener('message', (event) => {
      if (runId !== terminalRunId) return
      const payload = parseTerminalMessage(event.data)
      if (!payload) return

      if (payload.type === 'ready') {
        terminalCwd.value = payload.cwd
        terminalStatus.value = 'connected'
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
      if (runId !== terminalRunId) return
      if (terminalStatus.value === 'connected') terminalStatus.value = 'closed'
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
    if (terminalSocket?.readyState === WebSocket.OPEN) {
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
