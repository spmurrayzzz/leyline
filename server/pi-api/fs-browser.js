import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export async function readDirectory(path) {
  const current = normalizeFsPath(path)
  const info = await stat(current)
  if (!info.isDirectory()) throw new Error('Path is not a folder')

  const entries = await readdir(current, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: join(current, entry.name),
      hidden: entry.name.startsWith('.'),
    }))
    .sort((a, b) => {
      if (a.hidden !== b.hidden) return a.hidden ? 1 : -1
      return a.name.localeCompare(b.name)
    })

  return {
    path: current,
    parent: dirname(current) === current ? '' : dirname(current),
    home: homedir(),
    directories,
  }
}

function normalizeFsPath(path) {
  const value = path?.trim() || homedir()
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return join(homedir(), value.slice(2))
  return isAbsolute(value) ? resolve(value) : resolve(process.cwd(), value)
}
