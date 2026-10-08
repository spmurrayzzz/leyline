import { Worker } from 'node:worker_threads'

const SCAN_SLOTS = 24

export function createSummaryPool(count) {
  let sequence = 0
  let closing = false
  let failure
  const handles = []
  const fail = (error) => {
    if (failure || closing) return
    failure = error
    for (const handle of handles) {
      handle.rejectReady(error)
      for (const pending of handle.pending.values()) pending.reject(error)
      handle.pending.clear()
    }
  }

  for (let index = 0; index < count; index++) {
    let worker
    try {
      worker = new Worker(new URL('./session-summary-worker.js', import.meta.url), {
        execArgv: [],
      })
    } catch (error) {
      fail(error)
      break
    }
    const handle = { worker, pending: new Map() }
    handle.ready = new Promise((resolve, reject) => {
      handle.resolveReady = resolve
      handle.rejectReady = reject
    })
    worker.on('message', (message) => {
      if (closing || failure) return
      if (message.kind === 'ready') {
        handle.resolveReady()
        return
      }
      const pending = handle.pending.get(message.id)
      if (!pending) return
      handle.pending.delete(message.id)
      if (message.kind === 'failure') pending.reject(new Error(message.error))
      else pending.resolve(message.session)
    })
    worker.on('error', fail)
    worker.on('messageerror', fail)
    worker.on('exit', (code) => {
      if (!closing) fail(new Error(`Summary worker exited unexpectedly (${code})`))
    })
    handles.push(handle)
  }

  const ready = Promise.all(handles.map((handle) => handle.ready))
  ready.catch(() => {})

  const request = (handle, values) => {
    if (closing || failure) {
      return Promise.reject(failure || new Error('Summary pool is closed'))
    }
    const id = ++sequence
    return new Promise((resolve, reject) => {
      handle.pending.set(id, { resolve, reject })
      try {
        handle.worker.postMessage({ kind: 'scan', id, ...values })
      } catch (error) {
        handle.pending.delete(id)
        reject(error)
      }
    })
  }

  return {
    async scan(jobs, goalFallback) {
      await ready
      if (failure) throw failure
      const results = new Array(jobs.length)
      let nextIndex = 0
      await Promise.all(Array.from({
        length: Math.min(SCAN_SLOTS, jobs.length),
      }, async (_, slot) => {
        const handle = handles[slot % handles.length]
        while (nextIndex < jobs.length) {
          const index = nextIndex++
          const session = await request(handle, {
            path: jobs[index].path,
            goalFallback,
          })
          results[index] = { ...jobs[index], session }
        }
      }))
      return results
    },
    async close() {
      if (closing) return
      closing = true
      for (const handle of handles) {
        handle.rejectReady(new Error('Summary pool closed during startup'))
        for (const pending of handle.pending.values()) {
          pending.reject(new Error('Summary pool closed during a request'))
        }
        handle.pending.clear()
      }
      await Promise.all(handles.map((handle) => handle.worker.terminate()))
    },
  }
}
