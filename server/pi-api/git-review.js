import { execFile } from 'node:child_process'
import { lstat, open, stat } from 'node:fs/promises'
import { devNull } from 'node:os'
import { resolve } from 'node:path'

const CONFLICTED_STATUS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
const DIFF_FORMAT_ARGS = [
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--no-relative',
  '--src-prefix=a/',
  '--dst-prefix=b/',
]
const GIT_BINARY_PROBE_BYTES = 8000
const MAX_GIT_OUTPUT = 20 * 1024 * 1024
const MAX_RENDERABLE_DIFF_BYTES = 1024 * 1024
const MAX_RENDERABLE_DIFF_LINES = 5000
const MAX_REVIEW_FILES = 500
const MAX_UNTRACKED_DIFF_DRIVERS = 20
const MAX_UNTRACKED_LINE_STATS_BYTES = 20 * 1024 * 1024

export async function readGitReview(cwd) {
  const directory = await projectDirectory(cwd)
  const root = await repositoryRoot(directory)
  if (!root) {
    return {
      additions: 0,
      available: false,
      branch: '',
      conflicts: 0,
      deletions: 0,
      files: [],
      filesTruncated: false,
      lineStatsAvailable: true,
      root: directory,
      totalFiles: 0,
    }
  }

  const [branch, status] = await Promise.all([
    branchName(root),
    runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ])

  const { files, truncated } = parseStatus(status.stdout, MAX_REVIEW_FILES)
  const conflicts = truncated
    ? await readConflictCount(root)
    : files.filter((file) => file.conflicted).length
  const lineStats = truncated
    ? { additions: 0, deletions: 0, lineStatsAvailable: false }
    : await readLineStats(root, files)
  return {
    ...lineStats,
    available: true,
    branch,
    conflicts,
    files,
    filesTruncated: truncated,
    root,
    totalFiles: truncated ? null : files.length,
  }
}

export async function readGitReviewDiff(cwd, path) {
  const directory = await projectDirectory(cwd)
  const root = await repositoryRoot(directory)
  if (!root) throw new Error('This project is not a Git repository')

  const status = await runGit(
    root,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
  )
  const { files } = parseStatus(status.stdout, MAX_REVIEW_FILES)
  const file = files.find((item) => item.path === path)
  if (!file) throw new Error('This file is no longer available for review')

  return {
    diffs: await fileDiffs(root, file),
    path: file.path,
  }
}

async function readLineStats(root, files) {
  try {
    const [staged, working] = await Promise.all([
      runGit(root, [
        'diff',
        '--cached',
        '--numstat',
        '-z',
        '--no-ext-diff',
        '--no-textconv',
        '--find-renames',
        '--',
      ]),
      runGit(root, [
        'diff',
        '--numstat',
        '-z',
        '--no-ext-diff',
        '--no-textconv',
        '--find-renames',
        '--',
      ]),
    ])
    const stagedStats = parseNumstat(staged.stdout)
    const workingStats = parseNumstat(working.stdout)
    let additions = stagedStats.additions + workingStats.additions
    const deletions = stagedStats.deletions + workingStats.deletions
    const untrackedFiles = files.filter((file) => file.untracked)
    const diffAttributes = await untrackedDiffAttributes(root, untrackedFiles)
    let untrackedBytesRemaining = MAX_UNTRACKED_LINE_STATS_BYTES
    for (const file of untrackedFiles) {
      const stats = await untrackedAdditions(
        root,
        file.path,
        untrackedBytesRemaining,
        diffAttributes.get(file.path),
      )
      additions += stats.additions
      untrackedBytesRemaining -= stats.bytes
    }
    return { additions, deletions, lineStatsAvailable: true }
  } catch {
    return { additions: 0, deletions: 0, lineStatsAvailable: false }
  }
}

async function readConflictCount(root) {
  const result = await runGit(root, [
    'diff',
    '--name-only',
    '-z',
    '--diff-filter=U',
    '--',
  ])
  let count = 0
  for (const byte of Buffer.from(result.stdout)) {
    if (byte === 0) count++
  }
  return count
}

function parseNumstat(output) {
  let additions = 0
  let deletions = 0
  for (const record of output.split('\0')) {
    const match = /^(\d+|-)\t(\d+|-)\t/.exec(record)
    if (!match || match[1] === '-' || match[2] === '-') continue
    additions += Number(match[1])
    deletions += Number(match[2])
  }
  return { additions, deletions }
}

