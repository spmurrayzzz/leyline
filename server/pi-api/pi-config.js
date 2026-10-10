import { randomUUID, createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { applyEdits, getNodeValue, modify, parseTree, visit } from 'jsonc-parser'
import lockfile from 'proper-lockfile'

const files = new Set(['models.json', 'mcp.json'])
const maxBytes = 2 * 1024 * 1024

export function settingsError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode })
}

export function isSettingsObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseConfig(text, file) {
  if (!text.trim()) throw settingsError(`${file} is empty. Repair it before saving.`, 409)
  const source = text.replace(/^\uFEFF/, '')
  const errors = []
  const tree = parseTree(source, errors, {
    allowTrailingComma: file === 'models.json',
    disallowComments: file !== 'models.json',
  })
  if (file === 'models.json') {
    visit(source, {
      onComment(offset, length) {
        if (source.slice(offset, offset + length).startsWith('/*')) errors.push({ error: 'block-comment' })
      },
    })
  }
  if (errors.length || !tree || tree.type !== 'object') {
    throw settingsError(`${file} is not valid pi configuration. Repair it before saving.`, 409)
  }
  const duplicates = (node) => {
    if (node.type === 'object') {
      const keys = node.children.map((child) => child.children[0].value)
      if (new Set(keys).size !== keys.length) throw settingsError(`${file} contains duplicate keys. Repair it before saving.`, 409)
    }
    for (const child of node.children || []) duplicates(child)
  }
  duplicates(tree)
  return getNodeValue(tree)
}

async function configPath(file) {
  if (!files.has(file)) throw settingsError('Unsupported configuration file')
  const path = join(getAgentDir(), file)
  try {
    return await realpath(path)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const entry = await lstat(path).catch((failure) => {
      if (failure.code !== 'ENOENT') throw failure
      return null
    })
    if (entry?.isSymbolicLink()) throw settingsError(`${file} is a broken symbolic link. Restore its target before saving.`, 409)
    return path
  }
}

async function readAt(path, file) {
  let text
  let mode = 0o600
  let exists = true
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > maxBytes) throw settingsError(`${file} is not a supported configuration file`, 409)
    mode = info.mode & 0o600
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    exists = false
    text = file === 'models.json' ? '{\n  "providers": {}\n}\n' : '{\n  "mcpServers": {}\n}\n'
  }
  return {
    path,
    text,
    mode,
    data: parseConfig(text, file),
    revision: createHash('sha256').update(exists ? text : `missing:${file}`).digest('hex'),
  }
}

export async function readPiConfig(file) {
  return readAt(await configPath(file), file)
}

export async function updatePiConfig(file, revision, changes) {
  if (typeof revision !== 'string' || !revision) throw settingsError('Refresh settings before saving.', 409)
  const path = await configPath(file)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const release = await lockfile.lock(path, { realpath: false, retries: { retries: 8, minTimeout: 30, maxTimeout: 200 } })
  let temporary
  try {
    const current = await readAt(path, file)
    if (revision !== current.revision) throw settingsError('This configuration changed outside this editor. Refresh it before saving.', 409)
    const patches = typeof changes === 'function' ? await changes(current.data) : changes
    if (!Array.isArray(patches)) throw settingsError('Invalid configuration changes')
    const bom = current.text.startsWith('\uFEFF') ? '\uFEFF' : ''
    let text = current.text.slice(bom.length)
    const indentation = text.match(/\n([ \t]+)"/)?.[1] || '  '
    for (const patch of patches) {
      if (!Array.isArray(patch.path) || !patch.path.length
        || patch.path.some((part) => !['string', 'number'].includes(typeof part))) {
        throw settingsError('Invalid configuration field')
      }
      text = applyEdits(text, modify(text, patch.path, patch.value, {
        formattingOptions: { insertSpaces: !indentation.includes('\t'), tabSize: indentation.length, eol: text.includes('\r\n') ? '\r\n' : '\n' },
      }))
    }
    text = bom + text
    if (Buffer.byteLength(text) > maxBytes) throw settingsError('Configuration is too large')
    parseConfig(text, file)
    temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
    const descriptor = await open(temporary, 'wx', current.mode || 0o600)
    try {
      await descriptor.writeFile(text)
      await descriptor.sync()
    } finally {
      await descriptor.close()
    }
    if ((await readAt(path, file)).revision !== current.revision) {
      throw settingsError('This configuration changed while saving. Refresh it before saving again.', 409)
    }
    await rename(temporary, path)
    temporary = undefined
    return await readAt(path, file)
  } finally {
    if (temporary) await rm(temporary, { force: true })
    await release()
  }
}
