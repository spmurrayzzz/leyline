import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, open, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import { parseLocalFileHref } from '../../lib/file-links.js'
import { readBackendSettings, writeBackendSettings } from '../backend-connections.js'

const editorModes = new Set(['auto', 'desktop', 'terminal'])
const terminalEditors = new Set(['vim', 'vi', 'nvim', 'nano', 'hx', 'helix', 'micro'])
const textLimit = 2 * 1024 * 1024
const imageLimit = 10 * 1024 * 1024
const imageTypes = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

export async function getFileSettings() {
  return (await editorConfiguration()).settings
}

export async function setFileSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('Settings must be an object')
  const values = {}
  if (input.editor !== undefined) {
    if (typeof input.editor !== 'string' || input.editor.length > 4096) throw badRequest('editor must be a string of at most 4096 characters')
    if (input.editor.trim()) {
      try {
        parseEditorCommand(input.editor)
      } catch (error) {
        throw badRequest(error.message)
      }
    }
    values['files.editor'] = input.editor.trim()
  }
  if (input.editorMode !== undefined) {
    if (!editorModes.has(input.editorMode)) throw badRequest('editorMode must be auto, desktop, or terminal')
    values['files.editor_mode'] = input.editorMode
  }
  writeBackendSettings(values)
  return getFileSettings()
}

export async function performFileAction(session, input) {
  if (!input || !['resolve', 'preview', 'editor', 'reveal'].includes(input.action)) throw badRequest('Unknown file action')
  if (typeof input.href !== 'string') throw badRequest('href must be a string')
  if (input.basePath !== undefined && typeof input.basePath !== 'string') throw badRequest('basePath must be a string')
  if (input.allowOutsideProject !== undefined && typeof input.allowOutsideProject !== 'boolean') throw badRequest('allowOutsideProject must be a boolean')
  if (input.approvedPath !== undefined && typeof input.approvedPath !== 'string') throw badRequest('approvedPath must be a string')
  const configuration = await editorConfiguration()
  const descriptor = await resolveLocalFile(session.cwd, input, configuration)
  if (input.action === 'resolve' || descriptor.error || descriptor.needsApproval) return descriptor

  try {
    if (input.action === 'preview') return { ...descriptor, ...await readPreview(descriptor.path) }
    if (input.action === 'editor') {
      if (!descriptor.editorAvailable) throw new Error(configuration.settings.error || 'No editor configured. Set an editor or EDITOR on this backend.')
      if (descriptor.terminalEditor) return { ...descriptor, terminal: true }
      await launch(configuration.executable, editorArguments(configuration, descriptor), session.cwd)
    } else {
      if (!descriptor.revealLabel) throw new Error('Reveal is unavailable on this backend without a supported desktop environment')
      const [executable, args] = revealCommand(descriptor.path)
      await launch(executable, args, session.cwd)
    }
    return { ...descriptor, ok: true }
  } catch (error) {
    return { ...descriptor, error: fileError(error) }
  }
}

export async function terminalEditorOptions(cwd, { editorPath, editorLine, allowOutsideProject }) {
  if (typeof editorPath !== 'string' || !isAbsolute(editorPath)) throw new Error('editorPath must be an absolute file path')
  if (editorLine !== null && editorLine !== undefined && !/^[1-9]\d*$/.test(String(editorLine))) throw new Error('editorLine must be a positive integer')
  const line = editorLine == null ? undefined : Number(editorLine)
  if (line !== undefined && !Number.isSafeInteger(line)) throw new Error('editorLine must be a positive integer')
  const configuration = await editorConfiguration()
  const descriptor = await resolveLocalFile(cwd, {
    href: encodeURIComponent(editorPath),
    allowOutsideProject: allowOutsideProject === true,
    approvedPath: editorPath,
  }, configuration)
  if (descriptor.error) throw new Error(descriptor.error)
  if (descriptor.needsApproval) throw new Error('Approval is required to open a file outside the project')
  if (!descriptor.editorAvailable) throw new Error(configuration.settings.error || 'No editor configured on this backend')
  if (!descriptor.terminalEditor) throw new Error('The configured editor is not a terminal editor')
  return {
    executable: configuration.executable,
    args: editorArguments(configuration, { ...descriptor, line }),
    path: descriptor.path,
  }
}

