import { randomUUID } from 'node:crypto'

export function createPromptQueue({ isIdle, submit, onChange }) {
  const items = []
  let held = false
  let error = ''
  let revision = 0
  let job
  let scheduled
  let disposed = false

  function changed() {
    if (disposed) return
    if (!items.length) {
      held = false
      error = ''
    }
    revision += 1
    onChange()
  }

  function snapshot() {
    return {
      revision,
      held,
      error,
      items: items.map((item) => ({
        id: item.id,
        text: item.text,
        imageCount: item.images.length,
        status: job?.item === item ? 'sending' : 'pending',
      })),
    }
  }

  function schedule() {
    if (disposed || scheduled || held || job || !items.length) return
    scheduled = setImmediate(() => {
      scheduled = undefined
      if (!disposed && !held && !job && items.length && isIdle()) {
        void send(items[0])
      }
    })
  }

  function add(input) {
    if (disposed) throw new Error('Session is closed')
    const item = { ...input, id: randomUUID() }
    items.push(item)
    changed()
    schedule()
    return item.id
  }

  function hold() {
    held = true
    if (job && !job.accepted) job.controller.abort()
    changed()
  }

  async function send(item, streamingBehavior) {
    if (job || disposed) throw new Error('Wait for the pending message to finish sending')
    const current = { item, controller: new AbortController(), accepted: false }
    job = current
    error = ''
    changed()
    try {
      await submit(item, streamingBehavior, current.controller.signal, () => {
        current.accepted = true
        const index = items.indexOf(item)
        if (index !== -1) items.splice(index, 1)
        changed()
      })
    } catch (cause) {
      if (!current.accepted && !disposed && !current.controller.signal.aborted) {
        held = true
        error = cause.message || String(cause)
      }
    } finally {
      job = undefined
      if (!disposed) {
        changed()
        schedule()
      }
    }
  }

  async function update(request) {
    if (disposed) throw new Error('Session is closed')
    if (request.revision !== revision) {
      throw Object.assign(new Error('The queue changed. Review it and try again.'), { statusCode: 409 })
    }
    if (request.action === 'hold') {
      hold()
      return
    }
    if (request.action === 'resume') {
      held = false
      error = ''
      changed()
      schedule()
      return
    }
    const index = items.findIndex((item) => item.id === request.id)
    if (index === -1) throw new Error('This message is no longer in the queue')
    const item = items[index]
    if (job?.item === item) throw new Error('This message is already being sent')
    if (request.action === 'remove') {
      items.splice(index, 1)
    } else if (request.action === 'edit') {
      if (typeof request.text !== 'string' || (!request.text.trim() && !item.images.length)) {
        throw new Error('Text or an image is required')
      }
      held = true
      if (job && !job.accepted) job.controller.abort()
      item.text = request.text.trim()
      error = ''
    } else if (request.action === 'move') {
      if (!['up', 'down'].includes(request.direction)) throw new Error('Invalid queue direction')
      const next = index + (request.direction === 'up' ? -1 : 1)
      if (next < 0 || next >= items.length) return
      if (job?.item === items[next]) throw new Error('The first message is already being sent')
      items.splice(index, 1)
      items.splice(next, 0, item)
    } else if (request.action === 'steer') {
      if (held) throw new Error('Resume the queue before steering')
      await send(item, 'steer')
      return
    } else {
      throw new Error('Invalid queue action')
    }
    changed()
    schedule()
  }

  function dispose() {
    disposed = true
    clearImmediate(scheduled)
    job?.controller.abort()
    items.length = 0
  }

  return { add, dispose, hold, schedule, snapshot, update }
}