async function untrackedDiffAttributes(root, files) {
  const attributes = new Map()
  for (let offset = 0; offset < files.length; offset += 100) {
    const paths = files.slice(offset, offset + 100).map((file) => file.path)
    const result = await runGit(root, [
      'check-attr',
      '-z',
      'diff',
      '--',
      ...paths,
    ])
    const records = result.stdout.split('\0')
    for (let index = 0; index + 2 < records.length; index += 3) {
      attributes.set(records[index], records[index + 2])
    }
  }

  const drivers = [...new Set([...attributes.values()].filter((value) => {
    return !['set', 'unset', 'unspecified'].includes(value)
  }))]
  if (drivers.length > MAX_UNTRACKED_DIFF_DRIVERS) {
    throw new Error('Too many untracked diff drivers')
  }
  const driverModes = new Map(await Promise.all(drivers.map(async (driver) => {
    const result = await runGit(
      root,
      ['config', '--type=bool', '--get', `diff.${driver}.binary`],
      [0, 1],
    )
    if (result.code === 1) return [driver, 'unspecified']
    return [driver, stripLineEnding(result.stdout) === 'true' ? 'unset' : 'set']
  })))
  for (const [path, value] of attributes) {
    if (driverModes.has(value)) attributes.set(path, driverModes.get(value))
  }
  return attributes
}

async function untrackedAdditions(root, path, bytesRemaining, diffAttribute) {
  const absolutePath = resolve(root, path)
  const info = await lstat(absolutePath)
  if (!info.isFile() && !info.isSymbolicLink()) {
    return { additions: 0, bytes: 0 }
  }
  if (info.size > bytesRemaining) throw new Error('Untracked files are too large')
  if (info.isSymbolicLink()) return { additions: 1, bytes: info.size }
  if (diffAttribute === 'unset') return { additions: 0, bytes: info.size }
  if (info.size === 0) return { additions: 0, bytes: 0 }

  const file = await open(absolutePath, 'r')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  let binaryProbeBytesRemaining = GIT_BINARY_PROBE_BYTES
  let bytesRemainingInFile = info.size
  let lastByte = -1
  let lines = 0
  try {
    while (bytesRemainingInFile > 0) {
      const length = Math.min(buffer.length, bytesRemainingInFile)
      const { bytesRead } = await file.read(buffer, 0, length, null)
      if (!bytesRead) break
      bytesRemainingInFile -= bytesRead
      const chunk = buffer.subarray(0, bytesRead)
      if (diffAttribute !== 'set' && binaryProbeBytesRemaining > 0) {
        const probeBytes = Math.min(chunk.length, binaryProbeBytesRemaining)
        if (chunk.subarray(0, probeBytes).includes(0)) {
          return { additions: 0, bytes: info.size }
        }
        binaryProbeBytesRemaining -= probeBytes
      }
      for (const byte of chunk) {
        if (byte === 10) lines++
      }
      lastByte = chunk[chunk.length - 1]
    }
    if ((await file.stat()).size > info.size) {
      throw new Error('Untracked file changed while reading')
    }
  } finally {
    await file.close()
  }
  return {
    additions: lines + (lastByte === 10 ? 0 : 1),
    bytes: info.size,
  }
}

async function projectDirectory(cwd) {
  if (typeof cwd !== 'string' || !cwd) {
    throw new Error('Project path is required')
  }
  const directory = resolve(cwd)
  const info = await stat(directory)
  if (!info.isDirectory()) throw new Error('Project path is not a folder')
  return directory
}

async function repositoryRoot(cwd) {
  const result = await runGit(
    cwd,
    ['rev-parse', '--show-toplevel'],
    [0, 128],
  )
  if (result.code === 0) return stripLineEnding(result.stdout)
  if (/not a git repository/i.test(result.stderr)) return ''
  throw new Error(result.stderr.trim() || 'Could not inspect Git repository')
}

async function branchName(root) {
  const branch = await runGit(
    root,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    [0, 1],
  )
  if (branch.code === 0) return stripLineEnding(branch.stdout)

  const head = await runGit(root, ['rev-parse', '--short', 'HEAD'], [0, 128])
  return head.code === 0 ? stripLineEnding(head.stdout) : 'No commits yet'
}

async function fileDiffs(root, file) {
  const paths = file.oldPath ? [file.oldPath, file.path] : [file.path]
  if (file.conflicted) {
    return [diffSection('conflict', await conflictPatch(root, paths))]
  }

  const diffs = []
  if (file.staged) {
    const head = await runGit(root, ['rev-parse', '--verify', 'HEAD'], [0, 128])
    const args = [
      'diff',
      '--cached',
      ...DIFF_FORMAT_ARGS,
      '--find-renames',
    ]
    if (head.code === 0) args.push('HEAD')
    args.push('--', ...paths)
    const staged = await runGit(root, args)
    diffs.push(diffSection('staged', staged.stdout))
  }
  if (file.untracked) {
    diffs.push(file.path.endsWith('/')
      ? diffSection('working', '', { directory: true })
      : diffSection('working', await untrackedPatch(root, file.path)))
  } else if (file.unstaged) {
    diffs.push(diffSection('working', await workingPatch(root, paths)))
  }
  return diffs
}

async function conflictPatch(root, paths) {
  for (const side of ['--ours', '--theirs', '--base']) {
    const patch = await workingPatch(root, paths, [side])
    if (/^diff --git /m.test(patch)) return patch
  }
  return ''
}

async function workingPatch(root, paths, extraArgs = []) {
  const result = await runGit(root, [
    'diff',
    ...extraArgs,
    ...DIFF_FORMAT_ARGS,
    '--find-renames',
    '--',
    ...paths,
  ])
  return result.stdout
}

