import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { nextTick, ref } from 'vue'

export function useTerminal() {
  const terminalOpen = ref(false)
  const terminalEl = ref(null)
  const terminalStatus = ref('closed')
  const terminalCwd = ref('')
  let terminalInstance
  let terminalSocket
  let terminalInputDisposable
  let terminalRunId = 0

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
    window.removeEventListener('resize', resizeTerminal)

    terminalInstance = new Terminal({
      cursorBlink: true,
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      theme: {
        background: '#0b0c0f',
        foreground: '#d8dbe3',
        cursor: '#cfc5ff',
        selectionBackground: '#3d3650',
      },
    })
    const term = terminalInstance
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
    if (!terminalInstance || !terminalEl.value) return
    const style = window.getComputedStyle(terminalEl.value)
    const width = terminalEl.value.clientWidth - cssPixels(style.paddingLeft)
      - cssPixels(style.paddingRight)
    const height = terminalEl.value.clientHeight - cssPixels(style.paddingTop)
      - cssPixels(style.paddingBottom)
    const cols = Math.max(40, Math.floor(width / 7.4))
    const rows = Math.max(8, Math.floor(height / 15) - 1)
    terminalInstance.resize(cols, rows)
    terminalInstance.scrollToBottom()
    if (terminalSocket?.readyState === WebSocket.OPEN) {
      terminalSocket.send(JSON.stringify({ type: 'resize', cols, rows }))
    }
  }

  return {
    closeTerminalPanel,
    connectTerminal,
    terminalCwd,
    terminalEl,
    terminalOpen,
    terminalStatus,
    toggleTerminal,
  }
}

function cssPixels(value) {
  return Number.parseFloat(value) || 0
}

function parseTerminalMessage(data) {
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}
