import { watch } from 'node:fs'
import { basename, dirname, relative } from 'node:path'
import {
  hasGitReviewCollapsedWatchChange,
  hasGitReviewWatchChange,
  resolveGitReviewWatchTarget,
} from './git-review.js'

const MAX_PENDING_PATHS = 2048
const WATCH_DELAY = 200
const watchEntries = new Map()

export function openGitReviewEventStream(cwd, req, res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')

  let closed = false
  let release
  req.on('close', () => {
    closed = true
    release?.()
  })

  void subscribe(cwd, res).then((unsubscribe) => {
    if (closed) {
      unsubscribe()
      return
    }
    release = unsubscribe
    res.write(': connected\n\n')
  }).catch((error) => {
    if (closed) return
    sendEvent(res, 'review_watch_error', { message: error.message })
    res.end()
  })
}

async function subscribe(cwd, res) {
  const target = await resolveGitReviewWatchTarget(cwd)
  let entry = watchEntries.get(target.watchRoot)
  if (!entry) {
    entry = createWatchEntry(cwd, target)
    watchEntries.set(target.watchRoot, entry)
  }
  entry.clients.add(res)
  return () => releaseClient(entry, res)
}

function createWatchEntry(cwd, target) {
  const entry = {
    clients: new Set(),
    closed: false,
    collapsedPaths: new Set(),
    cwd,
    flushing: false,
    force: false,
    gitWatchPaths: target.gitWatchPaths,
    gitWatchers: [],
    paths: new Set(),
    repositoryRoot: target.repositoryRoot,
    rootGitPaths: rootGitPaths(target),
    reprobe: false,
    reprobing: false,
    rootWatcher: undefined,
    statusCheckAll: false,
    timer: undefined,
    watchRoot: target.watchRoot,
  }

  entry.rootWatcher = watch(entry.watchRoot, {
    encoding: 'utf8',
    persistent: false,
    recursive: true,
  }, (_eventType, filename) => handleRootChange(entry, filename))
  entry.rootWatcher.on('error', (error) => failEntry(entry, error))
  openGitWatchers(entry)
  return entry
}

function openGitWatchers(entry) {
  if (!entry.gitWatchPaths.length || entry.gitWatchers.length || entry.closed) return
  const pathsByDirectory = new Map()
  for (const path of entry.gitWatchPaths) {
    const directory = dirname(path)
    const names = pathsByDirectory.get(directory) || new Set()
    names.add(basename(path))
    pathsByDirectory.set(directory, names)
  }

  for (const [directory, names] of pathsByDirectory) {
    try {
      const watcher = watch(directory, {
        encoding: 'utf8',
        persistent: false,
      }, (_eventType, filename) => {
        const path = normalizeWatchPath(filename)
        if (!path || names.has(path)) {
          if (!path || path === 'HEAD') entry.reprobe = true
          queueChange(entry, '', true)
        }
      })
      watcher.on('error', () => {
        watcher.close()
        entry.gitWatchers = entry.gitWatchers.filter((item) => item !== watcher)
        entry.reprobe = true
        queueChange(entry, '', true)
      })
      entry.gitWatchers.push(watcher)
    } catch {
    }
  }
}

function handleRootChange(entry, filename) {
  const path = normalizeWatchPath(filename)
  if (!path) {
    entry.reprobe = true
    queueChange(entry, '', true)
    return
  }
  if (!entry.repositoryRoot) {
    if (isGitPath(path)) {
      entry.reprobe = true
      queueChange(entry, '', true)
    }
    return
  }
  if (isGitPath(path)) {
    if (path === '.git') {
      entry.reprobe = true
      queueChange(entry, '', true)
    } else if (entry.rootGitPaths.has(path)) {
      if (path.endsWith('/HEAD')) entry.reprobe = true
      queueChange(entry, '', true)
    }
    return
  }
  queueChange(entry, path)
}

function queueChange(entry, path, force = false) {
  if (entry.closed) return
  if (force) {
    entry.force = true
    entry.collapsedPaths.clear()
    entry.paths.clear()
    entry.statusCheckAll = false
  } else if (!entry.force && !entry.statusCheckAll) {
    if (!pendingPathCovered(entry.collapsedPaths, path)) entry.paths.add(path)
    if (entry.paths.size > MAX_PENDING_PATHS) collapsePendingPaths(entry)
  }
  scheduleFlush(entry)
}

function scheduleFlush(entry) {
  if (entry.closed || entry.timer) return
  entry.timer = setTimeout(() => {
    entry.timer = undefined
    void flushEntry(entry)
  }, WATCH_DELAY)
}

