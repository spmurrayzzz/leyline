import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

// Path-input helpers for user-typed / externally supplied paths.
// The tilde/MSYS handling is adapted from pi (MIT), packages/coding-agent/src/utils/paths.ts
// (earendil-works/pi), reimplemented here because pi does not export it.

export function expandUserPath(value) {
  if (typeof value !== 'string') return value
  const input = value.trim()
  if (!input) return input
  if (input === '~') return homedir()
  if (input.startsWith('~/') || (process.platform === 'win32' && input.startsWith('~\\'))) {
    return join(homedir(), input.slice(2))
  }
  if (process.platform === 'win32') {
    const converted = normalizeWindowsShellPath(input)
    if (converted !== input) return converted
  }
  return input
}

// Convert Git Bash/MSYS/Cygwin/WSL drive paths (/c/..., /mnt/c/..., /cygdrive/c/...)
// to native Windows form. Leaves other paths unchanged.
export function normalizeWindowsShellPath(filePath) {
  if (!filePath.startsWith('/') || filePath.startsWith('//') || filePath.includes('\\')) return filePath
  const match = filePath.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i)
  if (!match) return filePath
  const suffix = match[2]?.replaceAll('/', '\\')
  return `${match[1].toUpperCase()}:\\${suffix ?? ''}`
}

// Comparison-only canonical key: never use for storage or display.
// On win32, paths are case-insensitive, so case-fold after resolving so the
// same folder spelled differently maps to one project/session identity.
export function canonicalCwdKey(value) {
  const expanded = expandUserPath(String(value ?? ''))
  const resolved = isAbsolute(expanded) ? resolve(expanded) : resolve(process.cwd(), expanded)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
