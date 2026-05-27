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

  const { directory, prefix, direct } = splitInput(input)
  const current = normalizeFsPath(directory, cwd)
  const info = await stat(current)
  if (!info.isDirectory()) throw new Error('Path is not a folder')

  const entries = await readdir(current, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name.toLowerCase().startsWith(prefix.toLowerCase()))
    .filter((entry) => direct || prefix.startsWith('.') || !entry.name.startsWith('.'))
    .map((entry) => ({
      name: entry.name,
      fullPath: join(current, entry.name),
      path: join(current, entry.name),
      hidden: entry.name.startsWith('.'),
    }))
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

function splitInput(input) {
  if (input === '~') return { directory: '~', prefix: '', direct: true }

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