async function resolveLocalFile(cwd, input, configuration) {
  const parsed = parseLocalFileHref(input.href)
  const descriptor = {
    ...(parsed || { path: input.href }),
    outsideProject: false,
    needsApproval: false,
    editorAvailable: Boolean(configuration.executable),
    terminalEditor: configuration.settings.terminalEditor,
    revealLabel: configuration.settings.revealLabel,
  }
  try {
    if (!parsed) throw new Error('Unsupported local file link')
    descriptor.path = nativePath(parsed.path)
    if (!cwd || !isAbsolute(cwd)) throw new Error('Session has no absolute project path')
    const base = input.basePath ? dirname(resolve(cwd, nativePath(input.basePath))) : cwd
    descriptor.path = resolve(base, descriptor.path)
    descriptor.outsideProject = outsideRoot(resolve(cwd), descriptor.path)
    descriptor.needsApproval = descriptor.outsideProject && input.allowOutsideProject !== true
    const root = await realpath(cwd)
    descriptor.path = await realpath(descriptor.path)
    if (input.allowOutsideProject === true && input.approvedPath !== descriptor.path) {
      throw new Error('File link changed after approval. Open the link again before continuing.')
    }
    descriptor.outsideProject = outsideRoot(root, descriptor.path)
    descriptor.needsApproval = descriptor.outsideProject && input.allowOutsideProject !== true
    if (!(await stat(descriptor.path)).isFile()) throw new Error('Only regular files are supported')
  } catch (error) {
    descriptor.error = fileError(error)
  }
  return descriptor
}

function nativePath(path) {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(path)) throw new Error('File paths cannot contain control characters')
  if (process.platform !== 'win32' && (/^\/?[a-z]:/i.test(path) || path.includes('\\'))) throw new Error('Windows file paths are not supported on this backend')
  if (/^\\\\|^\/\//.test(path)) throw new Error('Network file paths are not supported')
  if (/^\/?[a-z]:/i.test(path)) {
    path = path.replace(/^\/([a-z]:)/i, '$1')
    if (!win32.isAbsolute(path)) throw new Error('Drive-relative Windows paths are not supported')
  }
  if (path === '~') return homedir()
  if (/^~[\\/]/.test(path)) return join(homedir(), path.slice(2))
  if (path.startsWith('~')) throw new Error('Only ~/ home paths are supported')
  return path
}

function outsideRoot(root, path) {
  const difference = relative(root, path)
  return difference === '..' || difference.startsWith(`..${sep}`) || isAbsolute(difference)
}

async function readPreview(path) {
  const extension = extname(path).toLowerCase()
  const mimeType = imageTypes[extension]
  const limit = mimeType ? imageLimit : textLimit
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('Only regular files are supported')
    const currentPath = await realpath(path)
    const current = await stat(currentPath)
    if (currentPath !== path || current.dev !== info.dev || current.ino !== info.ino) throw new Error('File path changed during access. Resolve the link again.')
    if (info.size > limit) throw new Error(`File exceeds the ${mimeType ? '10 MiB image' : '2 MiB text'} preview limit`)
    const buffer = Buffer.alloc(Math.min(info.size + 1, limit + 1))
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > info.size) throw new Error('File changed while reading. Try the preview again.')
    const data = buffer.subarray(0, length)
    const metadata = { source: 'disk', modifiedAt: info.mtime.toISOString(), size: length }
    if (mimeType) {
      if (!validImage(data, mimeType)) throw new Error('File is not a supported raster image')
      return { kind: 'image', mimeType, data: data.toString('base64'), ...metadata }
    }
    let content
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(data)
    } catch {
      throw new Error('Binary or non-UTF-8 files cannot be previewed')
    }
    if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(content)) throw new Error('Binary files cannot be previewed')
    if (content.split('\n').length > 20000) throw new Error('File exceeds the 20,000-line preview limit. Open it in your editor.')
    const language = ['.md', '.markdown', '.mdown', '.mkd'].includes(extension) ? 'markdown' : 'text'
    return { kind: 'file', content, language, ...metadata }
  } finally {
    await file.close()
  }
}

function validImage(data, mimeType) {
  if (mimeType === 'image/png') return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mimeType === 'image/jpeg') return data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255
  if (mimeType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))
  if (mimeType === 'image/webp') return data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
  return data.toString('ascii', 0, 2) === 'BM'
}

