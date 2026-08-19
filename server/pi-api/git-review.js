import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
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
const MAX_GIT_OUTPUT = 20 * 1024 * 1024
const MAX_RENDERABLE_DIFF_BYTES = 1024 * 1024
const MAX_RENDERABLE_DIFF_LINES = 5000
const MAX_REVIEW_FILES = 500

export async function readGitReview(cwd) {
  const directory = await projectDirectory(cwd)
  const root = await repositoryRoot(directory)
  if (!root) {
    return {
      available: false,
      branch: '',
      files: [],
      filesTruncated: false,
      root: directory,
      totalFiles: 0,
    }
  }

  const [branch, status] = await Promise.all([
    branchName(root),
    runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ])

  const { files, truncated } = parseStatus(status.stdout, MAX_REVIEW_FILES)
  return {
    available: true,
    branch,
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
