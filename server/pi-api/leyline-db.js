import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { expandUserPath } from './path-input.js'

// Single resolver for Leyline's own data directory (OD-1: dot-dirs kept).
// LEYLINE_MEMORY_DIR, when set, is tilde-expanded and made absolute so a
// relative value resolves deterministically instead of silently anchoring
// to whatever CWD the server happened to start in.
export function leylineDataDir() {
  const configured = process.env.LEYLINE_MEMORY_DIR
  if (configured) {
    const expanded = expandUserPath(configured)
    return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded)
  }
  return join(homedir(), '.local', 'share', 'leyline')
}

export function memoryDbPath() {
  return join(leylineDataDir(), 'memory.sqlite')
}

// The one SQLite opener for memory.sqlite. Callers keep their own DDL and
// must close the handle (open-per-operation lifecycle is intentional: it
// keeps Windows file-lock windows short).
export function openMemoryDb() {
  const dir = leylineDataDir()
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'memory.sqlite'))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  return db
}
