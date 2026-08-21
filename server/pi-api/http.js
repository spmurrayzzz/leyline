import {
  constants,
  createBrotliCompress,
  createGzip,
} from 'node:zlib'

const MIN_COMPRESSION_BYTES = 1024

export function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => {
      if (!data) return resolve({})

      try {
        resolve(JSON.parse(data))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

export function json(res, data, status = 200) {
  if (res.destroyed || res.writableEnded) return
  const serialized = JSON.stringify(data)
  const body = Buffer.from(serialized === undefined ? '' : serialized)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  appendVary(res, 'Accept-Encoding')

  const encoding = preferredEncoding(
    res.req?.headers?.['accept-encoding'],
    body.length >= MIN_COMPRESSION_BYTES,
  )
  if (encoding === undefined) {
    res.statusCode = 406
    res.setHeader('Content-Length', 0)
    return res.end()
  }
  if (!encoding) {
    res.setHeader('Content-Length', body.length)
    return res.end(body)
  }

  res.setHeader('Content-Encoding', encoding)
  const compressor = encoding === 'br'
    ? createBrotliCompress({
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 4,
        },
      })
    : createGzip()
  const cancel = () => compressor.destroy()
  res.once('close', cancel)
  compressor.once('end', () => res.off('close', cancel))
  compressor.once('error', (error) => {
    res.off('close', cancel)
    if (res.destroyed || res.writableEnded) return
    compressor.unpipe(res)
    if (res.headersSent) {
      res.destroy(error)
      return
    }
    res.removeHeader('Content-Encoding')
    res.setHeader('Content-Length', body.length)
    res.end(body)
  })
  compressor.pipe(res)
  compressor.end(body)
}

function preferredEncoding(header, preferCompression) {
  const accepted = new Map()
  for (const part of String(header || '').split(',')) {
    const [name, ...parameters] = part.trim().toLowerCase().split(';')
    if (!name) continue
    const qualityParameter = parameters.find((value) => {
      return value.trim().startsWith('q=')
    })
    const parsed = qualityParameter
      ? Number(qualityParameter.trim().slice(2))
      : 1
    const quality = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
      ? parsed
      : 0
    accepted.set(name, Math.max(accepted.get(name) || 0, quality))
  }

  const wildcard = accepted.get('*')
  const quality = (name) => {
    if (accepted.has(name)) return accepted.get(name)
    return wildcard ?? 0
  }
  const identity = accepted.has('identity')
    ? accepted.get('identity')
    : wildcard === 0
      ? 0
      : 1
  const candidates = preferCompression
    ? [['br', quality('br')], ['gzip', quality('gzip')], ['', identity]]
    : [['', identity], ['br', quality('br')], ['gzip', quality('gzip')]]
  let selected
  let selectedQuality = 0
  for (const [name, candidateQuality] of candidates) {
    if (candidateQuality <= selectedQuality) continue
    selected = name
    selectedQuality = candidateQuality
  }
  return selected
}

function appendVary(res, value) {
  const current = String(res.getHeader('Vary') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (!current.some((item) => item.toLowerCase() === value.toLowerCase())) {
    current.push(value)
  }
  res.setHeader('Vary', current.join(', '))
}

export function html(res, content, filename, inline = false) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; `
      + `filename="${filename.replace(/"/g, '')}"`,
  )
  res.end(content)
}
