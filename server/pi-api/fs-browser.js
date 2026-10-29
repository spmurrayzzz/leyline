import { readdir, stat } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  resolve,
  sep,
} from 'node:path'

export async function readDirectory(path, cwd) {
  const input = path?.trim() || '~/'
  if (isWindowsAbsolute(input) && platform() !== 'win32') {
    throw new Error('Windows paths are not available on this environment')
  }
  if (platform() === 'win32' && isDriveRelative(input)) {
    throw new Error('Drive-relative paths are not supported. Use an absolute path such as C:\\foo')
  }

  const { directory, prefix, direct } = splitInput(input)
  const current = normalizeFsPath(directory, cwd)
  const info = await stat(current)
  if (!info.isDirectory()) throw new Error('Path is not a folder')

  const entries = await readdir(current, { withFileTypes: true })
  const candidates = entries
    .filter((entry) => entry.name.toLowerCase().startsWith(prefix.toLowerCase()))
    .filter((entry) => direct || prefix.startsWith('.') || !entry.name.startsWith('.'))
  const directories = (await Promise.all(candidates.map(async (entry) => {
    if (!await isDirectoryEntry(current, entry)) return null
    return {
      name: entry.name,
      fullPath: join(current, entry.name),
      path: join(current, entry.name),
      hidden: entry.name.startsWith('.'),
    }
  }))).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))

  const root = parse(current).root
  const parent = dirname(current) === current ? '' : dirname(current)

  return {
    parentPath: current,
    path: current,
    parent,
    home: homedir(),
    entries: directories,
    directories,
    root,
  }
}

async function isDirectoryEntry(directory, entry) {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  try {
    return (await stat(join(directory, entry.name))).isDirectory()
  } catch {
    return false
  }
}

function splitInput(input) {
  if (input === '~') return { directory: '~', prefix: '', direct: true }

  if (platform() === 'win32' && isBareUncShare(input)) {
    return { directory: input, prefix: '', direct: true }
  }

  if (input.endsWith('/') || input.endsWith('\\')) {
    return { directory: input, prefix: '', direct: true }
  }

  const normalized = input.replace(/\\/g, sep)
  const dir = dirname(normalized)
  const prefix = basename(normalized)
  return {
    directory: dir === '.' ? './' : `${dir}${sep}`,
    prefix,
    direct: false,
  }
}

function normalizeFsPath(path, cwd) {
  const value = path?.trim() || homedir()
  if (value === '~') return homedir()
  if (value.startsWith(`~${sep}`) || value.startsWith('~/')) {
    return join(homedir(), value.slice(2))
  }
  if (isExplicitRelative(value)) {
    if (!cwd) throw new Error('Relative paths require an active project')
    return resolve(cwd, value)
  }
  return isAbsolute(value) ? resolve(value) : resolve(process.cwd(), value)
}

function isExplicitRelative(value) {
  return /^\.\.?([/\\]|$)/.test(value)
}

function isWindowsAbsolute(value) {
  return /^[a-zA-Z]:[/\\]/.test(value) || value.startsWith('\\\\')
}

function isDriveRelative(value) {
  return /^[a-zA-Z]:(?![/\\])/.test(value)
}

function isBareUncShare(value) {
  const normalized = value.replace(/\//g, '\\')
  if (!normalized.startsWith('\\\\')) return false
  const parts = normalized.split('\\').filter(Boolean)
  return parts.length === 2 && parts[0] !== '?' && parts[0] !== '.'
}
