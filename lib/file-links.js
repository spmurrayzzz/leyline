const controls = /[\u0000-\u001f\u007f-\u009f]/

export function isLocalFileHref(value) {
  return parseLocalFileHref(value) !== null
}

export function parseLocalFileHref(value) {
  if (typeof value !== 'string' || !value || controls.test(value)) return null
  if (value.startsWith('#') || value.startsWith('?') || value.startsWith('//')) return null

  let path = value
  let anchor
  const fragment = path.indexOf('#')
  if (fragment !== -1) {
    anchor = path.slice(fragment + 1)
    path = path.slice(0, fragment)
  }
  path = path.split('?')[0]

  const scheme = path.match(/^([a-z][a-z\d+.-]*):/i)
  if (scheme && scheme[1].toLowerCase() === 'file') {
    path = path.slice(5)
    if (path.startsWith('//')) {
      const authority = path.slice(2).match(/^([^/]*)(\/.*)$/)
      if (!authority || !['', 'localhost'].includes(authority[1].toLowerCase())) return null
      path = authority[2]
    }
    if (!path.startsWith('/') || path.startsWith('//')) return null
  } else if (scheme && !/^[a-z]:[\\/]/i.test(path)) {
    if (/^(?:https?|mailto|tel|ftp|data|javascript|vbscript)$/i.test(scheme[1])
      || !/^[^:]+:\d+(?::\d+)?$/.test(path)) return null
  }

  let line
  let endLine
  let column
  const position = path.match(/:(\d+)(?::(\d+))?$/)
  if (position) {
    line = Number(position[1])
    column = position[2] === undefined ? undefined : Number(position[2])
    path = path.slice(0, position.index)
  }

  try {
    path = decodeURIComponent(path)
    if (anchor !== undefined) anchor = decodeURIComponent(anchor)
  } catch {
    return null
  }
  if (!path || controls.test(path) || controls.test(anchor || '') || path.startsWith('//')) return null

  const range = anchor?.match(/^L(\d+)(?:-L?(\d+))?$/)
  if (range) {
    line = Number(range[1])
    endLine = range[2] === undefined ? undefined : Number(range[2])
    column = undefined
  }
  if ([line, endLine, column].some((number) => number !== undefined && (!Number.isSafeInteger(number) || number < 1))) return null
  if (endLine !== undefined && endLine < line) return null
  return { path, line, endLine, column, anchor }
}