async function editorConfiguration() {
  const stored = readBackendSettings(['files.editor', 'files.editor_mode'])
  const editor = stored['files.editor']
  const environmentEditor = process.env.EDITOR || ''
  const effectiveEditor = editor.trim() || environmentEditor.trim()
  const editorMode = editorModes.has(stored['files.editor_mode']) ? stored['files.editor_mode'] : 'auto'
  const settings = { editor, environmentEditor, effectiveEditor, editorMode, terminalEditor: editorMode === 'terminal', revealLabel: revealLabel() }
  if (!effectiveEditor) return { settings }
  try {
    const [command, ...args] = parseEditorCommand(effectiveEditor)
    const name = basename(command).toLowerCase().replace(/\.exe$/, '')
    settings.terminalEditor = editorMode === 'terminal' || (editorMode === 'auto' && (terminalEditors.has(name) || (name === 'emacs' && args.some((arg) => ['-nw', '--no-window-system'].includes(arg)))))
    const executable = await findExecutable(command)
    return { settings, executable, args, name }
  } catch (error) {
    settings.error = error.message
    return { settings }
  }
}

function parseEditorCommand(command) {
  if (/[\u0000-\u001f\u007f-\u009f$`]/.test(command)) throw new Error('Editor commands cannot contain control characters or substitutions')
  const words = []
  let word = ''
  let quote = ''
  let started = false
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (char === '\\' && quote !== "'") {
      const next = command[index + 1]
      if (next === undefined) throw new Error('Editor command has an incomplete escape')
      if (quote === '"' && next !== '"' && next !== '\\') word += char
      else {
        word += next
        index += 1
      }
      started = true
    } else if (quote) {
      if (char === quote) quote = ''
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) words.push(word)
      word = ''
      started = false
    } else {
      if (/[|&;<>()[\]{}*?!]/.test(char)) throw new Error('Editor commands cannot contain shell operators or expansions')
      word += char
      started = true
    }
  }
  if (quote) throw new Error('Editor command has an unclosed quote')
  if (started) words.push(word)
  if (!words[0]) throw new Error('Editor executable is required')
  return words
}

async function findExecutable(command) {
  command = nativePath(command)
  const paths = isAbsolute(command)
    ? [command]
    : command.includes('/') || command.includes('\\')
      ? []
      : (process.env.PATH || '').split(delimiter).filter((entry) => isAbsolute(entry)).map((entry) => join(entry, command))
  const extensions = process.platform === 'win32' && !extname(command) ? ['', '.exe', '.com'] : ['']
  for (const path of paths) {
    for (const extension of extensions) {
      const candidate = path + extension
      if (process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(candidate)) continue
      try {
        await access(candidate, constants.X_OK)
        if ((await stat(candidate)).isFile()) return candidate
      } catch {}
    }
  }
  throw new Error(`Editor executable not found or not executable: ${command}. Use an absolute path or a command on PATH.`)
}

function editorArguments(configuration, descriptor) {
  const args = [...configuration.args]
  if (descriptor.line && ['vim', 'vi', 'nvim', 'nano', 'emacs'].includes(configuration.name)) {
    args.push(`+${descriptor.line}`)
  }
  args.push(descriptor.path)
  return args
}

function revealLabel() {
  if (process.platform === 'darwin') return 'Reveal in Finder'
  if (process.platform === 'win32') return 'Reveal in Explorer'
  if (process.platform === 'linux' && (process.env.DISPLAY || process.env.WAYLAND_DISPLAY)) return 'Open containing folder'
  return null
}

function revealCommand(path) {
  if (process.platform === 'darwin') return ['/usr/bin/open', ['-R', path]]
  if (process.platform === 'win32') return ['explorer.exe', ['/select,', path]]
  return ['xdg-open', [dirname(path)]]
}

function launch(executable, args, cwd) {
  return new Promise((resolveLaunch, reject) => {
    let child
    let timer
    const finish = (error) => {
      clearTimeout(timer)
      child?.unref()
      if (error) reject(error)
      else resolveLaunch()
    }
    try {
      child = spawn(executable, args, { cwd, shell: false, stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true })
      child.once('error', finish)
      child.once('spawn', () => { timer = setTimeout(() => finish(), 750) })
      child.once('exit', (code, signal) => {
        finish(code === 0 ? undefined : new Error(`Application exited ${signal ? `with signal ${signal}` : `with code ${code}`}`))
      })
    } catch (error) {
      finish(error)
    }
  })
}

function fileError(error) {
  if (error.code === 'ENOENT') return 'File or project path does not exist'
  if (error.code === 'EACCES' || error.code === 'EPERM') return 'Permission denied for this file or application'
  if (error.code === 'ELOOP') return 'File contains a symlink loop or changed during access'
  if (error.code === 'ENOTDIR') return 'A parent path is not a directory'
  return error.message
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 })
}