async function untrackedPatch(root, path) {
  const result = await runGit(root, [
    'diff',
    '--no-index',
    ...DIFF_FORMAT_ARGS,
    '--',
    devNull,
    path,
  ], [0, 1])
  if (result.code === 1 && !/^diff --git /m.test(result.stdout)) {
    throw new Error(result.stderr.trim() || 'Could not read untracked file')
  }
  return result.stdout
}

function stripLineEnding(value) {
  if (value.endsWith('\r\n')) return value.slice(0, -2)
  if (value.endsWith('\n')) return value.slice(0, -1)
  return value
}

function diffSection(scope, output, metadata = {}) {
  const start = output.indexOf('diff --git ')
  const patch = start === -1 ? output : output.slice(start)
  const binary = /^(Binary files |GIT binary patch$)/m.test(patch)
  const bytes = Buffer.byteLength(patch)
  const lines = lineCount(patch)
  const tooLarge = !binary && (
    bytes > MAX_RENDERABLE_DIFF_BYTES
    || lines > MAX_RENDERABLE_DIFF_LINES
  )
  return {
    binary,
    bytes,
    lines,
    patch: tooLarge ? '' : patch,
    scope,
    tooLarge,
    ...metadata,
  }
}

function lineCount(value) {
  if (!value) return 0
  let count = value.endsWith('\n') ? 0 : 1
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '\n') count++
  }
  return count
}

function parseStatus(output, limit = Infinity) {
  const merged = new Map()
  let truncated = false
  for (const file of statusFiles(output)) {
    const current = merged.get(file.path)
    if (!current && merged.size >= limit) {
      truncated = true
      break
    }
    merged.set(file.path, current ? mergeStatusFile(current, file) : file)
  }
  return {
    files: [...merged.values()].sort((a, b) => a.path.localeCompare(b.path)),
    truncated,
  }
}

function* statusFiles(output) {
  let offset = 0
  while (offset < output.length) {
    const end = output.indexOf('\0', offset)
    const record = output.slice(offset, end === -1 ? output.length : end)
    offset = end === -1 ? output.length : end + 1
    if (!record || record.length < 4) continue

    const indexStatus = record[0]
    const worktreeStatus = record[1]
    const status = `${indexStatus}${worktreeStatus}`
    const renamed = indexStatus === 'R' || worktreeStatus === 'R'
      || indexStatus === 'C' || worktreeStatus === 'C'
    let oldPath = ''
    if (renamed) {
      const oldPathEnd = output.indexOf('\0', offset)
      oldPath = output.slice(
        offset,
        oldPathEnd === -1 ? output.length : oldPathEnd,
      )
      offset = oldPathEnd === -1 ? output.length : oldPathEnd + 1
    }
    const untracked = status === '??'
    yield {
      conflicted: CONFLICTED_STATUS.has(status),
      indexStatus,
      kind: statusKind(status),
      oldPath,
      path: record.slice(3),
      staged: !untracked && indexStatus !== ' ',
      unstaged: untracked || worktreeStatus !== ' ',
      untracked,
      worktreeStatus,
    }
  }
}

function mergeStatusFile(current, file) {
  const replaced = (current.untracked || file.untracked)
    && (current.indexStatus === 'D' || file.indexStatus === 'D')
  return {
    ...current,
    conflicted: current.conflicted || file.conflicted,
    indexStatus: current.staged ? current.indexStatus : file.indexStatus,
    kind: replaced ? 'replaced' : current.kind,
    oldPath: current.oldPath || file.oldPath,
    staged: current.staged || file.staged,
    unstaged: current.unstaged || file.unstaged,
    untracked: current.untracked || file.untracked,
    worktreeStatus: current.untracked || file.untracked
      ? '?'
      : file.worktreeStatus,
  }
}

function statusKind(status) {
  if (status === '??') return 'untracked'
  if (CONFLICTED_STATUS.has(status)) return 'conflicted'
  if (status.includes('R')) return 'renamed'
  if (status.includes('C')) return 'copied'
  if (status.includes('D')) return 'deleted'
  if (status.includes('A')) return 'added'
  return 'modified'
}

function runGit(cwd, args, acceptedCodes = [0]) {
  return new Promise((resolveCommand, rejectCommand) => {
    execFile('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_LITERAL_PATHSPECS: '1',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
      },
      maxBuffer: MAX_GIT_OUTPUT,
      timeout: 15000,
    }, (error, stdout, stderr) => {
      const code = typeof error?.code === 'number' ? error.code : 0
      if (!error) {
        resolveCommand({ code: 0, stderr, stdout })
        return
      }
      if (typeof error.code === 'number' && acceptedCodes.includes(code)) {
        resolveCommand({ code, stderr, stdout })
        return
      }

      if (error.code === 'ENOENT') {
        rejectCommand(new Error('Git is not installed on this backend'))
        return
      }
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        rejectCommand(new Error('Git output is too large to display'))
        return
      }
      if (error.killed) {
        rejectCommand(new Error('Git review timed out'))
        return
      }
      rejectCommand(new Error(stderr.trim() || error.message))
    })
  })
}