async function flushEntry(entry) {
  if (entry.closed) return
  if (entry.flushing) {
    scheduleFlush(entry)
    return
  }

  const force = entry.force
  const paths = [...entry.paths]
  const pathsCollapsed = entry.collapsedPaths.size > 0
  const reprobe = entry.reprobe
  const statusCheckAll = entry.statusCheckAll
  entry.force = false
  entry.collapsedPaths.clear()
  entry.paths.clear()
  entry.reprobe = false
  entry.statusCheckAll = false
  entry.flushing = true

  try {
    const previousRepositoryRoot = entry.repositoryRoot
    if (reprobe) await reprobeEntry(entry)
    let changed = previousRepositoryRoot !== entry.repositoryRoot
      || (force && !!entry.repositoryRoot)
      || (statusCheckAll && !!entry.repositoryRoot)
    if (!changed && entry.repositoryRoot && paths.length) {
      try {
        changed = pathsCollapsed
          ? await hasGitReviewCollapsedWatchChange(entry.repositoryRoot, paths)
          : await hasGitReviewWatchChange(entry.repositoryRoot, paths)
      } catch {
        changed = true
      }
    }
    if (changed) broadcastChange(entry)
  } finally {
    entry.flushing = false
    if (
      entry.force
      || entry.paths.size
      || entry.reprobe
      || entry.statusCheckAll
    ) scheduleFlush(entry)
  }
}

async function reprobeEntry(entry) {
  if (entry.reprobing) return
  entry.reprobing = true
  try {
    const target = await resolveGitReviewWatchTarget(entry.cwd)
    if (target.repositoryRoot && target.watchRoot !== entry.watchRoot) return
    for (const watcher of entry.gitWatchers) watcher.close()
    entry.gitWatchers = []
    entry.repositoryRoot = target.repositoryRoot
    entry.gitWatchPaths = target.gitWatchPaths
    entry.rootGitPaths = rootGitPaths(target)
    openGitWatchers(entry)
  } catch {
  } finally {
    entry.reprobing = false
  }
}

function broadcastChange(entry) {
  for (const client of entry.clients) {
    sendEvent(client, 'review_change', { root: entry.watchRoot })
  }
}

function failEntry(entry, error) {
  if (entry.closed) return
  closeEntry(entry)
  for (const client of entry.clients) {
    sendEvent(client, 'review_watch_error', { message: error.message })
    client.end()
  }
  entry.clients.clear()
}

function releaseClient(entry, res) {
  entry.clients.delete(res)
  if (entry.clients.size || entry.closed) return
  closeEntry(entry)
}

function closeEntry(entry) {
  if (entry.closed) return
  entry.closed = true
  clearTimeout(entry.timer)
  entry.rootWatcher?.close()
  for (const watcher of entry.gitWatchers) watcher.close()
  entry.gitWatchers = []
  if (watchEntries.get(entry.watchRoot) === entry) {
    watchEntries.delete(entry.watchRoot)
  }
}

function collapsePendingPaths(entry) {
  while (entry.paths.size > MAX_PENDING_PATHS) {
    const counts = new Map()
    for (const path of entry.paths) {
      let parent = parentWatchPath(path)
      while (parent) {
        counts.set(parent, (counts.get(parent) || 0) + 1)
        parent = parentWatchPath(parent)
      }
    }

    let candidate = ''
    let candidateCount = 1
    let candidateDepth = -1
    for (const [path, count] of counts) {
      const depth = path.split('/').length
      if (
        count > 1
        && (depth > candidateDepth
          || (depth === candidateDepth && count > candidateCount))
      ) {
        candidate = path
        candidateCount = count
        candidateDepth = depth
      }
    }

    if (!candidate) {
      entry.collapsedPaths.clear()
      entry.paths.clear()
      entry.statusCheckAll = true
      return
    }

    const prefix = `${candidate}/`
    for (const path of entry.paths) {
      if (
        path.startsWith(prefix)
        || candidate.startsWith(`${path}/`)
      ) entry.paths.delete(path)
    }
    for (const path of entry.collapsedPaths) {
      if (
        path.startsWith(prefix)
        || candidate.startsWith(`${path}/`)
      ) entry.collapsedPaths.delete(path)
    }
    entry.collapsedPaths.add(candidate)
    entry.paths.add(candidate)
  }
}

function pendingPathCovered(paths, path) {
  let candidate = path
  while (candidate) {
    if (paths.has(candidate)) return true
    candidate = parentWatchPath(candidate)
  }
  return false
}

function parentWatchPath(path) {
  const separator = path.lastIndexOf('/')
  return separator === -1 ? '' : path.slice(0, separator)
}

function rootGitPaths(target) {
  return new Set(target.gitWatchPaths.map((path) => {
    return relative(target.watchRoot, path).replaceAll('\\', '/')
  }).filter((path) => {
    return path && path !== '..' && !path.startsWith('../')
  }))
}

function normalizeWatchPath(filename) {
  if (filename === null || filename === undefined) return ''
  const value = Buffer.isBuffer(filename)
    ? filename.toString('utf8')
    : String(filename)
  const path = value
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/\/{2,}/g, '/')
  if (
    !path
    || path === '.'
    || path.startsWith('../')
    || path.startsWith('/')
    || /^[a-z]:\//i.test(path)
  ) return ''
  return path
}

function isGitPath(path) {
  return path === '.git' || path.startsWith('.git/')
}

function sendEvent(res, type, data) {
  if (res.destroyed || res.writableEnded) return
  res.write(`event: ${type}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}
