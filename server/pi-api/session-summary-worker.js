import { parentPort } from 'node:worker_threads'
import { buildSessionInfo } from './session-summary.js'

if (!parentPort) throw new Error('Session summary worker requires a parent port')

parentPort.on('message', async (message) => {
  if (message?.kind !== 'scan') return
  try {
    const session = await buildSessionInfo(message.path, message.goalFallback)
    parentPort.postMessage({ kind: 'result', id: message.id, session })
  } catch (error) {
    parentPort.postMessage({
      kind: 'failure',
      id: message.id,
      error: error?.message || 'Session summary worker failed',
    })
  }
})

parentPort.postMessage({ kind: 'ready' })
